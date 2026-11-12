/**
 * Lines › Grupos: la vista de la tabla (qué columnas, en qué orden, cómo se
 * ordena y qué filtros tiene). Se guarda por persona en el navegador. Puro:
 * sin base de datos ni React.
 *
 * Columnas:
 * - las del grupo: 'lines', 'members', 'labels', 'company', 'activity', 'created', 'status';
 * - una propiedad de zerosoft: 'prop:<clave>';
 * - una propiedad de la empresa de HubSpot: 'hs:<nombre interno>'.
 * El nombre del grupo va siempre, primero.
 */
import { parseLinesFilters, type LinesFilters } from './groups-filters';
import { HUBSPOT_PROP_NAME } from './groups-hubspot-shared';

export const GROUP_COLUMNS = ['lines', 'members', 'labels', 'company', 'activity', 'created', 'status'] as const;
export type GroupColumn = (typeof GROUP_COLUMNS)[number];

export interface GroupsSort {
  col: string;
  dir: 'asc' | 'desc';
}

export interface GroupsView {
  columns: string[];
  sort: GroupsSort | null;
  /** Abiertos, cerrados o los dos (vacío: los dos). Va aparte porque en la bandeja "sin estado" es "abiertos". */
  status: Array<'open' | 'closed'>;
  /** Los demás filtros del panel (sin estado ni búsqueda). */
  filters: LinesFilters;
}

export const MAX_COLUMNS = 40;
/** Cuántos chats que cumplen los filtros mira la tabla (los de actividad más reciente). */
export const GROUPS_TABLE_MAX = 500;
const PROP_KEY = /^[a-z0-9_]{1,40}$/;

export const propColumn = (key: string) => `prop:${key}`;
export const hsColumn = (name: string) => `hs:${name}`;

/** ¿Es una columna que la tabla sabe dibujar? (las propiedades se validan aparte contra lo que existe). */
export function validColumn(id: string): boolean {
  if ((GROUP_COLUMNS as readonly string[]).includes(id)) return true;
  if (id.startsWith('prop:')) return PROP_KEY.test(id.slice(5));
  if (id.startsWith('hs:')) return HUBSPOT_PROP_NAME.test(id.slice(3));
  return false;
}

/** Lo de siempre: líneas, miembros, etiquetas, empresa, las dos primeras propiedades y la actividad. */
export function defaultView(propKeys: string[]): GroupsView {
  return {
    columns: ['lines', 'members', 'labels', 'company', ...propKeys.slice(0, 2).map(propColumn), 'activity'],
    sort: null,
    status: [],
    filters: {},
  };
}

/**
 * Lo guardado en el navegador → una vista válida. `legacy` son las columnas
 * de propiedades de la versión anterior de la tabla (solo claves).
 */
export function parseView(raw: unknown, propKeys: string[], legacy?: unknown): GroupsView {
  const base = defaultView(propKeys);
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!r) {
    if (Array.isArray(legacy)) {
      const props = legacy.filter((k): k is string => typeof k === 'string' && propKeys.includes(k)).map(propColumn);
      return { ...base, columns: [...base.columns.filter((c) => !c.startsWith('prop:') && c !== 'activity'), ...props, 'activity'] };
    }
    return base;
  }
  const columns = Array.isArray(r.columns)
    ? [...new Set(r.columns.filter((c): c is string => typeof c === 'string' && validColumn(c)))]
        .filter((c) => !c.startsWith('prop:') || propKeys.includes(c.slice(5)))
        .slice(0, MAX_COLUMNS)
    : base.columns;
  const s = (r.sort && typeof r.sort === 'object' ? r.sort : null) as Record<string, unknown> | null;
  const sort: GroupsSort | null =
    s && typeof s.col === 'string' && (s.col === 'name' || validColumn(s.col)) && (s.dir === 'asc' || s.dir === 'desc') ? { col: s.col, dir: s.dir } : null;
  const status = (['open', 'closed'] as const).filter((x) => Array.isArray(r.status) && r.status.includes(x));
  const { status: _s, q: _q, ...filters } = parseLinesFilters(r.filters);
  return { columns, sort, status: status.length === 2 ? [] : status, filters };
}

/** Las propiedades de HubSpot que la vista muestra (lo que se le pide a la API). */
export function hsColumnsOf(columns: string[]): string[] {
  return columns.filter((c) => c.startsWith('hs:')).map((c) => c.slice(3));
}

/** Mostrar u ocultar una columna (al mostrarla va al final, antes de la actividad si está). */
export function toggleColumn(columns: string[], id: string): string[] {
  if (columns.includes(id)) return columns.filter((c) => c !== id);
  if (columns.length >= MAX_COLUMNS) return columns;
  const at = columns.indexOf('activity');
  return at === -1 || id === 'created' || id === 'status' ? [...columns, id] : [...columns.slice(0, at), id, ...columns.slice(at)];
}

/** Clic en el encabezado: ascendente, descendente y sin orden. */
export function nextSort(sort: GroupsSort | null, col: string): GroupsSort | null {
  if (!sort || sort.col !== col) return { col, dir: 'asc' };
  return sort.dir === 'asc' ? { col, dir: 'desc' } : null;
}

export type SortValue = string | number | null;

/**
 * Ordena por el valor que da `value` (texto sin importar mayúsculas ni
 * tildes, números de menor a mayor). Lo vacío va siempre al final; a igual
 * valor queda el orden de antes.
 */
export function sortRows<T>(rows: T[], dir: 'asc' | 'desc', value: (row: T) => SortValue, locale = 'en'): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const ea = a.v === null || a.v === '';
      const eb = b.v === null || b.v === '';
      if (ea || eb) return ea && eb ? a.i - b.i : ea ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}
