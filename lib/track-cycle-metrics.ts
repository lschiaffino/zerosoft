/**
 * Track — métricas de un cycle (como el detalle de cycle de Linear): burn-up
 * de alcance, empezados y terminados por día, scope creep, lo que pasó al
 * cycle siguiente, velocidad de los últimos 3 cycles cerrados y capacidad.
 *
 * Se reconstruye desde la actividad de los issues: los cambios de cycle
 * (cycle_change, por nombre de cycle dentro del proyecto) y los de status
 * (status_change con fromCategory/toCategory, o por nombre del status).
 */
import { currentVisibleSql } from './track-access';
import { getDb } from './db';
import type { TrackCycleRow, TrackStatusRow } from './db';
import {
  capacityPercent,
  computeCycleMetrics,
  velocity,
  type CycleIssueHistory,
  type CycleMetrics,
  type StatusCategory,
} from './track-planning-core';

export interface CycleMetricsResult extends CycleMetrics {
  cycle: TrackCycleRow;
  state: 'active' | 'upcoming' | 'past';
  velocity: number | null;
  capacityPercent: number | null;
  /** Lo terminado en cada uno de los cycles cerrados anteriores (más viejo primero). */
  history: Array<{ id: string; name: string; completed: number; scope: number }>;
}

function inClause(n: number): string {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

function stateOf(c: TrackCycleRow, today: string): 'active' | 'upcoming' | 'past' {
  if (c.start_at.slice(0, 10) > today) return 'upcoming';
  if (c.end_at.slice(0, 10) < today || c.completed_at) return 'past';
  return 'active';
}

async function histories(cycle: TrackCycleRow, statuses: TrackStatusRow[]): Promise<CycleIssueHistory[]> {
  const db = getDb();
  const byName = new Map(statuses.map((s) => [s.name, s.category]));
  const issues = (await db
    .prepare(
      `SELECT i.id, i.estimate, i.created_at, i.cycle_id, s.category FROM track_issues i
       LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND i.triage = 0 AND (i.cycle_id = ? OR i.id IN (
         SELECT a.issue_id FROM track_issue_activities a
         WHERE a.type = 'cycle_change' AND (json_extract(a.meta, '$.from') = ? OR json_extract(a.meta, '$.to') = ?)
       ))
       LIMIT 2000`,
    )
    .all(cycle.project_id, cycle.id, cycle.name, cycle.name)) as Array<{
    id: string;
    estimate: number | null;
    created_at: string;
    cycle_id: string | null;
    category: StatusCategory | null;
  }>;
  if (!issues.length) return [];
  const acts = (await db
    .prepare(
      `SELECT issue_id, type, meta, created_at FROM track_issue_activities
       WHERE issue_id IN ${inClause(issues.length)} AND type IN ('cycle_change', 'status_change')
       ORDER BY created_at ASC`,
    )
    .all(...issues.map((i) => i.id))) as Array<{ issue_id: string; type: string; meta: string; created_at: string }>;
  const cat = (name: unknown, category: unknown): StatusCategory | null => {
    if (typeof category === 'string' && category) return category as StatusCategory;
    if (typeof name === 'string') return byName.get(name) ?? null;
    return null;
  };
  return issues.map((i) => {
    const moves: CycleIssueHistory['moves'] = [];
    const statusChanges: CycleIssueHistory['statusChanges'] = [];
    for (const a of acts) {
      if (a.issue_id !== i.id) continue;
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(a.meta) as Record<string, unknown>;
      } catch {
        meta = {};
      }
      if (a.type === 'cycle_change') {
        if (meta.to === cycle.name && meta.from !== cycle.name) moves.push({ at: a.created_at, kind: 'join' });
        else if (meta.from === cycle.name && meta.to !== cycle.name) {
          moves.push({ at: a.created_at, kind: 'leave', rollover: meta.via === 'cycle_complete' });
        }
      } else {
        statusChanges.push({ at: a.created_at, from: cat(meta.from, meta.fromCategory), to: cat(meta.to, meta.toCategory) });
      }
    }
    return {
      id: i.id,
      estimate: i.estimate,
      createdAt: i.created_at.includes('T') ? i.created_at : `${i.created_at.replace(' ', 'T')}Z`,
      category: i.category,
      inCycle: i.cycle_id === cycle.id,
      moves,
      statusChanges,
    };
  });
}

/** Métricas completas de un cycle. `today` en YYYY-MM-DD. */
export async function cycleMetrics(cycle: TrackCycleRow, today: string): Promise<CycleMetricsResult> {
  const db = getDb();
  const statuses = (await db.prepare('SELECT * FROM track_statuses WHERE project_id = ?').all(cycle.project_id)) as TrackStatusRow[];
  const metrics = computeCycleMetrics({ start: cycle.start_at, end: cycle.end_at, today, issues: await histories(cycle, statuses) });
  // Velocidad: los últimos 3 cycles del proyecto que terminaron antes que este.
  const previous = (await db
    .prepare(
      `SELECT * FROM track_cycles WHERE project_id = ? AND id != ? AND substr(end_at, 1, 10) < ? AND substr(end_at, 1, 10) < ?
       ORDER BY start_at DESC LIMIT 3`,
    )
    .all(cycle.project_id, cycle.id, cycle.start_at.slice(0, 10) > today ? today : cycle.start_at.slice(0, 10), today)) as TrackCycleRow[];
  const history: CycleMetricsResult['history'] = [];
  for (const p of previous.reverse()) {
    const m = computeCycleMetrics({ start: p.start_at, end: p.end_at, today, issues: await histories(p, statuses) });
    history.push({ id: p.id, name: p.name, completed: m.completed, scope: m.scope });
  }
  const vel = velocity(history.map((h) => h.completed));
  const state = stateOf(cycle, today);
  // Cycle por empezar: el alcance es lo cargado hoy (el burn-up todavía no tiene días).
  const scope = state === 'upcoming' ? metrics.scope || (await upcomingScope(cycle, metrics.byPoints)) : metrics.scope;
  return {
    ...metrics,
    scope,
    cycle,
    state,
    velocity: vel,
    capacityPercent: capacityPercent(scope, vel),
    history,
  };
}

async function upcomingScope(cycle: TrackCycleRow, byPoints: boolean): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT i.estimate, s.category FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.cycle_id = ? AND i.triage = 0`,
    )
    .all(cycle.id)) as Array<{ estimate: number | null; category: string | null }>;
  return rows.filter((r) => r.category !== 'cancelled').reduce((a, r) => a + (byPoints ? Math.max(r.estimate ?? 1, 0) || 1 : 1), 0);
}

export interface CycleListItem {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  project_icon: string | null;
  /** Clave del team (MOB): /app/track/cycles?team=MOB. */
  project_slug: string;
  start_at: string;
  end_at: string;
  completed_at: string | null;
  total: number;
  done: number;
  started: number;
  state: 'active' | 'upcoming' | 'past';
}

/** Cycles de todos los proyectos del workspace (como la vista Cycles de Linear). */
export async function listWorkspaceCycles(scopeWhereSql: string, scopeArg: string, today: string): Promise<CycleListItem[]> {
  const vis = await currentVisibleSql('p');
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.name, c.project_id, p.name AS project_name, p.icon AS project_icon, p.slug AS project_slug, c.start_at, c.end_at, c.completed_at,
         (SELECT COUNT(*) FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id
            WHERE i.cycle_id = c.id AND i.triage = 0 AND (s.category IS NULL OR s.category != 'cancelled')) AS total,
         (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
            WHERE i.cycle_id = c.id AND i.triage = 0 AND s.category = 'done') AS done,
         (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
            WHERE i.cycle_id = c.id AND i.triage = 0 AND s.category = 'in_progress') AS started
       FROM track_cycles c JOIN track_projects p ON p.id = c.project_id
       WHERE ${scopeWhereSql} AND ${vis.sql} AND p.status = 'active'
       ORDER BY c.start_at DESC LIMIT 300`,
    )
    .all(scopeArg, ...vis.args)) as Array<Omit<CycleListItem, 'state'>>;
  return rows.map((r) => ({ ...r, state: stateOf(r as unknown as TrackCycleRow, today) }));
}
