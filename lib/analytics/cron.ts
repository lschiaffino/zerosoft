/**
 * Cron de Analytics (corre en /api/cron/tick, cada hora). Tres trabajos, cada
 * proyecto reclamado con compare-and-set para que dos corridas no hagan lo
 * mismo dos veces:
 * - rollup diario: cuenta eventos y personas únicas por día y evento en
 *   analytics_daily (las tendencias sin filtros leen de ahí los días cerrados);
 * - retención: borra los eventos y sesiones más viejos que retention_days;
 * - proyectos borrados: purga sus datos por tandas y después la fila.
 * Todo con presupuesto de tiempo: lo que no entra sigue en la próxima corrida.
 */
import { getDb } from '../db';
import { bucketOf } from './compute';

const DAY = 86_400_000;
const CLAIM_MS = 10 * 60_000;
const CHUNK = 5000;

function dayStartMs(day: string, offsetMin: number): number {
  return Date.parse(`${day}T00:00:00Z`) - offsetMin * 60_000;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Reclama un proyecto para un trabajo (columna con el ms del reclamo). */
async function claim(projectId: string, column: 'rollup_claimed_at' | 'purged_at', now: number, staleMs: number): Promise<boolean> {
  const res = await getDb()
    .prepare(`UPDATE analytics_projects SET ${column} = ? WHERE id = ? AND (${column} IS NULL OR ${column} < ?)`)
    .run(now, projectId, now - staleMs);
  return res.changes === 1;
}

export interface AnalyticsCronResult {
  rolledDays: number;
  purgedEvents: number;
  deletedProjects: number;
}

export async function runAnalyticsCron(opts: { budgetMs?: number; now?: number } = {}): Promise<AnalyticsCronResult> {
  const started = Date.now();
  const now = opts.now ?? Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const left = () => budget - (Date.now() - started);
  const db = getDb();
  const out: AnalyticsCronResult = { rolledDays: 0, purgedEvents: 0, deletedProjects: 0 };

  // 1. Proyectos borrados: datos por tandas, después la fila (insights, tableros y flags caen en cascada).
  const deleted = (await db
    .prepare('SELECT id FROM analytics_projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT 5')
    .all()) as Array<{ id: string }>;
  for (const { id } of deleted) {
    if (left() <= 0) break;
    if (!(await claim(id, 'purged_at', now, CLAIM_MS))) continue;
    let done = false;
    while (left() > 0) {
      const res = await db
        .prepare(`DELETE FROM analytics_events WHERE id IN (SELECT id FROM analytics_events WHERE project_id = ? LIMIT ${CHUNK})`)
        .run(id);
      out.purgedEvents += res.changes;
      if (res.changes < CHUNK) {
        done = true;
        break;
      }
    }
    if (!done) {
      await db.prepare('UPDATE analytics_projects SET purged_at = NULL WHERE id = ?').run(id);
      continue;
    }
    for (const table of ['analytics_person_ids', 'analytics_persons', 'analytics_sessions', 'analytics_groups', 'analytics_daily']) {
      await db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(id);
    }
    await db.prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
    out.deletedProjects++;
  }

  // 2. Rollup diario: hasta ayer (día local del proyecto), 31 días por corrida.
  const candidates = (await db
    .prepare(
      `SELECT id, tz_offset_min, rolled_through, dirty_from FROM analytics_projects
       WHERE deleted_at IS NULL AND (rollup_claimed_at IS NULL OR rollup_claimed_at < ?) ORDER BY rollup_claimed_at LIMIT 50`,
    )
    .all(now - CLAIM_MS)) as Array<{ id: string; tz_offset_min: number; rolled_through: string | null; dirty_from: string | null }>;
  for (const p of candidates) {
    if (left() <= 0) break;
    const tz = Number(p.tz_offset_min);
    const yesterday = addDays(bucketOf(now, 'day', tz), -1);
    let from: string | null = p.dirty_from ?? (p.rolled_through ? addDays(p.rolled_through, 1) : null);
    if (!from) {
      const first = (await db.prepare('SELECT MIN(ts) AS ts FROM analytics_events WHERE project_id = ?').get(p.id)) as { ts: number | null } | undefined;
      if (first?.ts == null) continue;
      from = bucketOf(Number(first.ts), 'day', tz);
    }
    if (from > yesterday) continue;
    if (!(await claim(p.id, 'rollup_claimed_at', now, CLAIM_MS))) continue;
    let day = from;
    let last: string | null = null;
    for (let n = 0; n < 31 && day <= yesterday && left() > 0; n++) {
      const start = dayStartMs(day, tz);
      await db.prepare('DELETE FROM analytics_daily WHERE project_id = ? AND day = ?').run(p.id, day);
      await db
        .prepare(
          `INSERT INTO analytics_daily (project_id, day, event, count, uniques)
           SELECT e.project_id, ?, e.event, COUNT(*), COUNT(DISTINCT COALESCE(m.person_id, e.distinct_id)) FROM analytics_events e
           LEFT JOIN analytics_person_ids m ON m.project_id = e.project_id AND m.distinct_id = e.distinct_id
           WHERE e.project_id = ? AND e.ts >= ? AND e.ts < ? GROUP BY e.event`,
        )
        .run(day, p.id, start, start + DAY);
      out.rolledDays++;
      last = day;
      day = addDays(day, 1);
    }
    if (last) {
      // Si llegó un evento atrasado mientras tanto (dirty_from cambió), no se pisa.
      await db
        .prepare(
          `UPDATE analytics_projects SET rolled_through = CASE WHEN rolled_through IS NULL OR rolled_through < ? THEN ? ELSE rolled_through END,
             dirty_from = CASE WHEN dirty_from IS ? THEN NULL ELSE dirty_from END, rollup_claimed_at = NULL WHERE id = ?`,
        )
        .run(last, last, p.dirty_from, p.id);
    } else {
      await db.prepare('UPDATE analytics_projects SET rollup_claimed_at = NULL WHERE id = ?').run(p.id);
    }
  }

  // 3. Retención: una vez cada 6 h por proyecto.
  const due = (await db
    .prepare('SELECT id, retention_days FROM analytics_projects WHERE deleted_at IS NULL AND (purged_at IS NULL OR purged_at < ?) LIMIT 50')
    .all(now - 6 * 3_600_000)) as Array<{ id: string; retention_days: number }>;
  for (const p of due) {
    if (left() <= 0) break;
    if (!(await claim(p.id, 'purged_at', now, 6 * 3_600_000))) continue;
    const cutoff = now - Number(p.retention_days) * DAY;
    for (let round = 0; round < 20 && left() > 0; round++) {
      const res = await db
        .prepare(`DELETE FROM analytics_events WHERE id IN (SELECT id FROM analytics_events WHERE project_id = ? AND ts < ? LIMIT ${CHUNK})`)
        .run(p.id, cutoff);
      out.purgedEvents += res.changes;
      if (res.changes < CHUNK) break;
    }
    await db.prepare('DELETE FROM analytics_sessions WHERE project_id = ? AND started_at < ?').run(p.id, cutoff);
    await db.prepare('DELETE FROM analytics_daily WHERE project_id = ? AND day < ?').run(p.id, new Date(cutoff).toISOString().slice(0, 10));
  }
  return out;
}
