/**
 * Filtros, orden y agrupado de la bandeja de Track (como la Inbox de Linear).
 * Puro: lo usan la ruta (app/api/notifications/inbox) y el cliente
 * (components/track/InboxFilters.tsx), que lo guarda en la URL y en localStorage.
 */

/** Tipo de aviso tal como lo ve la persona (varios `notifications.type` caen en uno). */
export const INBOX_KINDS = ['mention', 'assigned', 'status', 'update', 'comment', 'reminder', 'project', 'other'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

const KIND_OF_TYPE: Record<string, InboxKind> = {
  mention: 'mention',
  assigned: 'assigned',
  status_change: 'status',
  issue_update: 'update',
  subtask: 'update',
  relation: 'update',
  comment: 'comment',
  track_reminder: 'reminder',
  project_update: 'project',
};

export function inboxKind(type: string): InboxKind {
  return KIND_OF_TYPE[type] ?? 'other';
}

export const INBOX_READ = ['all', 'unread', 'read'] as const;
export type InboxRead = (typeof INBOX_READ)[number];
export const INBOX_ORDERS = ['newest', 'oldest'] as const;
export type InboxOrder = (typeof INBOX_ORDERS)[number];
export const INBOX_GROUPS = ['none', 'kind', 'project', 'team'] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];

/** Valor de "sin project" / "sin team" en los filtros. */
export const INBOX_NONE = '_none';

export interface InboxFilter {
  read: InboxRead;
  kinds: InboxKind[];
  /** Ids de track_plans (o INBOX_NONE). */
  projects: string[];
  /** Nombre del team (meta.projectName) o INBOX_NONE. */
  teams: string[];
  /** Ids de quien hizo el cambio. */
  actors: string[];
  order: InboxOrder;
  group: InboxGroup;
}

export const EMPTY_INBOX_FILTER: InboxFilter = { read: 'all', kinds: [], projects: [], teams: [], actors: [], order: 'newest', group: 'none' };

/** Lo que se sabe de cada aviso para filtrarlo, ordenarlo y agruparlo. */
export interface InboxFacts {
  kind: InboxKind;
  projectId: string | null;
  team: string | null;
  actorId: string | null;
  read: boolean;
  /** Momento por el que se ordena (el de vuelta si estuvo pospuesto). */
  at: string;
}

const MAX_VALUES = 50;

function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return value && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function list(sp: URLSearchParams, key: string): string[] {
  return [...new Set(sp.getAll(key).map((v) => v.trim()).filter((v) => v && v.length <= 200))].slice(0, MAX_VALUES);
}

export function parseInboxFilter(sp: URLSearchParams): InboxFilter {
  return {
    read: pick(sp.get('read'), INBOX_READ, 'all'),
    kinds: list(sp, 'kind').filter((k): k is InboxKind => (INBOX_KINDS as readonly string[]).includes(k)),
    projects: list(sp, 'project'),
    teams: list(sp, 'team'),
    actors: list(sp, 'from'),
    order: pick(sp.get('order'), INBOX_ORDERS, 'newest'),
    group: pick(sp.get('group'), INBOX_GROUPS, 'none'),
  };
}

/** Solo lo que no es el valor por defecto, para una URL corta. */
export function inboxFilterParams(f: InboxFilter): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.read !== 'all') sp.set('read', f.read);
  f.kinds.forEach((v) => sp.append('kind', v));
  f.projects.forEach((v) => sp.append('project', v));
  f.teams.forEach((v) => sp.append('team', v));
  f.actors.forEach((v) => sp.append('from', v));
  if (f.order !== 'newest') sp.set('order', f.order);
  if (f.group !== 'none') sp.set('group', f.group);
  return sp;
}

/** Cantidad de filtros puestos (orden y agrupado no cuentan). */
export function inboxFilterCount(f: InboxFilter): number {
  return (f.read !== 'all' ? 1 : 0) + (f.kinds.length ? 1 : 0) + (f.projects.length ? 1 : 0) + (f.teams.length ? 1 : 0) + (f.actors.length ? 1 : 0);
}

export function matchesInboxFilter(x: InboxFacts, f: InboxFilter): boolean {
  if (f.read === 'unread' && x.read) return false;
  if (f.read === 'read' && !x.read) return false;
  if (f.kinds.length && !f.kinds.includes(x.kind)) return false;
  if (f.projects.length && !f.projects.includes(x.projectId ?? INBOX_NONE)) return false;
  if (f.teams.length && !f.teams.includes(x.team ?? INBOX_NONE)) return false;
  if (f.actors.length && (!x.actorId || !f.actors.includes(x.actorId))) return false;
  return true;
}

/**
 * Orden de la lista: con agrupado, primero el grupo (tipos en su orden fijo,
 * projects y teams por nombre, "sin" al final) y adentro por fecha.
 */
export function compareInbox<T extends InboxFacts & { projectName?: string | null }>(f: Pick<InboxFilter, 'order' | 'group'>) {
  const byDate = (a: T, b: T) => (f.order === 'oldest' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at));
  const groupKey = (x: T): [number, string] => {
    if (f.group === 'kind') return [INBOX_KINDS.indexOf(x.kind), ''];
    if (f.group === 'project') return x.projectId ? [0, `${(x.projectName ?? '').toLowerCase()}\u0000${x.projectId}`] : [1, ''];
    if (f.group === 'team') return x.team ? [0, x.team.toLowerCase()] : [1, ''];
    return [0, ''];
  };
  return (a: T, b: T) => {
    if (f.group !== 'none') {
      const [ra, ka] = groupKey(a);
      const [rb, kb] = groupKey(b);
      if (ra !== rb) return ra - rb;
      const byName = ka.localeCompare(kb);
      if (byName) return byName;
    }
    return byDate(a, b);
  };
}

/** Clave del grupo de un aviso (para los encabezados de la lista). */
export function inboxGroupKey(x: Pick<InboxFacts, 'kind' | 'projectId' | 'team'>, group: InboxGroup): string {
  if (group === 'kind') return x.kind;
  if (group === 'project') return x.projectId ?? INBOX_NONE;
  if (group === 'team') return x.team ?? INBOX_NONE;
  return '';
}

// ---------- Priority / Other (Priority inbox de Linear, sep. 2025) ----------

/**
 * Pestañas de la bandeja. La regla de qué va a Priority:
 *
 * 1. Te asignaron algo (issue, chat, tarea) o te mencionaron (en un issue,
 *    un comentario, un doc, un chat de Lines).
 * 2. Algo espera una acción tuya: un issue en triage del que sos responsable,
 *    un SLA en riesgo o vencido, una aprobación pendiente, o un recordatorio
 *    que pusiste vos.
 * 3. En un issue al que estás suscripto cambió el status o la prioridad.
 *
 * Todo lo demás va a Other: comentarios sin mención, otras ediciones,
 * sub-issues, relaciones, updates de projects y avisos de otras apps.
 */
export const INBOX_TABS = ['priority', 'other'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/** Por qué llegó un aviso: la acción (línea gris de la fila) y el ícono del avatar. */
export type InboxReason =
  | 'assigned'
  | 'mentioned'
  | 'commented'
  | 'status'
  | 'priority'
  | 'updated'
  | 'subissue'
  | 'relation'
  | 'reminder'
  | 'triage'
  | 'sla_risk'
  | 'sla_breach'
  | 'agent'
  | 'project'
  | 'approval'
  | 'other';

/** Tipos que siempre son Priority, de cualquier app. */
const PRIORITY_TYPES = new Set([
  'mention',
  'assigned',
  'track_reminder',
  'talk_mention',
  'talk_dm',
  'social_assigned',
  'social_approval',
  'crm_approval',
  'time_approval',
]);

const APPROVAL_TYPES = new Set(['social_approval', 'crm_approval', 'time_approval']);

interface ReasonInput {
  type: string;
  source_type?: string | null;
  meta: Record<string, unknown>;
}

function changesOf(meta: Record<string, unknown>): string[] {
  return typeof meta.changes === 'string' ? meta.changes.split(',').filter(Boolean) : [];
}

export function inboxReason(n: ReasonInput): InboxReason {
  const kind = typeof n.meta.kind === 'string' ? n.meta.kind : '';
  if (n.source_type === 'track_triage' || kind === 'triage_owner') return 'triage';
  if (n.source_type === 'track_sla' || kind === 'sla_risk' || kind === 'sla_breach') return kind === 'sla_breach' ? 'sla_breach' : 'sla_risk';
  if (n.source_type === 'track_agent') return 'agent';
  if (APPROVAL_TYPES.has(n.type)) return 'approval';
  switch (n.type) {
    case 'assigned':
    case 'social_assigned':
      return 'assigned';
    case 'mention':
    case 'talk_mention':
    case 'talk_dm':
      return 'mentioned';
    case 'comment':
      return 'commented';
    case 'status_change':
      return 'status';
    case 'issue_update':
      return changesOf(n.meta).includes('priority') ? 'priority' : 'updated';
    case 'subtask':
      return 'subissue';
    case 'relation':
      return 'relation';
    case 'track_reminder':
      return 'reminder';
    case 'project_update':
      return 'project';
    default:
      return n.source_type === 'track_plan' ? 'project' : 'other';
  }
}

export function inboxTab(n: ReasonInput): InboxTab {
  if (PRIORITY_TYPES.has(n.type)) return 'priority';
  const reason = inboxReason(n);
  return reason === 'triage' || reason === 'sla_risk' || reason === 'sla_breach' || reason === 'status' || reason === 'priority' || reason === 'approval'
    ? 'priority'
    : 'other';
}
