/**
 * Flow — historial de corridas de todos los flows del workspace: búsqueda
 * (por estado, flow, fecha y texto), tablero de uso y fallas, y exportación
 * (CSV o JSON). Los datos de una corrida (entrada del disparador y de cada
 * paso) siguen siendo solo de quien la capturó (canSeeRunData): la búsqueda
 * por dato mira únicamente sus corridas, así no sirve para adivinar lo que
 * trae una corrida ajena. Server-only.
 */
import { getDb, type FlowRunRow } from './db';
import { canSeeRunData, toRunDto, type FlowRunDto, type FlowRunViewer } from './flow';
import { toCsv } from './crm-report-builder';

import { RUN_FILTER_STATUSES, RUN_RANGES, type RunFilterStatus } from './flow-monitor-shared';

export { RUN_FILTER_STATUSES, RUN_RANGES, type RunFilterStatus };

export interface RunSearch {
  status?: RunFilterStatus | null;
  flowId?: string | null;
  q?: string | null;
  /** Días hacia atrás (1, 7, 30, 90); sin esto, todo lo retenido. */
  days?: number | null;
  /** Paginación: corridas creadas antes de esta fecha. */
  before?: string | null;
  limit?: number;
}

export interface GlobalRunDto extends FlowRunDto {
  flowName: string;
  durationMs: number | null;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereFor(workspaceId: string, viewer: FlowRunViewer, f: RunSearch, now: Date): { sql: string; args: unknown[] } {
  const parts = ['r.user_id = ?'];
  const args: unknown[] = [workspaceId];
  if (f.status === 'held') parts.push("r.status = 'queued' AND r.held = 1");
  else if (f.status === 'queued') parts.push("r.status = 'queued' AND r.held = 0");
  else if (f.status) {
    parts.push('r.status = ?');
    args.push(f.status);
  }
  if (f.flowId) {
    parts.push('r.flow_id = ?');
    args.push(f.flowId);
  }
  if (f.days && (RUN_RANGES as readonly number[]).includes(f.days)) {
    parts.push('r.created_at >= ?');
    args.push(new Date(now.getTime() - f.days * 86_400_000).toISOString());
  }
  if (f.before) {
    parts.push('r.created_at < ?');
    args.push(f.before);
  }
  const q = (f.q ?? '').trim().slice(0, 200);
  if (q) {
    const like = `%${likeEscape(q)}%`;
    // Metadatos (cualquiera los ve) o datos de las corridas capturadas por quien busca.
    parts.push(`(
      r.id LIKE ? ESCAPE '\\' OR r.error LIKE ? ESCAPE '\\' OR fl.name LIKE ? ESCAPE '\\'
      OR (r.captured_by = ? AND (
        r.input LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM flow_steps s WHERE s.run_id = r.id AND (s.output LIKE ? ESCAPE '\\' OR s.input LIKE ? ESCAPE '\\'))
      ))
    )`);
    args.push(`${likeEscape(q)}%`, like, like, viewer.personId, like, like, like);
  }
  return { sql: parts.join(' AND '), args };
}

function toGlobal(row: FlowRunRow & { flow_name: string }, viewer: FlowRunViewer): GlobalRunDto {
  const dto = toRunDto(row);
  const started = row.started_at ? Date.parse(row.started_at) : NaN;
  const finished = row.finished_at ? Date.parse(row.finished_at) : NaN;
  const base: GlobalRunDto = {
    ...dto,
    flowName: row.flow_name,
    durationMs: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null,
  };
  return canSeeRunData(viewer, row) ? base : { ...base, input: {}, dataHidden: true };
}

export async function searchRuns(
  workspaceId: string,
  viewer: FlowRunViewer,
  f: RunSearch,
  now = new Date(),
): Promise<{ runs: GlobalRunDto[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const w = whereFor(workspaceId, viewer, f, now);
  const rows = (await getDb()
    .prepare(
      `SELECT r.*, fl.name AS flow_name FROM flow_runs r JOIN flow_flows fl ON fl.id = r.flow_id
       WHERE ${w.sql} ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(...(w.args as never[]), limit + 1)) as Array<FlowRunRow & { flow_name: string }>;
  const page = rows.slice(0, limit);
  return {
    runs: page.map((r) => toGlobal(r, viewer)),
    nextBefore: rows.length > limit ? page[page.length - 1].created_at : null,
  };
}

export interface FlowStats {
  days: number;
  total: number;
  byStatus: Record<string, number>;
  /** Corridas terminadas con éxito sobre las terminadas (0..1); null sin terminadas. */
  successRate: number | null;
  steps: number;
  avgDurationMs: number | null;
  perDay: Array<{ day: string; success: number; failed: number; other: number }>;
  perFlow: Array<{ flowId: string; name: string; runs: number; failed: number; steps: number; lastFailedAt: string | null }>;
  topErrors: Array<{ error: string; count: number }>;
  /** Cola ahora mismo (sin rango de fechas). */
  queue: { queued: number; held: number; running: number; waiting: number };
}

/** Tablero de uso: corridas, pasos y fallas del rango, por día y por flow, y la cola actual. */
export async function flowStats(workspaceId: string, days = 7, now = new Date()): Promise<FlowStats> {
  const d = (RUN_RANGES as readonly number[]).includes(days) ? days : 7;
  const since = new Date(now.getTime() - d * 86_400_000).toISOString();
  const db = getDb();
  const status = (await db
    .prepare('SELECT status, COUNT(*) AS n, SUM(step_count) AS steps FROM flow_runs WHERE user_id = ? AND created_at >= ? GROUP BY status')
    .all(workspaceId, since)) as Array<{ status: string; n: number; steps: number | null }>;
  const byStatus: Record<string, number> = {};
  let total = 0;
  let steps = 0;
  for (const s of status) {
    byStatus[s.status] = Number(s.n);
    total += Number(s.n);
    steps += Number(s.steps ?? 0);
  }
  const done = (byStatus.success ?? 0) + (byStatus.failed ?? 0);
  const dur = (await db
    .prepare(
      `SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS ms FROM flow_runs
       WHERE user_id = ? AND created_at >= ? AND finished_at IS NOT NULL AND started_at IS NOT NULL`,
    )
    .get(workspaceId, since)) as { ms: number | null };
  const perDayRows = (await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status NOT IN ('success', 'failed') THEN 1 ELSE 0 END) AS other
       FROM flow_runs WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day`,
    )
    .all(workspaceId, since)) as Array<{ day: string; success: number; failed: number; other: number }>;
  const byDay = new Map(perDayRows.map((r) => [r.day, r]));
  const perDay: FlowStats['perDay'] = [];
  for (let i = d - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    perDay.push({ day, success: Number(r?.success ?? 0), failed: Number(r?.failed ?? 0), other: Number(r?.other ?? 0) });
  }
  const perFlow = (await db
    .prepare(
      `SELECT r.flow_id, f.name, COUNT(*) AS runs, SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(r.step_count) AS steps, MAX(CASE WHEN r.status = 'failed' THEN r.created_at END) AS last_failed
       FROM flow_runs r JOIN flow_flows f ON f.id = r.flow_id
       WHERE r.user_id = ? AND r.created_at >= ? GROUP BY r.flow_id ORDER BY runs DESC LIMIT 20`,
    )
    .all(workspaceId, since)) as Array<{ flow_id: string; name: string; runs: number; failed: number; steps: number | null; last_failed: string | null }>;
  const errors = (await db
    .prepare(
      `SELECT error, COUNT(*) AS n FROM flow_runs WHERE user_id = ? AND created_at >= ? AND status = 'failed' AND error IS NOT NULL
       GROUP BY error ORDER BY n DESC LIMIT 5`,
    )
    .all(workspaceId, since)) as Array<{ error: string; n: number }>;
  const queue = (await db
    .prepare(
      `SELECT SUM(CASE WHEN status = 'queued' AND held = 0 THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN status = 'queued' AND held = 1 THEN 1 ELSE 0 END) AS held,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting
       FROM flow_runs WHERE user_id = ? AND status IN ('queued', 'running', 'waiting')`,
    )
    .get(workspaceId)) as Record<string, number | null>;
  return {
    days: d,
    total,
    byStatus,
    successRate: done ? (byStatus.success ?? 0) / done : null,
    steps,
    avgDurationMs: dur.ms === null || dur.ms === undefined ? null : Math.round(Number(dur.ms)),
    perDay,
    perFlow: perFlow.map((p) => ({
      flowId: p.flow_id,
      name: p.name,
      runs: Number(p.runs),
      failed: Number(p.failed),
      steps: Number(p.steps ?? 0),
      lastFailedAt: p.last_failed,
    })),
    topErrors: errors.map((e) => ({ error: e.error, count: Number(e.n) })),
    queue: {
      queued: Number(queue.queued ?? 0),
      held: Number(queue.held ?? 0),
      running: Number(queue.running ?? 0),
      waiting: Number(queue.waiting ?? 0),
    },
  };
}

/** Tope de corridas por exportación. */
export const EXPORT_LIMIT = 5_000;

/**
 * Exporta el historial filtrado. CSV: metadatos de cada corrida. JSON: lo
 * mismo más la entrada del disparador, solo en las corridas que quien exporta
 * capturó (las demás salen sin datos, como en la app).
 */
export async function exportRuns(
  workspaceId: string,
  viewer: FlowRunViewer,
  f: RunSearch,
  format: 'csv' | 'json',
  now = new Date(),
): Promise<string> {
  const w = whereFor(workspaceId, viewer, f, now);
  const rows = (await getDb()
    .prepare(
      `SELECT r.*, fl.name AS flow_name FROM flow_runs r JOIN flow_flows fl ON fl.id = r.flow_id
       WHERE ${w.sql} ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(...(w.args as never[]), EXPORT_LIMIT)) as Array<FlowRunRow & { flow_name: string }>;
  const runs = rows.map((r) => toGlobal(r, viewer));
  if (format === 'json') {
    return JSON.stringify(
      runs.map((r) => ({
        id: r.id,
        flowId: r.flowId,
        flow: r.flowName,
        status: r.held ? 'held' : r.status,
        trigger: r.triggerType,
        error: r.error,
        steps: r.stepCount,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs,
        input: r.dataHidden ? null : r.input,
        dataHidden: Boolean(r.dataHidden),
      })),
      null,
      2,
    );
  }
  return toCsv(
    ['run_id', 'flow', 'status', 'trigger', 'error', 'steps', 'created_at', 'started_at', 'finished_at', 'duration_ms'],
    runs.map((r) => [
      r.id,
      r.flowName,
      r.held ? 'held' : r.status,
      r.triggerType,
      r.error,
      r.stepCount,
      r.createdAt,
      r.startedAt,
      r.finishedAt,
      r.durationMs,
    ]),
  );
}

/** Filtros desde la query string (?status=&flow=&q=&days=&before=). */
export function runSearchFromParams(p: URLSearchParams): RunSearch {
  const status = p.get('status');
  const days = Number(p.get('days'));
  return {
    status: (RUN_FILTER_STATUSES as readonly string[]).includes(status ?? '') ? (status as RunFilterStatus) : null,
    flowId: p.get('flow') || null,
    q: p.get('q') || null,
    days: Number.isFinite(days) && days > 0 ? days : null,
    before: p.get('before') || null,
    limit: Number(p.get('limit')) || undefined,
  };
}

