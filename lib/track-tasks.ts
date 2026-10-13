/**
 * Track — helpers puros (sin DB) para la edición rápida de tareas:
 * tildar como hecha, aplicar parches optimistas, agrupar por vencimiento y
 * parsear tokens del quick-create. Se usan tanto en el cliente como en tests.
 */
import type { TrackStatusRow } from './schema/types';
import type { TrackIssueWithStatus } from './track-data';

export type StatusCategory = TrackStatusRow['category'];
export type IssuePriority = TrackIssueWithStatus['priority'];

export const PRIORITIES: IssuePriority[] = ['urgent', 'high', 'medium', 'low'];

/** Miembro mínimo necesario para resolver nombre/email del asignado. */
export interface MemberLike {
  id: string;
  name: string | null;
  email: string;
}

/** Status mínimo necesario para aplicar un cambio de status. */
export type StatusLike = Pick<TrackStatusRow, 'id' | 'name' | 'color' | 'category' | 'position'>;

/** Parche que entiende PATCH /api/track/issues/[id] (subset editable inline). */
export interface IssuePatch {
  title?: string;
  statusId?: string | null;
  priority?: IssuePriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export function isCompletedCategory(category: string | null | undefined): boolean {
  return category === 'done' || category === 'cancelled';
}

function byPosition<T extends { position: number }>(statuses: T[]): T[] {
  return [...statuses].sort((a, b) => a.position - b.position);
}

/** Primer status (por posición) con categoría `done`. */
export function findDoneStatus<T extends StatusLike>(statuses: T[]): T | undefined {
  return byPosition(statuses).find((s) => s.category === 'done');
}

/**
 * Status al que vuelve una tarea al destildarla: el primer `todo`, si no hay
 * el primer `backlog`, y si tampoco el primer status abierto.
 */
export function findOpenStatus<T extends StatusLike>(statuses: T[]): T | undefined {
  const sorted = byPosition(statuses);
  return (
    sorted.find((s) => s.category === 'todo') ??
    sorted.find((s) => s.category === 'backlog') ??
    sorted.find((s) => !isCompletedCategory(s.category))
  );
}

/**
 * Status destino al tocar el checkbox de una tarea. Devuelve `undefined` si
 * el proyecto no tiene un status adecuado (p. ej. ninguno con categoría done).
 */
export function toggleDoneStatus<T extends StatusLike>(
  currentCategory: string | null | undefined,
  statuses: T[],
): T | undefined {
  return isCompletedCategory(currentCategory) ? findOpenStatus(statuses) : findDoneStatus(statuses);
}

/**
 * Aplica un parche a un issue en memoria (actualización optimista),
 * resolviendo los campos derivados (nombre/color/categoría del status,
 * nombre/email del asignado).
 */
export function applyIssuePatch(
  issue: TrackIssueWithStatus,
  patch: IssuePatch,
  statuses: StatusLike[] = [],
  members: MemberLike[] = [],
): TrackIssueWithStatus {
  const next: TrackIssueWithStatus = { ...issue };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.dueDate !== undefined) next.due_date = patch.dueDate ?? null;
  if (patch.statusId !== undefined) {
    const status = patch.statusId ? statuses.find((s) => s.id === patch.statusId) : undefined;
    next.status_id = patch.statusId ?? null;
    next.status_name = status?.name ?? null;
    next.status_color = status?.color ?? null;
    next.status_category = status?.category ?? null;
  }
  if (patch.assigneeId !== undefined) {
    const member = patch.assigneeId ? members.find((m) => m.id === patch.assigneeId) : undefined;
    next.assignee_id = patch.assigneeId ?? null;
    next.assignee_name = member?.name ?? null;
    next.assignee_email = member?.email ?? null;
  }
  return next;
}

// ---------- Fechas ----------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Fecha local (no UTC) en formato YYYY-MM-DD. */
export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Suma días a una fecha YYYY-MM-DD (calendario, sin problemas de DST). */
export function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'none';

export const DUE_BUCKETS: DueBucket[] = ['overdue', 'today', 'upcoming', 'none'];

/** Clasifica un vencimiento respecto de `today` (ambos YYYY-MM-DD). */
export function dueBucket(dueDate: string | null | undefined, today: string): DueBucket {
  if (!dueDate) return 'none';
  const day = dueDate.slice(0, 10);
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  return 'upcoming';
}

/**
 * Agrupa issues por vencimiento. Dentro de cada grupo ordena por fecha y
 * luego por prioridad (sort estable: ante empates respeta el orden original,
 * así una tarea recién tildada no salta de lugar).
 */
export function groupByDue<T extends Pick<TrackIssueWithStatus, 'due_date' | 'priority'>>(
  issues: T[],
  today: string,
): Record<DueBucket, T[]> {
  const groups: Record<DueBucket, T[]> = { overdue: [], today: [], upcoming: [], none: [] };
  for (const issue of issues) {
    groups[dueBucket(issue.due_date, today)].push(issue);
  }
  const prio = (p: IssuePriority) => PRIORITIES.indexOf(p);
  for (const bucket of DUE_BUCKETS) {
    groups[bucket].sort((a, b) => {
      const da = a.due_date ?? '';
      const db = b.due_date ?? '';
      if (da !== db) return da < db ? -1 : 1;
      return prio(a.priority) - prio(b.priority);
    });
  }
  return groups;
}

// ---------- Quick-create tokens ----------

export interface QuickTitle {
  title: string;
  priority?: IssuePriority;
  dueDate?: string;
}

const PRIORITY_TOKENS: Record<string, IssuePriority> = {
  urgent: 'urgent',
  urgente: 'urgent',
  high: 'high',
  alta: 'high',
  medium: 'medium',
  media: 'medium',
  low: 'low',
  baja: 'low',
  '1': 'urgent',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
};

const TODAY_TOKENS = new Set(['today', 'hoy', 'hoje']);
const TOMORROW_TOKENS = new Set(['tomorrow', 'manana', 'mañana', 'amanha', 'amanhã']);

/**
 * Extrae tokens opcionales del título del quick-create:
 * - prioridad: `!urgent` `!high` `!medium` `!low` (también es/pt y `!1`…`!4`)
 * - vencimiento: `@today` `@tomorrow` `@2026-10-20` (también `@hoy`, `@mañana`, `@hoje`, `@amanhã`)
 * Los tokens no reconocidos quedan en el título tal cual.
 */
export function parseQuickTitle(input: string, today: string): QuickTitle {
  const out: QuickTitle = { title: '' };
  const kept: string[] = [];
  for (const word of input.trim().split(/\s+/)) {
    if (!word) continue;
    const lower = word.toLowerCase();
    if (lower.startsWith('!') && lower.length > 1) {
      const p = PRIORITY_TOKENS[lower.slice(1)];
      if (p) {
        out.priority = p;
        continue;
      }
    }
    if (lower.startsWith('@') && lower.length > 1) {
      const token = lower.slice(1);
      if (TODAY_TOKENS.has(token)) {
        out.dueDate = today;
        continue;
      }
      if (TOMORROW_TOKENS.has(token)) {
        out.dueDate = addDays(today, 1);
        continue;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
        out.dueDate = token;
        continue;
      }
    }
    kept.push(word);
  }
  out.title = kept.join(' ');
  return out;
}

/**
 * Formato corto de un día calendario ("Oct 14", o "Oct 14, 2027" si es de
 * otro año). Interpreta la fecha como día civil (UTC), así no se corre un
 * día según la zona horaria del navegador.
 */
export function formatDay(isoDay: string, locale: string, today?: string): string {
  const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return isoDay;
  const sameYear = today ? Number(today.slice(0, 4)) === y : false;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
