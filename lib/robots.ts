/**
 * Robots — datos (robots, corridas, uso) y orquestación de una corrida:
 * cuota mensual, rate limit, una corrida a la vez por workspace (las demás
 * esperan en cola: status 'queued', drainRobotQueue), ejecución
 * en el backend (lib/robots-runner.ts), capturas y eventos. También los
 * lotes de la API v1 (un robot sobre muchas entradas, todas en cola) y la
 * detección de cambios contra la corrida anterior (robot.output.changed).
 * Server-only.
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
import { recordRobotOutcome } from './robots-alerts';
import { diffRobotOutputs } from './robots-diff';
import {
  DEFAULT_PAUSE_AFTER,
  DEFAULT_TIMEOUT_SEC,
  MAX_BULK_INPUTS,
  MAX_PAUSE_AFTER,
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
import type { RobotFailure, RobotFile, RobotLogEntry, RobotScreenshot } from './robots-interpreter';

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
  /** Email al dueño cuando falla una corrida automática. */
  failureAlerts: boolean;
  /** Fallas seguidas que pausan el schedule (0 = nunca). */
  pauseAfter: number;
  consecutiveFailures: number;
  /** Cuándo se pausó solo por fallas seguidas (null si no está pausado por eso). */
  pausedAt: string | null;
  /** Días que se guardan las corridas (0 = default del servidor). */
  retentionDays: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RobotListItem extends RobotDto {
  lastRun: { id: string; status: RobotRunStatus; warnings: number; createdAt: string } | null;
  runs7d: number;
}

export interface RobotShot {
  name: string;
  /** URL pública (Blob) o data URL (sin Blob, si entra en el tope). */
  url: string | null;
  omitted?: boolean;
}

/** RobotFailure ya guardada: la captura pasa a URL (lib/uploads.ts) o data URL chica. */
export interface RobotRunFailure extends Omit<RobotFailure, 'screenshot'> {
  screenshot: string | null;
}

export interface RobotRunDto {
  id: string;
  robotId: string;
  status: RobotRunStatus;
  trigger: RobotRunTrigger;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  /** Pasos o elementos de loop que fallaron con "seguir si falla": la corrida terminó con advertencias. */
  warnings: number;
  failure: RobotRunFailure | null;
  logs: RobotLogEntry[];
  screenshots: RobotShot[];
  backend: string | null;
  /** Lote de la API v1 al que pertenece (null si es una corrida suelta). */
  batchId: string | null;
  /** La salida cambió contra la corrida exitosa anterior (null: no se comparó). */
  changed: boolean | null;
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
  /** Días que se guardan las corridas por defecto (los robots pueden elegir otro). */
  runRetentionDays: number;
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
    failureAlerts: row.failure_alerts !== 0,
    pauseAfter: Math.min(Math.max(Number(row.pause_after ?? DEFAULT_PAUSE_AFTER), 0), MAX_PAUSE_AFTER),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    pausedAt: row.paused_at ?? null,
    retentionDays: Number(row.retention_days ?? 0),
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
    warnings: Number(row.warnings ?? 0),
    failure: parseJson<RobotRunFailure | null>(row.failure, null),
    logs: parseJson(row.logs, []),
    screenshots: parseJson(row.screenshots, []),
    backend: row.backend,
    batchId: row.batch_id ?? null,
    changed: row.changed === null || row.changed === undefined ? null : row.changed === 1,
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
      `SELECT b.id AS robot_id, r.id, r.status, r.warnings, r.created_at FROM robots b
       JOIN robot_runs r ON r.id = (SELECT id FROM robot_runs WHERE robot_id = b.id ORDER BY created_at DESC LIMIT 1)
       WHERE b.user_id = ?`,
    )
    .all(workspaceId)) as Array<{ robot_id: string; id: string; status: RobotRunStatus; warnings: number | null; created_at: string }>;
  const counts = (await db
    .prepare('SELECT robot_id, COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND created_at >= ? GROUP BY robot_id')
    .all(workspaceId, since)) as Array<{ robot_id: string; n: number }>;
  const lastBy = new Map(lasts.map((l) => [l.robot_id, l]));
  const countBy = new Map(counts.map((c) => [c.robot_id, Number(c.n) || 0]));
  return rows.map((row) => {
    const last = lastBy.get(row.id);
    return {
      ...toRobotDto(row),
      lastRun: last ? { id: last.id, status: last.status, warnings: Number(last.warnings ?? 0), createdAt: last.created_at } : null,
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
    failureAlerts?: boolean;
    pauseAfter?: number;
    retentionDays?: number;
    /** Idioma de los emails de aviso (el de quien guarda). */
    locale?: string;
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
  // Volver a prender las corridas automáticas limpia la pausa por fallas.
  const resumed = enabled && row.enabled !== 1;
  const locale = patch.locale === 'es' || patch.locale === 'pt' || patch.locale === 'en' ? patch.locale : row.alert_locale || 'en';
  await getDb()
    .prepare(
      `UPDATE robots SET name = ?, description = ?, steps = ?, inputs = ?, enabled = ?, schedule = ?, next_run_at = ?,
         timeout_sec = ?, persist_session = ?, failure_alerts = ?, pause_after = ?, retention_days = ?, alert_locale = ?,
         consecutive_failures = ?, paused_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
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
      (patch.failureAlerts ?? row.failure_alerts !== 0) ? 1 : 0,
      Math.min(Math.max(patch.pauseAfter ?? Number(row.pause_after ?? DEFAULT_PAUSE_AFTER), 0), MAX_PAUSE_AFTER),
      patch.retentionDays ?? Number(row.retention_days ?? 0),
      locale,
      resumed ? 0 : Number(row.consecutive_failures ?? 0),
      resumed ? null : row.paused_at,
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
    runRetentionDays: defaultRetentionDays(),
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

/**
 * Captura de la falla: la imagen va a lib/uploads.ts (Blob o disco local); si
 * no hay dónde guardarla, data URL solo si es chica. DOM y URL sin secretos.
 */
async function storeFailure(f: RobotFailure | undefined, secrets: readonly string[]): Promise<RobotRunFailure | null> {
  if (!f || typeof f !== 'object') return null;
  let screenshot: string | null = null;
  if (typeof f.screenshot === 'string' && f.screenshot) {
    try {
      const { saveUpload } = await import('./uploads');
      screenshot = await saveUpload('robots', 'failure.jpg', 'image/jpeg', Buffer.from(f.screenshot, 'base64'));
    } catch {
      if (f.screenshot.length <= INLINE_SHOT_LIMIT) screenshot = `data:image/jpeg;base64,${f.screenshot}`;
    }
  }
  const text = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const out: RobotRunFailure = {
    step: text(f.step, 40),
    type: text(f.type, 40),
    error: text(f.error, 300),
    url: text(f.url, 2000),
    ...(typeof f.title === 'string' && f.title ? { title: text(f.title, 200) } : {}),
    ...(typeof f.matched === 'boolean' ? { matched: f.matched } : {}),
    ...(typeof f.dom === 'string' && f.dom ? { dom: text(f.dom, 4000) } : {}),
    screenshot,
  };
  return secrets.length ? redact(out, [...secrets]) : out;
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
  await recordRobotOutcome(robot.user_id, robot.id, { id: run.id, trigger: run.trigger, status: 'failed', error });
  return true;
}

/** Cancela una corrida que sigue en cola (queda fallida con error "cancelled"). Una corrida en curso no se puede cortar. */
export async function cancelQueuedRobotRun(
  workspaceId: string,
  runId: string,
): Promise<{ ok: true; run: RobotRunDto } | { ok: false; error: 'not_found' | 'not_queued' }> {
  const row = (await getDb()
    .prepare(
      `SELECT r.id, r.trigger, r.robot_id, b.name AS robot_name, r.user_id FROM robot_runs r
       JOIN robots b ON b.id = r.robot_id WHERE r.id = ? AND r.user_id = ?`,
    )
    .get(runId, workspaceId)) as { id: string; trigger: RobotRunTrigger; robot_id: string; robot_name: string; user_id: string } | undefined;
  if (!row) return { ok: false, error: 'not_found' };
  const done = await failRun({ id: row.robot_id, name: row.robot_name, user_id: row.user_id }, row, 'cancelled', 'queued');
  if (!done) return { ok: false, error: 'not_queued' };
  return { ok: true, run: (await getRobotRun(workspaceId, runId))! };
}

/** Edad máxima en cola de una corrida de un lote (BATCH_QUEUE_MAX_AGE_H, 24 h): un lote largo corre de a una. */
export function batchQueueMaxAgeMs(): number {
  return envInt('ROBOTS_BATCH_QUEUE_MAX_AGE_H', 24) * 3_600_000;
}

/** Corridas en cola más viejas que queueMaxAgeMs() (o batchQueueMaxAgeMs() si son de un lote): fallidas con queue_expired. */
export async function expireQueuedRobotRuns(workspaceId?: string, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - queueMaxAgeMs()).toISOString();
  const batchCutoff = new Date(now - batchQueueMaxAgeMs()).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT r.id, r.trigger, r.user_id, b.id AS robot_id, b.name AS robot_name FROM robot_runs r JOIN robots b ON b.id = r.robot_id
       WHERE r.status = 'queued' AND r.created_at < (CASE WHEN r.batch_id IS NULL THEN ? ELSE ? END)${workspaceId ? ' AND r.user_id = ?' : ''} LIMIT 200`,
    )
    .all(...(workspaceId ? [cutoff, batchCutoff, workspaceId] : [cutoff, batchCutoff]))) as Array<{
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
 * - con `defer` (API v1 sin wait): siempre queda en cola y la arranca
 *   drainRobotQueue en segundo plano; la respuesta no espera al navegador.
 * manual corre aunque el robot esté deshabilitado; flow / schedule / api /
 * agent, no. `timeoutCapMs` acota el tiempo de la corrida (Agents: la
 * respuesta del agente tiene su propio tope).
 */
export async function startRobotRun(
  workspaceId: string,
  robotId: string,
  values: Record<string, unknown> | undefined,
  opts: {
    trigger: RobotRunTrigger;
    actorId?: string | null;
    waitMs?: number;
    pollMs?: number;
    defer?: boolean;
    timeoutCapMs?: number;
  },
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

  const quotaTimeout = await effectiveTimeoutMs(workspaceId, robot);
  if (quotaTimeout === null) return { ok: false, error: 'quota_exceeded' };
  const timeoutMs = opts.timeoutCapMs ? Math.max(10_000, Math.min(quotaTimeout, opts.timeoutCapMs)) : quotaTimeout;
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
  if (opts.defer) {
    kickRobotQueue(workspaceId);
    return { ok: true, run: (await getRobotRun(workspaceId, id))!, queued: true };
  }
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
  const failure = status === 'failed' ? await storeFailure(result.failure, creds.secrets) : null;
  const warnings = Math.max(0, Math.floor(Number(result.warnings) || 0));
  const change = status === 'success' ? await compareWithPrevious(workspaceId, robot.id, id, output) : null;
  await getDb()
    .prepare(
      `UPDATE robot_runs SET status = ?, output = ?, error = ?, logs = ?, screenshots = ?, warnings = ?, failure = ?,
         changed = ?, locked_until = NULL, finished_at = ?, duration_ms = ? WHERE id = ?`,
    )
    .run(
      status,
      output,
      status === 'failed' ? (result.error ?? 'failed').slice(0, 500) : null,
      JSON.stringify((result.logs ?? []).slice(0, 600)),
      JSON.stringify(shots),
      warnings,
      failure ? JSON.stringify(failure) : null,
      change ? (change.diff.changed ? 1 : 0) : null,
      nowIso(),
      duration,
      id,
    );
  await meter(workspaceId, duration);
  const run = (await getRobotRun(workspaceId, id))!;
  await emitEvent(workspaceId, status === 'success' ? 'robot.run.finished' : 'robot.run.failed', {
    robot: { id: robot.id, name: robot.name },
    run: { id: run.id, status: run.status, trigger: run.trigger, durationMs: run.durationMs, error: run.error, warnings: run.warnings },
    output: run.output,
  });
  if (change?.diff.changed) {
    await emitEvent(workspaceId, 'robot.output.changed', {
      robot: { id: robot.id, name: robot.name },
      run: { id: run.id, status: run.status, trigger: run.trigger, durationMs: run.durationMs, warnings: run.warnings },
      previousRunId: change.previousRunId,
      diff: change.diff.changes,
      output: run.output,
    });
  }
  await recordRobotOutcome(workspaceId, robot.id, { id: run.id, trigger: run.trigger, status, error: run.error });
  kickRobotQueue(workspaceId);
  return run;
}

/**
 * Compara la salida con la de la corrida exitosa anterior del robot (con las
 * mismas entradas: en un lote, cada entrada se compara con su propia
 * historia). null si no hay con qué comparar o alguna salida quedó recortada.
 */
async function compareWithPrevious(
  workspaceId: string,
  robotId: string,
  runId: string,
  output: string,
): Promise<{ previousRunId: string; diff: ReturnType<typeof diffRobotOutputs> } | null> {
  const db = getDb();
  const current = (await db.prepare('SELECT input FROM robot_runs WHERE id = ?').get(runId)) as { input: string } | undefined;
  const prev = (await db
    .prepare(
      `SELECT id, output FROM robot_runs WHERE robot_id = ? AND user_id = ? AND status = 'success' AND id != ? AND input = ?
       ORDER BY finished_at DESC, rowid DESC LIMIT 1`,
    )
    .get(robotId, workspaceId, runId, current?.input ?? '{}')) as { id: string; output: string } | undefined;
  if (!prev) return null;
  const before = parseJson<Record<string, unknown>>(prev.output, {});
  const after = parseJson<Record<string, unknown>>(output, {});
  if (before.truncated === true || after.truncated === true) return null;
  return { previousRunId: prev.id, diff: diffRobotOutputs(before, after) };
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
  await recordRobotOutcome(row.user_id, row.id, { id, trigger: 'schedule', status: 'failed', error });
}

// ---------- Lotes (API v1) ----------

/** Corridas en cola que acepta un workspace contando las de lotes (ROBOTS_MAX_BULK_QUEUED, 200). */
export function maxBulkQueued(): number {
  return envInt('ROBOTS_MAX_BULK_QUEUED', 200);
}

/** Lotes por workspace y hora (ROBOTS_BULK_PER_HOUR, 10). */
export function bulkPerHour(): number {
  return envInt('ROBOTS_BULK_PER_HOUR', 10);
}

export type BatchErrorCode = RunErrorCode | 'too_many_inputs';

export type EnqueueBatchResult =
  | { ok: true; batchId: string; runs: RobotRunDto[] }
  | { ok: false; error: BatchErrorCode; name?: string; index?: number };

/**
 * Un robot sobre muchas entradas: valida todas, deja una corrida en cola por
 * entrada (mismo batch_id, en orden) y arranca la cola en segundo plano. Las
 * corridas corren de a una por workspace como cualquier otra; la cuota de
 * minutos se mira al arrancar cada una.
 */
export async function enqueueRobotBatch(
  workspaceId: string,
  robotId: string,
  inputs: Array<Record<string, unknown>>,
  opts: { actorId?: string | null } = {},
): Promise<EnqueueBatchResult> {
  if (inputs.length === 0 || inputs.length > MAX_BULK_INPUTS) return { ok: false, error: 'too_many_inputs' };
  const row = await getRobotRow(workspaceId, robotId);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.enabled !== 1) return { ok: false, error: 'disabled' };
  const robot = toRobotDto(row);
  if (robot.steps.length === 0) return { ok: false, error: 'no_steps' };
  if (!getRobotBackend()) return { ok: false, error: 'runner_unavailable' };
  const resolved: Array<Record<string, unknown>> = [];
  for (let i = 0; i < inputs.length; i++) {
    const r = resolveInputs(robot.inputs, inputs[i]);
    if (!r.ok) return { ok: false, error: 'missing_input', name: r.name, index: i };
    resolved.push(r.inputs);
  }
  const creds = await resolveRobotCredentials(workspaceId, robot.steps);
  if (!creds.ok) return { ok: false, error: 'missing_credential', name: creds.name };
  if ((await effectiveTimeoutMs(workspaceId, robot)) === null) return { ok: false, error: 'quota_exceeded' };
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`robot-bulk:${workspaceId}`, bulkPerHour(), 3600);
    if (!rl.ok) return { ok: false, error: 'rate_limited' };
  }
  await expireQueuedRobotRuns(workspaceId);
  const db = getDb();
  const depth = (await db
    .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'queued'")
    .get(workspaceId)) as { n: number };
  if (Number(depth.n) + resolved.length > maxBulkQueued()) return { ok: false, error: 'busy' };
  const batchId = crypto.randomUUID();
  const ids: string[] = [];
  // Mismo instante para todas: el orden FIFO lo da el rowid (en orden de entrada).
  const ts = nowIso();
  for (const values of resolved) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db
      .prepare(
        `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, created_by, batch_id, created_at)
         VALUES (?, ?, ?, 'queued', 'api', ?, ?, ?, ?)`,
      )
      .run(id, robot.id, workspaceId, JSON.stringify(values).slice(0, 100_000), opts.actorId ?? null, batchId, ts);
  }
  kickRobotQueue(workspaceId);
  const runs = (await db
    .prepare(`SELECT * FROM robot_runs WHERE batch_id = ? AND user_id = ? ORDER BY created_at, rowid`)
    .all(batchId, workspaceId)) as RobotRunRow[];
  return { ok: true, batchId, runs: runs.map(toRunDto) };
}

export interface RobotBatchDto {
  id: string;
  robotId: string;
  total: number;
  counts: Record<RobotRunStatus, number>;
  /** Todas terminaron (éxito o falla). */
  done: boolean;
  runs: RobotRunDto[];
}

export async function getRobotBatch(workspaceId: string, batchId: string): Promise<RobotBatchDto | null> {
  const rows = (await getDb()
    .prepare('SELECT * FROM robot_runs WHERE batch_id = ? AND user_id = ? ORDER BY created_at, rowid')
    .all(batchId, workspaceId)) as RobotRunRow[];
  if (!rows.length) return null;
  const counts: Record<RobotRunStatus, number> = { queued: 0, running: 0, success: 0, failed: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    id: batchId,
    robotId: rows[0].robot_id,
    total: rows.length,
    counts,
    done: counts.queued === 0 && counts.running === 0,
    runs: rows.map(toRunDto),
  };
}

// ---------- Retención ----------

/** Días que se guardan las corridas por defecto (ROBOTS_RUN_RETENTION_DAYS, 90). */
export function defaultRetentionDays(): number {
  return envInt('ROBOTS_RUN_RETENTION_DAYS', 90);
}

/** URLs guardadas con saveUpload que cuelgan de una corrida (capturas, falla, archivos). */
export function runUploadUrls(row: Pick<RobotRunRow, 'screenshots' | 'failure' | 'output'>): string[] {
  const urls: string[] = [];
  const add = (u: unknown) => {
    if (typeof u === 'string' && (u.startsWith('/uploads/robots/') || /^https:\/\/[^/]+\/robots\//.test(u))) urls.push(u);
  };
  for (const s of parseJson<Array<{ url?: unknown }>>(row.screenshots, [])) add(s?.url);
  add(parseJson<{ screenshot?: unknown } | null>(row.failure, null)?.screenshot);
  const output = parseJson<Record<string, unknown>>(row.output, {});
  for (const v of Object.values(output ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) add((v as { url?: unknown }).url);
  }
  return urls;
}

/**
 * Borra las corridas terminadas más viejas que la retención de su robot
 * (retention_days, o el default del servidor) y sus archivos. Las corridas en
 * cola o corriendo no se tocan. De a `batch` por llamada (lo llama el cron).
 */
export async function pruneRobotRuns(now = Date.now(), batch = 500): Promise<number> {
  const db = getDb();
  const fallback = defaultRetentionDays();
  const rows = (await db
    .prepare(
      `SELECT r.id, r.screenshots, r.failure, r.output FROM robot_runs r JOIN robots b ON b.id = r.robot_id
       WHERE r.status IN ('success', 'failed')
         AND r.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || (CASE WHEN b.retention_days > 0 THEN b.retention_days ELSE ? END) || ' days')
       ORDER BY r.created_at LIMIT ?`,
    )
    .all(new Date(now).toISOString(), fallback, batch)) as Array<Pick<RobotRunRow, 'id' | 'screenshots' | 'failure' | 'output'>>;
  if (!rows.length) return 0;
  const urls = rows.flatMap(runUploadUrls);
  if (urls.length) {
    const { deleteUploads } = await import('./uploads');
    await deleteUploads(urls);
  }
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id);
    const res = await db.prepare(`DELETE FROM robot_runs WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    n += res.changes;
  }
  return n;
}
