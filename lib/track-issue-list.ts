/**
 * Track — lógica de la lista de issues compartida (components/track/TrackIssueList):
 * alcance → query de /api/track/issues, preferencias por vista (filtros y
 * display), status de varios teams juntados por nombre y la ventana de
 * completados. Sin React, para testear.
 */
import { encodeFilter, normalizeFilter, type FilterRule, type FilterState } from './track-filter';
import { ISSUE_SORTS, TEAM_SCOPES, type IssueGroupBy, type IssueSort, type TeamScope } from './track-views';

export type MyIssuesTabKey = 'assigned' | 'created' | 'subscribed' | 'activity';

export interface ListScope {
  /** Issues de un project (track_plans). */
  planId?: string;
  /** Mis issues (pestañas Assigned, Created, Subscribed, Activity). */
  mine?: MyIssuesTabKey;
  /** Un team (track_projects). */
  projectId?: string;
}

export type CompletedWindowValue = 'all' | 'week' | 'none';

export type ListLayout = 'list' | 'board' | 'calendar' | 'gantt';
export const LIST_LAYOUTS: readonly ListLayout[] = ['list', 'board', 'calendar', 'gantt'];

export interface ListPrefs {
  filters: FilterState;
  group: IssueGroupBy;
  /** Sub-agrupado dentro de cada grupo (como Linear); 'none' = sin sub-grupos. */
  subGroup?: IssueGroupBy;
  sort: IssueSort;
  layout: ListLayout;
  showSub: boolean;
  completed: CompletedWindowValue;
  emptyGroups: boolean;
  props: Array<'id' | 'priority' | 'status' | 'labels' | 'cycle' | 'due' | 'assignee' | 'project' | 'created'>;
}

const PROP_KEYS = ['id', 'priority', 'status', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'] as const;

export interface ListQueryExtra {
  /** Status permitidos (pestañas Active / Backlog de un team). */
  statusIds?: string[] | null;
  /** Ocultar sub-issues: solo los de primer nivel. */
  topLevel?: boolean;
  /** Agrupado y sub-agrupado: el server devuelve los totales de cada grupo. */
  groupBy?: IssueGroupBy;
  subGroupBy?: IssueGroupBy;
  completed?: CompletedWindowValue;
}

/** Query de /api/track/issues para el alcance, los filtros y el orden. */
export function listQuery(scope: ListScope, filters: FilterState, sort: IssueSort, today: string, extra: ListQueryExtra = {}): string {
  const sp = new URLSearchParams();
  if (scope.planId) sp.set('planId', scope.planId);
  if (scope.mine) sp.set('mine', scope.mine);
  if (scope.projectId) sp.set('projectId', scope.projectId);
  const encoded = encodeFilter(filters);
  if (encoded) sp.set('filter', encoded);
  if (filters.q) sp.set('q', filters.q);
  sp.set('sort', sort);
  sp.set('today', today);
  if (extra.statusIds) sp.set('statusId', extra.statusIds.join(','));
  if (extra.topLevel) sp.set('topLevel', '1');
  if (extra.groupBy && extra.groupBy !== 'none') sp.set('groupBy', extra.groupBy);
  if (extra.groupBy && extra.groupBy !== 'none' && extra.subGroupBy && extra.subGroupBy !== 'none' && extra.subGroupBy !== extra.groupBy) {
    sp.set('subGroupBy', extra.subGroupBy);
  }
  if (extra.completed && extra.completed !== 'all') sp.set('completed', extra.completed);
  return sp.toString();
}

/** Clave de localStorage de una vista. */
export function prefsKey(viewKey: string): string {
  return `track:list:${viewKey}`;
}

/** Preferencias guardadas, validadas contra lo que ofrece la vista (lo inválido toma el valor por defecto). */
export function parseListPrefs(raw: unknown, fallback: ListPrefs, groups: readonly IssueGroupBy[]): ListPrefs {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  return {
    filters: r.filters ? normalizeFilter(r.filters) : fallback.filters,
    group: groups.includes(r.group as IssueGroupBy) ? (r.group as IssueGroupBy) : fallback.group,
    subGroup: groups.includes(r.subGroup as IssueGroupBy) ? (r.subGroup as IssueGroupBy) : (fallback.subGroup ?? 'none'),
    sort: (ISSUE_SORTS as readonly string[]).includes(r.sort as string) ? (r.sort as IssueSort) : fallback.sort,
    layout: (LIST_LAYOUTS as readonly unknown[]).includes(r.layout) ? (r.layout as ListLayout) : fallback.layout,
    showSub: typeof r.showSub === 'boolean' ? r.showSub : fallback.showSub,
    completed: r.completed === 'all' || r.completed === 'week' || r.completed === 'none' ? r.completed : fallback.completed,
    emptyGroups: typeof r.emptyGroups === 'boolean' ? r.emptyGroups : fallback.emptyGroups,
    props: Array.isArray(r.props) ? r.props.filter((p): p is ListPrefs['props'][number] => (PROP_KEYS as readonly string[]).includes(p as string)) : fallback.props,
  };
}

export function readListPrefs(viewKey: string, fallback: ListPrefs, groups: readonly IssueGroupBy[]): ListPrefs {
  try {
    const raw = window.localStorage.getItem(prefsKey(viewKey));
    return raw ? parseListPrefs(JSON.parse(raw), fallback, groups) : fallback;
  } catch {
    return fallback;
  }
}

export function writeListPrefs(viewKey: string, prefs: ListPrefs): void {
  try {
    window.localStorage.setItem(prefsKey(viewKey), JSON.stringify(prefs));
  } catch {
    /* sin storage: queda en memoria */
  }
}

interface StatusLike {
  id: string;
  name: string;
  category: string;
  color: string;
  position?: number;
}

/** Un status por nombre (el primero de cada uno), para filtros y columnas de varios teams. */
export function canonicalStatuses<T extends StatusLike>(statuses: T[]): T[] {
  const seen = new Map<string, T>();
  for (const s of statuses) if (!seen.has(s.name.toLowerCase())) seen.set(s.name.toLowerCase(), s);
  const order = ['triage', 'backlog', 'todo', 'unstarted', 'in_progress', 'started', 'done', 'completed', 'cancelled', 'canceled'];
  return [...seen.values()].sort((a, b) => {
    const ra = order.indexOf(a.category);
    const rb = order.indexOf(b.category);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || (a.position ?? 0) - (b.position ?? 0);
  });
}

/** Filtro por status con varios teams: elegir "Todo" incluye el "Todo" de cada team. */
export function expandStatusFilter(rules: FilterRule[], statuses: StatusLike[]): FilterRule[] {
  return rules.map((r) => {
    if (r.field !== 'status') return r;
    const names = new Set(r.values.map((v) => statuses.find((s) => s.id === v)?.name.toLowerCase()).filter(Boolean));
    const ids = statuses.filter((s) => names.has(s.name.toLowerCase())).map((s) => s.id);
    return { ...r, values: Array.from(new Set([...r.values, ...ids])) };
  });
}

/**
 * Status del team con ese nombre (alta o arrastre en una columna/grupo de
 * varios teams); si el team no tiene uno con ese nombre, el primero de la
 * misma categoría (Linear mapea por tipo de estado).
 */
export function statusForTeam(statuses: StatusLike[], name: string, category?: string | null): string | null {
  const byName = statuses.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (byName) return byName.id;
  if (!category) return null;
  return [...statuses].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).find((s) => s.category === category)?.id ?? null;
}

/** Issues con el status del primero de su nombre (el tablero de varios teams tiene una columna por nombre). */
export function remapToCanonical<T extends { status_id: string | null; status_name: string | null }>(issues: T[], canonical: StatusLike[]): T[] {
  return issues.map((i) => {
    const c = i.status_name ? canonical.find((s) => s.name.toLowerCase() === i.status_name!.toLowerCase()) : undefined;
    return c && c.id !== i.status_id ? { ...i, status_id: c.id } : i;
  });
}

/** "Completed issues": todos, los terminados en la última semana o ninguno. */
export function filterCompleted<T extends { status_category: string | null; updated_at: string }>(
  issues: T[],
  window: CompletedWindowValue,
  today: string,
): T[] {
  if (window === 'all') return issues;
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  return issues.filter((i) => {
    const done = i.status_category === 'done' || i.status_category === 'cancelled';
    if (!done) return true;
    return window === 'week' && i.updated_at.slice(0, 10) >= cutoff;
  });
}

// ---------- Vistas guardadas ----------

/** Lo que una vista guardada recuerda de la lista (además de su nombre). */
export interface ViewState {
  layout: ListLayout;
  filters: FilterState;
  group: IssueGroupBy;
  subGroup: IssueGroupBy;
  sort: IssueSort;
  showSub: boolean;
  completed: CompletedWindowValue;
}

/** Cuerpo para crear o actualizar una vista: el agrupado y lo demás viajan dentro de `filters`. */
export function viewPayload(v: ViewState): { viewType: ListLayout; filters: Record<string, unknown>; sort: IssueSort } {
  return {
    viewType: v.layout,
    filters: {
      match: v.filters.match,
      rules: v.filters.rules,
      q: v.filters.q,
      groupBy: v.group,
      ...(v.subGroup !== 'none' ? { subGroupBy: v.subGroup } : {}),
      ...(!v.showSub ? { subIssues: 'hide' } : {}),
      ...(v.completed !== 'all' ? { completed: v.completed } : {}),
    },
    sort: v.sort,
  };
}

/**
 * Estado de una vista guardada. Las vistas viejas de los teams guardaban el
 * agrupado vacío (lista sin agrupar = por status) y "sub-issues" ocultos.
 */
export function viewToState(
  view: { view_type: string; filters: Record<string, unknown>; sort: string },
  groups: readonly IssueGroupBy[],
  fallbackGroup: IssueGroupBy,
): ViewState {
  const { groupBy, subGroupBy, subIssues, completed, ...rest } = view.filters ?? {};
  const pick = (g: unknown, fb: IssueGroupBy) => (groups.includes(g as IssueGroupBy) ? (g as IssueGroupBy) : fb);
  const n = normalizeFilter(rest);
  return {
    layout: (LIST_LAYOUTS as readonly string[]).includes(view.view_type) ? (view.view_type as ListLayout) : 'list',
    filters: { ...n, q: typeof rest.q === 'string' ? rest.q : '' },
    group: pick(groupBy, fallbackGroup),
    subGroup: pick(subGroupBy, 'none'),
    sort: (ISSUE_SORTS as readonly string[]).includes(view.sort) ? (view.sort as IssueSort) : 'newest',
    showSub: subIssues !== 'hide',
    completed: completed === 'week' || completed === 'none' ? completed : 'all',
  };
}

/** Firma comparable del estado (marca la vista con cambios sin guardar). */
export function viewSignature(v: ViewState): string {
  return JSON.stringify([v.layout, v.filters.match, v.filters.rules, v.filters.q ?? '', v.group, v.subGroup, v.sort, v.showSub, v.completed]);
}

// ---------- URL del team ----------

/** Estado de la lista que se lee de la URL (links compartidos y recargas); null si la URL no trae nada. */
export function stateFromParams(
  sp: URLSearchParams,
  groups: readonly IssueGroupBy[],
): (Partial<ViewState> & { scope?: TeamScope }) | null {
  const has = ['view', 'sort', 'group', 'subGroup', 'filter', 'statusId', 'priority', 'q', 'scope', 'done', 'sub'].some((k) => sp.get(k));
  if (!has) return null;
  const legacy: Record<string, unknown> = {};
  for (const key of ['statusId', 'priority', 'assigneeId', 'cycleId', 'labelIds']) {
    const values = sp.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    if (values.length) legacy[key] = values;
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(sp.get('filter') ?? '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const out: Partial<ViewState> & { scope?: TeamScope } = {};
  const n = normalizeFilter({ ...legacy, ...parsed });
  out.filters = { ...n, q: sp.get('q') ?? '' };
  const view = sp.get('view');
  if (view && (LIST_LAYOUTS as readonly string[]).includes(view)) out.layout = view as ListLayout;
  const sort = sp.get('sort');
  if (sort && (ISSUE_SORTS as readonly string[]).includes(sort)) out.sort = sort as IssueSort;
  const group = sp.get('group');
  if (group && groups.includes(group as IssueGroupBy)) out.group = group as IssueGroupBy;
  const sub = sp.get('subGroup');
  if (sub && groups.includes(sub as IssueGroupBy)) out.subGroup = sub as IssueGroupBy;
  const scope = sp.get('scope');
  if (scope && (TEAM_SCOPES as readonly string[]).includes(scope)) out.scope = scope as TeamScope;
  const done = sp.get('done');
  if (done === 'hide') out.completed = 'none';
  else if (done === 'week') out.completed = 'week';
  if (sp.get('sub') === 'hide') out.showSub = false;
  return out;
}

/** Estado → params de la URL del team (lo que difiere de lo predeterminado). */
export function stateToParams(v: ViewState & { scope: TeamScope }, defaults: { group: IssueGroupBy; sort: IssueSort }): URLSearchParams {
  const sp = new URLSearchParams();
  const encoded = encodeFilter(v.filters);
  if (encoded) sp.set('filter', encoded);
  if (v.filters.q) sp.set('q', v.filters.q);
  sp.set('view', v.layout);
  if (v.sort !== defaults.sort) sp.set('sort', v.sort);
  if (v.group !== defaults.group) sp.set('group', v.group);
  if (v.subGroup !== 'none') sp.set('subGroup', v.subGroup);
  if (v.scope !== 'all') sp.set('scope', v.scope);
  if (v.completed === 'none') sp.set('done', 'hide');
  else if (v.completed === 'week') sp.set('done', 'week');
  if (!v.showSub) sp.set('sub', 'hide');
  return sp;
}

/** Suma totales por status en totales por nombre de status (grupos de varios teams). */
export function countsByStatusName(counts: Record<string, number>, statuses: Array<{ id: string; name: string }>, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(counts)) {
    const name = statuses.find((s) => s.id === id)?.name;
    const key = name !== undefined ? `${prefix}${name.toLowerCase()}` : id;
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}
