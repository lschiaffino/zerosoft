/**
 * Track — vista de projects (track_plans): orden de la lista y el gráfico de
 * progreso del project (alcance contra terminado en el tiempo), como el de
 * la página de project de Linear. El gráfico se arma con el mismo burn-up
 * de los cycles (lib/track-planning-core): el alcance de cada día son los
 * issues del project creados hasta ese día, y lo terminado sale de los
 * cambios de status de la actividad.
 */
import { getDb } from './db';
import { computeCycleMetrics, type CycleDayPoint, type CycleIssueHistory, type StatusCategory } from './track-planning-core';

export const PLAN_LIST_SORTS = ['manual', 'name', 'target', 'progress', 'created', 'updated'] as const;
export type PlanListSort = (typeof PLAN_LIST_SORTS)[number];

interface SortablePlan {
  name: string;
  target_date: string | null;
  created_at: string;
  updated_at?: string | null;
  progress: { percent: number };
}

/** Orden de la lista de projects ("manual" deja el del servidor: estado y después fecha). */
export function sortPlans<T extends SortablePlan>(rows: T[], sort: PlanListSort): T[] {
  if (sort === 'manual') return rows;
  const out = [...rows];
  switch (sort) {
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'target':
      // Sin fecha al final, como Linear.
      return out.sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'));
    case 'progress':
      return out.sort((a, b) => b.progress.percent - a.progress.percent);
    case 'created':
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'updated':
      return out.sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
  }
  return out;
}

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
  if (start > today) start = today;
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
  return planProgressSeries({
    startDate: plan.start_date,
    targetDate: plan.target_date,
    createdAt: plan.created_at,
    today,
    issues: rows.map((r) => ({ ...r, statusChanges: changes.get(r.id) ?? [] })),
  });
}
