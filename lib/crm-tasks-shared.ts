/**
 * CRM, listado de tareas (bloque A3): el estado del listado como lo guarda la
 * URL y una vista guardada. Puro: lo usan el server, los componentes y los
 * unitarios.
 */
export const TASK_INDEX_BUCKETS = ['all', 'today', 'overdue', 'upcoming', 'done'] as const;
export type TaskIndexBucket = (typeof TASK_INDEX_BUCKETS)[number];

/** Tipo de tarea en el filtro: to-do, llamada o email. */
export const TASK_INDEX_KINDS = ['todo', 'call', 'email'] as const;
export type TaskIndexKind = (typeof TASK_INDEX_KINDS)[number];

export const TASK_INDEX_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;
export type TaskIndexPriority = (typeof TASK_INDEX_PRIORITIES)[number];

export const TASK_INDEX_SORTS = ['due', '-due', 'priority', '-priority', 'created', '-created', 'subject', '-subject'] as const;
export type TaskIndexSort = (typeof TASK_INDEX_SORTS)[number];

export const TASK_PAGE_SIZE = 50;

export interface TaskIndexFilter {
  bucket: TaskIndexBucket;
  kind?: TaskIndexKind;
  priority?: TaskIndexPriority;
  /** Persona, 'me' (quien mira) o 'unassigned'. */
  owner?: string;
  queueId?: string;
  projectId?: string;
  q?: string;
  sort: TaskIndexSort;
}

function pick<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function idParam(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined;
}

/** Filtro desde el estado del listado (vista activa + URL). Lo que no se entiende se ignora. */
export function parseTaskIndexFilter(state: Record<string, string | undefined>): TaskIndexFilter {
  const q = typeof state.q === 'string' ? state.q.trim().slice(0, 200) : '';
  return {
    bucket: pick(TASK_INDEX_BUCKETS, state.bucket) ?? 'all',
    kind: pick(TASK_INDEX_KINDS, state.type),
    priority: pick(TASK_INDEX_PRIORITIES, state.priority),
    owner: state.owner === 'me' || state.owner === 'unassigned' ? state.owner : idParam(state.owner),
    queueId: idParam(state.queue),
    projectId: idParam(state.project),
    q: q || undefined,
    sort: pick(TASK_INDEX_SORTS, state.sort) ?? (state.bucket === 'done' ? '-due' : 'due'),
  };
}

/** Params de la cola de trabajo que sigue el listado filtrado ("Empezar" desde una vista). */
export function queueParamsFor(f: TaskIndexFilter): Record<string, string> {
  const out: Record<string, string> = { scope: f.bucket === 'done' ? 'all' : f.bucket, owner: f.owner ?? 'all' };
  if (f.kind) out.type = f.kind;
  if (f.priority) out.priority = f.priority;
  if (f.queueId) out.queue = f.queueId;
  if (f.projectId) out.project = f.projectId;
  if (f.q) out.q = f.q;
  return out;
}

/** Recordatorio relativo al vencimiento (como el "Send reminder" de HubSpot). */
export const REMINDER_OFFSETS = ['none', 'at_due', '15m', '1h', '1d', '1w'] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

const OFFSET_MS: Record<Exclude<ReminderOffset, 'none'>, number> = {
  at_due: 0,
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
};

/** Instante UTC 'YYYY-MM-DD HH:MM' del recordatorio, o null (sin recordatorio o sin vencimiento). */
export function reminderFromDue(dueUtc: string | null, offset: ReminderOffset): string | null {
  if (offset === 'none' || !dueUtc) return null;
  const norm = dueUtc.trim().replace('T', ' ');
  const full = /^\d{4}-\d{2}-\d{2}$/.test(norm) ? `${norm} 00:00` : norm;
  const due = new Date(`${full.slice(0, 16).replace(' ', 'T')}:00Z`);
  if (Number.isNaN(due.getTime())) return null;
  const d = new Date(due.getTime() - OFFSET_MS[offset]);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function parseUtcMinute(v: string): number {
  const norm = v.trim().replace('T', ' ');
  const full = /^\d{4}-\d{2}-\d{2}$/.test(norm) ? `${norm} 00:00` : norm;
  return new Date(`${full.slice(0, 16).replace(' ', 'T')}:00Z`).getTime();
}

/**
 * El recordatorio sigue al vencimiento: si la tarea se mueve (posponer, otra
 * fecha, la siguiente de una serie), el recordatorio se corre lo mismo. Sin
 * recordatorio o sin alguna de las dos fechas, null (no hay qué correr).
 */
export function shiftReminder(reminderUtc: string | null | undefined, oldDueUtc: string | null | undefined, newDueUtc: string | null | undefined): string | null {
  if (!reminderUtc || !oldDueUtc || !newDueUtc) return null;
  const r = parseUtcMinute(reminderUtc);
  const a = parseUtcMinute(oldDueUtc);
  const b = parseUtcMinute(newDueUtc);
  if ([r, a, b].some((x) => Number.isNaN(x))) return null;
  const d = new Date(r + (b - a));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
