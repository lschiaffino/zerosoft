/**
 * Track — helpers puros (sin DB) para la edición rápida de tareas:
 * tildar como hecha, aplicar parches optimistas, agrupar por vencimiento y
 * parsear tokens del quick-create. Se usan tanto en el cliente como en tests.
 */
import type { TrackStatusRow } from './schema/types';
import type { TrackIssueWithStatus } from './track-data';

export type StatusCategory = TrackStatusRow['category'];
export type IssuePriority = TrackIssueWithStatus['priority'];

export const PRIORITIES: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

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
  startDate?: string | null;
  estimate?: number | null;
  cycleId?: string | null;
  milestoneId?: string | null;
  planMilestoneId?: string | null;
  parentId?: string | null;
  subOrder?: number | null;
  /** Project (plan) del issue. */
  planId?: string | null;
  /** Lista completa de labels (ids del workspace). */
  labels?: Array<{ id: string }>;
}

/** Nombres para el parche optimista de cycle, milestone y labels. */
export interface PatchExtras {
  cycles?: Array<{ id: string; name: string }>;
  milestones?: Array<{ id: string; name: string }>;
  labels?: Array<{ id: string; name: string; color: string }>;
  plans?: Array<{ id: string; name: string }>;
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
 * Status de un issue nuevo cuando no se elige uno (quick-create con C, API,
 * Flow, agentes, Chat, recurrentes, triage). Una sola regla en todos lados,
 * la de Linear: el primer status sin empezar (`todo`); si no hay, el primer
 * `backlog`; si tampoco, el primer status abierto. Es la misma que al reabrir.
 */
export function defaultIssueStatus<T extends StatusLike>(statuses: T[]): T | undefined {
  return findOpenStatus(statuses);
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
  extras: PatchExtras = {},
): TrackIssueWithStatus {
  const next: TrackIssueWithStatus = { ...issue };
  if (patch.estimate !== undefined) next.estimate = patch.estimate ?? null;
  if (patch.startDate !== undefined) next.start_date = patch.startDate ?? null;
  if (patch.parentId !== undefined) next.parent_id = patch.parentId ?? null;
  if (patch.subOrder !== undefined) next.sub_order = patch.subOrder ?? null;
  if (patch.cycleId !== undefined) {
    next.cycle_id = patch.cycleId ?? null;
    next.cycle_name = patch.cycleId ? (extras.cycles?.find((c) => c.id === patch.cycleId)?.name ?? null) : null;
  }
  if (patch.milestoneId !== undefined) {
    next.milestone_id = patch.milestoneId ?? null;
    next.milestone_name = patch.milestoneId
      ? (extras.milestones?.find((m) => m.id === patch.milestoneId)?.name ?? null)
      : null;
  }
  if (patch.planMilestoneId !== undefined) {
    next.plan_milestone_id = patch.planMilestoneId ?? null;
    next.plan_milestone_name = patch.planMilestoneId ? (next.plan_milestone_name ?? null) : null;
  }
  if (patch.planId !== undefined) {
    next.plan_id = patch.planId ?? null;
    next.plan_name = patch.planId ? (extras.plans?.find((p) => p.id === patch.planId)?.name ?? next.plan_name ?? null) : null;
  }
  if (patch.labels !== undefined && extras.labels) {
    const byId = new Map(extras.labels.map((l) => [l.id, l]));
    next.labels = JSON.stringify(patch.labels.map((l) => byId.get(l.id)).filter(Boolean));
  }
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
  '0': 'none',
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

/**
 * Slug de un proyecto a partir del nombre: el mismo que deriva el servidor
 * cuando no se manda uno. Es el prefijo de los identificadores (WEB-12).
 */
export function projectSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/**
 * Clave corta para un proyecto que llega sin una (import de GitHub, Jira o
 * CSV): iniciales si el nombre tiene varias palabras, las tres primeras letras
 * si tiene una. "Gen Proj 0idt" → "gp" (GP-12), "Website" → "web". Las
 * palabras que empiezan con un número no cuentan si hay otras.
 */
export function shortProjectKey(name: string): string {
  const words = projectSlug(name).split('-').filter(Boolean);
  const alpha = words.filter((w) => /^[a-z]/.test(w));
  const use = alpha.length ? alpha : words;
  if (use.length === 0) return '';
  if (use.length === 1) return use[0].slice(0, 3);
  return use
    .slice(0, 4)
    .map((w) => w[0])
    .join('');
}

export type CycleState = 'active' | 'upcoming' | 'past';

interface CycleLike {
  start_at: string;
  end_at: string;
}

/** Estado de un ciclo respecto de `today` (YYYY-MM-DD); inicio y fin inclusive. */
export function cycleState(cycle: CycleLike, today: string): CycleState {
  if (cycle.end_at.slice(0, 10) < today) return 'past';
  if (cycle.start_at.slice(0, 10) > today) return 'upcoming';
  return 'active';
}

/** El ciclo en curso (si hay varios, el que empezó último). */
export function activeCycle<T extends CycleLike>(cycles: T[], today: string): T | null {
  return (
    cycles
      .filter((c) => cycleState(c, today) === 'active')
      .sort((a, b) => b.start_at.localeCompare(a.start_at))[0] ?? null
  );
}

/** Primer ciclo que se pisa con el rango [startAt, endAt] (inclusive), sin contar `exceptId`. */
export function overlappingCycle<T extends CycleLike & { id: string }>(
  cycles: T[],
  startAt: string,
  endAt: string,
  exceptId?: string,
): T | undefined {
  const s = startAt.slice(0, 10);
  const e = endAt.slice(0, 10);
  return cycles.find((c) => c.id !== exceptId && s <= c.end_at.slice(0, 10) && e >= c.start_at.slice(0, 10));
}

/** Días entre dos fechas YYYY-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (x: string) => {
    const [y, m, d] = x.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * Valores del ciclo nuevo: número N+1 (del último "Ciclo N") y fechas que
 * arrancan el día después del último ciclo, con la misma duración. Sin
 * ciclos, dos semanas desde hoy.
 */
export function nextCycleDraft(
  cycles: Array<CycleLike & { name: string }>,
  today: string,
): { n: number; startAt: string; endAt: string } {
  const numbers = cycles.map((c) => Number(/(\d+)\s*$/.exec(c.name)?.[1] ?? NaN)).filter((n) => Number.isFinite(n));
  const n = (numbers.length > 0 ? Math.max(...numbers) : cycles.length) + 1;
  const last = [...cycles].sort((a, b) => b.end_at.localeCompare(a.end_at))[0];
  if (!last) return { n, startAt: today, endAt: addDays(today, 13) };
  const length = Math.max(0, daysBetween(last.start_at, last.end_at));
  const after = addDays(last.end_at.slice(0, 10), 1);
  const startAt = after > today ? after : today;
  return { n, startAt, endAt: addDays(startAt, length) };
}

// ---------- Deshacer ----------

function labelIds(raw: string | null | undefined): Array<{ id: string }> {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.id === 'string').map((l) => ({ id: l.id })) : [];
  } catch {
    return [];
  }
}

/** Parche que devuelve el issue a como estaba antes de `patch` (para ⌘Z). */
export function inversePatch(prev: TrackIssueWithStatus, patch: IssuePatch): IssuePatch {
  const out: IssuePatch = {};
  if (patch.title !== undefined) out.title = prev.title;
  if (patch.statusId !== undefined) out.statusId = prev.status_id;
  if (patch.priority !== undefined) out.priority = prev.priority;
  if (patch.assigneeId !== undefined) out.assigneeId = prev.assignee_id;
  if (patch.dueDate !== undefined) out.dueDate = prev.due_date;
  if (patch.startDate !== undefined) out.startDate = prev.start_date;
  if (patch.estimate !== undefined) out.estimate = prev.estimate;
  if (patch.cycleId !== undefined) out.cycleId = prev.cycle_id;
  if (patch.milestoneId !== undefined) out.milestoneId = prev.milestone_id ?? null;
  if (patch.planMilestoneId !== undefined) out.planMilestoneId = prev.plan_milestone_id ?? null;
  if (patch.parentId !== undefined) out.parentId = prev.parent_id;
  if (patch.subOrder !== undefined) out.subOrder = prev.sub_order ?? null;
  if (patch.planId !== undefined) out.planId = prev.plan_id ?? null;
  if (patch.labels !== undefined) out.labels = labelIds(prev.labels);
  return out;
}

/** Copia de `prev` los campos que toca `patch` (revertir un parche que falló). */
export function revertPatchFields(
  current: TrackIssueWithStatus,
  prev: TrackIssueWithStatus,
  patch: IssuePatch,
): TrackIssueWithStatus {
  const r = { ...current };
  if (patch.title !== undefined) r.title = prev.title;
  if (patch.priority !== undefined) r.priority = prev.priority;
  if (patch.dueDate !== undefined) r.due_date = prev.due_date;
  if (patch.startDate !== undefined) r.start_date = prev.start_date;
  if (patch.estimate !== undefined) r.estimate = prev.estimate;
  if (patch.parentId !== undefined) r.parent_id = prev.parent_id;
  if (patch.subOrder !== undefined) r.sub_order = prev.sub_order;
  if (patch.planId !== undefined) {
    r.plan_id = prev.plan_id;
    r.plan_name = prev.plan_name;
  }
  if (patch.labels !== undefined) r.labels = prev.labels;
  if (patch.cycleId !== undefined) {
    r.cycle_id = prev.cycle_id;
    r.cycle_name = prev.cycle_name;
  }
  if (patch.milestoneId !== undefined) {
    r.milestone_id = prev.milestone_id;
    r.milestone_name = prev.milestone_name;
  }
  if (patch.statusId !== undefined) {
    r.status_id = prev.status_id;
    r.status_name = prev.status_name;
    r.status_color = prev.status_color;
    r.status_category = prev.status_category;
  }
  if (patch.assigneeId !== undefined) {
    r.assignee_id = prev.assignee_id;
    r.assignee_name = prev.assignee_name;
    r.assignee_email = prev.assignee_email;
  }
  return r;
}
