/**
 * Track — lógica de la lista de issues compartida (components/track/TrackIssueList):
 * alcance → query de /api/track/issues, preferencias por vista (filtros y
 * display), status de varios teams juntados por nombre y la ventana de
 * completados. Sin React, para testear.
 */
import { encodeFilter, normalizeFilter, type FilterRule, type FilterState } from './track-filter';
import { ISSUE_SORTS, type IssueGroupBy, type IssueSort } from './track-views';

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

export interface ListPrefs {
  filters: FilterState;
  group: IssueGroupBy;
  sort: IssueSort;
  layout: 'list' | 'board';
  showSub: boolean;
  completed: CompletedWindowValue;
  emptyGroups: boolean;
  props: Array<'id' | 'priority' | 'status' | 'labels' | 'cycle' | 'due' | 'assignee' | 'project' | 'created'>;
}

const PROP_KEYS = ['id', 'priority', 'status', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'] as const;

/** Query de /api/track/issues para el alcance, los filtros y el orden. */
export function listQuery(scope: ListScope, filters: FilterState, sort: IssueSort, today: string): string {
  const sp = new URLSearchParams();
  if (scope.planId) sp.set('planId', scope.planId);
  if (scope.mine) sp.set('mine', scope.mine);
  if (scope.projectId) sp.set('projectId', scope.projectId);
  const encoded = encodeFilter(filters);
  if (encoded) sp.set('filter', encoded);
  if (filters.q) sp.set('q', filters.q);
  sp.set('sort', sort);
  sp.set('today', today);
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
    sort: (ISSUE_SORTS as readonly string[]).includes(r.sort as string) ? (r.sort as IssueSort) : fallback.sort,
    layout: r.layout === 'board' || r.layout === 'list' ? r.layout : fallback.layout,
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

/** Status del team con ese nombre (alta o arrastre en una columna/grupo de varios teams). */
export function statusForTeam(statuses: StatusLike[], name: string): string | null {
  return statuses.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id ?? null;
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
