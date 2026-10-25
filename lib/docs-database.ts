/**
 * Bases de datos de Docs y Notes (bloque `database`), estilo Notion. Puro:
 * sin DB ni DOM. Lo usan el editor (components/docs/database), las vistas de
 * solo lectura, la búsqueda, el export y el saneado del servidor.
 *
 * Formato (ver tipos en lib/docs-types.ts): `block.db` con propiedades
 * tipadas, filas con valores por id de propiedad (y un cuerpo de bloques: la
 * fila abierta como página) y vistas guardadas (tabla, board, galería) con
 * filtro, orden, agrupado, propiedades ocultas y anchos.
 *
 * Las bases viejas (`columns` + `rows` posicionales + `view`) se migran al
 * leer (normalizeDatabase, determinístico: mismos ids en cada lectura) y se
 * guardan en el formato nuevo con la primera edición.
 */
import type {
  DbRowTemplate,
  DbFilter,
  DbFilterOp,
  DbOption,
  DbProperty,
  DbPropertyType,
  DbRow,
  DbSort,
  DbStatusGroup,
  DbValue,
  DbViewConfig,
  DbViewType,
  DocsBlock,
  DocsDatabase,
} from './docs-types';

/** Minúsculas y sin tildes (igual que normalizeSearch de lib/docs-search.ts, sin importarlo: evita el ciclo). */
function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Href seguro de una celda URL/email/teléfono (null si no sirve como link). */
export function dbValueHref(type: DbPropertyType, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (type === 'url') {
    if (/^https?:\/\/[^\s]+$/i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
    return null;
  }
  if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null;
  if (type === 'phone') {
    const digits = v.replace(/[^\d+]/g, '');
    return digits.length >= 3 ? `tel:${digits}` : null;
  }
  return null;
}

export const DB_PROPERTY_TYPES: DbPropertyType[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'created_time',
  'last_edited_time',
  'formula',
  'relation',
  'rollup',
  'files',
  'created_by',
  'last_edited_by',
  'unique_id',
  'button',
  'place',
];

export const DB_STATUS_GROUPS: DbStatusGroup[] = ['todo', 'in_progress', 'done'];

/** Topes (los chequea también el schema del servidor). */
export const DB_MAX_ROWS = 2000;
export const DB_MAX_PROPERTIES = 40;
export const DB_MAX_OPTIONS = 100;
export const DB_MAX_VIEWS = 20;
export const DB_MAX_BODY_BLOCKS = 500;
export const DB_MAX_TEMPLATES = 30;

/** Tipos cuyo valor es texto libre. */
const TEXT_TYPES = new Set<DbPropertyType>(['title', 'text', 'url', 'email', 'phone', 'place']);
/**
 * Tipos que no se editan a mano: salen de la fila (creado/editado), se
 * calculan (fórmula, rollup) o los asigna la base (ID único). El botón no
 * tiene valor. El ID único sí se guarda (lo numera addRow y lo repara el
 * servidor); los demás no.
 */
const COMPUTED_TYPES = new Set<DbPropertyType>(['created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'formula', 'rollup', 'unique_id', 'button']);
/** Tipos calculados que dependen de otras propiedades (se resuelven en lib/docs-db-compute.ts). */
const DERIVED_TYPES = new Set<DbPropertyType>(['formula', 'rollup']);
/** Tipos con opciones. */
const OPTION_TYPES = new Set<DbPropertyType>(['select', 'multi_select', 'status']);
/** Se puede agrupar (tabla) o armar columnas (board) por estos tipos. */
export const DB_GROUPABLE_TYPES = new Set<DbPropertyType>(['select', 'status', 'person', 'checkbox']);

export const isTextType = (t: DbPropertyType) => TEXT_TYPES.has(t);
export const isComputedType = (t: DbPropertyType) => COMPUTED_TYPES.has(t);
export const isOptionType = (t: DbPropertyType) => OPTION_TYPES.has(t);
export const isDerivedType = (t: DbPropertyType) => DERIVED_TYPES.has(t);
/** Tipos que guardan una lista de ids de persona (o la calculan). */
export const isPersonType = (t: DbPropertyType) => t === 'person' || t === 'created_by' || t === 'last_edited_by';

/** Tipo con el que se filtra, ordena y muestra una propiedad (fórmula y rollup según su resultado). */
export function effectiveType(prop: DbProperty): DbPropertyType {
  if (prop.type === 'formula' || prop.type === 'rollup') {
    switch (prop.kind) {
      case 'number':
        return 'number';
      case 'checkbox':
        return 'checkbox';
      case 'date':
        return 'date';
      default:
        return 'text';
    }
  }
  if (prop.type === 'created_by' || prop.type === 'last_edited_by') return 'person';
  if (prop.type === 'unique_id') return 'number';
  return prop.type;
}

/** Texto de un ID único: "TASK-12" o "12". */
export function formatUniqueId(prop: Pick<DbProperty, 'prefix'>, v: unknown): string {
  if (typeof v !== 'number') return '';
  return prop.prefix ? `${prop.prefix}-${v}` : String(v);
}

/** Id corto (filas, opciones, vistas): entra en un link `[[` (data-row) y pesa poco con 1.000 filas. */
export function newDbId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-2);
}

export interface DefaultDatabaseLabels {
  name: string;
  status: string;
  due: string;
  notStarted: string;
  inProgress: string;
  done: string;
}

const EN_LABELS: DefaultDatabaseLabels = {
  name: 'Name',
  status: 'Status',
  due: 'Due',
  notStarted: 'Not started',
  inProgress: 'In progress',
  done: 'Done',
};

export function defaultStatusOptions(labels: Pick<DefaultDatabaseLabels, 'notStarted' | 'inProgress' | 'done'> = EN_LABELS): DbOption[] {
  return [
    { id: newDbId(), name: labels.notStarted, group: 'todo' },
    { id: newDbId(), name: labels.inProgress, group: 'in_progress' },
    { id: newDbId(), name: labels.done, group: 'done' },
  ];
}

/** Base nueva (`/database`): Name, Status y Due, una fila vacía y una vista tabla. */
export function defaultDatabase(labels: DefaultDatabaseLabels = EN_LABELS, now = new Date().toISOString()): DocsDatabase {
  const title: DbProperty = { id: newDbId(), name: labels.name, type: 'title' };
  const status: DbProperty = { id: newDbId(), name: labels.status, type: 'status', options: defaultStatusOptions(labels) };
  const due: DbProperty = { id: newDbId(), name: labels.due, type: 'date' };
  const view: DbViewConfig = { id: newDbId(), name: '', type: 'table' };
  return {
    properties: [title, status, due],
    // La primera fila arranca en "Not started", como las que se agregan después (y como Notion).
    rows: [{ id: newDbId(), values: { [status.id]: status.options![0].id }, created_at: now, updated_at: now }],
    views: [view],
    active_view: view.id,
  };
}

// ---------- Migración del formato viejo ----------

const LEGACY_EPOCH = '1970-01-01T00:00:00.000Z';

const STATUS_DONE_RE = /^(done|complete|completed|finished|closed|hecho|listo|terminad[oa]|completad[oa]|cerrad[oa]|feito|conclu[ií]d[oa]|pronto)$/i;
const STATUS_PROGRESS_RE = /(progress|doing|curso|haciendo|andamento|fazendo|wip|review|revisi)/i;

/** Grupo de status que corresponde a un nombre de opción (para migrar o convertir). */
export function guessStatusGroup(name: string): DbStatusGroup {
  const n = name.trim();
  if (STATUS_DONE_RE.test(n)) return 'done';
  if (STATUS_PROGRESS_RE.test(n)) return 'in_progress';
  return 'todo';
}

function legacyToDatabase(block: DocsBlock): DocsDatabase {
  const cols = block.columns?.length
    ? block.columns
    : [{ id: `${block.id}-c0`, name: 'Name', type: 'text' as const }];
  const titleIdx = Math.max(0, cols.findIndex((c) => c.type === 'text'));
  const hasText = cols.some((c) => c.type === 'text');
  const properties: DbProperty[] = [];
  const optionIds = new Map<string, Map<string, string>>();
  cols.forEach((c, i) => {
    if (c.type === 'select') {
      const map = new Map<string, string>();
      const names = [...(c.options ?? [])];
      // Valores usados que no estaban entre las opciones también pasan a ser opción.
      for (const row of block.rows ?? []) {
        const v = (row[i] ?? '').trim();
        if (v && !names.includes(v)) names.push(v);
      }
      const options = names.slice(0, DB_MAX_OPTIONS).map((name, k) => {
        const id = `${c.id}-o${k}`;
        map.set(name, id);
        return { id, name };
      });
      optionIds.set(c.id, map);
      properties.push({ id: c.id, name: c.name, type: 'select', options });
      return;
    }
    const type: DbPropertyType = hasText && i === titleIdx ? 'title' : c.type;
    properties.push({ id: c.id, name: c.name, type });
  });
  if (!hasText) properties.unshift({ id: `${block.id}-title`, name: 'Name', type: 'title' });
  const rows: DbRow[] = (block.rows ?? []).slice(0, DB_MAX_ROWS).map((row, r) => {
    const values: Record<string, DbValue> = {};
    cols.forEach((c, i) => {
      const raw = (row[i] ?? '').trim();
      if (!raw) return;
      if (c.type === 'select') {
        const id = optionIds.get(c.id)?.get(raw);
        if (id) values[c.id] = id;
      } else if (c.type === 'number') {
        const n = parseNumber(raw);
        if (n !== null) values[c.id] = n;
      } else if (c.type === 'date') {
        const d = parseDateText(raw);
        if (d) values[c.id] = d;
      } else {
        values[c.id] = row[i] ?? '';
      }
    });
    return { id: `${block.id}-r${r}`, values, created_at: LEGACY_EPOCH, updated_at: LEGACY_EPOCH };
  });
  const table: DbViewConfig = { id: `${block.id}-vt`, name: '', type: 'table' };
  const views: DbViewConfig[] = [table];
  let active = table.id;
  if (block.view === 'gallery') {
    const gallery: DbViewConfig = { id: `${block.id}-vg`, name: '', type: 'gallery' };
    views.push(gallery);
    active = gallery.id;
  }
  return { properties, rows, views, active_view: active };
}

/** Arregla lo mínimo de un `db` guardado: una propiedad title primero y al menos una vista. */
function repairDatabase(db: DocsDatabase): DocsDatabase {
  let properties = Array.isArray(db.properties) ? db.properties : [];
  const titleIdx = properties.findIndex((p) => p.type === 'title');
  let changed = false;
  if (titleIdx === -1) {
    properties = [{ id: 'title', name: 'Name', type: 'title' }, ...properties];
    changed = true;
  } else if (titleIdx > 0) {
    const t = properties[titleIdx];
    properties = [t, ...properties.filter((_, i) => i !== titleIdx)];
    changed = true;
  }
  let views = Array.isArray(db.views) ? db.views : [];
  if (views.length === 0) {
    views = [{ id: 'default', name: '', type: 'table' }];
    changed = true;
  }
  const rows = Array.isArray(db.rows) ? db.rows : [];
  if (!changed && rows === db.rows) return db;
  return { ...db, properties, views, rows };
}

const normalized = new WeakMap<DocsBlock, DocsDatabase>();

/**
 * La base de un bloque en el formato nuevo. Cacheada por bloque (mismo objeto
 * → mismo resultado: los memos de la tabla no se invalidan en cada render).
 */
export function normalizeDatabase(block: DocsBlock): DocsDatabase {
  const hit = normalized.get(block);
  if (hit) return hit;
  const db = block.db ? repairDatabase(block.db) : legacyToDatabase(block);
  normalized.set(block, db);
  return db;
}

/** Patch del bloque para guardar una base (y soltar el formato viejo). */
export function databasePatch(db: DocsDatabase): Partial<DocsBlock> {
  return { db, columns: undefined, rows: undefined, view: undefined };
}

// ---------- Lectura ----------

export function titleProperty(db: DocsDatabase): DbProperty {
  return db.properties.find((p) => p.type === 'title') ?? db.properties[0];
}

export function rowTitle(db: DocsDatabase, row: DbRow): string {
  const v = row.values[titleProperty(db)?.id ?? ''];
  return typeof v === 'string' ? v : '';
}

export function activeView(db: DocsDatabase): DbViewConfig {
  return db.views.find((v) => v.id === db.active_view) ?? db.views[0];
}

export function findRow(db: DocsDatabase, rowId: string): DbRow | undefined {
  return db.rows.find((r) => r.id === rowId);
}

/** Valor crudo de una propiedad (los computados salen de la fila). */
export function cellValue(prop: DbProperty, row: DbRow): DbValue {
  if (prop.type === 'created_time') return row.created_at;
  if (prop.type === 'last_edited_time') return row.updated_at;
  if (prop.type === 'created_by') return row.created_by ? [row.created_by] : [];
  if (prop.type === 'last_edited_by') return row.updated_by ? [row.updated_by] : row.created_by ? [row.created_by] : [];
  if (prop.type === 'files') return (row.files?.[prop.id] ?? []).map((f) => f.name);
  if (prop.type === 'button') return null;
  return row.values[prop.id] ?? null;
}

/** En una tarjeta de board no se muestra: vacío, o un checkbox sin tildar. */
export function cardHidesValue(prop: Pick<DbProperty, 'type'>, v: DbValue | undefined): boolean {
  return prop.type === 'checkbox' ? v !== true : isEmptyValue(v);
}

export function isEmptyValue(v: DbValue | undefined): boolean {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function optionById(prop: DbProperty, id: unknown): DbOption | undefined {
  return typeof id === 'string' ? prop.options?.find((o) => o.id === id) : undefined;
}

/** Opciones de status en el orden de sus grupos (To-do, In progress, Done). */
export function orderedOptions(prop: DbProperty): DbOption[] {
  const opts = prop.options ?? [];
  if (prop.type !== 'status') return opts;
  return DB_STATUS_GROUPS.flatMap((g) => opts.filter((o) => (o.group ?? 'todo') === g));
}

export interface DbFormatContext {
  /** id de persona → nombre a mostrar. */
  people?: Record<string, string>;
  locale?: string;
  /** id de fila (de esta u otra base) → título, para mostrar relaciones. */
  rowTitles?: Record<string, string>;
}

/** 'YYYY-MM-DD' de una fecha local (sin corrimiento por timezone). */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Día (local) de un valor de fecha: 'YYYY-MM-DD' tal cual o un timestamp ISO. */
export function dayKey(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return localDateKey(new Date(t));
}

export function formatDate(v: string, locale?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTimestamp(v: string, locale?: string): string {
  const t = Date.parse(v);
  if (Number.isNaN(t) || v === LEGACY_EPOCH) return '';
  return new Date(t).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatNumber(n: number, locale?: string): string {
  return n.toLocaleString(locale, { maximumFractionDigits: 10 });
}

/** Texto de una celda (búsqueda, export, conversión a texto, read-only). */
export function formatValue(prop: DbProperty, row: DbRow, ctx: DbFormatContext = {}): string {
  const v = cellValue(prop, row);
  const type = effectiveType(prop);
  if (isEmptyValue(v) && type !== 'checkbox') return '';
  if (prop.type === 'unique_id') return formatUniqueId(prop, v);
  if (prop.type === 'relation') {
    return (Array.isArray(v) ? v : []).map((id) => ctx.rowTitles?.[id] ?? '').filter(Boolean).join(', ');
  }
  if (prop.type === 'files') return (Array.isArray(v) ? v : []).join(', ');
  if ((prop.type === 'formula' || prop.type === 'rollup') && type === 'number' && typeof v === 'number') {
    return prop.kind === 'number' && prop.rollup?.fn?.startsWith('percent') ? `${formatNumber(Math.round(v * 1000) / 10, ctx.locale)}%` : formatNumber(v, ctx.locale);
  }
  switch (type) {
    case 'number':
      return typeof v === 'number' ? formatNumber(v, ctx.locale) : '';
    case 'select':
    case 'status':
      return optionById(prop, v)?.name ?? '';
    case 'multi_select':
      return (Array.isArray(v) ? v : [])
        .map((id) => optionById(prop, id)?.name)
        .filter(Boolean)
        .join(', ');
    case 'person':
      return (Array.isArray(v) ? v : []).map((id) => ctx.people?.[id] ?? '').filter(Boolean).join(', ');
    case 'checkbox':
      return v === true ? 'Yes' : 'No';
    case 'date':
      return typeof v === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, ctx.locale) : formatTimestamp(v, ctx.locale)) : '';
    case 'created_time':
    case 'last_edited_time':
      return typeof v === 'string' ? formatTimestamp(v, ctx.locale) : '';
    default:
      return typeof v === 'string' ? v : String(v ?? '');
  }
}

// ---------- Parseo ----------

/** Número de un texto ("1.234,5", "$ 30", "12%"): null si no hay. */
export function parseNumber(text: string): number | null {
  let s = text.trim().replace(/[^\d.,\-eE+]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Fecha 'YYYY-MM-DD' de un texto (ISO, o lo que entienda Date.parse): null si no hay. */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : localDateKey(d);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : localDateKey(new Date(t));
}

const TRUE_WORDS = new Set(['yes', 'y', 'true', 'x', '1', '✓', '✔', 'done', 'si', 'sí', 'sim', 'checked', 'ok']);

export function parseCheckbox(text: string): boolean {
  return TRUE_WORDS.has(text.trim().toLowerCase());
}

// ---------- Cambio de tipo ----------

export interface DbConvertContext extends DbFormatContext {
  /** Miembros del workspace (texto → persona por nombre o email). */
  members?: Array<{ id: string; name: string | null; email: string }>;
}

/**
 * Cambia el tipo de una propiedad convirtiendo los valores de todas las filas:
 * texto ↔ número/fecha/checkbox, texto → opciones (crea una por valor distinto),
 * select ↔ multi_select ↔ status (mismas opciones), persona ↔ texto por nombre.
 * Lo que no se puede convertir queda vacío. created/last edited no guardan valor.
 */
export function changePropertyType(
  db: DocsDatabase,
  propId: string,
  type: DbPropertyType,
  ctx: DbConvertContext = {},
): DocsDatabase {
  const prop = db.properties.find((p) => p.id === propId);
  if (!prop || prop.type === type || prop.type === 'title' || type === 'title') return db;
  const next: DbProperty = { id: prop.id, name: prop.name, type };
  // Opciones: se conservan entre tipos con opciones; desde otros se crean.
  let options: DbOption[] = [];
  if (isOptionType(type)) {
    if (isOptionType(prop.type)) {
      options = (prop.options ?? []).map((o) => {
        if (type === 'status') return { id: o.id, name: o.name, group: o.group ?? guessStatusGroup(o.name) };
        return { id: o.id, name: o.name };
      });
    } else if (prop.type === 'checkbox' && type === 'status') {
      options = defaultStatusOptions();
    }
  }
  const byName = new Map(options.map((o) => [o.name.trim().toLowerCase(), o.id]));
  const optionFor = (name: string): string | null => {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    const hit = byName.get(key);
    if (hit) return hit;
    if (options.length >= DB_MAX_OPTIONS) return null;
    const o: DbOption = { id: newDbId(), name: name.trim() };
    if (type === 'status') o.group = guessStatusGroup(o.name);
    options.push(o);
    byName.set(key, o.id);
    return o.id;
  };
  const memberFor = (text: string): string | null => {
    const key = text.trim().toLowerCase();
    if (!key) return null;
    const m = ctx.members?.find((u) => (u.name ?? '').trim().toLowerCase() === key || u.email.toLowerCase() === key);
    return m?.id ?? null;
  };

  const convert = (row: DbRow): DbValue => {
    const v = cellValue(prop, row);
    if (isComputedType(type)) return null;
    // Texto plano del valor viejo (para destinos que parten de texto).
    const asText = (): string => {
      if (prop.type === 'date' && typeof v === 'string') return v;
      if (prop.type === 'created_time' || prop.type === 'last_edited_time') return dayKey(v) ?? '';
      if (prop.type === 'unique_id') return typeof v === 'number' ? String(v) : '';
      if (prop.type === 'number' && typeof v === 'number') return String(v);
      return formatValue(prop, row, ctx);
    };
    if (isTextType(type)) {
      if (prop.type === 'checkbox') return v === true ? 'Yes' : 'No';
      return asText() || null;
    }
    switch (type) {
      case 'number': {
        if (prop.type === 'checkbox') return v === true ? 1 : 0;
        return parseNumber(asText());
      }
      case 'date':
        return prop.type === 'created_time' || prop.type === 'last_edited_time' ? dayKey(v) : parseDateText(asText());
      case 'checkbox': {
        if (prop.type === 'number') return typeof v === 'number' && v !== 0;
        if (prop.type === 'status') return optionById(prop, v)?.group === 'done';
        if (prop.type === 'multi_select' || prop.type === 'person') return Array.isArray(v) && v.length > 0;
        return parseCheckbox(asText());
      }
      case 'select':
      case 'status': {
        if (prop.type === 'checkbox' && type === 'status') {
          const opts = options;
          return (v === true ? opts.find((o) => o.group === 'done') : opts.find((o) => o.group === 'todo'))?.id ?? null;
        }
        if (isOptionType(prop.type)) {
          const first = Array.isArray(v) ? v[0] : v;
          return typeof first === 'string' && options.some((o) => o.id === first) ? first : null;
        }
        if (prop.type === 'checkbox') return v === true ? optionFor('Yes') : null;
        const text = prop.type === 'person' ? formatValue(prop, row, ctx).split(',')[0] ?? '' : asText();
        return optionFor(text);
      }
      case 'multi_select': {
        if (isOptionType(prop.type)) {
          const ids = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
          return ids.filter((id) => options.some((o) => o.id === id));
        }
        if (prop.type === 'checkbox') return v === true ? [optionFor('Yes')!].filter(Boolean) : [];
        const text = asText();
        return [...new Set(text.split(',').map((s) => optionFor(s)).filter((id): id is string => Boolean(id)))];
      }
      case 'person': {
        if (isPersonType(prop.type)) return v;
        const parts = asText().split(',');
        return [...new Set(parts.map(memberFor).filter((id): id is string => Boolean(id)))];
      }
      default:
        return null;
    }
  };

  let seq = 0;
  const rows = db.rows.map((row) => {
    // ID único: se numeran todas las filas en el orden de la base.
    const value = type === 'unique_id' ? ++seq : convert(row);
    const values = { ...row.values };
    if (isEmptyValue(value) && type !== 'checkbox') delete values[prop.id];
    else values[prop.id] = value;
    let files = row.files;
    if (prop.type === 'files' && files?.[prop.id]) {
      files = { ...files };
      delete files[prop.id];
    }
    const out: DbRow = { ...row, values };
    if (files && Object.keys(files).length) out.files = files;
    else delete out.files;
    return out;
  });
  if (isOptionType(type)) next.options = options;
  if (type === 'unique_id') next.next_id = seq + 1;
  if (type === 'formula') next.formula = '';
  if (type === 'button') next.button = { label: prop.name, actions: [] };
  // Las vistas que filtraban o agrupaban por esta propiedad pierden esas condiciones (otro tipo, otros operadores).
  const views = db.views.map((view) => ({
    ...view,
    filters: view.filters?.filter((f) => f.property !== prop.id),
    group_by: view.group_by === prop.id && !DB_GROUPABLE_TYPES.has(type) ? null : view.group_by,
  }));
  return {
    ...db,
    properties: db.properties.map((p) => (p.id === prop.id ? next : p)),
    rows,
    views,
  };
}

// ---------- Edición ----------

/**
 * Numera los IDs únicos de una fila nueva (y avanza el contador de la
 * propiedad). Nunca reusa un número, como en Notion.
 */
function stampUniqueIds(db: DocsDatabase, values: Record<string, DbValue>): { properties: DbProperty[]; values: Record<string, DbValue> } {
  if (!db.properties.some((p) => p.type === 'unique_id')) return { properties: db.properties, values };
  const out = { ...values };
  const properties = db.properties.map((p) => {
    if (p.type !== 'unique_id') return p;
    const next = nextUniqueId(db, p);
    out[p.id] = next;
    return { ...p, next_id: next + 1 };
  });
  return { properties, values: out };
}

/** Próximo número de un ID único: el contador, o uno más que el mayor usado. */
export function nextUniqueId(db: DocsDatabase, prop: DbProperty): number {
  let max = 0;
  for (const r of db.rows) {
    const v = r.values[prop.id];
    if (typeof v === 'number' && v > max) max = v;
  }
  return Math.max(prop.next_id ?? 1, max + 1);
}

/** Opción con la que arranca una fila nueva en un status: la primera de "Por hacer" (como "Not started" en Notion). */
export function defaultStatusId(prop: DbProperty): string | null {
  if (prop.type !== 'status') return null;
  const opts = orderedOptions(prop);
  return (opts.find((o) => (o.group ?? 'todo') === 'todo') ?? opts[0])?.id ?? null;
}

export function addRow(db: DocsDatabase, values: Record<string, DbValue> = {}, now = new Date().toISOString(), at?: number): { db: DocsDatabase; row: DbRow } {
  let withDefaults = values;
  for (const p of db.properties) {
    // Un null explícito (fila nueva en la columna "Sin estado") la deja vacía.
    if (p.type !== 'status' || p.id in values) continue;
    const id = defaultStatusId(p);
    if (id) withDefaults = { ...withDefaults, [p.id]: id };
  }
  for (const [k, v] of Object.entries(withDefaults)) {
    if (v === null) {
      if (withDefaults === values) withDefaults = { ...values };
      delete withDefaults[k];
    }
  }
  const stamped = stampUniqueIds(db, withDefaults);
  const row: DbRow = { id: newDbId(), values: stamped.values, created_at: now, updated_at: now };
  db = stamped.properties === db.properties ? db : { ...db, properties: stamped.properties };
  const rows = [...db.rows];
  rows.splice(at === undefined ? rows.length : Math.max(0, Math.min(at, rows.length)), 0, row);
  return { db: { ...db, rows }, row };
}

// ---------- Plantillas de fila ----------

/**
 * Lo que una plantilla puede llevar: valores editables de propiedades que
 * existen. Lo calculado (fórmula, rollup, ID único, creado/editado, botón) y
 * el lado espejo de una relación de dos vías se arman solos en la fila nueva.
 */
function templateValues(db: DocsDatabase, values: Record<string, DbValue>): Record<string, DbValue> {
  const out: Record<string, DbValue> = {};
  for (const [k, v] of Object.entries(values)) {
    const p = db.properties.find((x) => x.id === k);
    if (!p || isComputedType(p.type) || p.relation?.mirror_of) continue;
    out[k] = v;
  }
  return out;
}

/** Guarda una fila (valores y cuerpo) como plantilla con ese nombre. */
export function saveRowAsTemplate(db: DocsDatabase, rowId: string, name: string, newId: () => string = newDbId): DocsDatabase {
  const row = findRow(db, rowId);
  if (!row || (db.templates?.length ?? 0) >= DB_MAX_TEMPLATES) return db;
  const tpl: DbRowTemplate = {
    id: newId(),
    name: name.trim().slice(0, 500),
    values: templateValues(db, row.values),
    ...(row.body?.length ? { body: row.body.map((b) => ({ ...b })) } : {}),
  };
  return { ...db, templates: [...(db.templates ?? []), tpl] };
}

/** Fila nueva desde una plantilla (ids de bloque nuevos; los valores pisan a `extra`). */
export function addRowFromTemplate(
  db: DocsDatabase,
  templateId: string,
  extra: Record<string, DbValue> = {},
  now = new Date().toISOString(),
  newId: () => string = () => crypto.randomUUID(),
): { db: DocsDatabase; row: DbRow } | null {
  const tpl = db.templates?.find((x) => x.id === templateId);
  if (!tpl) return null;
  const values: Record<string, DbValue> = { ...extra, ...templateValues(db, tpl.values) };
  const res = addRow(db, values, now);
  if (!tpl.body?.length) return res;
  const body = tpl.body.map((b) => ({ ...b, id: newId() }));
  return { db: updateRow(res.db, res.row.id, { body }, now), row: { ...res.row, body } };
}

export function removeRowTemplate(db: DocsDatabase, templateId: string): DocsDatabase {
  const templates = (db.templates ?? []).filter((x) => x.id !== templateId);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { templates: _old, ...rest } = db;
  return templates.length ? { ...rest, templates } : rest;
}

export function renameRowTemplate(db: DocsDatabase, templateId: string, name: string): DocsDatabase {
  return { ...db, templates: (db.templates ?? []).map((x) => (x.id === templateId ? { ...x, name: name.trim().slice(0, 500) } : x)) };
}

export function updateRow(db: DocsDatabase, rowId: string, patch: Partial<Pick<DbRow, 'values' | 'body'>>, now = new Date().toISOString()): DocsDatabase {
  return {
    ...db,
    rows: db.rows.map((r) => (r.id === rowId ? { ...r, ...patch, updated_at: now } : r)),
  };
}

/** Pone (o borra, si queda vacío) el valor de una celda. */
export function setCell(db: DocsDatabase, rowId: string, propId: string, value: DbValue, now = new Date().toISOString()): DocsDatabase {
  const row = findRow(db, rowId);
  const prop = db.properties.find((p) => p.id === propId);
  if (!row || !prop || isComputedType(prop.type)) return db;
  const values = { ...row.values };
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0) || value === '') delete values[propId];
  else values[propId] = value;
  return updateRow(db, rowId, { values }, now);
}

export function deleteRows(db: DocsDatabase, ids: string[]): DocsDatabase {
  const set = new Set(ids);
  return { ...db, rows: db.rows.filter((r) => !set.has(r.id)) };
}

/** Mueve una fila antes de otra (null: al final). */
export function moveRow(db: DocsDatabase, rowId: string, beforeId: string | null): DocsDatabase {
  if (rowId === beforeId) return db;
  const row = findRow(db, rowId);
  if (!row) return db;
  const rest = db.rows.filter((r) => r.id !== rowId);
  const at = beforeId === null ? rest.length : rest.findIndex((r) => r.id === beforeId);
  rest.splice(at === -1 ? rest.length : at, 0, row);
  return { ...db, rows: rest };
}

export function addProperty(db: DocsDatabase, type: DbPropertyType, name: string): { db: DocsDatabase; property: DbProperty } {
  const property: DbProperty = { id: newDbId(), name, type };
  if (type === 'status') property.options = defaultStatusOptions();
  else if (isOptionType(type)) property.options = [];
  else if (type === 'formula') property.formula = '';
  else if (type === 'button') property.button = { label: name, actions: [] };
  if (type === 'unique_id') {
    // Las filas que ya existen se numeran en orden.
    let n = 0;
    const rows = db.rows.map((r) => ({ ...r, values: { ...r.values, [property.id]: ++n } }));
    property.next_id = n + 1;
    return { db: { ...db, properties: [...db.properties, property], rows }, property };
  }
  return { db: { ...db, properties: [...db.properties, property] }, property };
}

export type DbPropertyPatch = Partial<Pick<DbProperty, 'name' | 'options' | 'formula' | 'relation' | 'rollup' | 'prefix' | 'button' | 'ai'>>;

export function updateProperty(db: DocsDatabase, propId: string, patch: DbPropertyPatch): DocsDatabase {
  return { ...db, properties: db.properties.map((p) => (p.id === propId ? { ...p, ...patch } : p)) };
}

/** Borra una propiedad (nunca el título), sus valores y lo que la usaba en las vistas. */
export function removeProperty(db: DocsDatabase, propId: string): DocsDatabase {
  const prop = db.properties.find((p) => p.id === propId);
  if (!prop || prop.type === 'title') return db;
  return {
    ...db,
    properties: db.properties.filter((p) => p.id !== propId),
    rows: db.rows.map((r) => {
      if (!(propId in r.values) && !r.files?.[propId]) return r;
      const values = { ...r.values };
      delete values[propId];
      const out: DbRow = { ...r, values };
      if (r.files?.[propId]) {
        const files = { ...r.files };
        delete files[propId];
        if (Object.keys(files).length) out.files = files;
        else delete out.files;
      }
      return out;
    }),
    views: db.views.map((v) => removePropFromView(v, propId)),
  };
}

/** Una vista sin las condiciones, orden y agrupados de una propiedad que ya no está. */
export function removePropFromView(v: DbViewConfig, propId: string): DbViewConfig {
  return {
    ...v,
    filters: v.filters?.filter((f) => f.property !== propId),
    sorts: v.sorts?.filter((s) => s.property !== propId),
    group_by: v.group_by === propId ? null : v.group_by,
    hidden: v.hidden?.filter((h) => h !== propId),
    ...(v.sub_group_by === propId ? { sub_group_by: null } : {}),
    ...(v.date_by === propId ? { date_by: null } : {}),
    ...(v.end_by === propId ? { end_by: null } : {}),
  };
}

/** Saca una opción: las celdas que la usaban quedan vacías. */
export function removeOption(db: DocsDatabase, propId: string, optionId: string): DocsDatabase {
  const prop = db.properties.find((p) => p.id === propId);
  if (!prop) return db;
  const next = updateProperty(db, propId, { options: (prop.options ?? []).filter((o) => o.id !== optionId) });
  return {
    ...next,
    rows: next.rows.map((r) => {
      const v = r.values[propId];
      if (v === optionId) {
        const values = { ...r.values };
        delete values[propId];
        return { ...r, values };
      }
      if (Array.isArray(v) && v.includes(optionId)) return { ...r, values: { ...r.values, [propId]: v.filter((x) => x !== optionId) } };
      return r;
    }),
  };
}

export function updateView(db: DocsDatabase, viewId: string, patch: Partial<DbViewConfig>): DocsDatabase {
  return { ...db, views: db.views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) };
}

export function addView(db: DocsDatabase, type: DbViewType, name = ''): { db: DocsDatabase; view: DbViewConfig } {
  const view: DbViewConfig = { id: newDbId(), name, type };
  Object.assign(view, viewDefaults(db, type));
  return { db: { ...db, views: [...db.views, view], active_view: view.id }, view };
}

/**
 * Lo que necesita una vista de ese tipo para mostrarse: columnas del board
 * (status o la primera agrupable), fecha del calendario y de la timeline
 * (inicio y fin: las dos primeras fechas). El calendario y la timeline
 * arrancan mostrando solo el título en las tarjetas, como en Notion.
 */
export function viewDefaults(db: DocsDatabase, type: DbViewType, cur?: DbViewConfig): Partial<DbViewConfig> {
  const out: Partial<DbViewConfig> = {};
  if (type === 'board' && !cur?.group_by) {
    const group = db.properties.find((p) => p.type === 'status') ?? db.properties.find((p) => DB_GROUPABLE_TYPES.has(p.type));
    out.group_by = group?.id ?? null;
  }
  if ((type === 'calendar' || type === 'timeline') && !cur?.date_by) {
    const dates = db.properties.filter((p) => p.type === 'date');
    out.date_by = dates[0]?.id ?? db.properties.find((p) => p.type === 'created_time')?.id ?? null;
    if (type === 'timeline' && dates[1]) out.end_by = dates[1].id;
    if (!cur) out.hidden = db.properties.filter((p) => p.type !== 'title').map((p) => p.id);
  }
  return out;
}

export function duplicateView(db: DocsDatabase, viewId: string): DocsDatabase {
  const src = db.views.find((v) => v.id === viewId);
  if (!src || db.views.length >= DB_MAX_VIEWS) return db;
  const copy: DbViewConfig = { ...structuredCloneSafe(src), id: newDbId() };
  const at = db.views.indexOf(src) + 1;
  const views = [...db.views.slice(0, at), copy, ...db.views.slice(at)];
  return { ...db, views, active_view: copy.id };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Borra una vista (siempre queda una). */
export function removeView(db: DocsDatabase, viewId: string): DocsDatabase {
  if (db.views.length <= 1) return db;
  const views = db.views.filter((v) => v.id !== viewId);
  return { ...db, views, active_view: db.active_view === viewId ? views[0].id : db.active_view };
}

// ---------- Filtro ----------

const TEXT_OPS: DbFilterOp[] = ['contains', 'not_contains', 'is', 'is_not', 'starts_with', 'ends_with', 'empty', 'not_empty'];
const NUMBER_OPS: DbFilterOp[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty'];
const SELECT_OPS: DbFilterOp[] = ['is', 'is_not', 'empty', 'not_empty'];
const MULTI_OPS: DbFilterOp[] = ['contains', 'not_contains', 'empty', 'not_empty'];
const DATE_OPS: DbFilterOp[] = ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'empty', 'not_empty'];
const CHECK_OPS: DbFilterOp[] = ['checked', 'unchecked'];

/** Operadores de filtro de un tipo de propiedad (el primero es el default). */
export function filterOps(type: DbPropertyType): DbFilterOp[] {
  if (isTextType(type)) return TEXT_OPS;
  switch (type) {
    case 'number':
      return NUMBER_OPS;
    case 'select':
    case 'status':
      return SELECT_OPS;
    case 'multi_select':
    case 'person':
      return MULTI_OPS;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return DATE_OPS;
    case 'checkbox':
      return CHECK_OPS;
    case 'relation':
    case 'files':
      return MULTI_OPS;
    case 'button':
      return [];
    default:
      return TEXT_OPS;
  }
}

/** Operadores de filtro de una propiedad (fórmula y rollup según su resultado). */
export function filterOpsFor(prop: DbProperty): DbFilterOp[] {
  return filterOps(effectiveType(prop));
}

/** El operador compara contra un valor (los demás miran solo si hay valor). */
export function opNeedsValue(op: DbFilterOp): boolean {
  return op !== 'empty' && op !== 'not_empty' && op !== 'checked' && op !== 'unchecked';
}

/**
 * Una condición sobre una fila. Una condición a medio armar (sin valor, o
 * sobre una propiedad que ya no existe) no filtra nada, como en Notion.
 */
export function matchesFilter(db: DocsDatabase, row: DbRow, filter: DbFilter, ctx: DbFormatContext = {}): boolean {
  const prop = db.properties.find((p) => p.id === filter.property);
  if (!prop || !filterOpsFor(prop).includes(filter.op)) return true;
  const type = effectiveType(prop);
  let v = cellValue(prop, row);
  const { op } = filter;
  if (op === 'empty') return isEmptyValue(v);
  if (op === 'not_empty') return !isEmptyValue(v);
  if (op === 'checked') return v === true;
  if (op === 'unchecked') return v !== true;
  const target = filter.value;
  if (target === undefined || target === null || target === '' || (Array.isArray(target) && target.length === 0)) return true;

  // Relación y archivos: "contiene" busca en los títulos / nombres.
  if (prop.type === 'relation' || prop.type === 'files') {
    const hay = normalizeSearch(formatValue(prop, row, ctx));
    const hit = hay.includes(normalizeSearch(String(target)));
    return op === 'not_contains' ? !hit : hit;
  }
  if (prop.type === 'unique_id' && typeof target === 'string') v = v ?? null;
  if (isTextType(type)) {
    const hay = normalizeSearch(typeof v === 'string' ? v : '');
    const needle = normalizeSearch(String(target));
    switch (op) {
      case 'contains':
        return hay.includes(needle);
      case 'not_contains':
        return !hay.includes(needle);
      case 'is':
        return hay.trim() === needle.trim();
      case 'is_not':
        return hay.trim() !== needle.trim();
      case 'starts_with':
        return hay.startsWith(needle);
      case 'ends_with':
        return hay.endsWith(needle);
      default:
        return true;
    }
  }
  if (type === 'number') {
    const n = typeof target === 'number' ? target : parseNumber(String(target));
    if (n === null) return true;
    if (typeof v !== 'number') return op === 'neq';
    switch (op) {
      case 'eq':
        return v === n;
      case 'neq':
        return v !== n;
      case 'gt':
        return v > n;
      case 'lt':
        return v < n;
      case 'gte':
        return v >= n;
      case 'lte':
        return v <= n;
      default:
        return true;
    }
  }
  if (prop.type === 'select' || prop.type === 'status') {
    const ids = Array.isArray(target) ? target : [String(target)];
    const hit = typeof v === 'string' && ids.includes(v);
    return op === 'is_not' ? !hit : hit;
  }
  if (prop.type === 'multi_select' || type === 'person') {
    const ids = Array.isArray(target) ? target : [String(target)];
    const have = Array.isArray(v) ? v : [];
    const hit = ids.some((id) => have.includes(id));
    return op === 'not_contains' ? !hit : hit;
  }
  if (type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time') {
    const day = dayKey(v);
    const t = dayKey(target);
    if (!t) return true;
    if (!day) return false;
    switch (op) {
      case 'is':
        return day === t;
      case 'before':
        return day < t;
      case 'after':
        return day > t;
      case 'on_or_before':
        return day <= t;
      case 'on_or_after':
        return day >= t;
      default:
        return true;
    }
  }
  return true;
}

// ---------- Orden ----------

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;

/** Clave comparable de una celda (null = vacía: va siempre al final). */
function sortKey(prop: DbProperty, row: DbRow, ctx: DbFormatContext): string | number | null {
  const v = cellValue(prop, row);
  const type = effectiveType(prop);
  if (type === 'checkbox') return v === true ? 1 : 0;
  if (isEmptyValue(v)) return null;
  if (prop.type === 'relation' || prop.type === 'files') return formatValue(prop, row, ctx) || null;
  if (type === 'date') {
    const t = Date.parse(String(v).length === 10 ? `${v}T00:00:00` : String(v));
    return Number.isNaN(t) ? null : t;
  }
  switch (type) {
    case 'number':
      return typeof v === 'number' ? v : null;
    case 'select':
    case 'status': {
      const i = orderedOptions(prop).findIndex((o) => o.id === v);
      return i === -1 ? null : i;
    }
    case 'multi_select': {
      const opts = prop.options ?? [];
      const idx = (Array.isArray(v) ? v : []).map((id) => opts.findIndex((o) => o.id === id)).filter((i) => i >= 0);
      return idx.length ? Math.min(...idx) : null;
    }
    case 'person':
      return formatValue(prop, row, ctx) || null;
    case 'created_time':
    case 'last_edited_time': {
      const t = Date.parse(String(v));
      return Number.isNaN(t) ? null : t;
    }
    default:
      return String(v);
  }
}

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return collator ? collator.compare(sa, sb) : sa.localeCompare(sb);
}

export function sortRows(db: DocsDatabase, rows: DbRow[], sorts: DbSort[], ctx: DbFormatContext = {}): DbRow[] {
  const keys = sorts
    .map((s) => ({ s, prop: db.properties.find((p) => p.id === s.property) }))
    .filter((k): k is { s: DbSort; prop: DbProperty } => Boolean(k.prop));
  if (keys.length === 0) return rows;
  // Claves calculadas una vez por fila (1.000 filas × varias claves).
  const decorated = rows.map((row, i) => ({ row, i, k: keys.map(({ prop }) => sortKey(prop, row, ctx)) }));
  decorated.sort((a, b) => {
    for (let j = 0; j < keys.length; j++) {
      const ka = a.k[j];
      const kb = b.k[j];
      if (ka === null && kb === null) continue;
      if (ka === null) return 1;
      if (kb === null) return -1;
      const c = compareKeys(ka, kb);
      if (c !== 0) return keys[j].s.direction === 'desc' ? -c : c;
    }
    return a.i - b.i;
  });
  return decorated.map((d) => d.row);
}

/** Filas de una vista: filtros en AND y orden multi-clave (estable: empata por el orden manual). */
export function viewRows(db: DocsDatabase, view: DbViewConfig, ctx: DbFormatContext = {}): DbRow[] {
  const filters = view.filters ?? [];
  const filtered = filters.length ? db.rows.filter((r) => filters.every((f) => matchesFilter(db, r, f, ctx))) : db.rows;
  return sortRows(db, filtered, view.sorts ?? [], ctx);
}

/** Propiedades visibles en una vista (el título siempre). */
export function visibleProperties(db: Pick<DocsDatabase, 'properties'>, view: DbViewConfig): DbProperty[] {
  const hidden = new Set(view.hidden ?? []);
  return db.properties.filter((p) => p.type === 'title' || !hidden.has(p.id));
}

// ---------- Agrupar ----------

export interface DbGroup {
  /** Id de opción, de persona, 'true'/'false' (checkbox) o '' (sin valor). */
  key: string;
  label: string;
  option?: DbOption;
  rows: DbRow[];
}

/** Propiedad de agrupado de una vista, si es agrupable. */
export function groupProperty(db: DocsDatabase, view: DbViewConfig): DbProperty | null {
  if (!view.group_by) return null;
  const p = db.properties.find((x) => x.id === view.group_by);
  return p && DB_GROUPABLE_TYPES.has(p.type) ? p : null;
}

/**
 * Grupos de una vista en orden (opciones en su orden, personas por nombre,
 * checkbox marcado primero; "sin valor" al final). Con personas, una fila con
 * dos personas sale en los dos grupos. `keepEmpty`: incluir grupos sin filas
 * (columnas del board); el de "sin valor" solo aparece si tiene filas.
 */
export function groupRows(
  db: DocsDatabase,
  prop: DbProperty,
  rows: DbRow[],
  ctx: DbFormatContext = {},
  keepEmpty = true,
): DbGroup[] {
  const groups: DbGroup[] = [];
  const byKey = new Map<string, DbGroup>();
  const push = (g: DbGroup) => {
    groups.push(g);
    byKey.set(g.key, g);
  };
  if (prop.type === 'select' || prop.type === 'status') {
    for (const o of orderedOptions(prop)) push({ key: o.id, label: o.name, option: o, rows: [] });
  } else if (prop.type === 'checkbox') {
    push({ key: 'true', label: 'true', rows: [] });
    push({ key: 'false', label: 'false', rows: [] });
  }
  const none: DbGroup = { key: '', label: '', rows: [] };
  for (const row of rows) {
    const v = cellValue(prop, row);
    if (prop.type === 'checkbox') {
      byKey.get(v === true ? 'true' : 'false')!.rows.push(row);
      continue;
    }
    if (prop.type === 'person') {
      const ids = Array.isArray(v) ? v : [];
      if (ids.length === 0) none.rows.push(row);
      for (const id of ids) {
        let g = byKey.get(id);
        if (!g) {
          g = { key: id, label: ctx.people?.[id] ?? '', rows: [] };
          push(g);
        }
        g.rows.push(row);
      }
      continue;
    }
    const g = typeof v === 'string' ? byKey.get(v) : undefined;
    if (g) g.rows.push(row);
    else none.rows.push(row);
  }
  if (prop.type === 'person') {
    groups.sort((a, b) => compareKeys(a.label || '￿', b.label || '￿'));
  }
  const out = keepEmpty ? groups : groups.filter((g) => g.rows.length > 0);
  // "Sin <propiedad>" va primero, como en Notion.
  if (none.rows.length > 0) out.unshift(none);
  return out;
}

/**
 * Valor de la propiedad de agrupado al mover una fila de un grupo a otro
 * (board): select/status toman la opción, checkbox el boolean, y en persona se
 * reemplaza la del grupo de origen por la del destino.
 */
export function valueForGroup(prop: DbProperty, row: DbRow, toKey: string, fromKey: string | null): DbValue {
  if (prop.type === 'checkbox') return toKey === 'true';
  if (prop.type === 'person') {
    const have = Array.isArray(row.values[prop.id]) ? (row.values[prop.id] as string[]) : [];
    const without = have.filter((id) => id !== fromKey);
    if (!toKey) return [];
    return without.includes(toKey) ? without : [...without, toKey];
  }
  return toKey || null;
}

/**
 * Valores de una fila nueva para que entre en la vista filtrada (como Notion):
 * "es" en select/status/texto, "contiene" en multi/persona, checkbox marcado.
 */
export function filterDefaults(db: DocsDatabase, view: DbViewConfig): Record<string, DbValue> {
  const out: Record<string, DbValue> = {};
  for (const f of view.filters ?? []) {
    const prop = db.properties.find((p) => p.id === f.property);
    if (!prop || isComputedType(prop.type) || prop.id in out) continue;
    const v = f.value;
    if (f.op === 'checked') out[prop.id] = true;
    else if (isEmptyValue(v ?? null)) continue;
    else if ((prop.type === 'select' || prop.type === 'status') && f.op === 'is' && typeof v === 'string') out[prop.id] = v;
    else if ((prop.type === 'multi_select' || prop.type === 'person') && f.op === 'contains' && typeof v === 'string') out[prop.id] = [v];
    else if (isTextType(prop.type) && (f.op === 'is' || f.op === 'contains' || f.op === 'starts_with') && typeof v === 'string') out[prop.id] = v;
    else if (prop.type === 'number' && (f.op === 'eq' || f.op === 'gte' || f.op === 'lte') && typeof v === 'number') out[prop.id] = v;
    else if (prop.type === 'date' && (f.op === 'is' || f.op === 'on_or_after' || f.op === 'on_or_before') && typeof v === 'string') out[prop.id] = v;
  }
  return out;
}

// ---------- Texto (búsqueda, export, solo lectura) ----------

/** Encabezado y filas de texto de la vista activa (export Markdown y vistas sin componentes). */
export function databaseTable(block: DocsBlock, ctx: DbFormatContext = {}): { header: string[]; rows: string[][] } {
  const db = normalizeDatabase(block);
  const view = activeView(db);
  const props = visibleProperties(db, view).filter((p) => p.type !== 'person' || ctx.people);
  return {
    header: props.map((p) => p.name),
    rows: viewRows(db, view, ctx).map((r) => props.map((p) => formatValue(p, r, ctx))),
  };
}

/** Texto plano de una base (nombres de propiedades y todas las celdas de texto y opciones). */
export function databaseSearchText(block: DocsBlock): string {
  const db = normalizeDatabase(block);
  const parts: string[] = [db.title ?? '', db.properties.map((p) => p.name).join(' ')];
  for (const row of db.rows) {
    for (const p of db.properties) {
      if (p.type === 'person' || isComputedType(p.type) || p.type === 'checkbox') continue;
      const text = formatValue(p, row);
      if (text) parts.push(text);
    }
  }
  return parts.join(' ').trim();
}

/** Filas de las bases de una página (búsqueda Cmd+K y links `[[` a una fila). */
export function databaseRowEntries(blocks: DocsBlock[]): Array<{ blockId: string; rowId: string; title: string; dbTitle: string }> {
  const out: Array<{ blockId: string; rowId: string; title: string; dbTitle: string }> = [];
  for (const b of blocks) {
    if (b.type !== 'database') continue;
    const db = normalizeDatabase(b);
    for (const r of db.rows) {
      const title = rowTitle(db, r).trim();
      if (title) out.push({ blockId: b.id, rowId: r.id, title, dbTitle: db.title ?? '' });
    }
  }
  return out;
}
