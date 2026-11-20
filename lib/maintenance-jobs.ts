/**
 * Trabajos de mantenimiento de una vez que tienen que correr contra producción (la base y el storage no se alcanzan
 * desde afuera). Los corre el cron de cada minuto (app/api/cron/minute), protegido por CRON_SECRET, y solo los que
 * nombra la variable MAINTENANCE_JOBS: sin la variable no corre nada, y ningún request puede elegir un trabajo.
 *
 *   MAINTENANCE_JOBS=files-migrate:dry,files-scheduled:dry,lid-repair:dry
 *
 * Trabajos y modos:
 *   files-migrate    dry | apply | apply-delete   archivos de antes al storage privado (lib/files/migrate.ts)
 *   files-scheduled  dry | apply | apply-delete   lo mismo, solo los mensajes programados de Inbox y Lines
 *   lid-repair       dry | apply                  chats duplicados por lid de WhatsApp (lib/wa-dedupe-repair.ts)
 *   wa-webhook-header dry | apply                 webhook de las líneas conectadas con el secreto en un header
 *                                                 (lib/wa-webhook-migrate.ts)
 *   wa-media-audit   dry                          solo lectura: archivos de WhatsApp que dependen de Evolution y
 *                                                 filas por instancia (lib/wa-media-audit.ts)
 *
 * Cada tick corre una tanda acotada (~20 s entre todos) y guarda el cursor en `maintenance_jobs` (una fila por
 * trabajo y modo), así retoma en el tick siguiente y se detiene al terminar. Seguridad: `apply` no arranca si el
 * `dry` del mismo trabajo no terminó al menos una vez, y `apply-delete` además espera a que termine `apply`. Dos
 * ticks superpuestos no corren el mismo trabajo (claim por fila en locked_until).
 *
 * El informe tiene solo estado y cuentas (nada de teléfonos, nombres, lids, URLs ni contenido): queda en la tabla
 * y en una línea de log por trabajo y tick ("[maintenance] files-migrate dry: …").
 * Server-only.
 */
import { createHash } from 'crypto';
import type { Client } from '@libsql/client';
import { ensureMigrated, getClient } from './db';
import { migrateStep, newMigrateProgress, SCHEDULED_TABLES, type MigrateOptions, type MigrateProgress, type SeenKeys } from './files/migrate';
import type { LidRepairReport } from './wa-dedupe-repair';
import type { WebhookMigrateDeps, WebhookMigrateState } from './wa-webhook-migrate';
import type { MediaAuditDeps, MediaAuditState } from './wa-media-audit';

export type JobMode = 'dry' | 'apply' | 'apply-delete';

/** Trabajos conocidos y los modos que aceptan. */
export const MAINTENANCE_JOBS: Record<string, readonly JobMode[]> = {
  'files-migrate': ['dry', 'apply', 'apply-delete'],
  'files-scheduled': ['dry', 'apply', 'apply-delete'],
  'lid-repair': ['dry', 'apply'],
  'wa-webhook-header': ['dry', 'apply'],
  // Solo lectura: no tiene apply (la poda de Evolution se decide aparte, docs/design/evolution-disk-retention.md).
  'wa-media-audit': ['dry'],
};

const MODE_ORDER: Record<JobMode, number> = { dry: 0, apply: 1, 'apply-delete': 2 };

/** Lo que tiene que haber terminado antes de cada modo. */
const REQUIRES: Record<JobMode, JobMode[]> = { dry: [], apply: ['dry'], 'apply-delete': ['dry', 'apply'] };

/** Lease de un claim: si el tick se corta, otro lo retoma después de esto. */
const LEASE_MS = 10 * 60_000;
/** Errores seguidos (excepciones del tick, no fallas por archivo) antes de marcar el trabajo como fallido. */
const MAX_ERRORS = 5;

export interface JobSpec {
  job: string;
  mode: JobMode;
}

/**
 * Lee MAINTENANCE_JOBS: lista separada por comas de `trabajo:modo`. Ignora (y devuelve en `invalid`) lo que no
 * conoce. Sin repetidos; primero los dry, después apply y apply-delete (así un apply de la misma lista espera al dry).
 */
export function parseMaintenanceJobs(value: string | undefined | null): { jobs: JobSpec[]; invalid: string[] } {
  const jobs: JobSpec[] = [];
  const invalid: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const [job, mode, extra] = item.split(':').map((s) => s.trim());
    const modes = Object.prototype.hasOwnProperty.call(MAINTENANCE_JOBS, job) ? MAINTENANCE_JOBS[job] : null;
    if (!modes || extra !== undefined || !(modes as readonly string[]).includes(mode)) {
      invalid.push(item.slice(0, 40));
      continue;
    }
    if (!jobs.some((j) => j.job === job && j.mode === mode)) jobs.push({ job, mode: mode as JobMode });
  }
  jobs.sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode]);
  return { jobs, invalid };
}

export type JobStatus = 'running' | 'done' | 'failed';

export interface JobRow {
  job: string;
  mode: JobMode;
  status: JobStatus;
  report: Record<string, unknown>;
  ticks: number;
  errors: number;
  last_error: string | null;
  started_at: number;
  updated_at: number;
  finished_at: number | null;
}

export interface TickResult {
  job: string;
  mode: JobMode;
  /** running: avanzó y sigue; done; failed; waiting: le falta el dry (o el apply); busy: otro tick lo tiene; no_time. */
  status: JobStatus | 'waiting' | 'busy' | 'no_time';
  line: string;
}

export interface RunOptions {
  /** Por defecto process.env.MAINTENANCE_JOBS. */
  env?: string;
  /** Tiempo de todos los trabajos del tick (por defecto 20 s). */
  budgetMs?: number;
  client?: Client;
  log?: (line: string) => void;
  /** Para tests: opciones de la migración de archivos (tablas, lectura y borrado de originales). */
  files?: Pick<MigrateOptions, 'tables' | 'batch' | 'readOriginal' | 'sizeOf' | 'deleteOriginal'>;
  /** Para tests: el arreglo de lids. */
  lidRepair?: (client: Client, opts: { apply: boolean }) => Promise<LidRepairReport>;
  /** Para tests: cómo se registra el webhook de cada línea. */
  webhookDeps?: WebhookMigrateDeps;
  /** Para tests: instancias del servidor y nombre de instancia de cada línea. */
  mediaAuditDeps?: MediaAuditDeps;
}

interface StepResult {
  state: unknown;
  report: Record<string, unknown>;
  done: boolean;
  line: string;
}

/** Filas de la tabla, para leer el estado (solo cuentas). */
export async function listMaintenanceJobs(client: Client = getClient()): Promise<JobRow[]> {
  const rs = await client.execute('SELECT job, mode, status, report, ticks, errors, last_error, started_at, updated_at, finished_at FROM maintenance_jobs ORDER BY job, mode');
  return rs.rows.map((r) => ({
    job: String(r.job),
    mode: String(r.mode) as JobMode,
    status: String(r.status) as JobStatus,
    report: safeJson(r.report),
    ticks: Number(r.ticks),
    errors: Number(r.errors),
    last_error: r.last_error == null ? null : String(r.last_error),
    started_at: Number(r.started_at),
    updated_at: Number(r.updated_at),
    finished_at: r.finished_at == null ? null : Number(r.finished_at),
  }));
}

function safeJson(v: unknown): Record<string, unknown> {
  try {
    const out = JSON.parse(String(v ?? '{}'));
    return out && typeof out === 'object' ? out : {};
  } catch {
    return {};
  }
}

/** Lo ya contado en una corrida, con hash (la tabla no guarda URLs ni claves). */
function dbSeen(client: Client, run: string): SeenKeys {
  const h = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 32);
  return {
    add: async (ns, key) =>
      (await client.execute({ sql: 'INSERT OR IGNORE INTO maintenance_job_seen (run, ns, h) VALUES (?, ?, ?)', args: [run, ns, h(key)] })).rowsAffected > 0,
    has: async (ns, key) => (await client.execute({ sql: 'SELECT 1 FROM maintenance_job_seen WHERE run = ? AND ns = ? AND h = ?', args: [run, ns, h(key)] })).rows.length > 0,
  };
}

const mb = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;

/** Solo motivos con forma de código (los mensajes de error de afuera pueden traer una URL o un nombre de archivo). */
function safeReasons(r: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(r)) {
    const key = /^[a-z0-9_]{1,40}$/.test(k) ? k : 'other';
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

/** Informe de la migración de archivos: cuentas y nombres de tablas y carpetas, nada más. */
export function filesReport(p: MigrateProgress): Record<string, unknown> {
  return {
    phase: p.phase,
    scannedRows: p.scannedRows,
    files: p.total.files,
    bytes: p.total.bytes,
    byFolder: p.byFolder,
    unmappedCells: p.unmapped.reduce((n, u) => n + u.cells, 0),
    unmapped: p.unmapped.map((u) => ({ table: u.table, column: u.column, cells: u.cells })),
    skippedFolders: p.skippedFolders,
    registered: p.registered,
    copied: p.copied,
    rewrittenCells: p.rewrittenCells,
    deleted: p.deleted,
    failed: p.failed,
    failedByReason: safeReasons(p.failedByReason),
  };
}

async function filesStep(client: Client, spec: JobSpec, state: unknown, deadline: number, o: RunOptions): Promise<StepResult> {
  const apply = spec.mode !== 'dry';
  if (apply) {
    const { fileBackend } = await import('./files/store');
    if (fileBackend() === 'unavailable') throw new Error('no_storage');
  }
  const p: MigrateProgress = state && typeof state === 'object' && 'phase' in state ? (state as MigrateProgress) : newMigrateProgress();
  const opts: MigrateOptions = {
    ...o.files,
    apply,
    deleteOriginals: spec.mode === 'apply-delete',
    tables: spec.job === 'files-scheduled' ? SCHEDULED_TABLES : o.files?.tables,
  };
  await migrateStep(client, opts, p, { seen: dbSeen(client, `${spec.job}:${spec.mode}`), deadline });
  p.failedByReason = safeReasons(p.failedByReason);
  const done = p.phase === 'done';
  const parts = [`scanned ${p.scannedRows} rows`];
  if (spec.mode === 'dry') parts.push(`would migrate ${p.total.files} files (${mb(p.total.bytes)})`);
  else {
    parts.push(`found ${p.total.files} files (${mb(p.total.bytes)})`, `registered ${p.registered}`, `copied ${p.copied}`, `rewritten ${p.rewrittenCells} cells`);
    if (spec.mode === 'apply-delete') parts.push(`deleted ${p.deleted} originals`);
    parts.push(`failed ${p.failed}`);
  }
  const unmapped = p.unmapped.reduce((n, u) => n + u.cells, 0);
  if (unmapped) parts.push(`unmapped ${unmapped} cells`);
  return { state: p, report: filesReport(p), done, line: `${parts.join(', ')}, phase ${p.phase}` };
}

async function lidStep(client: Client, spec: JobSpec, o: RunOptions): Promise<StepResult> {
  const run = o.lidRepair ?? (await import('./wa-dedupe-repair')).repairLidDuplicates;
  const r = await run(client, { apply: spec.mode === 'apply' });
  const report = { applied: r.applied, before: r.before, after: r.after, inbox: r.inbox, lines: r.lines, inboxLidHandles: r.inboxLidHandles };
  const verb = spec.mode === 'apply' ? 'merged' : 'would merge';
  const line =
    `inbox ${verb} ${r.inbox.merged}, renamed ${r.inbox.renamed}, removed ${r.inbox.messages} messages; ` +
    `lines ${verb} ${r.lines.merged}, renamed ${r.lines.renamed}, removed ${r.lines.messages} messages; lid handles cleared ${r.inboxLidHandles}`;
  return { state: {}, report, done: true, line };
}

async function webhookStep(spec: JobSpec, state: unknown, deadline: number, o: RunOptions): Promise<StepResult> {
  const { newWebhookMigrateState, webhookMigrateStep } = await import('./wa-webhook-migrate');
  const s: WebhookMigrateState = state && typeof state === 'object' && 'phase' in state ? (state as WebhookMigrateState) : newWebhookMigrateState();
  const done = await webhookMigrateStep(s, { apply: spec.mode === 'apply', deadline, deps: o.webhookDeps });
  const side = (name: string, c: WebhookMigrateState['inbox']) =>
    spec.mode === 'apply'
      ? `${name} migrated ${c.migrated} of ${c.eligible}, failed ${c.failed}, skipped ${c.skipped}`
      : `${name} would migrate ${c.eligible} of ${c.seen}, skipped ${c.skipped}`;
  const report = { phase: s.phase, inbox: s.inbox, lines: s.lines };
  return { state: s, report, done, line: `${side('inbox', s.inbox)}; ${side('lines', s.lines)}, phase ${s.phase}` };
}

async function mediaAuditJobStep(state: unknown, deadline: number, o: RunOptions): Promise<StepResult> {
  const { newMediaAuditState, mediaAuditStep, mediaAuditLine } = await import('./wa-media-audit');
  const s: MediaAuditState = state && typeof state === 'object' && 'phase' in state ? (state as MediaAuditState) : newMediaAuditState();
  const done = await mediaAuditStep(s, { deadline, deps: o.mediaAuditDeps });
  const report = { phase: s.phase, totals: s.totals, lines: s.lines, truncated: s.truncated, instances: s.instances, instancesError: s.instancesError };
  return { state: s, report, done, line: mediaAuditLine(s) };
}

/**
 * Un tick: corre lo que pide MAINTENANCE_JOBS con el tiempo que haya. Devuelve null si la variable no está.
 * Nunca tira: un trabajo que falla queda anotado en su fila.
 */
export async function runMaintenanceJobs(o: RunOptions = {}): Promise<TickResult[] | null> {
  const env = o.env ?? process.env.MAINTENANCE_JOBS;
  if (!env?.trim()) return null;
  const log = o.log ?? ((line: string) => console.log(line));
  const { jobs, invalid } = parseMaintenanceJobs(env);
  if (invalid.length) log(`[maintenance] unknown entries in MAINTENANCE_JOBS ignored: ${invalid.length}`);
  if (!jobs.length) return [];
  const start = Date.now();
  const deadline = start + (o.budgetMs ?? 20_000);
  if (!o.client) await ensureMigrated();
  const client = o.client ?? getClient();
  const out: TickResult[] = [];
  let worked = false;
  for (const spec of jobs) {
    const name = `${spec.job} ${spec.mode}`;
    const say = (status: TickResult['status'], line: string) => {
      log(`[maintenance] ${name}: ${line}`);
      out.push({ job: spec.job, mode: spec.mode, status, line });
    };
    try {
      const row = (await client.execute({ sql: 'SELECT status, report, ticks FROM maintenance_jobs WHERE job = ? AND mode = ?', args: [spec.job, spec.mode] })).rows[0];
      if (row?.status === 'done') {
        say('done', `done after ${Number(row.ticks)} ticks (remove it from MAINTENANCE_JOBS)`);
        continue;
      }
      if (row?.status === 'failed') {
        say('failed', 'stopped after repeated errors (see maintenance_jobs.last_error)');
        continue;
      }
      const missing: JobMode[] = [];
      for (const need of REQUIRES[spec.mode]) {
        const r = await client.execute({ sql: "SELECT 1 FROM maintenance_jobs WHERE job = ? AND mode = ? AND status = 'done'", args: [spec.job, need] });
        if (!r.rows.length) missing.push(need);
      }
      if (missing.length) {
        say('waiting', `waiting: ${missing.join(' and ')} has not finished yet`);
        continue;
      }
      if (worked && Date.now() >= deadline) {
        say('no_time', 'no time left in this tick');
        continue;
      }
      const now = Date.now();
      await client.execute({
        sql: "INSERT OR IGNORE INTO maintenance_jobs (job, mode, status, state, report, started_at, updated_at) VALUES (?, ?, 'running', '{}', '{}', ?, ?)",
        args: [spec.job, spec.mode, now, now],
      });
      const claim = await client.execute({
        sql: "UPDATE maintenance_jobs SET locked_until = ? WHERE job = ? AND mode = ? AND status = 'running' AND (locked_until IS NULL OR locked_until < ?)",
        args: [now + LEASE_MS, spec.job, spec.mode, now],
      });
      if (!claim.rowsAffected) {
        say('busy', 'another tick is running it');
        continue;
      }
      const cur = (await client.execute({ sql: 'SELECT state, ticks FROM maintenance_jobs WHERE job = ? AND mode = ?', args: [spec.job, spec.mode] })).rows[0];
      const ticks = Number(cur?.ticks ?? 0) + 1;
      worked = true;
      try {
        const step =
          spec.job === 'lid-repair'
            ? await lidStep(client, spec, o)
            : spec.job === 'wa-webhook-header'
              ? await webhookStep(spec, safeJson(cur?.state), deadline, o)
              : spec.job === 'wa-media-audit'
                ? await mediaAuditJobStep(safeJson(cur?.state), deadline, o)
                : await filesStep(client, spec, safeJson(cur?.state), deadline, o);
        const at = Date.now();
        await client.execute({
          sql: `UPDATE maintenance_jobs SET status = ?, state = ?, report = ?, ticks = ?, errors = 0, last_error = NULL, locked_until = NULL,
                  updated_at = ?, finished_at = ? WHERE job = ? AND mode = ?`,
          args: [step.done ? 'done' : 'running', JSON.stringify(step.state), JSON.stringify(step.report), ticks, at, step.done ? at : null, spec.job, spec.mode],
        });
        if (step.done) await client.execute({ sql: 'DELETE FROM maintenance_job_seen WHERE run = ?', args: [`${spec.job}:${spec.mode}`] });
        say(step.done ? 'done' : 'running', `${step.line}, tick ${ticks}, ${step.done ? 'done' : 'running'}`);
      } catch (err) {
        // Solo un código (el mensaje puede traer datos); el tick siguiente reintenta desde el último cursor guardado.
        const code = err instanceof Error && /^[a-z0-9_]{1,40}$/.test(err.message) ? err.message : err instanceof Error ? err.name : 'error';
        const r = await client.execute({
          sql: `UPDATE maintenance_jobs SET errors = errors + 1, ticks = ?, last_error = ?, locked_until = NULL, updated_at = ?,
                  status = CASE WHEN errors + 1 >= ? THEN 'failed' ELSE status END WHERE job = ? AND mode = ? RETURNING status, errors`,
          args: [ticks, code, Date.now(), MAX_ERRORS, spec.job, spec.mode],
        });
        const failed = r.rows[0]?.status === 'failed';
        say(failed ? 'failed' : 'running', `error ${code} (${Number(r.rows[0]?.errors ?? 0)} in a row), tick ${ticks}${failed ? ', stopped' : ', will retry'}`);
      }
    } catch (err) {
      say('busy', `could not read its state (${err instanceof Error ? err.name : 'error'})`);
    }
  }
  return out;
}
