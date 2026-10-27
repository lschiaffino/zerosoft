/**
 * Flow — worker de la cola. Lo llaman los crons (app/api/cron/minute cada minuto y app/api/cron/tick) y after()
 * cuando se encola una corrida. Varias invocaciones concurrentes no ejecutan
 * dos veces lo mismo: cada corrida/job se reclama con un UPDATE condicional
 * (compare-and-set sobre status/locked_until) y solo sigue quien lo ganó.
 * Server-only.
 */
import { getDb, type FlowJobRow } from './db';
import { processDueReplays } from './flow-alerts';
import { executeRun, resumeRun } from './flow-engine';
import { enqueueDueSchedules, nowIso, parseJson } from './flow';
import { enqueueDuePolls } from './flow-poll';

/** Tiempo máximo que una corrida puede quedar tomada por un worker. */
const LOCK_MS = 5 * 60_000;

function lockUntil(): string {
  return new Date(Date.now() + LOCK_MS).toISOString();
}

/**
 * Reclama una corrida en cola. true = este worker la ejecuta. Las retenidas
 * por la protección ante avalanchas no se toman, y si el flow tiene un tope
 * de corridas a la vez (max_concurrency), solo se toma mientras haya lugar:
 * el conteo va en el mismo UPDATE (atómico), así dos workers no lo pasan.
 */
export async function claimQueuedRun(runId: string): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE flow_runs SET status = 'running', locked_until = ?, started_at = COALESCE(started_at, ?)
       WHERE id = ? AND status = 'queued' AND held = 0 AND (locked_until IS NULL OR locked_until < ?)
         AND (
           COALESCE((SELECT f.max_concurrency FROM flow_flows f WHERE f.id = flow_runs.flow_id), 0) <= 0
           OR (SELECT COUNT(*) FROM flow_runs r2 WHERE r2.flow_id = flow_runs.flow_id AND r2.status = 'running')
              < (SELECT f.max_concurrency FROM flow_flows f WHERE f.id = flow_runs.flow_id)
         )`,
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
  /** Replays automáticos de corridas fallidas (lib/flow-alerts.ts). */
  replays: number;
  /** Corridas encoladas por disparadores de polling (lib/flow-poll.ts). */
  polled: number;
}

/**
 * Procesa la cola. `budgetMs`: tiempo máximo para empezar corridas/jobs nuevos
 * (el cron lo acota para no consumir todo el tick); lo que no entra queda en
 * cola para la próxima pasada.
 */
export async function processFlowQueue(opts: { limit?: number; now?: Date; budgetMs?: number } = {}): Promise<WorkerResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const deadline = opts.budgetMs === undefined ? Infinity : Date.now() + Math.max(0, opts.budgetMs);
  const result: WorkerResult = { runs: 0, jobs: 0, schedules: 0, stale: 0, replays: 0, polled: 0 };
  result.stale = await failStaleRuns();
  result.schedules = (await enqueueDueSchedules(opts.now ?? new Date())).length;
  result.polled = await enqueueDuePolls(opts.now ?? new Date(), { limit: 10, deadline: opts.budgetMs === undefined ? undefined : deadline }).catch(
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[flow] polling failed', err);
      return 0;
    },
  );

  const queued = (await getDb()
    .prepare("SELECT id FROM flow_runs WHERE status = 'queued' AND held = 0 ORDER BY created_at, rowid LIMIT ?")
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

  if (Date.now() < deadline) {
    result.replays = await processDueReplays({ now: opts.now, limit: Math.min(limit, 20), deadline }).catch(() => 0);
  }
  return result;
}
