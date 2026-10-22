/**
 * Track — orden, búsqueda y agrupado de las vistas de issues (lista y tablero).
 *
 * El orden y la búsqueda se resuelven en SQL (listIssues / listAllIssues); el
 * agrupado se hace en el cliente sobre las filas ya cargadas, respetando el
 * orden que vino del servidor dentro de cada grupo. Sin dependencias de
 * servidor: lo importan también los componentes.
 */
import type { TrackIssueWithStatus } from './track-data';

// ---------- Orden ----------

export const ISSUE_SORTS = ['newest', 'oldest', 'updated', 'priority', 'due', 'identifier'] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export function parseIssueSort(value: unknown): IssueSort {
  return ISSUE_SORTS.includes(value as IssueSort) ? (value as IssueSort) : 'newest';
}

const PRIORITY_ORDER = "CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

/**
 * ORDER BY para cada orden. Todos desempatan por fecha de creación (y luego
 * id) para que la paginación con OFFSET sea estable.
 */
export function issueOrderBy(sort: IssueSort | undefined): string {
  switch (sort) {
    case 'oldest':
      return 'i.created_at ASC, i.id ASC';
    case 'updated':
      return 'i.updated_at DESC, i.created_at DESC, i.id DESC';
    case 'priority':
      return `${PRIORITY_ORDER}, i.created_at DESC, i.id DESC`;
    case 'due':
      // Sin fecha al final.
      return 'i.due_date IS NULL, i.due_date ASC, ' + `${PRIORITY_ORDER}, i.created_at DESC, i.id DESC`;
    case 'identifier':
      return 'i.identifier ASC, i.id ASC';
    default:
      return 'i.created_at DESC, i.id DESC';
  }
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2 };

type SortableIssue = Pick<TrackIssueWithStatus, 'id' | 'created_at' | 'updated_at' | 'priority' | 'due_date' | 'identifier'>;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * El mismo orden que `issueOrderBy`, en el cliente: sirve para ubicar un issue
 * recién creado sin recargar la lista. Negativo si `a` va antes que `b`.
 */
export function compareIssues(sort: IssueSort | undefined, a: SortableIssue, b: SortableIssue): number {
  const newest = () => cmp(b.created_at, a.created_at) || cmp(b.id, a.id);
  const prio = () => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  switch (sort) {
    case 'oldest':
      return cmp(a.created_at, b.created_at) || cmp(a.id, b.id);
    case 'updated':
      return cmp(b.updated_at, a.updated_at) || newest();
    case 'priority':
      return prio() || newest();
    case 'due': {
      if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
      return cmp(a.due_date ?? '', b.due_date ?? '') || prio() || newest();
    }
    case 'identifier':
      return cmp(a.identifier, b.identifier) || cmp(a.id, b.id);
    default:
      return newest();
  }
}

/**
 * Inserta `issue` en `list` (ya ordenada por `sort`) en su lugar: antes del
 * primer issue que debería ir después. Sin orden conocido, va al final.
 */
export function insertIssueSorted<T extends SortableIssue>(list: T[], issue: T, sort: IssueSort | undefined): T[] {
  const at = list.findIndex((other) => compareIssues(sort, issue, other) < 0);
  if (at === -1) return [...list, issue];
  return [...list.slice(0, at), issue, ...list.slice(at)];
}

// ---------- Búsqueda ----------

/** Escapa los comodines de LIKE (% y _) y el propio escape; va con ESCAPE '\'. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%texto%` literal para un LIKE ... ESCAPE '\'. */
export function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

/**
 * Texto de la descripción: es un array JSON de bloques `{ type, text }`. Se
 * buscan solo los textos (no las claves del JSON); si la columna no es JSON
 * válido (datos viejos) se busca el texto crudo. Los CASE evitan que
 * json_each / json_extract fallen con valores mal formados.
 */
const DESCRIPTION_MATCH = `(
  EXISTS (
    SELECT 1 FROM json_each(CASE WHEN json_valid(i.description) THEN CASE WHEN json_type(i.description) = 'array' THEN i.description ELSE '[]' END ELSE '[]' END) d
    WHERE (CASE WHEN d.type = 'object' THEN json_extract(d.value, '$.text') END) LIKE ? ESCAPE '\\'
  )
  OR (CASE WHEN json_valid(i.description) THEN 0 ELSE i.description LIKE ? ESCAPE '\\' END)
)`;

/**
 * Filtro de búsqueda: título, identificador, descripción y comentarios.
 * Devuelve null si la búsqueda está vacía.
 */
export function issueSearchClause(q: string | undefined): { sql: string; args: string[] } | null {
  const term = q?.trim();
  if (!term) return null;
  const like = likeContains(term);
  return {
    sql: `(i.title LIKE ? ESCAPE '\\' OR i.identifier LIKE ? ESCAPE '\\' OR ${DESCRIPTION_MATCH}
      OR EXISTS (SELECT 1 FROM track_issue_comments cm WHERE cm.issue_id = i.id AND cm.body LIKE ? ESCAPE '\\'))`,
    args: [like, like, like, like, like],
  };
}

/** LIKE que encuentra un label por id dentro del JSON de labels del issue. */
export function labelIdLike(labelId: string): string {
  return `%${escapeLike(`"id":"${labelId}"`)}%`;
}

// ---------- Agrupado ----------

export const ISSUE_GROUPS = ['none', 'status', 'assignee', 'priority', 'cycle', 'label', 'project'] as const;
export type IssueGroupBy = (typeof ISSUE_GROUPS)[number];

/** Agrupados disponibles en el tablero (las columnas): sin "ninguno". */
export const BOARD_GROUPS = ['status', 'assignee', 'priority', 'cycle', 'label', 'project'] as const;
export type BoardGroupBy = (typeof BOARD_GROUPS)[number];

export function parseIssueGroup(value: unknown, allowed: readonly IssueGroupBy[] = ISSUE_GROUPS): IssueGroupBy {
  return allowed.includes(value as IssueGroupBy) ? (value as IssueGroupBy) : allowed[0];
}

export interface IssueGroup<T> {
  /** Valor del campo (id, prioridad); '' = sin valor. */
  key: string;
  /** Nombre a mostrar (status, persona, cycle, label, proyecto); vacío para prioridad o sin valor. */
  name: string;
  color?: string | null;
  category?: string | null;
  issues: T[];
}

type GroupableIssue = Pick<
  TrackIssueWithStatus,
  | 'id'
  | 'project_id'
  | 'status_id'
  | 'status_name'
  | 'status_color'
  | 'status_category'
  | 'priority'
  | 'assignee_id'
  | 'assignee_name'
  | 'assignee_email'
  | 'cycle_id'
  | 'cycle_name'
  | 'labels'
>;

export interface GroupContext {
  /** Statuses en orden: definen columnas aunque estén vacías (agrupar por status). */
  statuses?: Array<{ id: string; name: string; color: string; category: string }>;
  /** Nombres de proyecto por id. */
  projectNames?: Record<string, string>;
  /** Incluye los grupos vacíos que se conocen de antemano (status y prioridad). */
  includeEmpty?: boolean;
  /**
   * Varios proyectos: cada uno tiene sus propios status, así que se agrupan
   * por nombre (dos "Todo" van juntos) y se ordenan por categoría.
   */
  statusByName?: boolean;
}

/** Prefijo de las claves de status agrupados por nombre (no son ids asignables). */
export const STATUS_NAME_KEY = 'name:';

const CATEGORY_ORDER = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];

const PRIORITY_KEYS = ['urgent', 'high', 'medium', 'low'] as const;

function parseLabelList(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Agrupa issues por un campo, manteniendo el orden de entrada dentro de cada
 * grupo. El grupo "sin valor" (key '') va siempre al final. Por label un
 * issue aparece en cada uno de sus labels.
 */
export function groupIssues<T extends GroupableIssue>(
  issues: T[],
  groupBy: IssueGroupBy,
  ctx: GroupContext = {},
): IssueGroup<T>[] {
  if (groupBy === 'none') return [{ key: 'all', name: '', issues }];
  const groups = new Map<string, IssueGroup<T>>();
  const add = (key: string, init: Omit<IssueGroup<T>, 'issues' | 'key'>, issue: T | null) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, ...init, issues: [] };
      groups.set(key, g);
    }
    if (issue) g.issues.push(issue);
  };

  if (groupBy === 'status' && ctx.statuses) {
    for (const s of ctx.statuses) add(s.id, { name: s.name, color: s.color, category: s.category }, null);
  }
  if (groupBy === 'priority' && ctx.includeEmpty) {
    for (const p of PRIORITY_KEYS) add(p, { name: '' }, null);
  }

  for (const issue of issues) {
    switch (groupBy) {
      case 'status':
        add(
          issue.status_id ? (ctx.statusByName ? `${STATUS_NAME_KEY}${issue.status_name ?? ''}` : issue.status_id) : '',
          { name: issue.status_name ?? '', color: issue.status_color, category: issue.status_category },
          issue,
        );
        break;
      case 'assignee':
        add(issue.assignee_id ?? '', { name: issue.assignee_name ?? issue.assignee_email ?? '' }, issue);
        break;
      case 'priority':
        add(issue.priority, { name: '' }, issue);
        break;
      case 'cycle':
        add(issue.cycle_id ?? '', { name: issue.cycle_name ?? '' }, issue);
        break;
      case 'project':
        add(issue.project_id, { name: ctx.projectNames?.[issue.project_id] ?? '' }, issue);
        break;
      case 'label': {
        const list = parseLabelList(issue.labels);
        if (list.length === 0) add('', { name: '' }, issue);
        for (const l of list) add(l.id, { name: l.name, color: l.color }, issue);
        break;
      }
    }
  }

  let out = Array.from(groups.values());
  if (!ctx.includeEmpty) out = out.filter((g) => g.issues.length > 0);
  if (groupBy === 'priority') {
    out.sort((a, b) => PRIORITY_KEYS.indexOf(a.key as never) - PRIORITY_KEYS.indexOf(b.key as never));
  } else if (groupBy === 'status' && ctx.statusByName) {
    const rank = (g: IssueGroup<T>) => {
      const i = CATEGORY_ORDER.indexOf(g.category ?? '');
      return i < 0 ? CATEGORY_ORDER.length : i;
    };
    out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  } else if (groupBy !== 'status' || !ctx.statuses) {
    // Por nombre; status sin lista de referencia también.
    out.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name)));
  }
  // "Sin valor" al final siempre.
  const none = out.findIndex((g) => g.key === '');
  if (none >= 0 && none !== out.length - 1) out.push(...out.splice(none, 1));
  return out;
}

export interface GroupPreset {
  statusId?: string;
  priority?: TrackIssueWithStatus['priority'];
  assigneeId?: string | null;
  cycleId?: string | null;
}

/**
 * Valor que toma un issue al crearlo (o soltarlo) en un grupo. null si ese
 * grupo no se puede asignar: label (varios por issue), proyecto, o un status
 * vacío. `movable` deja afuera cycle, que no se cambia arrastrando.
 */
export function groupPreset(groupBy: IssueGroupBy, key: string, opts: { movable?: boolean } = {}): GroupPreset | null {
  switch (groupBy) {
    case 'status':
      return key && !key.startsWith(STATUS_NAME_KEY) ? { statusId: key } : null;
    case 'priority':
      return (PRIORITY_KEYS as readonly string[]).includes(key) ? { priority: key as GroupPreset['priority'] } : null;
    case 'assignee':
      return { assigneeId: key || null };
    case 'cycle':
      return opts.movable ? null : { cycleId: key || null };
    default:
      return null;
  }
}
