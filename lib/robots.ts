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
import { expandedSecrets, referencedCredentialNames, resolveCredential, secretValues } from './flow-credentials';
import { redact } from './flow-credentials-schema';
import { rateLimit } from './rate-limit';
import { getRobotBackend, robotBackendName, type RobotBackendName } from './robots-runner';
import { open, seal } from './secret-box';
import { recordRobotOutcome } from './robots-alerts';
import { PASSWORD_PLACEHOLDER as RECORDER_PASSWORD_PLACEHOLDER } from './robots-recorder';
import { diffRobotOutputs, stableJson } from './robots-diff';
import { geoOptions } from './robots-geo';
import { mergeDataset, rowsOf, toRowObject, type DatasetMergeResult } from './robots-dataset';
import type { DestinationResult } from './robots-destinations';
import {
  CREDENTIAL_TEMPLATE,
  credentialMisuse,
  DEFAULT_PAUSE_AFTER,
  isSimpleSelector,
  MAX_BATCH_BYTES,
  MAX_AI_COLUMN_ROWS,
  datasetVariable,
  parseRobotSettings,
  robotExportSchema,
  robotSettingsSchema,
  type RobotSettings,
  DEFAULT_TIMEOUT_SEC,
  MAX_BATCH_INPUTS,
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
import type { RobotFailure, RobotFile, RobotHealed, RobotLogEntry, RobotScreenshot } from './robots-interpreter';

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
  /** Tabla acumulada, columnas con IA, email de cambios, envíos y país. */
  settings: RobotSettings;
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
  /** La corrida usó un login o una sesión guardada: sus datos son de quien armó el robot. */
  capturedBy: string | null;
  /** Quien mira no puede ver los datos (corrida con login de otra persona). */
  dataHidden?: boolean;
  /** IA, tabla acumulada, email de cambios, envíos y autorreparación de la corrida. */
  exports: RobotRunExports;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface RobotRunExports {
  /** Pasos que usaron un selector alternativo. */
  healed?: RobotHealed[];
  ai?: { errors: Array<{ variable: string; error: string }> };
  dataset?: Omit<DatasetMergeResult, 'fresh'>;
  email?: { sent: number };
  destinations?: DestinationResult[];
  geo?: { country: string; proxy: boolean };
}

/** Quién mira las corridas y la tabla (los datos capturados con un login no son para todo el workspace). */
export interface RobotViewer {
  /** Persona real. */
  personId: string;
  /** Owner o admin del workspace (puede correr el robot con ese login). */
  admin: boolean;
}

/**
 * ¿Puede ver los datos de la corrida? Las corridas sin login ni sesión
 * guardada traen datos públicos: todo el workspace. Las que usaron un login
 * (captured_by): quien armó el robot y los admins, que igual pueden correrlo
 * con ese login. Sin viewer (Flow, API, sistema): sí.
 */
export function canSeeRobotData(viewer: RobotViewer | undefined, run: { captured_by?: string | null }): boolean {
  if (!viewer || !run.captured_by) return true;
  return viewer.admin || run.captured_by === viewer.personId;
}

function redactRunDto(run: RobotRunDto): RobotRunDto {
  return {
    ...run,
    output: {},
    logs: run.logs.map((l) => ({ ...l, detail: undefined })),
    screenshots: [],
    failure: run.failure ? { step: run.failure.step, type: run.failure.type, error: run.failure.error, url: '', screenshot: null } : null,
    exports: { ...run.exports, healed: undefined },
    dataHidden: true,
  };
}

export interface RobotUsageByRobot {
  robotId: string;
  name: string;
  runs: number;
  minutes: number;
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
  /** Corridas y minutos del mes por robot (más usados primero). */
  byRobot: RobotUsageByRobot[];
  /** Hay un proveedor de proxies configurado (país con IP del país). */
  proxies: boolean;
  /** Tope diario de emails de cambios por robot. */
  changeEmailsPerDay: number;
  /** Corridas a la vez de este workspace. */
  concurrency: number;
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
    settings: parseRobotSettings(parseJson<unknown>(row.settings, {})),
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
    capturedBy: row.captured_by ?? null,
    exports: parseJson<RobotRunExports>(row.exports, {}),
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
  | { ok: true; robot: RobotDto; /** Destinatarios del email de cambios que no son del workspace (se descartaron). */ droppedRecipients?: string[] }
  | { ok: false; error: RobotErrorCode | 'not_found' | 'unknown_template' | 'invalid_settings' | 'invalid_import' | 'credential_misuse'; index?: number };

function nextRun(schedule: RobotSchedule, enabled: boolean, from = new Date()): string | null {
  if (!schedule || !enabled) return null;
  return computeNextRun(schedule as unknown as Record<string, unknown>, from, MIN_SCHEDULE_MINUTES).toISOString();
}

export async function createRobot(
  workspaceId: string,
  actorId: string,
  input: { name: string; description?: string; template?: string; steps?: unknown; inputs?: unknown; import?: unknown },
): Promise<RobotWriteResult> {
  let steps: RobotStep[] = [{ type: 'goto', url: 'https://example.com' }];
  let inputs: RobotInputDef[] = [];
  let schedule: RobotSchedule = null;
  let settings: RobotSettings = {};
  let timeoutSec = DEFAULT_TIMEOUT_SEC;
  let name = input.name.trim();
  let description = input.description ?? '';
  if (input.template) {
    const tpl = ROBOT_TEMPLATES.find((t) => t.key === input.template);
    if (!tpl) return { ok: false, error: 'unknown_template' };
    steps = JSON.parse(JSON.stringify(tpl.steps)) as RobotStep[];
    inputs = JSON.parse(JSON.stringify(tpl.inputs)) as RobotInputDef[];
    schedule = tpl.schedule;
    settings = tpl.settings ? (JSON.parse(JSON.stringify(tpl.settings)) as RobotSettings) : {};
  } else if (input.import !== undefined) {
    // Robot exportado: se valida todo como si se guardara desde el editor.
    const file = robotExportSchema.safeParse(input.import);
    if (!file.success) return { ok: false, error: 'invalid_import' };
    const v = validateSteps(file.data.steps);
    if (!v.ok) return v;
    const iv = validateInputDefs(file.data.inputs ?? []);
    if (!iv.ok) return iv;
    const st = robotSettingsSchema.safeParse(file.data.settings ?? {});
    if (!st.success) return { ok: false, error: 'invalid_settings' };
    steps = v.steps;
    inputs = iv.inputs;
    schedule = file.data.schedule ?? null;
    // Los envíos apuntan a credenciales de otro workspace: se importan apagados.
    // Los destinatarios del email de cambios pueden ser de otro workspace: se
    // vacían (el email, si queda prendido, va a quien importa el robot).
    settings = {
      ...st.data,
      destinations: (st.data.destinations ?? []).map((d) => ({ ...d, enabled: false })),
      ...(st.data.changeEmail ? { changeEmail: { enabled: st.data.changeEmail.enabled, to: [] } } : {}),
    };
    timeoutSec = Math.min(Math.max(file.data.timeoutSec ?? DEFAULT_TIMEOUT_SEC, 10), MAX_TIMEOUT_SEC);
    name = name || file.data.name;
    description = description || file.data.description;
  } else if (input.steps !== undefined) {
    const v = validateSteps(input.steps);
    if (!v.ok) return v;
    steps = v.steps;
    // Robot armado con IA: la tabla acumulada usa el link de cada fila como clave (si hay).
    const list = steps.find((s) => s.type === 'extract_list');
    const link = list?.type === 'extract_list' ? list.fields.find((f) => f.attribute === 'href') : undefined;
    if (list?.type === 'extract_list' && link) settings = { dataset: { enabled: true, variable: list.name, keyFields: [link.name] } };
    if (input.inputs !== undefined) {
      const iv = validateInputDefs(input.inputs);
      if (!iv.ok) return iv;
      inputs = iv.inputs;
    }
  }
  const misuse = credentialMisuse(steps);
  if (misuse !== null) return { ok: false, error: 'credential_misuse', index: misuse };
  const id = crypto.randomUUID();
  const ts = nowIso();
  // Los robots nuevos arrancan habilitados pero el schedule de una plantilla
  // queda apagado hasta que alguien lo active (enabled = 0 si tiene schedule).
  const enabled = schedule ? 0 : 1;
  await getDb()
    .prepare(
      `INSERT INTO robots (id, user_id, name, description, steps, inputs, enabled, schedule, next_run_at, timeout_sec,
         settings, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      name,
      description,
      JSON.stringify(steps),
      JSON.stringify(inputs),
      enabled,
      schedule ? JSON.stringify(schedule) : null,
      timeoutSec,
      JSON.stringify(settings),
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
    settings?: unknown;
    /** Idioma de los emails de aviso (el de quien guarda). */
    locale?: string;
  },
): Promise<RobotWriteResult> {
  const row = await getRobotRow(workspaceId, id);
  if (!row) return { ok: false, error: 'not_found' };
  let settings = row.settings ?? '{}';
  let droppedRecipients: string[] = [];
  if (patch.settings !== undefined) {
    const v = robotSettingsSchema.safeParse(patch.settings);
    if (!v.success) return { ok: false, error: 'invalid_settings' };
    // El email de cambios solo va a personas del workspace: las demás direcciones se descartan al guardar.
    const to = v.data.changeEmail?.to ?? [];
    if (to.length) {
      const { workspaceMemberEmails } = await import('./robots-alerts');
      const members = await workspaceMemberEmails(workspaceId);
      droppedRecipients = to.filter((a) => !members.has(a.toLowerCase()));
      if (droppedRecipients.length && v.data.changeEmail) v.data.changeEmail.to = to.filter((a) => members.has(a.toLowerCase()));
    }
    settings = JSON.stringify(v.data);
  }
  let steps = row.steps;
  if (patch.steps !== undefined) {
    const v = validateSteps(patch.steps);
    if (!v.ok) return v;
    const misuse = credentialMisuse(v.steps);
    if (misuse !== null) return { ok: false, error: 'credential_misuse', index: misuse };
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
         consecutive_failures = ?, paused_at = ?, settings = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
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
      settings,
      nowIso(),
      id,
      workspaceId,
    );
  // Apagar el autoaprendizaje borra lo que recordaba de las páginas.
  if (patch.settings !== undefined && parseRobotSettings(parseJson<unknown>(settings, {})).selfHeal !== true) {
    await getDb().prepare('DELETE FROM robot_selector_prints WHERE robot_id = ?').run(id);
  }
  // Apagar "guardar sesión" borra la sesión guardada.
  if (patch.persistSession === false) await clearRobotSession(workspaceId, id);
  return { ok: true, robot: (await getRobot(workspaceId, id))!, ...(droppedRecipients.length ? { droppedRecipients } : {}) };
}

export async function setRobotOwner(workspaceId: string, id: string, personId: string): Promise<void> {
  await getDb().prepare('UPDATE robots SET created_by = ? WHERE id = ? AND user_id = ?').run(personId, id, workspaceId);
}

export async function deleteRobot(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM robots WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

// ---------- Corridas ----------

export async function listRobotRuns(workspaceId: string, robotId: string, limit = 30, viewer?: RobotViewer): Promise<RobotRunDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM robot_runs WHERE robot_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(robotId, workspaceId, Math.min(Math.max(limit, 1), 100))) as RobotRunRow[];
  return rows.map((r) => (canSeeRobotData(viewer, r) ? toRunDto(r) : redactRunDto(toRunDto(r))));
}

export async function getRobotRun(workspaceId: string, runId: string, viewer?: RobotViewer): Promise<RobotRunDto | null> {
  const row = (await getDb().prepare('SELECT * FROM robot_runs WHERE id = ? AND user_id = ?').get(runId, workspaceId)) as
    | RobotRunRow
    | undefined;
  if (!row) return null;
  return canSeeRobotData(viewer, row) ? toRunDto(row) : redactRunDto(toRunDto(row));
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
    byRobot: await usageByRobot(workspaceId),
    proxies: !!(process.env.ROBOTS_PROXY_URL ?? '').trim(),
    changeEmailsPerDay: envInt('ROBOTS_CHANGE_EMAILS_PER_DAY', 24),
    concurrency: (await getRobotWorkspaceConfig(workspaceId)).concurrency,
  };
}

/** Corridas y minutos del mes por robot (de las corridas guardadas: las ya borradas por la retención no cuentan). */
export async function usageByRobot(workspaceId: string, now = new Date()): Promise<RobotUsageByRobot[]> {
  const since = `${currentMonth(now)}-01T00:00:00.000Z`;
  const rows = (await getDb()
    .prepare(
      `SELECT r.robot_id, b.name, COUNT(*) AS runs, COALESCE(SUM(r.duration_ms), 0) AS ms
       FROM robot_runs r JOIN robots b ON b.id = r.robot_id
       WHERE r.user_id = ? AND r.created_at >= ? AND r.status IN ('success', 'failed')
       GROUP BY r.robot_id, b.name ORDER BY ms DESC, runs DESC LIMIT 50`,
    )
    .all(workspaceId, since)) as Array<{ robot_id: string; name: string; runs: number; ms: number }>;
  return rows.map((r) => ({
    robotId: r.robot_id,
    name: r.name,
    runs: Number(r.runs) || 0,
    minutes: Math.round((Number(r.ms) / 60_000) * 10) / 10,
  }));
}

async function usedMs(workspaceId: string): Promise<number> {
  const row = (await getDb()
    .prepare('SELECT ms FROM robot_usage WHERE user_id = ? AND month = ?')
    .get(workspaceId, currentMonth())) as { ms: number } | undefined;
  return Number(row?.ms ?? 0);
}

/** Suma minutos (y una corrida, salvo las lecturas de página del constructor). */
async function meter(workspaceId: string, ms: number, countRun = true): Promise<void> {
  const runs = countRun ? 1 : 0;
  await getDb()
    .prepare(
      `INSERT INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, month) DO UPDATE SET runs = runs + excluded.runs, ms = ms + excluded.ms`,
    )
    .run(workspaceId, currentMonth(), runs, Math.max(0, Math.round(ms)));
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
  | 'no_steps'
  | 'admin_only_login';

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
  // Lo que queda de la cuota se reparte con las que ya corren: juntas no se pasan (mínimo 10 s cada una).
  const running = (await getDb()
    .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'running'")
    .get(workspaceId)) as { n: number };
  return Math.max(10_000, Math.min(timeoutMs, left / (Number(running.n) + 1)));
}

// ---------- Ajustes de Robots del workspace ----------

export interface RobotWorkspaceConfig {
  /** Corridas a la vez (1 = de a una, el default). */
  concurrency: number;
  /** Los members arman y corren robots sin login. */
  membersCanBuild: boolean;
}

/** Tope de corridas a la vez que puede elegir un workspace (ROBOTS_MAX_CONCURRENCY, 5). */
export function maxWorkspaceConcurrency(): number {
  return Math.min(envInt('ROBOTS_MAX_CONCURRENCY', 5), 50);
}

const configKey = (workspaceId: string) => `config:${workspaceId}`;

export async function getRobotWorkspaceConfig(workspaceId: string): Promise<RobotWorkspaceConfig> {
  const row = (await getDb().prepare('SELECT value FROM robot_runtime WHERE key = ?').get(configKey(workspaceId))) as { value: string } | undefined;
  const raw = parseJson<Partial<RobotWorkspaceConfig>>(row?.value, {});
  return {
    concurrency: Math.min(Math.max(Math.floor(Number(raw.concurrency) || 1), 1), maxWorkspaceConcurrency()),
    membersCanBuild: raw.membersCanBuild === true,
  };
}

export async function setRobotWorkspaceConfig(workspaceId: string, patch: Partial<RobotWorkspaceConfig>): Promise<RobotWorkspaceConfig> {
  const current = await getRobotWorkspaceConfig(workspaceId);
  const next: RobotWorkspaceConfig = {
    concurrency: Math.min(Math.max(Math.floor(patch.concurrency ?? current.concurrency), 1), maxWorkspaceConcurrency()),
    membersCanBuild: patch.membersCanBuild ?? current.membersCanBuild,
  };
  await getDb()
    .prepare(
      `INSERT INTO robot_runtime (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(configKey(workspaceId), JSON.stringify(next), nowIso());
  return next;
}

/**
 * Pasa una corrida de 'queued' a 'running' si queda cupo en el workspace y es
 * la primera de la cola: primero las sueltas y después las de lotes, así un
 * lote de miles no frena una corrida manual. Un robot con sesión guardada no
 * corre contra sí mismo (se pisarían las cookies). Compare-and-set: de dos que
 * intentan a la vez, gana una.
 */
async function claimQueuedRun(workspaceId: string, runId: string, timeoutMs: number, backend: string): Promise<boolean> {
  const ts = nowIso();
  const lock = new Date(Date.now() + timeoutMs + 3 * 60_000).toISOString();
  const { concurrency } = await getRobotWorkspaceConfig(workspaceId);
  const res = await getDb()
    .prepare(
      `UPDATE robot_runs SET status = 'running', started_at = ?, locked_until = ?, backend = ?
       WHERE id = ? AND status = 'queued'
         AND (SELECT COUNT(*) FROM robot_runs WHERE user_id = ? AND status = 'running')
           + (CASE WHEN EXISTS (SELECT 1 FROM robot_runtime WHERE key = ? AND value > ?) THEN 1 ELSE 0 END) < ?
         AND NOT EXISTS (
           SELECT 1 FROM robots b JOIN robot_runs x ON x.robot_id = b.id
           WHERE b.id = robot_runs.robot_id AND b.persist_session = 1 AND x.status = 'running'
         )
         AND id = COALESCE(
           (SELECT id FROM robot_runs WHERE user_id = ? AND status = 'queued' AND batch_id IS NULL ORDER BY created_at, rowid LIMIT 1),
           (SELECT id FROM robot_runs WHERE user_id = ? AND status = 'queued' AND batch_id IS NOT NULL ORDER BY created_at, rowid LIMIT 1)
         )`,
    )
    .run(ts, lock, backend, runId, workspaceId, snapshotLockKey(workspaceId), ts, concurrency, workspaceId, workspaceId);
  return res.changes === 1;
}

// ---------- Cupo de navegador compartido (corridas + lecturas del constructor) ----------

/** Clave del candado de la lectura de página del constructor con IA (robot_runtime). */
function snapshotLockKey(workspaceId: string): string {
  return `snapshot_lock:${workspaceId}`;
}

/**
 * Toma el cupo de navegador del workspace para una lectura de página: una a la
 * vez, y nunca junto a una corrida (las corridas, a su vez, no arrancan
 * mientras haya una lectura: claimQueuedRun). El valor es "vence|token":
 * compare-and-set con vencimiento, así una función que se cae no lo deja tomado.
 * Devuelve el token para soltarlo, o null si está ocupado.
 */
async function acquireSnapshotLock(workspaceId: string, ttlMs: number): Promise<string | null> {
  const db = getDb();
  const now = nowIso();
  const value = `${new Date(Date.now() + ttlMs).toISOString()}|${crypto.randomUUID()}`;
  const res = await db
    .prepare(
      `INSERT INTO robot_runtime (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE robot_runtime.value < ?`,
    )
    .run(snapshotLockKey(workspaceId), value, now, now);
  if (res.changes !== 1) return null;
  const live = (await db
    .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'running'")
    .get(workspaceId)) as { n: number };
  if (Number(live.n) >= (await getRobotWorkspaceConfig(workspaceId)).concurrency) {
    await releaseSnapshotLock(workspaceId, value);
    return null;
  }
  return value;
}

async function releaseSnapshotLock(workspaceId: string, token: string): Promise<void> {
  await getDb().prepare('DELETE FROM robot_runtime WHERE key = ? AND value = ?').run(snapshotLockKey(workspaceId), token);
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

/** Edad máxima en cola de una corrida de un lote (ROBOTS_BATCH_QUEUE_MAX_AGE_H, 45 días): alcanza para un cambio de mes sin minutos. */
export function batchQueueMaxAgeMs(): number {
  return envInt('ROBOTS_BATCH_QUEUE_MAX_AGE_H', 1080) * 3_600_000;
}

/** ¿El workspace se quedó sin minutos este mes? */
export async function robotQuotaExhausted(workspaceId: string): Promise<boolean> {
  const limit = freeMinutesPerMonth();
  return limit !== null && limit * 60_000 - (await usedMs(workspaceId)) <= 0;
}

/**
 * Corridas en cola demasiado viejas: fallidas con queue_expired. Las sueltas
 * avisan una por una; las de un lote se cierran juntas, sin un evento por fila
 * (se ven en el avance del lote).
 */
export async function expireQueuedRobotRuns(workspaceId?: string, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - queueMaxAgeMs()).toISOString();
  const batchCutoff = new Date(now - batchQueueMaxAgeMs()).toISOString();
  const db = getDb();
  const ts = nowIso();
  const bulk = await db
    .prepare(
      `UPDATE robot_runs SET status = 'failed', error = 'queue_expired', started_at = COALESCE(started_at, ?), finished_at = ?, duration_ms = 0
       WHERE status = 'queued' AND batch_id IS NOT NULL AND created_at < ?${workspaceId ? ' AND user_id = ?' : ''}`,
    )
    .run(...(workspaceId ? [ts, ts, batchCutoff, workspaceId] : [ts, ts, batchCutoff]));
  const rows = (await db
    .prepare(
      `SELECT r.id, r.trigger, r.user_id, b.id AS robot_id, b.name AS robot_name FROM robot_runs r JOIN robots b ON b.id = r.robot_id
       WHERE r.status = 'queued' AND r.batch_id IS NULL AND r.created_at < ?${workspaceId ? ' AND r.user_id = ?' : ''} LIMIT 200`,
    )
    .all(...(workspaceId ? [cutoff, workspaceId] : [cutoff]))) as Array<{
    id: string;
    trigger: RobotRunTrigger;
    user_id: string;
    robot_id: string;
    robot_name: string;
  }>;
  let n = bulk.changes;
  for (const r of rows) {
    if (await failRun({ id: r.robot_id, name: r.robot_name, user_id: r.user_id }, r, 'queue_expired', 'queued')) n++;
  }
  return n;
}

/** Rol de una persona en el workspace; null si no es de él (se fue, o es el sistema). */
async function personRole(workspaceId: string, personId: string | null | undefined): Promise<string | null> {
  if (!personId) return null;
  if (personId === workspaceId) return 'owner';
  const row = (await getDb()
    .prepare('SELECT m.role FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.owner_id = ? AND m.user_id = ? LIMIT 1')
    .get(workspaceId, personId)) as { role: string } | undefined;
  return row?.role ?? null;
}

/**
 * Al arrancar cualquier corrida (manual, programada, en cola, Flow): un robot que
 * usa un login no corre si lo armó, o lo lanzó, alguien que hoy no es admin. Los
 * pasos pueden haber cambiado desde que se puso en cola.
 */
async function loginAllowed(row: RobotRow, actorId: string | null | undefined): Promise<boolean> {
  const { robotUsesLogin } = await import('./robots-http');
  if (!robotUsesLogin(row)) return true;
  for (const person of [row.created_by, actorId]) {
    const role = await personRole(row.user_id, person);
    if (role === 'member' || role === 'guest') return false;
  }
  return true;
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
  if (!(await loginAllowed(row, opts.actorId))) return { ok: false, error: 'admin_only_login' };
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
  // Solo las sueltas: un lote en cola no le cierra la puerta a una corrida manual o programada.
  const depth = (await db
    .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'queued' AND batch_id IS NULL")
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

// ---------- Autoaprendizaje de selectores ----------

/** Huellas por robot: un robot tiene hasta 100 pasos (con alternativos, unas 500 como mucho). */
const MAX_PRINTS = 500;

async function loadPrints(robotId: string): Promise<Record<string, unknown>> {
  const rows = (await getDb()
    .prepare('SELECT selector, print FROM robot_selector_prints WHERE robot_id = ? LIMIT ?')
    .all(robotId, MAX_PRINTS)) as Array<{ selector: string; print: string }>;
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const plain = open(r.print);
    if (plain) out[r.selector] = parseJson<unknown>(plain, null);
  }
  return out;
}

/** Cifradas y sin secretos: guardan texto de la página, que puede ser de un sitio con login. Solo se escriben si cambiaron. */
async function savePrints(robotId: string, prints: Record<string, unknown>, known: Record<string, unknown>, secrets: string[]): Promise<void> {
  const db = getDb();
  const ts = nowIso();
  for (const [selector, print] of Object.entries(prints).slice(0, MAX_PRINTS)) {
    if (selector.length > 500) continue;
    const clean = secrets.length ? redact(print, secrets) : print;
    const json = JSON.stringify(clean);
    if (json.length > 20_000 || json === JSON.stringify(known[selector])) continue;
    await db
      .prepare(
        `INSERT INTO robot_selector_prints (robot_id, selector, print, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (robot_id, selector) DO UPDATE SET print = excluded.print, updated_at = excluded.updated_at`,
      )
      .run(robotId, selector, seal(json), ts);
  }
}

/** Solo los pasos que leen se guardan solos. Los de acción quedan para que una persona los revise. */
const AUTO_SAVE_TYPES = new Set(['wait', 'extract', 'extract_table', 'extract_list', 'scroll']);

/**
 * Corrida buena con selectores de lectura reencontrados: quedan en los pasos y el
 * viejo pasa a alternativo. Lo que llega se valida otra vez: solo selectores
 * simples, sin plantillas. Guardar nunca cambia si el robot usa credenciales.
 * Compare-and-set contra updated_at: si alguien editó el robot mientras corría, no se pisa.
 */
async function saveRelearned(row: RobotRow, healed: RobotHealed[]): Promise<RobotHealed[]> {
  const list = healed.filter((h) => h.relearned && !h.review && isSimpleSelector(h.to || 'a'));
  if (!list.length) return healed;
  const steps = parseJson<Array<Record<string, unknown>>>(row.steps, []);
  const saved = new Set<RobotHealed>();
  const stepAt = (label: string): Record<string, unknown> | null => {
    const parts = label.split('.').map(Number);
    if (parts.length === 1) return steps[parts[0] - 1] ?? null;
    const top = steps[parts[0] - 1];
    return parts.length === 3 && Array.isArray(top?.steps) ? ((top.steps as Array<Record<string, unknown>>)[parts[2] - 1] ?? null) : null;
  };
  for (const h of list) {
    const step = stepAt(h.step);
    if (!step || !AUTO_SAVE_TYPES.has(String(step.type))) continue;
    if (h.field) {
      const field = (Array.isArray(step.fields) ? (step.fields as Array<Record<string, unknown>>) : []).find((f) => f.name === h.field);
      if (!field || String(field.selector ?? '').includes('{{')) continue;
      field.selector = h.to;
      saved.add(h);
      continue;
    }
    const old = String(step.selector ?? '');
    if (old.includes('{{') || !h.to) continue;
    if (old === h.to) {
      saved.add(h);
      continue;
    }
    step.selector = h.to;
    const alts = (Array.isArray(step.fallbacks) ? (step.fallbacks as string[]) : []).filter((x) => x !== h.to);
    step.fallbacks = [old, ...alts.filter((x) => x !== old)].filter(Boolean).slice(0, 4);
    saved.add(h);
  }
  if (!saved.size) return healed;
  const v = validateSteps(steps);
  if (!v.ok) return healed;
  const next = JSON.stringify(v.steps);
  if (CREDENTIAL_TEMPLATE.test(next) !== CREDENTIAL_TEMPLATE.test(row.steps)) return healed;
  const res = await getDb()
    .prepare('UPDATE robots SET steps = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
    .run(next, nowIso(), row.id, row.updated_at);
  if (res.changes !== 1) return healed;
  return healed.map((h) => (saved.has(h) ? { ...h, saved: true } : h));
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
  const settings = robot.settings;
  const geo = geoOptions(settings.country);
  const session = persist ? await loadSession(workspaceId, robot.id) : undefined;
  // Con un login o una sesión guardada, los datos son de quien armó el robot (captured_by).
  const authenticated = Object.keys(creds.credentials).length > 0 || session !== undefined;
  const capturedBy = authenticated ? (row.created_by ?? workspaceId) : null;
  // Los secretos se redactan también en sus formas codificadas (URL, form, base64, HTML):
  // una página podría devolverlos en un query string o en un atributo.
  const secrets = expandedSecrets([...creds.secrets, ...(geo.proxy?.password ? [geo.proxy.password] : [])]);
  const selfHeal = settings.selfHeal === true ? { prints: await loadPrints(robot.id) } : undefined;
  let result: Awaited<ReturnType<typeof backend.run>>;
  try {
    result = await backend.run({
      robotName: robot.name,
      steps: robot.steps,
      inputs,
      timeoutMs,
      credentials: creds.credentials,
      storageState: session,
      saveSession: persist,
      ...geo,
      ...(selfHeal ? { selfHeal } : {}),
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
  if (secrets.length) {
    result = {
      ...result,
      error: result.error ? redact(result.error, secrets) : result.error,
      logs: redact(result.logs ?? [], secrets),
      screenshots: (result.screenshots ?? []).map((s) => ({ ...s, name: redact(s.name, secrets) })),
    };
    Object.assign(vars, redact(vars, secrets));
  }
  const status: RobotRunStatus = result.status === 'success' ? 'success' : 'failed';
  let warnings = Math.max(0, Math.floor(Number(result.warnings) || 0));
  const exports: RobotRunExports = {};
  if (Array.isArray(result.healed) && result.healed.length) exports.healed = result.healed.slice(0, 50);
  if (selfHeal && status === 'success') {
    if (result.prints) await savePrints(robot.id, result.prints, selfHeal.prints, secrets).catch(() => {});
    if (exports.healed) exports.healed = await saveRelearned(row, exports.healed).catch(() => exports.healed);
  }
  if (settings.country || geo.proxy) exports.geo = { country: settings.country ?? '', proxy: !!geo.proxy };
  // IA: pasos ai_extract (texto de la página → filas) y columnas calculadas.
  const aiErrors = await resolveAiExtracts(workspaceId, vars, status === 'success');
  if (status === 'success' && settings.aiColumns?.length) aiErrors.push(...(await applyAiColumns(workspaceId, robot.id, settings, vars)));
  if (aiErrors.length) {
    exports.ai = { errors: aiErrors };
    warnings += aiErrors.length;
  }
  const shots = await storeScreenshots(Array.isArray(result.screenshots) ? result.screenshots : []);
  let output = JSON.stringify(vars);
  const truncated = output.length > 200_000;
  if (truncated) output = JSON.stringify({ truncated: true, preview: output.slice(0, 2000) });
  const failure = status === 'failed' ? await storeFailure(result.failure, secrets) : null;
  const change = status === 'success' ? await compareWithPrevious(workspaceId, robot.id, id, output) : null;
  // Tabla acumulada: las filas de la lista del robot se juntan con las de corridas anteriores.
  const dsVar = datasetVariable(robot.steps, settings);
  let dataset: DatasetMergeResult | null = null;
  if (status === 'success' && dsVar && Array.isArray(vars[dsVar])) {
    const runInput = (await getDb().prepare('SELECT input FROM robot_runs WHERE id = ?').get(id)) as { input: string } | undefined;
    dataset = await mergeDataset({
      workspaceId,
      robotId: robot.id,
      runId: id,
      variable: dsVar,
      rows: rowsOf(vars[dsVar]),
      keyFields: settings.dataset?.keyFields ?? [],
      capturedBy,
      input: runInput?.input ?? '{}',
    }).catch(() => null);
    if (dataset) {
      const { fresh, ...summary } = dataset;
      void fresh;
      exports.dataset = summary;
    }
  }
  if (change?.diff.changed && settings.changeEmail?.enabled) {
    const { sendChangeEmail } = await import('./robots-alerts');
    exports.email = { sent: await sendChangeEmail(row, change.diff.changes, settings.changeEmail.to ?? []) };
  }
  if (status === 'success' && settings.destinations?.some((d) => d.enabled !== false)) {
    const { runDestinations } = await import('./robots-destinations');
    exports.destinations = (
      await runDestinations({
        workspaceId,
        robot: row,
        runId: id,
        destinations: settings.destinations,
        vars,
        datasetVariable: dsVar,
        dataset,
        secrets,
      }).catch(() => [])
    ).map((d) => (d.error ? { ...d, error: redact(d.error, secrets) } : d));
    warnings += exports.destinations.filter((d) => !d.ok).length;
  }
  await getDb()
    .prepare(
      `UPDATE robot_runs SET status = ?, output = ?, error = ?, logs = ?, screenshots = ?, warnings = ?, failure = ?,
         changed = ?, captured_by = ?, exports = ?, locked_until = NULL, finished_at = ?, duration_ms = ? WHERE id = ?`,
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
      capturedBy,
      JSON.stringify(exports),
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
 * Pasos ai_extract: la variable trae el texto de la página; la IA la
 * convierte en filas. Si la corrida falló (o la IA no está), la variable
 * queda como lista vacía: el texto crudo nunca se guarda.
 */
async function resolveAiExtracts(workspaceId: string, vars: Record<string, unknown>, run: boolean): Promise<Array<{ variable: string; error: string }>> {
  const { isAiExtractCapture, extractWithAi, AiError } = await import('./robots-ai');
  const errors: Array<{ variable: string; error: string }> = [];
  for (const [name, value] of Object.entries(vars)) {
    if (!isAiExtractCapture(value)) continue;
    if (!run) {
      vars[name] = [];
      continue;
    }
    try {
      vars[name] = await extractWithAi(workspaceId, value);
    } catch (err) {
      vars[name] = [];
      errors.push({ variable: name, error: err instanceof AiError ? err.code : 'ai_error' });
    }
  }
  return errors;
}

/**
 * Columnas con IA: un valor por fila (hasta MAX_AI_COLUMN_ROWS por corrida).
 * Las filas que no cambiaron reusan el valor guardado (robot_ai_cache): la
 * columna no cambia sola entre corridas y no se paga dos veces.
 */
async function applyAiColumns(
  workspaceId: string,
  robotId: string,
  settings: RobotSettings,
  vars: Record<string, unknown>,
): Promise<Array<{ variable: string; error: string }>> {
  const { aiColumnValues, AiError } = await import('./robots-ai');
  const { createHash } = await import('crypto');
  const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32);
  const db = getDb();
  const errors: Array<{ variable: string; error: string }> = [];
  const aiNames = new Set((settings.aiColumns ?? []).map((c) => c.name));
  for (const col of settings.aiColumns ?? []) {
    const list = vars[col.variable];
    if (!Array.isArray(list)) continue;
    const rows = list.map((r) => toRowObject(r) ?? {});
    vars[col.variable] = rows;
    const colKey = sha(`${col.name}\n${col.prompt}`);
    const base = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !aiNames.has(k))));
    const hashes = base.map((r) => sha(stableJson(r)));
    const head = hashes.slice(0, MAX_AI_COLUMN_ROWS);
    const cached = new Map<string, string>();
    for (let i = 0; i < head.length; i += 200) {
      const chunk = [...new Set(head.slice(i, i + 200))];
      const found = (await db
        .prepare(`SELECT row_hash, value FROM robot_ai_cache WHERE robot_id = ? AND col = ? AND row_hash IN (${chunk.map(() => '?').join(',')})`)
        .all(robotId, colKey, ...chunk)) as Array<{ row_hash: string; value: string }>;
      for (const f of found) cached.set(f.row_hash, f.value);
    }
    const missing = head.map((h, i) => (cached.has(h) ? -1 : i)).filter((i) => i >= 0);
    if (missing.length) {
      try {
        const values = await aiColumnValues(workspaceId, col.prompt, missing.map((i) => base[i]));
        const ts = nowIso();
        for (let k = 0; k < missing.length; k++) {
          const h = hashes[missing[k]];
          cached.set(h, values[k] ?? '');
          await db
            .prepare(
              `INSERT INTO robot_ai_cache (robot_id, col, row_hash, value, created_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (robot_id, col, row_hash) DO UPDATE SET value = excluded.value`,
            )
            .run(robotId, colKey, h, String(values[k] ?? '').slice(0, 500), ts);
        }
      } catch (err) {
        errors.push({ variable: col.variable, error: err instanceof AiError ? err.code : 'ai_error' });
      }
    }
    rows.forEach((r, i) => {
      r[col.name] = i < MAX_AI_COLUMN_ROWS ? (cached.get(hashes[i]) ?? '') : '';
    });
  }
  return errors;
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

/**
 * Reclama una corrida de la cola (si le toca) y devuelve cómo ejecutarla. El
 * reclamo va en orden y la ejecución en paralelo: dos corridas del mismo
 * workspace no se pisan el turno. null = no le tocó. true = ya se cerró acá.
 */
async function claimForDrain(run: RobotRunRow): Promise<(() => Promise<unknown>) | true | null> {
  const row = await getRobotRow(run.user_id, run.robot_id);
  if (!row) return null;
  const backend = getRobotBackend();
  if (!backend) return null;
  if (run.trigger !== 'manual' && row.enabled !== 1) return (await failRun(row, run, 'disabled', 'queued')) ? true : null;
  if (!(await loginAllowed(row, run.created_by))) return (await failRun(row, run, 'admin_only_login', 'queued')) ? true : null;
  const robot = toRobotDto(row);
  const timeoutMs = await effectiveTimeoutMs(run.user_id, robot);
  if (timeoutMs === null) {
    // Sin minutos, un lote queda en pausa: sigue el mes que viene o cuando se amplíe la cuota.
    if (run.batch_id) return null;
    return (await failRun(row, run, 'quota_exceeded', 'queued')) ? true : null;
  }
  if (!(await claimQueuedRun(run.user_id, run.id, timeoutMs, backend.name))) return null;
  const creds = await resolveRobotCredentials(run.user_id, robot.steps);
  if (!creds.ok) {
    await failRun(row, run, 'missing_credential', 'running');
    return true;
  }
  return () => executeClaimedRun(row, run.id, parseJson<Record<string, unknown>>(run.input, {}), creds, timeoutMs, backend);
}

/** Primeras de la cola de cada workspace con cupo. Orden al azar entre workspaces: un lote enorme de uno no tapa a los demás. */
async function pickQueuedRuns(concurrency: number, ws?: string): Promise<RobotRunRow[]> {
  const db = getDb();
  const spaces = (await db
    .prepare(`SELECT user_id FROM robot_runs WHERE status = 'queued'${ws ? ' AND user_id = ?' : ''} GROUP BY user_id ORDER BY RANDOM() LIMIT 200`)
    .all(...(ws ? [ws] : []))) as Array<{ user_id: string }>;
  const picked: RobotRunRow[] = [];
  for (const { user_id } of spaces) {
    const left = concurrency - picked.length;
    if (left <= 0) break;
    const running = (await db
      .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'running'")
      .get(user_id)) as { n: number };
    const slots = Math.min((await getRobotWorkspaceConfig(user_id)).concurrency - Number(running.n), left);
    if (slots <= 0) continue;
    const solo = (await db
      .prepare("SELECT * FROM robot_runs WHERE user_id = ? AND status = 'queued' AND batch_id IS NULL ORDER BY created_at, rowid LIMIT ?")
      .all(user_id, slots)) as RobotRunRow[];
    // Sin minutos, las de lotes esperan sin ocupar un lugar en la pasada.
    const rest = solo.length >= slots || (await robotQuotaExhausted(user_id))
      ? []
      : ((await db
          .prepare("SELECT * FROM robot_runs WHERE user_id = ? AND status = 'queued' AND batch_id IS NOT NULL ORDER BY created_at, rowid LIMIT ?")
          .all(user_id, slots - solo.length)) as RobotRunRow[]);
    picked.push(...solo, ...rest);
  }
  return picked;
}

/**
 * Vacía la cola: arranca las primeras de cada workspace con cupo, en paralelo
 * (hasta `concurrency` en total) y en pasadas sucesivas mientras quede tiempo.
 * Devuelve las corridas arrancadas.
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
    const batch = await pickQueuedRuns(concurrency, ws);
    if (!batch.length) break;
    let started = 0;
    const jobs: Array<() => Promise<unknown>> = [];
    for (const r of batch) {
      const claimed = await claimForDrain(r).catch(() => null);
      if (claimed === true) started++;
      else if (claimed) jobs.push(claimed);
    }
    await Promise.all(jobs.map((j) => j().catch(() => false)));
    started += jobs.length;
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
  // Hasta la mitad del tiempo: la cola no puede dejar sin correr a los programados de otros workspaces.
  let ran = await drainRobotQueue({ budgetMs: Math.floor(budgetMs / 2), concurrency });
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

/** Corridas en cola que acepta un workspace contando las de lotes (ROBOTS_MAX_BULK_QUEUED, 51.000). */
export function maxBulkQueued(): number {
  return envInt('ROBOTS_MAX_BULK_QUEUED', MAX_BATCH_INPUTS + 1000);
}

/** Lotes por workspace y hora (ROBOTS_BULK_PER_HOUR, 10). */
export function bulkPerHour(): number {
  return envInt('ROBOTS_BULK_PER_HOUR', 10);
}

export type BatchErrorCode = RunErrorCode | 'too_many_inputs' | 'batch_too_large';

export type EnqueueBatchResult =
  | { ok: true; batchId: string; total: number; /** Ya está en la cola (si no, espera las partes que faltan). */ committed: boolean; runs: RobotRunDto[] }
  | { ok: false; error: BatchErrorCode; name?: string; index?: number };

/** Id estable de la fila de un lote en partes: reenviar la misma parte no agrega corridas. */
async function batchRunId(batchId: string, position: number): Promise<string> {
  const { createHash } = await import('crypto');
  const h = createHash('sha256').update(`${batchId}:${position}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Un robot sobre muchas entradas: valida todas, deja una corrida en cola por
 * entrada (mismo batch_id, en orden) y arranca la cola en segundo plano. Las
 * corridas respetan el cupo del workspace como cualquier otra; la cuota de
 * minutos se mira al arrancar cada una. Un lote de más de 1.000 filas se sube
 * en partes con el mismo `batchId` y el `offset` de su primera fila, hasta
 * MAX_BATCH_INPUTS en total.
 */
export async function enqueueRobotBatch(
  workspaceId: string,
  robotId: string,
  inputs: Array<Record<string, unknown>>,
  opts: { actorId?: string | null; batchId?: string; offset?: number; total?: number } = {},
): Promise<EnqueueBatchResult> {
  if (inputs.length === 0 || inputs.length > MAX_BULK_INPUTS) return { ok: false, error: 'too_many_inputs' };
  const offset = opts.offset ?? 0;
  if (offset + inputs.length > MAX_BATCH_INPUTS) return { ok: false, error: 'too_many_inputs' };
  if (opts.batchId && (!opts.total || offset + inputs.length > opts.total)) return { ok: false, error: 'too_many_inputs' };
  const row = await getRobotRow(workspaceId, robotId);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.enabled !== 1) return { ok: false, error: 'disabled' };
  const robot = toRobotDto(row);
  if (robot.steps.length === 0) return { ok: false, error: 'no_steps' };
  if (!getRobotBackend()) return { ok: false, error: 'runner_unavailable' };
  if (!(await loginAllowed(row, opts.actorId))) return { ok: false, error: 'admin_only_login' };
  const resolved: Array<Record<string, unknown>> = [];
  for (let i = 0; i < inputs.length; i++) {
    const r = resolveInputs(robot.inputs, inputs[i]);
    if (!r.ok) return { ok: false, error: 'missing_input', name: r.name, index: offset + i };
    resolved.push(r.inputs);
  }
  const creds = await resolveRobotCredentials(workspaceId, robot.steps);
  if (!creds.ok) return { ok: false, error: 'missing_credential', name: creds.name };
  if ((await effectiveTimeoutMs(workspaceId, robot)) === null) return { ok: false, error: 'quota_exceeded' };
  const db = getDb();
  const batchId = opts.batchId ?? crypto.randomUUID();
  // Un id de lote solo vale para su workspace y su robot.
  const existing = opts.batchId
    ? (((await db.prepare('SELECT user_id, robot_id FROM robot_runs WHERE batch_id = ? LIMIT 1').get(batchId)) ??
        (await db.prepare('SELECT user_id, robot_id FROM robot_batch_items WHERE batch_id = ? LIMIT 1').get(batchId))) as { user_id: string; robot_id: string } | undefined)
    : undefined;
  if (existing && (existing.user_id !== workspaceId || existing.robot_id !== robotId)) return { ok: false, error: 'not_found' };
  // El rate limit cuenta lotes, no partes.
  if (!existing && process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`robot-bulk:${workspaceId}`, bulkPerHour(), 3600);
    if (!rl.ok) return { ok: false, error: 'rate_limited' };
  }
  await expireQueuedRobotRuns(workspaceId);
  const wanted = opts.total ?? resolved.length;
  const depth = (await db
    .prepare("SELECT COUNT(*) AS n FROM robot_runs WHERE user_id = ? AND status = 'queued' AND (batch_id IS NULL OR batch_id != ?)")
    .get(workspaceId, batchId)) as { n: number };
  if (Number(depth.n) + wanted > maxBulkQueued()) return { ok: false, error: 'busy' };
  const ts = nowIso();
  const rows = [];
  for (let k = 0; k < resolved.length; k++) {
    rows.push({ id: opts.batchId ? await batchRunId(batchId, offset + k) : crypto.randomUUID(), input: JSON.stringify(resolved[k]).slice(0, 100_000), position: offset + k });
  }
  if (opts.batchId) {
    // En partes: las filas esperan aparte. Nada arranca hasta que llegó todo el lote y pasó la validación.
    const bytes = (await db.prepare('SELECT COALESCE(SUM(LENGTH(input)), 0) AS n FROM robot_batch_items WHERE batch_id = ?').get(batchId)) as { n: number };
    if (Number(bytes.n) + rows.reduce((a, r) => a + r.input.length, 0) > MAX_BATCH_BYTES) return { ok: false, error: 'batch_too_large' };
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await db
        .prepare(
          `INSERT OR IGNORE INTO robot_batch_items (id, batch_id, position, robot_id, user_id, input, created_by, created_at)
           VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        )
        .run(...(chunk.flatMap((r) => [r.id, batchId, r.position, robot.id, workspaceId, r.input, opts.actorId ?? null, ts]) as string[]));
    }
    const held = (await db.prepare('SELECT COUNT(*) AS n FROM robot_batch_items WHERE batch_id = ?').get(batchId)) as { n: number };
    const committed = (await db.prepare('SELECT COUNT(*) AS n FROM robot_runs WHERE batch_id = ?').get(batchId)) as { n: number };
    if (Number(committed.n) >= wanted) return { ok: true, batchId, total: Number(committed.n), committed: true, runs: [] };
    if (Number(held.n) < wanted) return { ok: true, batchId, total: Number(held.n), committed: false, runs: [] };
    // Una sola sentencia: entran todas o ninguna.
    await db
      .prepare(
        `INSERT OR IGNORE INTO robot_runs (id, robot_id, user_id, status, trigger, input, created_by, batch_id, created_at)
         SELECT id, robot_id, user_id, 'queued', 'api', input, created_by, batch_id, ? FROM robot_batch_items WHERE batch_id = ? ORDER BY position`,
      )
      .run(nowIso(), batchId);
    await db.prepare('DELETE FROM robot_batch_items WHERE batch_id = ?').run(batchId);
    kickRobotQueue(workspaceId);
    return { ok: true, batchId, total: wanted, committed: true, runs: [] };
  }
  // Mismo instante para todas: el orden FIFO lo da el rowid (en orden de entrada).
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await db
      .prepare(
        `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, created_by, batch_id, created_at)
         VALUES ${chunk.map(() => "(?, ?, ?, 'queued', 'api', ?, ?, ?, ?)").join(', ')}`,
      )
      .run(...(chunk.flatMap((r) => [r.id, robot.id, workspaceId, r.input, opts.actorId ?? null, batchId, ts]) as string[]));
  }
  kickRobotQueue(workspaceId);
  const runs = (await db
    .prepare('SELECT * FROM robot_runs WHERE batch_id = ? AND user_id = ? ORDER BY created_at, rowid')
    .all(batchId, workspaceId)) as RobotRunRow[];
  return { ok: true, batchId, total: runs.length, committed: true, runs: runs.map(toRunDto) };
}

export interface RobotBatchDto {
  id: string;
  robotId: string;
  total: number;
  counts: Record<RobotRunStatus, number>;
  /** Todas terminaron (éxito o falla). */
  done: boolean;
  /** Una página de corridas (`limit` / `offset`): un lote puede tener 50.000. */
  runs: RobotRunDto[];
}

async function batchCounts(workspaceId: string, batchId: string): Promise<{ total: number; counts: Record<RobotRunStatus, number> } | null> {
  const rows = (await getDb()
    .prepare('SELECT status, COUNT(*) AS n FROM robot_runs WHERE batch_id = ? AND user_id = ? GROUP BY status')
    .all(batchId, workspaceId)) as Array<{ status: RobotRunStatus; n: number }>;
  if (!rows.length) return null;
  const counts: Record<RobotRunStatus, number> = { queued: 0, running: 0, success: 0, failed: 0 };
  let total = 0;
  for (const r of rows) {
    counts[r.status] = Number(r.n);
    total += Number(r.n);
  }
  return { total, counts };
}

export async function getRobotBatch(
  workspaceId: string,
  batchId: string,
  viewer?: RobotViewer,
  page: { limit?: number; offset?: number } = {},
): Promise<RobotBatchDto | null> {
  const summary = await batchCounts(workspaceId, batchId);
  if (!summary) return null;
  const limit = Math.min(Math.max(Math.floor(page.limit ?? 1000), 1), 1000);
  const rows = (await getDb()
    .prepare('SELECT * FROM robot_runs WHERE batch_id = ? AND user_id = ? ORDER BY created_at, rowid LIMIT ? OFFSET ?')
    .all(batchId, workspaceId, limit, Math.max(Math.floor(page.offset ?? 0), 0))) as RobotRunRow[];
  return {
    id: batchId,
    robotId: rows[0]?.robot_id ?? '',
    total: summary.total,
    counts: summary.counts,
    done: summary.counts.queued === 0 && summary.counts.running === 0,
    runs: rows.map((r) => (canSeeRobotData(viewer, r) ? toRunDto(r) : redactRunDto(toRunDto(r)))),
  };
}

export interface RobotBatchSummary {
  id: string;
  total: number;
  counts: Record<RobotRunStatus, number>;
  createdAt: string;
  /** Primera corrida, para abrirla desde el lote. */
  firstRunId: string | null;
  /** En pausa: quedan filas y el workspace no tiene minutos. */
  paused: boolean;
  /** Quien mira puede cancelar lo que falta: admins, o quien lanzó el lote. */
  canCancel: boolean;
}

/** Lotes recientes del robot, con su avance (sin los datos de las corridas). */
export async function listRobotBatches(workspaceId: string, robotId: string, viewer?: RobotViewer, limit = 10): Promise<RobotBatchSummary[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT batch_id, status, COUNT(*) AS n, MIN(created_at) AS created_at, MIN(id) AS any_id, MIN(created_by) AS created_by FROM robot_runs
       WHERE robot_id = ? AND user_id = ? AND batch_id IN (
         SELECT batch_id FROM robot_runs WHERE robot_id = ? AND user_id = ? AND batch_id IS NOT NULL
         GROUP BY batch_id ORDER BY MIN(created_at) DESC LIMIT ?
       ) GROUP BY batch_id, status`,
    )
    .all(robotId, workspaceId, robotId, workspaceId, limit)) as Array<{ batch_id: string; status: RobotRunStatus; n: number; created_at: string; any_id: string; created_by: string | null }>;
  const exhausted = await robotQuotaExhausted(workspaceId);
  const by = new Map<string, RobotBatchSummary>();
  for (const r of rows) {
    const b =
      by.get(r.batch_id) ??
      ({
        id: r.batch_id,
        total: 0,
        counts: { queued: 0, running: 0, success: 0, failed: 0 },
        createdAt: r.created_at,
        firstRunId: r.any_id,
        paused: false,
        canCancel: !viewer || viewer.admin || r.created_by === viewer.personId,
      } satisfies RobotBatchSummary);
    b.counts[r.status] = Number(r.n);
    b.total += Number(r.n);
    if (r.created_at < b.createdAt) b.createdAt = r.created_at;
    by.set(r.batch_id, b);
  }
  for (const b of by.values()) b.paused = exhausted && b.counts.queued > 0;
  return [...by.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Quién lanzó el lote o la corrida (para cancelar: admins o esa persona). */
export async function batchActor(workspaceId: string, batchId: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT created_by FROM robot_runs WHERE batch_id = ? AND user_id = ? LIMIT 1').get(batchId, workspaceId)) as { created_by: string | null } | undefined;
  return row?.created_by ?? null;
}

export async function runActor(workspaceId: string, runId: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT created_by FROM robot_runs WHERE id = ? AND user_id = ?').get(runId, workspaceId)) as { created_by: string | null } | undefined;
  return row?.created_by ?? null;
}

/** Cancela lo que sigue en cola de un lote. Lo que ya corrió o está corriendo no se toca. */
export async function cancelRobotBatch(workspaceId: string, batchId: string): Promise<number | null> {
  if (!(await batchCounts(workspaceId, batchId))) return null;
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE robot_runs SET status = 'failed', error = 'canceled', started_at = COALESCE(started_at, ?), finished_at = ?, duration_ms = 0
       WHERE batch_id = ? AND user_id = ? AND status = 'queued'`,
    )
    .run(ts, ts, batchId, workspaceId);
  return res.changes;
}

/** Saca una corrida de la cola. Solo si sigue en cola. */
export async function cancelQueuedRun(workspaceId: string, runId: string): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE robot_runs SET status = 'failed', error = 'canceled', started_at = COALESCE(started_at, ?), finished_at = ?, duration_ms = 0
       WHERE id = ? AND user_id = ? AND status = 'queued'`,
    )
    .run(ts, ts, runId, workspaceId);
  return res.changes === 1;
}

// ---------- Grabaciones en vivo ----------

/** Vida de una grabación: lo que tarda una persona en recorrer el sitio. */
const RECORDING_TTL_MS = 60 * 60_000;

export interface RobotRecordingDto {
  id: string;
  robotId: string;
  steps: RobotStep[];
  updatedAt: string;
  expiresAt: string;
}

async function tokenHash(token: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(token).digest('hex');
}

/** Abre una grabación: el token solo sirve para mandar pasos a esta grabación y vence en una hora. */
export async function createRobotRecording(workspaceId: string, robotId: string, personId: string): Promise<{ id: string; token: string; expiresAt: string } | null> {
  if (!(await getRobotRow(workspaceId, robotId))) return null;
  const { randomBytes } = await import('crypto');
  const id = crypto.randomUUID();
  const token = randomBytes(24).toString('base64url');
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + RECORDING_TTL_MS).toISOString();
  await getDb()
    .prepare(
      `INSERT INTO robot_recordings (id, robot_id, user_id, created_by, token_hash, steps, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
    )
    .run(id, robotId, workspaceId, personId, await tokenHash(token), ts, expiresAt);
  return { id, token, expiresAt };
}

/** Solo quien la abrió la ve: los pasos grabados pueden traer lo que esa persona escribió en el sitio. */
export async function getRobotRecording(workspaceId: string, id: string, personId: string): Promise<RobotRecordingDto | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM robot_recordings WHERE id = ? AND user_id = ? AND created_by = ?')
    .get(id, workspaceId, personId)) as { id: string; robot_id: string; steps: string; updated_at: string; expires_at: string } | undefined;
  if (!row) return null;
  const plain = row.steps.startsWith('[') ? row.steps : open(row.steps);
  const v = validateSteps(parseJson<unknown>(plain, []));
  return { id: row.id, robotId: row.robot_id, steps: v.ok ? v.steps : [], updatedAt: row.updated_at, expiresAt: row.expires_at };
}

export async function deleteRobotRecording(workspaceId: string, id: string, personId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM robot_recordings WHERE id = ? AND user_id = ? AND created_by = ?').run(id, workspaceId, personId);
  return res.changes > 0;
}

/**
 * Lo grabado viene de un sitio: cualquier {{ es texto, no una plantilla. La única
 * excepción es el marcador de contraseña en el valor de un fill, y lo revisa una
 * persona antes de agregarlo (stepsNeedingReview).
 */
export function neutralizeRecorded(steps: unknown): unknown {
  const clean = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') return key === 'value' && v === RECORDER_PASSWORD_PLACEHOLDER ? v : v.replace(/\{\{/g, '{ {');
    if (Array.isArray(v)) return v.map((x) => clean(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)]));
    return v;
  };
  return clean(steps);
}

export type PushRecordingResult = { ok: true; count: number } | { ok: false; error: 'not_found' | 'invalid_steps' };

/**
 * Lo que manda el grabador desde el sitio (sin sesión: vale el token). Reemplaza
 * los pasos de la grabación. Nada se escribe en el robot hasta que la persona
 * los agrega desde el editor.
 */
export async function pushRobotRecording(id: string, token: string, steps: unknown): Promise<PushRecordingResult> {
  const { timingSafeEqual } = await import('crypto');
  const row = (await getDb().prepare('SELECT token_hash, expires_at FROM robot_recordings WHERE id = ?').get(id)) as
    | { token_hash: string; expires_at: string }
    | undefined;
  const a = Buffer.from(await tokenHash(token));
  const b = Buffer.from(row?.token_hash ?? '0'.repeat(64));
  if (!row || a.length !== b.length || !timingSafeEqual(a, b) || row.expires_at < nowIso()) return { ok: false, error: 'not_found' };
  const v = validateSteps(neutralizeRecorded(steps));
  if (!v.ok) return { ok: false, error: 'invalid_steps' };
  await getDb().prepare('UPDATE robot_recordings SET steps = ?, updated_at = ? WHERE id = ?').run(seal(JSON.stringify(v.steps)), nowIso(), id);
  return { ok: true, count: v.steps.length };
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
  await db.prepare('DELETE FROM robot_recordings WHERE expires_at < ?').run(new Date(now).toISOString()).catch(() => {});
  // Lotes que nunca terminaron de subirse.
  await db.prepare('DELETE FROM robot_batch_items WHERE created_at < ?').run(new Date(now - 86_400_000).toISOString()).catch(() => {});
  // Las huellas guardan texto de la página: duran lo mismo que las corridas.
  await db
    .prepare(
      `DELETE FROM robot_selector_prints WHERE robot_id IN (SELECT id FROM robots) AND updated_at < (
         SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-' || (CASE WHEN b.retention_days > 0 THEN b.retention_days ELSE ? END) || ' days')
         FROM robots b WHERE b.id = robot_selector_prints.robot_id
       )`,
    )
    .run(new Date(now).toISOString(), fallback)
    .catch(() => {});
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


// ---------- Exportar ----------

/** Robot como archivo .json (sin credenciales, sesiones, corridas ni ids de envíos ajenos). */
export function exportRobot(robot: RobotDto): Record<string, unknown> {
  return {
    zerosoftRobot: 1,
    name: robot.name,
    description: robot.description,
    steps: robot.steps,
    inputs: robot.inputs,
    schedule: robot.schedule,
    timeoutSec: robot.timeoutSec,
    settings: robot.settings,
    exportedAt: nowIso(),
  };
}

// ---------- Lectura de una página (constructor con IA) ----------

export type SnapshotResult =
  | { ok: true; snapshot: import('./robots-detect').PageSnapshot }
  | { ok: false; error: 'runner_unavailable' | 'quota_exceeded' | 'rate_limited' | 'busy' | 'invalid_url' | 'private_host' | 'snapshot_failed'; detail?: string };

/** Lecturas de página por workspace y hora (ROBOTS_SNAPSHOTS_PER_HOUR, 30). */
export function snapshotsPerHour(): number {
  return envInt('ROBOTS_SNAPSHOTS_PER_HOUR', 30);
}

/**
 * Abre la URL en el mismo navegador aislado de las corridas (mismas reglas:
 * hosts privados bloqueados en cada pedido), detecta listas y devuelve el HTML
 * simplificado. Cuenta minutos del mes como una corrida corta.
 */
export async function snapshotPage(workspaceId: string, url: string, country?: string): Promise<SnapshotResult> {
  const { checkRobotUrl } = await import('./robots-runner');
  const blocked = await checkRobotUrl(url);
  if (blocked) return { ok: false, error: blocked === 'private_host' ? 'private_host' : 'invalid_url' };
  const backend = getRobotBackend();
  if (!backend) return { ok: false, error: 'runner_unavailable' };
  const limitMin = freeMinutesPerMonth();
  if (limitMin !== null && limitMin * 60_000 - (await usedMs(workspaceId)) <= 0) return { ok: false, error: 'quota_exceeded' };
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const rl = await rateLimit(`robot-snapshot:${workspaceId}`, snapshotsPerHour(), 3600);
    if (!rl.ok) return { ok: false, error: 'rate_limited' };
  }
  // Un navegador a la vez por workspace: la lectura toma el mismo cupo que las
  // corridas (una lectura a la vez y nunca junto a una corrida).
  await failStaleRobotRuns(workspaceId);
  const token = await acquireSnapshotLock(workspaceId, 90_000);
  if (!token) return { ok: false, error: 'busy' };
  try {
    return await runSnapshot(workspaceId, url, country);
  } finally {
    await releaseSnapshotLock(workspaceId, token).catch(() => {});
    // Si quedaron corridas esperando el cupo, que arranquen.
    kickRobotQueue(workspaceId);
  }
}

async function runSnapshot(workspaceId: string, url: string, country?: string): Promise<SnapshotResult> {
  const backend = getRobotBackend();
  if (!backend) return { ok: false, error: 'runner_unavailable' };
  const { PAGE_SNAPSHOT_SCRIPT, normalizeSnapshot } = await import('./robots-detect');
  const t0 = Date.now();
  const res = await backend
    .run({
      robotName: 'snapshot',
      steps: [
        { type: 'goto', url },
        { type: 'wait', ms: 1500 },
        { type: 'evaluate', script: PAGE_SNAPSHOT_SCRIPT, name: 'snapshot' },
      ],
      inputs: {},
      timeoutMs: 45_000,
      ...geoOptions(country),
    })
    .catch(() => null);
  await meter(workspaceId, Date.now() - t0, false);
  const snap = res?.status === 'success' ? normalizeSnapshot(res.vars?.snapshot) : null;
  if (!snap) return { ok: false, error: 'snapshot_failed', detail: res?.error?.slice(0, 200) ?? undefined };
  return { ok: true, snapshot: snap };
}
