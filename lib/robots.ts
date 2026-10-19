/**
 * Robots — datos (robots, corridas, uso) y orquestación de una corrida:
 * cuota mensual, rate limit, una corrida a la vez por workspace (las demás
 * esperan en cola: status 'queued', drainRobotQueue), ejecución
 * en el backend (lib/robots-runner.ts), capturas y eventos. Server-only.
 *
 * user_id = workspace (dueño); created_by = persona real.
 */
import { after } from 'next/server';
import { getDb, type RobotRow, type RobotRunRow, type RobotRunStatus, type RobotRunTrigger } from './db';
import { emitEvent } from './events';
import { computeNextRun, sameJson } from './flow';
import { referencedCredentialNames, resolveCredential, secretValues } from './flow-credentials';
import { redact } from './flow-credentials-schema';
import { rateLimit } from './rate-limit';
import { getRobotBackend, robotBackendName, type RobotBackendName } from './robots-runner';
import { open, seal } from './secret-box';
import {
  DEFAULT_TIMEOUT_SEC,
  MAX_TIMEOUT_SEC,
  MIN_SCHEDULE_MINUTES,
  ROBOT_TEMPLATES,
  resolveInputs,
  validateInputDefs,
  validateSteps,
  type RobotErrorCode,
  type RobotInputDef,
  type RobotSchedule,
  type RobotStep,
} from './robots-schema';
import type { RobotFile, RobotLogEntry, RobotScreenshot } from './robots-interpreter';

export interface RobotDto {
  id: string;
  name: string;
  description: string;
  steps: RobotStep[];
  inputs: RobotInputDef[];
  enabled: boolean;
  schedule: RobotSchedule;
  nextRunAt: string | null;
  timeoutSec: number;
  persistSession: boolean;
  /** Hay una sesión guardada (cookies/localStorage) para la próxima corrida. */
  hasSession: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RobotListItem extends RobotDto {
  lastRun: { id: string; status: RobotRunStatus; createdAt: string } | null;
  runs7d: number;
}

export interface RobotShot {
  name: string;
  /** URL pública (Blob) o data URL (sin Blob, si entra en el tope). */
  url: string | null;
  omitted?: boolean;
}

export interface RobotRunDto {
  id: string;
  robotId: string;
  status: RobotRunStatus;
  trigger: RobotRunTrigger;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  logs: RobotLogEntry[];
  screenshots: RobotShot[];
  backend: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface RobotUsage {
  month: string;
  runs: number;
  minutesUsed: number;
  /** null = sin cuota. */
  minutesLimit: number | null;
  runsPerHour: number;
  backend: RobotBackendName;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toRobotDto(row: RobotRow, hasSession = false): RobotDto {
  const steps = validateSteps(parseJson<unknown>(row.steps, []));
  const inputs = validateInputDefs(parseJson<unknown>(row.inputs, []));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: steps.ok ? steps.steps : [],
    inputs: inputs.ok ? inputs.inputs : [],
    enabled: row.enabled === 1,
    schedule: parseJson<RobotSchedule>(row.schedule, null),
    nextRunAt: row.next_run_at,
    timeoutSec: Math.min(row.timeout_sec, MAX_TIMEOUT_SEC),
    persistSession: row.persist_session === 1,
    hasSession,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRunDto(row: RobotRunRow): RobotRunDto {
  return {
    id: row.id,
    robotId: row.robot_id,
    status: row.status,
    trigger: row.trigger,
    input: parseJson(row.input, {}),
    output: parseJson(row.output, {}),
    error: row.error,
    logs: parseJson(row.logs, []),
    screenshots: parseJson(row.screenshots, []),
    backend: row.backend,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  };
}

// ---------- Límites (env) ----------

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Minutos gratis por workspace y mes. null = sin cuota ("unlimited"). */
export function freeMinutesPerMonth(): number | null {
  if ((process.env.ROBOTS_FREE_MINUTES_PER_MONTH ?? '').trim().toLowerCase() === 'unlimited') return null;
  return envInt('ROBOTS_FREE_MINUTES_PER_MONTH', 120);
}

export function runsPerHour(): number {
  return envInt('ROBOTS_RUNS_PER_HOUR', 30);
}

export function currentMonth(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

// ---------- Robots ----------

export async function getRobotRow(workspaceId: string, id: string): Promise<RobotRow | null> {
  return ((await getDb().prepare('SELECT * FROM robots WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | RobotRow
    | undefined) ?? null;
}

export async function getRobot(workspaceId: string, id: string): Promise<RobotDto | null> {
  const row = await getRobotRow(workspaceId, id);
  if (!row) return null;
  const session = await getDb().prepare('SELECT 1 AS x FROM robot_sessions WHERE robot_id = ? AND user_id = ?').get(id, workspaceId);
  return toRobotDto(row, !!session);
}

// ---------- Sesiones guardadas ----------

/** Tope de la sesión guardada (cookies + localStorage) en bytes de JSON. */
const SESSION_LIMIT = 1_000_000;

async function loadSession(workspaceId: string, robotId: string): Promise<unknown> {
  const row = (await getDb()
    .prepare('SELECT data FROM robot_sessions WHERE robot_id = ? AND user_id = ?')
    .get(robotId, workspaceId)) as { data: string } | undefined;
  if (!row) return undefined;
  const plain = open(row.data);
  return plain ? (parseJson<unknown>(plain, undefined) ?? undefined) : undefined;
}

async function saveSession(workspaceId: string, robotId: string, state: unknown): Promise<void> {
  const json = JSON.stringify(state ?? null);
  if (!state || json.length > SESSION_LIMIT) return;
  await getDb()
    .prepare(
      `INSERT INTO robot_sessions (robot_id, user_id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (robot_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(robotId, workspaceId, seal(json), nowIso());
}

/** "Borrar sesión": la próxima corrida arranca sin cookies ni localStorage. */
export async function clearRobotSession(workspaceId: string, robotId: string): Promise<boolean> {
  if (!(await getRobotRow(workspaceId, robotId))) return false;
  await getDb().prepare('DELETE FROM robot_sessions WHERE robot_id = ? AND user_id = ?').run(robotId, workspaceId);
  return true;
}

export async function listRobots(workspaceId: string): Promise<RobotListItem[]> {
  const db = getDb();
  const rows = (await db
    .prepare('SELECT * FROM robots WHERE user_id = ? ORDER BY updated_at DESC')
    .all(workspaceId)) as RobotRow[];
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  // Última corrida y conteo de 7 días de todos los robots en dos queries (sin N+1).
  const lasts = (await db
    .prepare(
      `SELECT b.id AS robot_id, r.id, r.status, r.created_at FROM robots b
       JOIN robot_runs r ON r.id = (SELECT id FROM robot_runs WHERE robot_id = b.id ORDER BY created_at DESC LIMIT 1)
       WHERE b.user_id = ?`,
    )
    .all(workspaceId)) as Array<{ robot_id: string; id: string; status: RobotRunStatus; created_at: string }>;
  const counts = (await db
    .prepare('SELECT robot_id, COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND created_at >= ? GROUP BY robot_id')
    .all(workspaceId, since)) as Array<{ robot_id: string; n: number }>;
  const lastBy = new Map(lasts.map((l) => [l.robot_id, l]));
  const countBy = new Map(counts.map((c) => [c.robot_id, Number(c.n) || 0]));
  return rows.map((row) => {
    const last = lastBy.get(row.id);
    return {
      ...toRobotDto(row),
      lastRun: last ? { id: last.id, status: last.status, createdAt: last.created_at } : null,
      runs7d: countBy.get(row.id) ?? 0,
    };
  });
}

export type RobotWriteResult =
  | { ok: true; robot: RobotDto }
  | { ok: false; error: RobotErrorCode | 'not_found' | 'unknown_template'; index?: number };

function nextRun(schedule: RobotSchedule, enabled: boolean, from = new Date()): string | null {
  if (!schedule || !enabled) return null;
  return computeNextRun(schedule as unknown as Record<string, unknown>, from, MIN_SCHEDULE_MINUTES).toISOString();
}

export async function createRobot(
  workspaceId: string,
  actorId: string,
  input: { name: string; description?: string; template?: string },
): Promise<RobotWriteResult> {
  let steps: RobotStep[] = [{ type: 'goto', url: 'https://example.com' }];
  let inputs: RobotInputDef[] = [];
  let schedule: RobotSchedule = null;
  if (input.template) {
    const tpl = ROBOT_TEMPLATES.find((t) => t.key === input.template);
    if (!tpl) return { ok: false, error: 'unknown_template' };
    steps = JSON.parse(JSON.stringify(tpl.steps)) as RobotStep[];
    inputs = JSON.parse(JSON.stringify(tpl.inputs)) as RobotInputDef[];
    schedule = tpl.schedule;
  }
  const id = crypto.randomUUID();
  const ts = nowIso();
  // Los robots nuevos arrancan habilitados pero el schedule de una plantilla
  // queda apagado hasta que alguien lo active (enabled = 0 si tiene schedule).
  const enabled = schedule ? 0 : 1;
  await getDb()
    .prepare(
      `INSERT INTO robots (id, user_id, name, description, steps, inputs, enabled, schedule, next_run_at, timeout_sec,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      input.name.trim(),
      input.description ?? '',
      JSON.stringify(steps),
      JSON.stringify(inputs),
      enabled,
      schedule ? JSON.stringify(schedule) : null,
      DEFAULT_TIMEOUT_SEC,
      actorId,
      ts,
      ts,
    );
  return { ok: true, robot: (await getRobot(workspaceId, id))! };
}

export async function updateRobot(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    description?: string;
    steps?: unknown;
    inputs?: unknown;
    enabled?: boolean;
    schedule?: RobotSchedule;
    timeoutSec?: number;
    persistSession?: boolean;
  },
): Promise<RobotWriteResult> {
  const row = await getRobotRow(workspaceId, id);
  if (!row) return { ok: false, error: 'not_found' };
  let steps = row.steps;
  if (patch.steps !== undefined) {
    const v = validateSteps(patch.steps);
    if (!v.ok) return v;
    steps = JSON.stringify(v.steps);
  }
  let inputs = row.inputs;
  if (patch.inputs !== undefined) {
    const v = validateInputDefs(patch.inputs);
    if (!v.ok) return v;
    inputs = JSON.stringify(v.inputs);
  }
  const enabled = patch.enabled ?? row.enabled === 1;
  const schedule = patch.schedule !== undefined ? patch.schedule : parseJson<RobotSchedule>(row.schedule, null);
  // El editor manda el schedule en cada guardado: solo se recalcula la próxima
  // corrida si cambió (si no, un intervalo se posterga con cada guardado).
  const scheduleChanged =
    (patch.schedule !== undefined && !sameJson(patch.schedule, parseJson<RobotSchedule>(row.schedule, null))) ||
    (patch.enabled !== undefined && patch.enabled !== (row.enabled === 1)) ||
    (enabled && !!schedule && !row.next_run_at);
  const next = scheduleChanged ? nextRun(schedule, enabled) : row.next_run_at;
  const timeout = Math.min(Math.max(patch.timeoutSec ?? row.timeout_sec, 10), MAX_TIMEOUT_SEC);
  await getDb()
    .prepare(
      `UPDATE robots SET name = ?, description = ?, steps = ?, inputs = ?, enabled = ?, schedule = ?, next_run_at = ?,
         timeout_sec = ?, persist_session = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(
      patch.name?.trim() || row.name,
      patch.description ?? row.description,
      steps,
      inputs,
      enabled ? 1 : 0,
      schedule ? JSON.stringify(schedule) : null,
      next,
      timeout,
      (patch.persistSession ?? row.persist_session === 1) ? 1 : 0,
      nowIso(),
      id,
      workspaceId,
    );
  // Apagar "guardar sesión" borra la sesión guardada.
  if (patch.persistSession === false) await clearRobotSession(workspaceId, id);
  return { ok: true, robot: (await getRobot(workspaceId, id))! };
}

export async function deleteRobot(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM robots WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

// ---------- Corridas ----------

export async function listRobotRuns(workspaceId: string, robotId: string, limit = 30): Promise<RobotRunDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM robot_runs WHERE robot_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(robotId, workspaceId, Math.min(Math.max(limit, 1), 100))) as RobotRunRow[];
  return rows.map(toRunDto);
}

export async function getRobotRun(workspaceId: string, runId: string): Promise<RobotRunDto | null> {
  const row = (await getDb().prepare('SELECT * FROM robot_runs WHERE id = ? AND user_id = ?').get(runId, workspaceId)) as
    | RobotRunRow
    | undefined;
  return row ? toRunDto(row) : null;
}

export async function getUsage(workspaceId: string): Promise<RobotUsage> {
  const month = currentMonth();
  const row = (await getDb()
    .prepare('SELECT runs, ms FROM robot_usage WHERE user_id = ? AND month = ?')
    .get(workspaceId, month)) as { runs: number; ms: number } | undefined;
  return {
    month,
    runs: Number(row?.runs ?? 0),
    minutesUsed: Math.round((Number(row?.ms ?? 0) / 60_000) * 10) / 10,
    minutesLimit: freeMinutesPerMonth(),
    runsPerHour: runsPerHour(),
    backend: robotBackendName(),
  };
}

async function usedMs(workspaceId: string): Promise<number> {
  const row = (await getDb()
    .prepare('SELECT ms FROM robot_usage WHERE user_id = ? AND month = ?')
    .get(workspaceId, currentMonth())) as { ms: number } | undefined;
  return Number(row?.ms ?? 0);
}

async function meter(workspaceId: string, ms: number): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, 1, ?)
       ON CONFLICT (user_id, month) DO UPDATE SET runs = runs + 1, ms = ms + excluded.ms`,
    )
    .run(workspaceId, currentMonth(), Math.max(0, Math.round(ms)));
}

/** Corridas colgadas (proceso caído a mitad): se marcan como fallidas. */
export async function failStaleRobotRuns(workspaceId?: string): Promise<number> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE robot_runs SET status = 'failed', error = 'worker_timeout', finished_at = ?, locked_until = NULL
       WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < ?${workspaceId ? ' AND user_id = ?' : ''}`,
    )
    .run(...(workspaceId ? [ts, ts, workspaceId] : [ts, ts]));
  return res.changes;
}

/** Sin Blob: data URL solo si es chica (no inflar la base). */
const INLINE_SHOT_LIMIT = 200_000;

async function storeScreenshots(shots: RobotScreenshot[]): Promise<RobotShot[]> {
  const out: RobotShot[] = [];
  for (const s of shots.slice(0, 5)) {
    if (!s.data) continue;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { saveUpload } = await import('./uploads');
        const url = await saveUpload('robots', `${s.name}.jpg`, 'image/jpeg', Buffer.from(s.data, 'base64'));
        out.push({ name: s.name, url });
        continue;
      } catch {
        // cae al inline
      }
    }
    if (s.data.length <= INLINE_SHOT_LIMIT) out.push({ name: s.name, url: `data:image/jpeg;base64,${s.data}` });
    else out.push({ name: s.name, url: null, omitted: true });
  }
  return out;
}

export type RunErrorCode =
  | 'not_found'
  | 'disabled'
  | 'runner_unavailable'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'busy'
  | 'missing_input'
  | 'missing_credential'
  | 'no_steps';

/**
 * Credenciales usadas en los pasos ({{credentials.<name>.campo}}), en claro
 * para esta corrida, y sus valores secretos (para redactar logs y salidas).
 */
export async function resolveRobotCredentials(
  workspaceId: string,
  steps: readonly RobotStep[],
): Promise<
  | { ok: true; credentials: Record<string, Record<string, string>>; secrets: string[] }
  | { ok: false; name: string }
> {
  const credentials: Record<string, Record<string, string>> = {};
  const secrets: string[] = [];
  for (const name of referencedCredentialNames(JSON.stringify(steps))) {
    const cred = await resolveCredential(workspaceId, name);
    if (!cred || cred.name !== name) return { ok: false, name };
    credentials[name] = cred.data;
    secrets.push(...secretValues(cred.type, cred.data));
  }
  return { ok: true, credentials, secrets };
}

/** Sube los archivos (download / pdf) a Blob y deja la URL en la variable. */
async function storeFiles(files: RobotFile[], vars: Record<string, unknown>): Promise<void> {
  const { saveUpload } = await import('./uploads');
  for (const f of files.slice(0, 5)) {
    try {
      const url = await saveUpload('robots', f.filename, f.contentType, Buffer.from(f.data, 'base64'));
      vars[f.name] = { url, filename: f.filename, size: f.size, contentType: f.contentType };
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? String((err as { code: string }).code) : 'storage_unavailable';
      vars[f.name] = { url: null, filename: f.filename, size: f.size, error: code };
    }
  }
}

export type StartRunResult =
  | { ok: true; run: RobotRunDto; queued?: boolean }
  | { ok: false; error: RunErrorCode; name?: string };

export type { RobotFile };

/** Corridas en cola por workspace (más que esto: 'busy'). */
export function maxQueuedRuns(): number {
  return envInt('ROBOTS_MAX_QUEUED', 20);
}

/** Edad máxima de una corrida en cola: pasada, se marca fallida (queue_expired). */
export function queueMaxAgeMs(): number {
  return envInt('ROBOTS_QUEUE_MAX_AGE_MIN', 60) * 60_000;
}

/** Timeout efectivo de la corrida (acotado a lo que queda de la cuota). null = sin cuota. */
async function effectiveTimeoutMs(workspaceId: string, robot: RobotDto): Promise<number | null> {
  const limitMin = freeMinutesPerMonth();
  const timeoutMs = Math.min(Math.max(robot.timeoutSec, 10), MAX_TIMEOUT_SEC) * 1000;
  if (limitMin === null) return timeoutMs;
  const left = limitMin * 60_000 - (await usedMs(workspaceId));
  if (left <= 0) return null;
  // Una corrida no puede pasarse de lo que queda de la cuota (mínimo 10 s).
  return Math.max(10_000, Math.min(timeoutMs, left));
}

/**
 * Pasa una corrida de 'queued' a 'running' si no hay otra viva en el
 * workspace y es la más vieja de la cola (FIFO). Compare-and-set: de dos que
 * intentan a la vez, gana una.
 */
async function claimQueuedRun(workspaceId: string, runId: string, timeoutMs: number, backend: string): Promise<boolean> {
  const ts = nowIso();
  const lock = new Date(Date.now() + timeoutMs + 3 * 60_000).toISOString();
  const res = await getDb()
    .prepare(
      `UPDATE robot_runs SET status = 'running', started_at = ?, locked_until = ?, backend = ?
       WHERE id = ? AND status = 'queued'
         AND NOT EXISTS (SELECT 1 FROM robot_runs WHERE user_id = ? AND status = 'running')
         AND id = (SELECT id FROM robot_runs WHERE user_id = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT 1)`,
    )
    .run(ts, lock, backend, runId, workspaceId, workspaceId);
  return res.changes === 1;
}

/** Cierra una corrida (en cola o recién reclamada) como fallida y avisa a Flow. */
async function failRun(
  robot: Pick<RobotRow, 'id' | 'name' | 'user_id'>,
  run: Pick<RobotRunRow, 'id' | 'trigger'>,
  error: string,
  fromStatus: RobotRunStatus,
): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE robot_runs SET status = 'failed', error = ?, locked_until = NULL, started_at = COALESCE(started_at, ?),
         finished_at = ?, duration_ms = 0 WHERE id = ? AND status = ?`,
    )
    .run(error, ts, ts, run.id, fromStatus);
  if (res.changes !== 1) return false;
  await emitEvent(robot.user_id, 'robot.run.failed', {
    robot: { id: robot.id, name: robot.name },
    run: { id: run.id, status: 'failed', trigger: run.trigger, durationMs: 0, error },
    output: {},
  });
  return true;
}

/** Corridas en cola más viejas que queueMaxAgeMs(): fallidas con queue_expired. */
export async function expireQueuedRobotRuns(workspaceId?: string, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - queueMaxAgeMs()).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT r.id, r.trigger, r.user_id, b.id AS robot_id, b.name AS robot_name FROM robot_runs r JOIN robots b ON b.id = r.robot_id
       WHERE r.status = 'queued' AND r.created_at < ?${workspaceId ? ' AND r.user_id = ?' : ''} LIMIT 200`,
    )
    .all(...(workspaceId ? [cutoff, workspaceId] : [cutoff]))) as Array<{
    id: string;
    trigger: RobotRunTrigger;
    user_id: string;
    robot_id: string;
    robot_name: string;
  }>;
  let n = 0;
  for (const r of rows) {
    if (await failRun({ id: r.robot_id, name: r.robot_name, user_id: r.user_id }, r, 'queue_expired', 'queued')) n++;
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Corre un robot. Si el workspace ya tiene una corrida viva (una a la vez),
 * la corrida queda en cola ('queued') en vez de fallar:
 * - sin `waitMs` (manual, schedule): devuelve la corrida en cola; arranca
 *   cuando termina la actual (drainRobotQueue, también desde el cron).
 * - con `waitMs` (Flow): espera su turno hasta ese tiempo y devuelve el
 *   resultado; si no le tocó, sale de la cola y devuelve 'busy'.
 * manual corre aunque el robot esté deshabilitado; flow / schedule, no.
 */
export async function startRobotRun(
  workspaceId: string,
  robotId: string,
  values: Record<string, unknown> | undefined,
  opts: { trigger: RobotRunTrigger; actorId?: string | null; waitMs?: number; pollMs?: number },
): Promise<StartRunResult> {
  const row = await getRobotRow(workspaceId, robotId);
  if (!row) return { ok: false, error: 'not_found' };
  if (opts.trigger !== 'manual' && row.enabled !== 1) return { ok: false, error: 'disabled' };
  const robot = toRobotDto(row);
  if (robot.steps.length === 0) return { ok: false, error: 'no_steps' };
  const backend = getRobotBackend();
  if (!backend) return { ok: false, error: 'runner_unavailable' };
  const resolved = resolveInputs(robot.inputs, values);
  if (!resolved.ok) return { ok: false, error: 'missing_input', name: resolved.name };
  const creds = await resolveRobotCredentials(workspaceId, robot.steps);
  if (!creds.ok) return { ok: false, error: 'missing_credential', name: creds.name };

  const timeoutMs = await effectiveTimeoutMs(workspaceId, robot);
  if (timeoutMs === null) return { ok: false, error: 'quota_exceeded' };
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`robot-runs:${workspaceId}`, runsPerHour(), 3600);
    if (!rl.ok) return { ok: false, error: 'rate_limited' };
  }

  await failStaleRobotRuns(workspaceId);
  await expireQueuedRobotRuns(workspaceId);
  const db = getDb();
  const depth = (await db
    .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'queued'")
    .get(workspaceId)) as { n: number };
  if (Number(depth.n) >= maxQueuedRuns()) return { ok: false, error: 'busy' };

  // Entra a la cola y, si no hay otra viva ni otra antes, arranca ya.
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, created_by, created_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .run(id, robot.id, workspaceId, opts.trigger, JSON.stringify(resolved.inputs).slice(0, 100_000), opts.actorId ?? null, nowIso());
  if (await claimQueuedRun(workspaceId, id, timeoutMs, backend.name)) {
    return { ok: true, run: await executeClaimedRun(row, id, resolved.inputs, creds, timeoutMs, backend) };
  }

  const waitMs = Math.max(0, opts.waitMs ?? 0);
  if (!waitMs) return { ok: true, run: (await getRobotRun(workspaceId, id))!, queued: true };

  // Flow: espera su turno. Si otro proceso (cron, fin de otra corrida) la
  // reclama, espera a que termine.
  const pollMs = Math.max(10, opts.pollMs ?? 2000);
  const deadline = Date.now() + waitMs;
  for (;;) {
    await sleep(pollMs);
    const current = (await db.prepare('SELECT * FROM robot_runs WHERE id = ?').get(id)) as RobotRunRow | undefined;
    if (!current) return { ok: false, error: 'not_found' };
    if (current.status === 'success' || current.status === 'failed') return { ok: true, run: toRunDto(current) };
    if (current.status === 'queued') {
      if (await claimQueuedRun(workspaceId, id, timeoutMs, backend.name)) {
        return { ok: true, run: await executeClaimedRun(row, id, resolved.inputs, creds, timeoutMs, backend) };
      }
      if (Date.now() >= deadline) {
        // Sale de la cola: el nodo reintenta (o falla) como busy.
        const res = await db.prepare("DELETE FROM robot_runs WHERE id = ? AND status = 'queued'").run(id);
        if (res.changes === 1) return { ok: false, error: 'busy' };
      }
    } else if (Date.now() >= deadline + timeoutMs + 3 * 60_000) {
      // La reclamó otro proceso y no terminó: failStaleRobotRuns la cerrará.
      return { ok: false, error: 'busy' };
    }
  }
}

/** Ejecuta una corrida ya reclamada ('running') y guarda el resultado. */
async function executeClaimedRun(
  row: RobotRow,
  id: string,
  inputs: Record<string, unknown>,
  creds: { credentials: Record<string, Record<string, string>>; secrets: string[] },
  timeoutMs: number,
  backend: NonNullable<ReturnType<typeof getRobotBackend>>,
): Promise<RobotRunDto> {
  const workspaceId = row.user_id;
  const robot = toRobotDto(row);
  const t0 = Date.now();
  const persist = row.persist_session === 1;
  let result: Awaited<ReturnType<typeof backend.run>>;
  try {
    result = await backend.run({
      robotName: robot.name,
      steps: robot.steps,
      inputs,
      timeoutMs,
      credentials: creds.credentials,
      storageState: persist ? await loadSession(workspaceId, robot.id) : undefined,
      saveSession: persist,
    });
  } catch (err) {
    result = {
      status: 'failed' as const,
      error: `runner_error: ${err instanceof Error ? err.message.slice(0, 200) : 'error'}`,
      vars: {},
      logs: [],
      screenshots: [],
      pages: 0,
    };
  }
  const duration = Date.now() - t0;
  if (persist && result.storageState) await saveSession(workspaceId, robot.id, result.storageState).catch(() => {});
  const vars: Record<string, unknown> = { ...(result.vars ?? {}) };
  if (Array.isArray(result.files) && result.files.length) await storeFiles(result.files, vars);
  // Credenciales: nunca quedan en logs, variables, errores ni nombres de capturas.
  if (creds.secrets.length) {
    result = {
      ...result,
      error: result.error ? redact(result.error, creds.secrets) : result.error,
      logs: redact(result.logs ?? [], creds.secrets),
      screenshots: (result.screenshots ?? []).map((s) => ({ ...s, name: redact(s.name, creds.secrets) })),
    };
    Object.assign(vars, redact(vars, creds.secrets));
  }
  const shots = await storeScreenshots(Array.isArray(result.screenshots) ? result.screenshots : []);
  let output = JSON.stringify(vars);
  if (output.length > 200_000) output = JSON.stringify({ truncated: true, preview: output.slice(0, 2000) });
  const status: RobotRunStatus = result.status === 'success' ? 'success' : 'failed';
  await getDb()
    .prepare(
      `UPDATE robot_runs SET status = ?, output = ?, error = ?, logs = ?, screenshots = ?, locked_until = NULL,
         finished_at = ?, duration_ms = ? WHERE id = ?`,
    )
    .run(
      status,
      output,
      status === 'failed' ? (result.error ?? 'failed').slice(0, 500) : null,
      JSON.stringify((result.logs ?? []).slice(0, 600)),
      JSON.stringify(shots),
      nowIso(),
      duration,
      id,
    );
  await meter(workspaceId, duration);
  const run = (await getRobotRun(workspaceId, id))!;
  await emitEvent(workspaceId, status === 'success' ? 'robot.run.finished' : 'robot.run.failed', {
    robot: { id: robot.id, name: robot.name },
    run: { id: run.id, status: run.status, trigger: run.trigger, durationMs: run.durationMs, error: run.error },
    output: run.output,
  });
  kickRobotQueue(workspaceId);
  return run;
}

/**
 * Al terminar una corrida, arranca la siguiente de la cola del workspace en
 * segundo plano (after). Si la función se corta, la levanta el cron.
 */
function kickRobotQueue(workspaceId: string): void {
  if (process.env.ROBOTS_QUEUE_KICK === 'false' || process.env.VITEST) return;
  const job = async () => {
    await drainRobotQueue({ workspaceId, budgetMs: 240_000 });
  };
  try {
    after(job);
  } catch {
    void job().catch(() => {});
  }
}

/** Arranca una corrida de la cola (si le toca): chequeos de nuevo y ejecución. */
async function startQueuedRun(run: RobotRunRow): Promise<boolean> {
  const row = await getRobotRow(run.user_id, run.robot_id);
  if (!row) return false;
  const backend = getRobotBackend();
  if (!backend) return false;
  if (run.trigger !== 'manual' && row.enabled !== 1) return failRun(row, run, 'disabled', 'queued');
  const robot = toRobotDto(row);
  const timeoutMs = await effectiveTimeoutMs(run.user_id, robot);
  if (timeoutMs === null) return failRun(row, run, 'quota_exceeded', 'queued');
  if (!(await claimQueuedRun(run.user_id, run.id, timeoutMs, backend.name))) return false;
  const creds = await resolveRobotCredentials(run.user_id, robot.steps);
  if (!creds.ok) {
    await failRun(row, run, 'missing_credential', 'running');
    return true;
  }
  await executeClaimedRun(row, run.id, parseJson<Record<string, unknown>>(run.input, {}), creds, timeoutMs, backend);
  return true;
}

/**
 * Vacía la cola: por cada workspace sin corrida viva arranca la más vieja en
 * cola, en paralelo (hasta `concurrency` workspaces) y en pasadas sucesivas
 * mientras quede tiempo. Devuelve las corridas arrancadas.
 */
export async function drainRobotQueue(
  opts: { workspaceId?: string; budgetMs?: number; concurrency?: number } = {},
): Promise<number> {
  if (!getRobotBackend()) return 0;
  const budgetMs = opts.budgetMs ?? 240_000;
  const concurrency = opts.concurrency ?? cronConcurrency();
  const ws = opts.workspaceId;
  await failStaleRobotRuns(ws);
  await expireQueuedRobotRuns(ws);
  const t0 = Date.now();
  let ran = 0;
  for (let pass = 0; pass < 50; pass++) {
    const rows = (await getDb()
      .prepare(
        `SELECT r.* FROM robot_runs r
         WHERE r.status = 'queued'${ws ? ' AND r.user_id = ?' : ''}
           AND NOT EXISTS (SELECT 1 FROM robot_runs x WHERE x.user_id = r.user_id AND x.status = 'running')
         ORDER BY r.created_at, r.rowid LIMIT 500`,
      )
      .all(...(ws ? [ws] : []))) as RobotRunRow[];
    const batch: RobotRunRow[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (batch.length >= concurrency) break;
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      batch.push(r);
    }
    if (!batch.length) break;
    const results = await Promise.all(batch.map((r) => startQueuedRun(r).catch(() => false)));
    const started = results.filter(Boolean).length;
    ran += started;
    if (!started || Date.now() - t0 + MAX_TIMEOUT_SEC * 1000 > budgetMs) break;
  }
  return ran;
}

/** Robots programados que corren a la vez en una pasada del cron (uno por workspace). */
function cronConcurrency(): number {
  const env = Number(process.env.ROBOTS_CRON_CONCURRENCY);
  if (Number.isFinite(env) && env >= 1) return Math.min(Math.floor(env), 50);
  // Local: cada corrida es un Chromium en este servidor. Sandbox: microVMs remotas.
  return robotBackendName() === 'local' ? 2 : 10;
}

/**
 * Schedules vencidos (cron): avanza next_run_at con compare-and-set y corre
 * los robots en paralelo, de a uno por workspace (un workspace corre un robot
 * a la vez) y hasta `cronConcurrency()` workspaces juntos, en pasadas
 * sucesivas mientras quede tiempo. Después de la primera pasada (que siempre
 * corre), solo arranca corridas cuyo timeout entra en `budgetMs`; lo
 * que no entra queda para la próxima invocación (/api/cron/robots, cada pocos
 * minutos). Devuelve las corridas arrancadas.
 */
export async function runDueRobots(now: Date = new Date(), limit = 100, budgetMs = 240_000): Promise<number> {
  await failStaleRobotRuns();
  // Sin tiempo suficiente en este tick: quedan para el próximo.
  if (budgetMs < 60_000) return 0;
  const concurrency = cronConcurrency();
  const t0 = Date.now();
  // Primero la cola (corridas que esperaban turno), después los schedules.
  let ran = await drainRobotQueue({ budgetMs, concurrency });
  if (budgetMs - (Date.now() - t0) < 60_000) return ran;
  let attempted = 0;
  while (attempted < limit) {
    const rows = (await getDb()
      .prepare(
        `SELECT * FROM robots WHERE enabled = 1 AND schedule IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at LIMIT ?`,
      )
      .all(now.toISOString(), Math.max(concurrency * 20, 100))) as RobotRow[];
    // Uno por workspace por pasada (el resto del workspace va en la siguiente).
    const batch: RobotRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (batch.length >= Math.min(concurrency, limit - attempted)) break;
      if (seen.has(row.user_id)) continue;
      // La primera pasada siempre corre (arrancan juntas); las siguientes, si el timeout entra.
      if (attempted > 0 && Date.now() - t0 + Math.min(row.timeout_sec, MAX_TIMEOUT_SEC) * 1000 > budgetMs) continue;
      seen.add(row.user_id);
      batch.push(row);
    }
    if (!batch.length) break;
    const results = await Promise.all(
      batch.map(async (row) => {
        const schedule = parseJson<RobotSchedule>(row.schedule, null);
        const next = nextRun(schedule, true, now);
        const res = await getDb()
          .prepare('UPDATE robots SET next_run_at = ? WHERE id = ? AND next_run_at = ?')
          .run(next, row.id, row.next_run_at);
        if (res.changes !== 1) return false;
        const r = await startRobotRun(row.user_id, row.id, undefined, { trigger: 'schedule' });
        if (!r.ok && r.error !== 'not_found' && r.error !== 'disabled') await recordSkippedRun(row, r.error);
        return r.ok;
      }),
    );
    attempted += batch.length;
    ran += results.filter(Boolean).length;
  }
  // Los schedules que chocaron con otra corrida del workspace quedaron en cola.
  const left = budgetMs - (Date.now() - t0);
  if (left >= 60_000) ran += await drainRobotQueue({ budgetMs: left, concurrency });
  return ran;
}

/**
 * Una corrida programada que no pudo arrancar (cola llena, sin cuota, rate limit,
 * credencial faltante…) queda en el historial como fallida con el código y
 * emite robot.run.failed: no se pierde en silencio.
 */
async function recordSkippedRun(row: RobotRow, error: RunErrorCode): Promise<void> {
  const id = crypto.randomUUID();
  const ts = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, error, created_at, started_at, finished_at, duration_ms)
       VALUES (?, ?, ?, 'failed', 'schedule', ?, ?, ?, ?, 0)`,
    )
    .run(id, row.id, row.user_id, error, ts, ts, ts);
  await emitEvent(row.user_id, 'robot.run.failed', {
    robot: { id: row.id, name: row.name },
    run: { id, status: 'failed', trigger: 'schedule', durationMs: 0, error },
    output: {},
  });
}
