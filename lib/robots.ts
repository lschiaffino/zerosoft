/**
 * Robots — datos (robots, corridas, uso) y orquestación de una corrida:
 * cuota mensual, rate limit, una corrida a la vez por workspace, ejecución
 * en el backend (lib/robots-runner.ts), capturas y eventos. Server-only.
 *
 * user_id = workspace (dueño); created_by = persona real.
 */
import { getDb, type RobotRow, type RobotRunRow, type RobotRunStatus, type RobotRunTrigger } from './db';
import { emitEvent } from './events';
import { computeNextRun } from './flow';
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
    timeoutSec: row.timeout_sec,
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
  const out: RobotListItem[] = [];
  for (const row of rows) {
    const last = (await db
      .prepare('SELECT id, status, created_at FROM robot_runs WHERE robot_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(row.id)) as { id: string; status: RobotRunStatus; created_at: string } | undefined;
    const count = (await db
      .prepare('SELECT COUNT(*) AS n FROM robot_runs WHERE robot_id = ? AND created_at >= ?')
      .get(row.id, since)) as { n: number };
    out.push({
      ...toRobotDto(row),
      lastRun: last ? { id: last.id, status: last.status, createdAt: last.created_at } : null,
      runs7d: Number(count.n) || 0,
    });
  }
  return out;
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
  const scheduleChanged = patch.schedule !== undefined || (patch.enabled !== undefined && patch.enabled !== (row.enabled === 1));
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

export type StartRunResult = { ok: true; run: RobotRunDto } | { ok: false; error: RunErrorCode; name?: string };

export type { RobotFile };

/**
 * Corre un robot ahora y espera el resultado (≤ timeout del robot).
 * - manual: lo pide un admin desde la app (corre aunque esté deshabilitado).
 * - flow / schedule: solo si el robot está habilitado.
 */
export async function startRobotRun(
  workspaceId: string,
  robotId: string,
  values: Record<string, unknown> | undefined,
  opts: { trigger: RobotRunTrigger; actorId?: string | null },
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

  const limitMin = freeMinutesPerMonth();
  let timeoutMs = Math.min(Math.max(robot.timeoutSec, 10), MAX_TIMEOUT_SEC) * 1000;
  if (limitMin !== null) {
    const left = limitMin * 60_000 - (await usedMs(workspaceId));
    if (left <= 0) return { ok: false, error: 'quota_exceeded' };
    // Una corrida no puede pasarse de lo que queda de la cuota (mínimo 10 s).
    timeoutMs = Math.max(10_000, Math.min(timeoutMs, left));
  }
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`robot-runs:${workspaceId}`, runsPerHour(), 3600);
    if (!rl.ok) return { ok: false, error: 'rate_limited' };
  }

  // Una corrida a la vez por workspace: se inserta solo si no hay otra viva.
  await failStaleRobotRuns(workspaceId);
  const id = crypto.randomUUID();
  const started = nowIso();
  const lock = new Date(Date.now() + timeoutMs + 3 * 60_000).toISOString();
  const claim = await getDb()
    .prepare(
      `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, backend, created_by, locked_until, created_at, started_at)
       SELECT ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM robot_runs WHERE user_id = ? AND status = 'running')`,
    )
    .run(
      id,
      robot.id,
      workspaceId,
      opts.trigger,
      JSON.stringify(resolved.inputs).slice(0, 100_000),
      backend.name,
      opts.actorId ?? null,
      lock,
      started,
      started,
      workspaceId,
    );
  if (claim.changes !== 1) return { ok: false, error: 'busy' };

  const t0 = Date.now();
  const persist = row.persist_session === 1;
  let result: Awaited<ReturnType<typeof backend.run>>;
  try {
    result = await backend.run({
      robotName: robot.name,
      steps: robot.steps,
      inputs: resolved.inputs,
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
  return { ok: true, run };
}

/**
 * Schedules vencidos (cron): avanza next_run_at con compare-and-set y corre
 * cada robot. Con presupuesto de tiempo: solo arranca una corrida si su
 * timeout entra en lo que queda de `budgetMs` (el resto queda para el
 * próximo tick; la primera siempre corre).
 */
export async function runDueRobots(now: Date = new Date(), limit = 5, budgetMs = 240_000): Promise<number> {
  await failStaleRobotRuns();
  // Sin tiempo suficiente en este tick: quedan para el próximo.
  if (budgetMs < 60_000) return 0;
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM robots WHERE enabled = 1 AND schedule IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at LIMIT ?`,
    )
    .all(now.toISOString(), limit)) as RobotRow[];
  const t0 = Date.now();
  let ran = 0;
  let attempted = 0;
  for (const row of rows) {
    if (attempted > 0 && Date.now() - t0 + row.timeout_sec * 1000 > budgetMs) break;
    const schedule = parseJson<RobotSchedule>(row.schedule, null);
    const next = nextRun(schedule, true, now);
    const res = await getDb()
      .prepare('UPDATE robots SET next_run_at = ? WHERE id = ? AND next_run_at = ?')
      .run(next, row.id, row.next_run_at);
    if (res.changes !== 1) continue;
    attempted += 1;
    const r = await startRobotRun(row.user_id, row.id, undefined, { trigger: 'schedule' });
    if (r.ok) ran += 1;
  }
  return ran;
}
