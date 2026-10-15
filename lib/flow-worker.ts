/**
 * Flow — worker de la cola. Lo llaman el cron (app/api/cron/tick) y after()
 * cuando se encola una corrida. Varias invocaciones concurrentes no ejecutan
 * dos veces lo mismo: cada corrida/job se reclama con un UPDATE condicional
 * (compare-and-set sobre status/locked_until) y solo sigue quien lo ganó.
 * Server-only.
 */
import { getDb, type FlowJobRow } from './db';
import { executeRun, resumeRun } from './flow-engine';
import { enqueueDueSchedules, nowIso, parseJson } from './flow';

/** Tiempo máximo que una corrida puede quedar tomada por un worker. */
const LOCK_MS = 5 * 60_000;

function lockUntil(): string {
  return new Date(Date.now() + LOCK_MS).toISOString();
}

/** Reclama una corrida en cola. true = este worker la ejecuta. */
export async function claimQueuedRun(runId: string): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE flow_runs SET status = 'running', locked_until = ?, started_at = COALESCE(started_at, ?)
       WHERE id = ? AND status = 'queued' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(lockUntil(), ts, runId, ts);
  return res.changes === 1;
}

/** Toma el lock de una corrida en espera (para retomarla desde un job). */
async function lockWaitingRun(runId: string): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE flow_runs SET locked_until = ?
       WHERE id = ? AND status = 'waiting' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(lockUntil(), runId, ts);
  return res.changes === 1;
}

async function claimJob(jobId: string): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE flow_jobs SET locked_until = ?, attempts = attempts + 1
       WHERE id = ? AND run_at <= ? AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(lockUntil(), jobId, ts, ts);
  return res.changes === 1;
}

/** Corridas colgadas (worker caído a mitad): se marcan como fallidas. */
async function failStaleRuns(): Promise<number> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE flow_runs SET status = 'failed', error = 'worker_timeout', finished_at = ?, locked_until = NULL
       WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < ?`,
    )
    .run(ts, ts);
  return res.changes;
}

export interface WorkerResult {
  runs: number;
  jobs: number;
  schedules: number;
  stale: number;
}

/**
 * Procesa la cola. `budgetMs`: tiempo máximo para empezar corridas/jobs nuevos
 * (el cron lo acota para no consumir todo el tick); lo que no entra queda en
 * cola para la próxima pasada.
 */
export async function processFlowQueue(opts: { limit?: number; now?: Date; budgetMs?: number } = {}): Promise<WorkerResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const deadline = opts.budgetMs === undefined ? Infinity : Date.now() + Math.max(0, opts.budgetMs);
  const result: WorkerResult = { runs: 0, jobs: 0, schedules: 0, stale: 0 };
  result.stale = await failStaleRuns();
  result.schedules = (await enqueueDueSchedules(opts.now ?? new Date())).length;

  const queued = (await getDb()
    .prepare("SELECT id FROM flow_runs WHERE status = 'queued' ORDER BY created_at LIMIT ?")
    .all(limit)) as Array<{ id: string }>;
  for (const r of queued) {
    if (Date.now() >= deadline) break;
    if (!(await claimQueuedRun(r.id))) continue;
    try {
      await executeRun(r.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[flow] run failed', err);
      await getDb()
        .prepare("UPDATE flow_runs SET status = 'failed', error = 'internal_error', finished_at = ?, locked_until = NULL WHERE id = ?")
        .run(nowIso(), r.id);
    }
    result.runs += 1;
  }

  const due = (await getDb()
    .prepare('SELECT * FROM flow_jobs WHERE run_at <= ? ORDER BY run_at LIMIT ?')
    .all(nowIso(), limit)) as FlowJobRow[];
  for (const job of due) {
    if (Date.now() >= deadline) break;
    if (!(await claimJob(job.id))) continue;
    if (!(await lockWaitingRun(job.run_id))) {
      // La corrida está tomada por otro worker (o ya terminó): se libera el job.
      const run = (await getDb().prepare('SELECT status FROM flow_runs WHERE id = ?').get(job.run_id)) as
        | { status: string }
        | undefined;
      if (!run || run.status === 'failed' || run.status === 'success') {
        await getDb().prepare('DELETE FROM flow_jobs WHERE id = ?').run(job.id);
      } else {
        await getDb().prepare('UPDATE flow_jobs SET locked_until = NULL WHERE id = ?').run(job.id);
      }
      continue;
    }
    await getDb().prepare('DELETE FROM flow_jobs WHERE id = ?').run(job.id);
    try {
      await resumeRun(job.run_id, job.node_id, parseJson(job.payload, {}));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[flow] resume failed', err);
      await getDb()
        .prepare("UPDATE flow_runs SET status = 'failed', error = 'internal_error', finished_at = ?, locked_until = NULL WHERE id = ?")
        .run(nowIso(), job.run_id);
    }
    result.jobs += 1;
  }
  return result;
}
