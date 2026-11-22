/**
 * CRM, vistas guardadas de los listados (contactos, empresas y deals), como
 * las de HubSpot. Puro: lo usan el server, los componentes y los unitarios.
 *
 * Una vista guarda el estado del listado, nunca resultados: los filtros
 * (simples, `custom_<name>` y el avanzado `filters`), el orden y las columnas
 * (`cols`, `freeze`). Cada persona que la abre ve sus propios resultados, con
 * su visibilidad por owner y sus permisos por campo; lo que no puede ver de la
 * vista (reglas, orden o columnas de campos que tiene ocultos) se le quita con
 * redactViewQuery antes de mandarlo.
 *
 * En la URL: `sv` = la vista activa (una por defecto, como `mine`, o el id de
 * una guardada). Los params explícitos ganan sobre los de la vista; con `m=1`
 * la URL es el estado completo y la vista no aporta nada (así se puede quitar
 * un filtro que la vista tiene).
 */
import { parseFilterModel, serializeFilterModel, type FilterModel } from './crm-filter-model';
import { parseCustomSort } from './crm-list-sort';

export const VIEW_ENTITIES = ['contacts', 'companies', 'deals', 'tasks'] as const;
export type ViewEntity = (typeof VIEW_ENTITIES)[number];

export function isViewEntity(v: unknown): v is ViewEntity {
  return typeof v === 'string' && (VIEW_ENTITIES as readonly string[]).includes(v);
}

export const VIEW_VISIBILITIES = ['private', 'team', 'everyone'] as const;
export type ViewVisibility = (typeof VIEW_VISIBILITIES)[number];

export const SAVED_VIEW_PARAM = 'sv';
export const MODIFIED_PARAM = 'm';

/** Tope de pestañas abiertas por persona y objeto (HubSpot permite 50). */
export const MAX_TABS = 50;
/** Tope de vistas guardadas por workspace y objeto. */
export const MAX_VIEWS = 200;
const MAX_VALUE = 4000;

/** Lo que una vista guarda de cada listado (además de `custom_<name>`). */
export const VIEW_STATE_KEYS: Record<ViewEntity, readonly string[]> = {
  // `created` / `activity`: rango de los filtros rápidos (lib/crm-date-presets.ts), relativo o a medida con From/To.
  contacts: ['q', 'lifecycle', 'leadStatus', 'source', 'owner', 'tag', 'created', 'createdFrom', 'createdTo', 'activity', 'activityFrom', 'activityTo', 'filters', 'sort', 'cols', 'freeze'],
  companies: ['q', 'industry', 'lifecycle', 'owner', 'tag', 'created', 'createdFrom', 'createdTo', 'activity', 'activityFrom', 'activityTo', 'filters', 'sort', 'cols', 'freeze'],
  deals: ['q', 'stageId', 'priority', 'source', 'owner', 'tag', 'stalled', 'createdFrom', 'createdTo', 'filters', 'sort', 'cols', 'freeze'],
  // Tareas (A3): vencimiento, tipo, prioridad, owner, cola, proyecto, texto y orden (lib/crm-tasks-shared.ts).
  tasks: ['bucket', 'type', 'priority', 'owner', 'queue', 'project', 'q', 'sort', 'cols', 'freeze'],
};

const CUSTOM_KEY = /^custom_([A-Za-z0-9_-]{1,100})$/;
const COLUMN_ID = /^([A-Za-z]{1,40}|custom:[A-Za-z0-9_-]{1,100})$/;
const MAX_COLUMNS = 80;

export type ViewQuery = Record<string, string>;

// ---------- Vistas por defecto ----------

export interface DefaultView {
  key: string;
  /** Clave de crm.views.defaults.* */
  labelKey: string;
  query: ViewQuery;
}

const ownerRule = (value: string): string =>
  serializeFilterModel({ v: 1, groups: [{ rules: [{ f: 'owner', o: 'is', v: [value] }] }] });

export const DEFAULT_VIEWS: Record<ViewEntity, readonly DefaultView[]> = {
  contacts: [
    { key: 'all', labelKey: 'allContacts', query: {} },
    { key: 'mine', labelKey: 'myContacts', query: { filters: ownerRule('me') } },
    { key: 'unassigned', labelKey: 'unassignedContacts', query: { filters: ownerRule('unassigned') } },
  ],
  companies: [
    { key: 'all', labelKey: 'allCompanies', query: {} },
    { key: 'mine', labelKey: 'myCompanies', query: { filters: ownerRule('me') } },
    { key: 'unassigned', labelKey: 'unassignedCompanies', query: { filters: ownerRule('unassigned') } },
  ],
  deals: [
    { key: 'all', labelKey: 'allDeals', query: {} },
    { key: 'mine', labelKey: 'myDeals', query: { filters: ownerRule('me') } },
    {
      key: 'open',
      labelKey: 'openDeals',
      query: { filters: serializeFilterModel({ v: 1, groups: [{ rules: [{ f: 'status', o: 'is', v: ['open'] }] }] }) },
    },
  ],
  // Las vistas por defecto del índice de Tareas de HubSpot, más las completadas.
  tasks: [
    { key: 'all', labelKey: 'allTasks', query: {} },
    { key: 'today', labelKey: 'dueToday', query: { bucket: 'today' } },
    { key: 'overdue', labelKey: 'overdueTasks', query: { bucket: 'overdue' } },
    { key: 'upcoming', labelKey: 'upcomingTasks', query: { bucket: 'upcoming' } },
    { key: 'done', labelKey: 'completedTasks', query: { bucket: 'done' } },
  ],
};

export function defaultView(entity: ViewEntity, key: string): DefaultView | undefined {
  return DEFAULT_VIEWS[entity].find((d) => d.key === key);
}

export function isDefaultViewKey(entity: ViewEntity, key: string): boolean {
  return !!defaultView(entity, key);
}

// ---------- Estado del listado ----------

/**
 * Solo las claves de estado del objeto, con valor, sin el orden por defecto.
 * `explicit`: params de la URL, donde `freeze=0` apaga el de la vista.
 */
export function pickViewState(entity: ViewEntity, params: Record<string, unknown>, opts: { explicit?: boolean } = {}): ViewQuery {
  const keys = VIEW_STATE_KEYS[entity];
  const out: ViewQuery = {};
  for (const [key, raw] of Object.entries(params)) {
    if (!keys.includes(key) && !CUSTOM_KEY.test(key)) continue;
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, MAX_VALUE);
    if (!value) continue;
    if (key === 'sort' && value === 'newest') continue;
    if (key === 'freeze' && value !== '1' && !(opts.explicit && value === '0')) continue;
    if (key === 'stalled' && value !== '1') continue;
    if (key === 'cols') {
      const cols = serializeColumns(parseColumns(value));
      if (cols) out.cols = cols;
      continue;
    }
    if (key === 'filters') {
      const f = serializeFilterModel(parseFilterModel(value));
      if (f) out.filters = f;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function sameViewQuery(a: ViewQuery, b: ViewQuery): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * Estado efectivo del listado: la vista activa más los params de la URL (los
 * de la URL ganan; con `m=1` la URL es todo). `modified` = difiere de la vista.
 */
export function resolveViewState(
  entity: ViewEntity,
  params: Record<string, string | string[] | undefined>,
  viewQuery: ViewQuery,
): { state: ViewQuery; modified: boolean } {
  const explicit = pickViewState(entity, params, { explicit: true });
  const base = pickViewState(entity, viewQuery);
  const state = params[MODIFIED_PARAM] === '1' ? { ...explicit } : { ...base, ...explicit };
  if (state.freeze !== '1') delete state.freeze;
  return { state, modified: !sameViewQuery(state, base) };
}

// ---------- Columnas ----------

export function parseColumns(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (COLUMN_ID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_COLUMNS) break;
  }
  return out;
}

export function serializeColumns(ids: readonly string[]): string {
  return parseColumns(ids.join(',')).join(',');
}

/**
 * Columnas a mostrar, en orden: las de la vista que existen para quien mira;
 * la primera (`first`, el nombre) siempre va y va primera.
 */
export function orderedColumns(saved: readonly string[], available: readonly string[], first: string): string[] {
  const known = new Set(available);
  const rest = saved.filter((id) => id !== first && known.has(id));
  return known.has(first) ? [first, ...rest] : rest;
}

// ---------- Lo que no se ve ----------

/**
 * Quita de una vista lo que toca campos propios ocultos para quien mira:
 * `custom_<name>`, el orden `cf:<name>`, la columna `custom:<name>` y las
 * reglas `custom:<name>` del filtro avanzado. Así una vista compartida no
 * revela ni el nombre de un campo oculto ni los valores por los que filtra.
 */
export function redactViewQuery(query: ViewQuery, hidden: ReadonlySet<string>): ViewQuery {
  if (!hidden.size) return { ...query };
  const out: ViewQuery = {};
  for (const [key, value] of Object.entries(query)) {
    const custom = CUSTOM_KEY.exec(key);
    if (custom) {
      if (!hidden.has(custom[1])) out[key] = value;
      continue;
    }
    if (key === 'sort') {
      const cs = parseCustomSort(value);
      if (!cs || !hidden.has(cs.name)) out.sort = value;
      continue;
    }
    if (key === 'cols') {
      const cols = serializeColumns(parseColumns(value).filter((id) => !(id.startsWith('custom:') && hidden.has(id.slice(7)))));
      if (cols) out.cols = cols;
      continue;
    }
    if (key === 'filters') {
      const f = serializeFilterModel(dropHiddenRules(parseFilterModel(value), hidden));
      if (f) out.filters = f;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * ¿La vista filtra por algún campo oculto para quien mira? Entonces esos
 * filtros no se le aplican (redactViewQuery los quita) y la UI lo avisa, sin
 * nombrarlos. Puro.
 */
export function viewQueryDropsFilters(query: ViewQuery, hidden: ReadonlySet<string>): boolean {
  if (!hidden.size) return false;
  for (const [key, value] of Object.entries(query)) {
    const custom = CUSTOM_KEY.exec(key);
    if (custom && hidden.has(custom[1]) && value) return true;
    if (key === 'filters' && parseFilterModel(value).groups.some((g) => g.rules.some((r) => r.f.startsWith('custom:') && hidden.has(r.f.slice(7))))) {
      return true;
    }
  }
  return false;
}

function dropHiddenRules(model: FilterModel, hidden: ReadonlySet<string>): FilterModel {
  return {
    v: 1,
    groups: model.groups
      .map((g) => ({ rules: g.rules.filter((r) => !(r.f.startsWith('custom:') && hidden.has(r.f.slice(7)))) }))
      .filter((g) => g.rules.length > 0),
  };
}

// ---------- Quién ve y quién edita ----------

export interface ViewViewer {
  workspaceId: string;
  personId: string;
  /** Owner del workspace o admin. */
  isAdmin: boolean;
  /** Equipos de venta de la persona. */
  teamIds: ReadonlySet<string>;
}

export interface ViewAccessRow {
  user_id: string;
  person_id: string | null;
  visibility: string;
  team_id: string | null;
}

/** Quien creó la vista (las de antes de B2 cuentan como del dueño del workspace). */
export function viewCreator(row: ViewAccessRow): string {
  return row.person_id ?? row.user_id;
}

export function normalizeVisibility(v: unknown): ViewVisibility {
  return v === 'private' || v === 'team' ? v : 'everyone';
}

/**
 * Privada: solo quien la creó (tampoco un admin). Equipo: quien la creó, los
 * miembros del equipo y los admins (que la pueden editar). Todos: todo el
 * workspace.
 */
export function canSeeView(row: ViewAccessRow, viewer: ViewViewer): boolean {
  if (row.user_id !== viewer.workspaceId) return false;
  if (viewCreator(row) === viewer.personId) return true;
  const visibility = normalizeVisibility(row.visibility);
  if (visibility === 'private') return false;
  if (visibility === 'everyone') return true;
  return viewer.isAdmin || (!!row.team_id && viewer.teamIds.has(row.team_id));
}

/** Editar, renombrar o borrar: quien la creó, o un admin si está compartida. */
export function canEditView(row: ViewAccessRow, viewer: ViewViewer): boolean {
  if (!canSeeView(row, viewer)) return false;
  return viewCreator(row) === viewer.personId || viewer.isAdmin;
}

// ---------- Pestañas ----------

export interface TabPref {
  key: string;
  pinned?: boolean;
}

/** Sin repetidas ni desconocidas, las fijadas primero (en su orden), hasta MAX_TABS. */
export function normalizeTabs(tabs: readonly TabPref[], known: (key: string) => boolean): TabPref[] {
  const seen = new Set<string>();
  const clean: TabPref[] = [];
  for (const t of tabs) {
    if (!t || typeof t.key !== 'string' || seen.has(t.key) || !known(t.key)) continue;
    seen.add(t.key);
    clean.push(t.pinned ? { key: t.key, pinned: true } : { key: t.key });
  }
  return [...clean.filter((t) => t.pinned), ...clean.filter((t) => !t.pinned)].slice(0, MAX_TABS);
}

/** Lee el JSON guardado de pestañas; null si no hay o está roto. */
export function parseTabs(raw: string | null | undefined): TabPref[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v
      .filter((t): t is { key: unknown; pinned?: unknown } => !!t && typeof t === 'object')
      .filter((t) => typeof t.key === 'string')
      .map((t) => ({ key: t.key as string, pinned: t.pinned === true }));
  } catch {
    return null;
  }
}

export function addTab(tabs: readonly TabPref[], key: string): TabPref[] {
  if (tabs.some((t) => t.key === key)) return [...tabs];
  const next = [...tabs];
  // Con el tope lleno, la nueva reemplaza a la última sin fijar.
  if (next.length >= MAX_TABS) {
    const i = next.map((t) => !!t.pinned).lastIndexOf(false);
    if (i < 0) return next;
    next.splice(i, 1);
  }
  return [...next, { key }];
}

/** Cerrar: una fijada no se cierra, y siempre queda al menos una pestaña. */
export function closeTab(tabs: readonly TabPref[], key: string): TabPref[] {
  const tab = tabs.find((t) => t.key === key);
  if (!tab || tab.pinned || tabs.length <= 1) return [...tabs];
  return tabs.filter((t) => t.key !== key);
}

export function togglePin(tabs: readonly TabPref[], key: string): TabPref[] {
  const next = tabs.map((t) => (t.key === key ? (t.pinned ? { key: t.key } : { key: t.key, pinned: true }) : t));
  return normalizeTabs(next, () => true);
}

/**
 * Mueve una pestaña a la posición `to` (índice en la lista completa). Las
 * fijadas se quedan entre las fijadas y las otras entre las otras.
 */
export function moveTab(tabs: readonly TabPref[], key: string, to: number): TabPref[] {
  const from = tabs.findIndex((t) => t.key === key);
  if (from < 0) return [...tabs];
  const tab = tabs[from];
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  const min = tab.pinned ? 0 : pinnedCount;
  const max = tab.pinned ? pinnedCount - 1 : tabs.length - 1;
  const target = Math.min(Math.max(to, min), max);
  const next = [...tabs];
  next.splice(from, 1);
  next.splice(target, 0, tab);
  return next;
}
