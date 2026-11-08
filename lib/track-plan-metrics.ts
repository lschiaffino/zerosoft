/**
 * Track — gráfico de progreso del project (alcance contra terminado en el
 * tiempo), como el de la página de project de Linear. Se arma con el mismo
 * burn-up de los cycles (lib/track-planning-core): el alcance de cada día son
 * los issues del project creados hasta ese día, y lo terminado sale de los
 * cambios de status de la actividad. Solo servidor (lee la base); el orden de
 * la lista de projects está en lib/track-plan-list.
 */
import { getDb } from './db';
import { computeCycleMetrics, type CycleDayPoint, type CycleIssueHistory, type StatusCategory } from './track-planning-core';

export interface PlanProgressSeries {
  points: CycleDayPoint[];
  byPoints: boolean;
  /** Primer y último día del gráfico (YYYY-MM-DD). */
  start: string | null;
  end: string | null;
}

export interface PlanIssueHistoryRow {
  id: string;
  estimate: number | null;
  created_at: string;
  category: StatusCategory | null;
  statusChanges: CycleIssueHistory['statusChanges'];
}

function isoDay(raw: string): string {
  return raw.slice(0, 10);
}

/** Zona horaria IANA válida (la que manda el navegador), o null. */
export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Instante UTC (ISO o "YYYY-MM-DD HH:MM:SS" de SQLite) → hora de pared en esa zona ("YYYY-MM-DDTHH:MM:SS"). */
export function wallClock(iso: string, timeZone: string): string {
  const d = new Date(/T/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Hoy en esa zona. */
export function todayIn(timeZone: string, now = new Date()): string {
  return wallClock(now.toISOString(), timeZone).slice(0, 10);
}

/**
 * Serie diaria del project: desde el inicio (o el primer issue, o el alta del
 * project) hasta hoy o la fecha objetivo si ya pasó. Puro, para testear.
 */
export function planProgressSeries(args: {
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  today: string;
  issues: PlanIssueHistoryRow[];
}): PlanProgressSeries {
  const { issues, today } = args;
  if (issues.length === 0) return { points: [], byPoints: false, start: null, end: null };
  const firstIssue = issues.reduce((min, i) => (isoDay(i.created_at) < min ? isoDay(i.created_at) : min), today);
  let start = args.startDate ?? (firstIssue < isoDay(args.createdAt) ? firstIssue : isoDay(args.createdAt));
  // Al menos dos días (ayer y hoy): un project recién empezado ya muestra la línea desde cero.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (start > yesterday) start = yesterday;
  // Hasta hoy (lo que falta no se dibuja); si la fecha objetivo ya pasó, hasta hoy igual: se ve el atraso.
  const end = today;
  // Más de 180 días: se empieza 180 días atrás para que el gráfico se lea.
  const maxStart = new Date(Date.parse(`${end}T00:00:00Z`) - 180 * 86_400_000).toISOString().slice(0, 10);
  if (start < maxStart) start = maxStart;
  const metrics = computeCycleMetrics({
    start,
    end,
    today,
    issues: issues.map((i) => ({
      id: i.id,
      estimate: i.estimate,
      createdAt: i.created_at.includes('T') ? i.created_at : `${i.created_at.replace(' ', 'T')}Z`,
      category: i.category,
      inCycle: true,
      moves: [],
      statusChanges: i.statusChanges,
    })),
  });
  return { points: metrics.points, byPoints: metrics.byPoints, start, end };
}

function inClause(n: number): string {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

/** Serie del project desde la base (issues del project y sus cambios de status). */
export async function loadPlanProgressSeries(
  plan: { id: string; start_date: string | null; target_date: string | null; created_at: string },
  today: string,
  timeZone?: string | null,
): Promise<PlanProgressSeries> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT i.id, i.estimate, i.created_at, s.category FROM track_issues i
       LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.plan_id = ? AND i.triage = 0 AND i.archived_at IS NULL LIMIT 2000`,
    )
    .all(plan.id)) as Array<{ id: string; estimate: number | null; created_at: string; category: StatusCategory | null }>;
  if (!rows.length) return { points: [], byPoints: false, start: null, end: null };
  const acts = (await db
    .prepare(
      `SELECT issue_id, meta, created_at FROM track_issue_activities
       WHERE issue_id IN ${inClause(rows.length)} AND type = 'status_change' ORDER BY created_at ASC`,
    )
    .all(...rows.map((r) => r.id))) as Array<{ issue_id: string; meta: string; created_at: string }>;
  // Status viejos sin categoría en la actividad: por nombre, con los status de los teams del project.
  const statuses = (await db
    .prepare(
      `SELECT DISTINCT s.name, s.category FROM track_statuses s
       WHERE s.project_id IN (SELECT project_id FROM track_issues WHERE plan_id = ?)`,
    )
    .all(plan.id)) as Array<{ name: string; category: StatusCategory }>;
  const byName = new Map(statuses.map((s) => [s.name, s.category]));
  const cat = (name: unknown, category: unknown): StatusCategory | null => {
    if (typeof category === 'string' && category) return category as StatusCategory;
    if (typeof name === 'string') return byName.get(name) ?? null;
    return null;
  };
  const changes = new Map<string, CycleIssueHistory['statusChanges']>();
  for (const a of acts) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(a.meta) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    const list = changes.get(a.issue_id) ?? [];
    list.push({ at: a.created_at, from: cat(meta.from, meta.fromCategory), to: cat(meta.to, meta.toCategory) });
    changes.set(a.issue_id, list);
  }
  // Con zona: cada instante pasa a la hora de pared de esa zona, así los días son los de quien mira.
  const local = (iso: string) => (timeZone ? wallClock(iso, timeZone) : iso);
  return planProgressSeries({
    startDate: plan.start_date,
    targetDate: plan.target_date,
    createdAt: plan.created_at,
    today,
    issues: rows.map((r) => ({
      ...r,
      created_at: local(r.created_at),
      statusChanges: (changes.get(r.id) ?? []).map((c) => ({ ...c, at: local(c.at) })),
    })),
  });
}
