/**
 * Importadores: el job y lo que comparten todas las fuentes (Track, Cal y
 * Docs). Sin lógica de ninguna fuente: eso vive en lib/import-runner.ts y en
 * los adaptadores (lib/track-import*.ts, lib/cal-import.ts,
 * lib/docs-notion-import.ts).
 *
 * Ciclo de un job:
 *   fetching  → se lee la fuente por pasos y se deja lo normalizado en
 *               import_job_items (nada se escribe en la app todavía).
 *   preview   → vista previa con conteos y mapeo; el token ya se borró.
 *   importing → se escribe por tandas, etapa por etapa.
 *   done | failed | cancelled.
 * 'uploading' es el estado inicial del import de Docs mientras sube el zip.
 *
 * El token de terceros se guarda cifrado (lib/secret-box) solo mientras se
 * lee la fuente y se borra al pasar a preview, al fallar o al cancelar.
 * Nunca se loguea ni vuelve en la API.
 */
import { getDb } from './db';
import { open, seal } from './secret-box';

export type ImportApp = 'track' | 'cal' | 'docs';
export type ImportStatus = 'uploading' | 'fetching' | 'preview' | 'importing' | 'done' | 'failed' | 'cancelled';

export interface ImportJobRow {
  id: string;
  workspace_id: string;
  team_id: string | null;
  user_id: string;
  app: ImportApp;
  source: string;
  status: ImportStatus;
  stage: string;
  options: string;
  secret: string | null;
  payload: string | null;
  cursor: string;
  total: number;
  processed: number;
  preview: string | null;
  report: string | null;
  error: string | null;
  locale: string;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/** Job con los JSON ya parseados. `secret` está descifrado (solo en el servidor). */
export interface ImportJob extends Omit<ImportJobRow, 'options' | 'cursor' | 'preview' | 'report' | 'secret'> {
  options: Record<string, unknown>;
  cursor: Record<string, unknown>;
  preview: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  secret: string;
}

/** Lo que ve el navegador: sin token ni payload. */
export interface ImportJobView {
  id: string;
  app: ImportApp;
  source: string;
  status: ImportStatus;
  stage: string;
  total: number;
  processed: number;
  preview: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  error: string | null;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StagedItem<T = Record<string, unknown>> {
  seq: number;
  kind: string;
  data: T;
}

/** Error de la fuente con un código que la UI traduce (unauthorized, not_found…). */
export class ImportError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'ImportError';
  }
}

/** La fuente pidió esperar (429): el job sigue donde estaba después de `ms`. */
export class ImportRetryError extends Error {
  constructor(public ms: number) {
    super('import_retry');
    this.name = 'ImportRetryError';
  }
}

/** Estados en los que el job todavía trabaja (los empuja el cron). */
export const ACTIVE_STATUSES: ImportStatus[] = ['fetching', 'importing'];

function nowIso(): string {
  return new Date().toISOString();
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJob(row: ImportJobRow): ImportJob {
  return {
    ...row,
    options: parse(row.options, {}),
    cursor: parse(row.cursor, {}),
    preview: parse(row.preview, null),
    report: parse(row.report, null),
    secret: open(row.secret),
  };
}

export function jobView(job: ImportJob | ImportJobRow): ImportJobView {
  const j = typeof job.options === 'string' ? toJob(job as ImportJobRow) : (job as ImportJob);
  return {
    id: j.id,
    app: j.app,
    source: j.source,
    status: j.status,
    stage: j.stage,
    total: j.total,
    processed: j.processed,
    preview: j.preview,
    report: j.report,
    error: j.error,
    options: j.options,
    created_at: j.created_at,
    updated_at: j.updated_at,
    finished_at: j.finished_at,
  };
}

export interface CreateImportJobInput {
  workspaceId: string;
  teamId: string | null;
  userId: string;
  app: ImportApp;
  source: string;
  options?: Record<string, unknown>;
  /** Token de la fuente (se guarda cifrado hasta terminar de leerla). */
  secret?: string | null;
  payload?: string | null;
  status?: ImportStatus;
  locale?: string;
}

export async function createImportJob(input: CreateImportJobInput): Promise<ImportJob> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO import_jobs (id, workspace_id, team_id, user_id, app, source, status, options, secret, payload, locale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.teamId,
      input.userId,
      input.app,
      input.source,
      input.status ?? 'fetching',
      JSON.stringify(input.options ?? {}),
      input.secret ? seal(input.secret) : null,
      input.payload ?? null,
      input.locale ?? 'en',
      now,
      now,
    );
  return (await getImportJob(id)) as ImportJob;
}

export async function getImportJobRow(id: string): Promise<ImportJobRow | undefined> {
  return (await getDb().prepare('SELECT * FROM import_jobs WHERE id = ?').get(id)) as ImportJobRow | undefined;
}

export async function getImportJob(id: string): Promise<ImportJob | undefined> {
  const row = await getImportJobRow(id);
  return row ? toJob(row) : undefined;
}

/** Job del workspace (si no es suyo, como si no existiera). */
export async function getWorkspaceImportJob(workspaceId: string, id: string): Promise<ImportJob | undefined> {
  const job = await getImportJob(id);
  return job && job.workspace_id === workspaceId ? job : undefined;
}

export async function listImportJobs(workspaceId: string, app: ImportApp, limit = 10): Promise<ImportJobView[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM import_jobs WHERE workspace_id = ? AND app = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, app, limit)) as ImportJobRow[];
  return rows.map((r) => jobView(r));
}

export interface ImportJobPatch {
  status?: ImportStatus;
  stage?: string;
  options?: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  total?: number;
  processed?: number;
  preview?: Record<string, unknown> | null;
  report?: Record<string, unknown> | null;
  error?: string | null;
  payload?: string | null;
  /** null borra el token. */
  secret?: null;
  finished?: boolean;
  lockedUntil?: string | null;
}

export async function updateImportJob(id: string, patch: ImportJobPatch): Promise<void> {
  const sets: string[] = ['updated_at = ?'];
  const args: Array<string | number | null> = [nowIso()];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.stage !== undefined) set('stage', patch.stage);
  if (patch.options !== undefined) set('options', JSON.stringify(patch.options));
  if (patch.cursor !== undefined) set('cursor', JSON.stringify(patch.cursor));
  if (patch.total !== undefined) set('total', patch.total);
  if (patch.processed !== undefined) set('processed', patch.processed);
  if (patch.preview !== undefined) set('preview', patch.preview === null ? null : JSON.stringify(patch.preview));
  if (patch.report !== undefined) set('report', patch.report === null ? null : JSON.stringify(patch.report));
  if (patch.error !== undefined) set('error', patch.error);
  if (patch.payload !== undefined) set('payload', patch.payload);
  if (patch.secret === null) set('secret', null);
  if (patch.finished) set('finished_at', nowIso());
  if (patch.lockedUntil !== undefined) set('locked_until', patch.lockedUntil);
  args.push(id);
  await getDb().prepare(`UPDATE import_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

/**
 * Reclama el job para trabajarlo (compare-and-set de locked_until): dos
 * corridas (la pestaña abierta y el cron) nunca procesan la misma tanda.
 */
export async function claimImportJob(id: string, ms: number): Promise<boolean> {
  const now = nowIso();
  const res = await getDb()
    .prepare(
      `UPDATE import_jobs SET locked_until = ?
       WHERE id = ? AND status IN ('fetching', 'importing') AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(new Date(Date.now() + ms).toISOString(), id, now);
  return res.changes > 0;
}

export async function releaseImportJob(id: string, until: string | null = null): Promise<void> {
  await getDb().prepare('UPDATE import_jobs SET locked_until = ? WHERE id = ?').run(until, id);
}

/** Jobs con trabajo pendiente que nadie tiene tomado (para el cron). */
export async function listRunnableImportJobs(limit = 5): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM import_jobs
       WHERE status IN ('fetching', 'importing') AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY updated_at ASC LIMIT ?`,
    )
    .all(nowIso(), limit)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// ---------- Items normalizados ----------

/** Agrega items al final (seq correlativo desde `from`), en INSERTs de a 100. */
export async function appendImportItems(jobId: string, from: number, items: Array<{ kind: string; data: unknown }>): Promise<number> {
  const db = getDb();
  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    const args: Array<string | number> = [];
    batch.forEach((item, k) => args.push(jobId, from + i + k, item.kind, JSON.stringify(item.data)));
    await db
      .prepare(`INSERT OR REPLACE INTO import_job_items (job_id, seq, kind, data) VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')}`)
      .run(...args);
  }
  return items.length;
}

export async function listImportItems<T = Record<string, unknown>>(
  jobId: string,
  from = 0,
  limit = 100_000,
): Promise<StagedItem<T>[]> {
  const rows = (await getDb()
    .prepare('SELECT seq, kind, data FROM import_job_items WHERE job_id = ? AND seq >= ? ORDER BY seq LIMIT ?')
    .all(jobId, from, limit)) as Array<{ seq: number; kind: string; data: string }>;
  return rows.map((r) => ({ seq: Number(r.seq), kind: r.kind, data: parse<T>(r.data, {} as T) }));
}

export async function deleteImportItems(jobId: string): Promise<void> {
  await getDb().prepare('DELETE FROM import_job_items WHERE job_id = ?').run(jobId);
}

// ---------- Ids externos (idempotencia) ----------

export async function getExternalId(workspaceId: string, source: string, kind: string, externalId: string): Promise<string | null> {
  const row = (await getDb()
    .prepare('SELECT local_id FROM import_external_ids WHERE workspace_id = ? AND source = ? AND kind = ? AND external_id = ?')
    .get(workspaceId, source, kind, externalId)) as { local_id: string } | undefined;
  return row?.local_id ?? null;
}

/** Ids locales ya importados para una lista de ids externos. */
export async function getExternalIds(
  workspaceId: string,
  source: string,
  kind: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < externalIds.length; i += 200) {
    const chunk = externalIds.slice(i, i + 200);
    if (!chunk.length) continue;
    const rows = (await getDb()
      .prepare(
        `SELECT external_id, local_id FROM import_external_ids
         WHERE workspace_id = ? AND source = ? AND kind = ? AND external_id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .all(workspaceId, source, kind, ...chunk)) as Array<{ external_id: string; local_id: string }>;
    for (const r of rows) out.set(r.external_id, r.local_id);
  }
  return out;
}

export async function setExternalId(
  workspaceId: string,
  source: string,
  kind: string,
  externalId: string,
  localId: string,
): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO import_external_ids (workspace_id, source, kind, external_id, local_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, source, kind, external_id) DO UPDATE SET local_id = excluded.local_id`,
    )
    .run(workspaceId, source, kind, externalId, localId);
}

// ---------- fetch a terceros ----------

/**
 * GET/POST a la API de la fuente con timeout y errores traducidos: 401/403 →
 * unauthorized, 404 → not_found, 429 → reintento más tarde. El token va solo
 * en el header; nunca en la URL ni en un log.
 */
export async function sourceFetch<T>(url: string, init: RequestInit = {}): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  } catch {
    throw new ImportError('source_unreachable');
  }
  if (res.status === 401 || res.status === 403) {
    // GitHub responde 403 cuando se agotó el límite.
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      throw new ImportRetryError(Math.min(Math.max(reset - Date.now(), 30_000), 3_600_000));
    }
    throw new ImportError('unauthorized');
  }
  if (res.status === 404) throw new ImportError('not_found');
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    throw new ImportRetryError(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 3_600_000) : 60_000);
  }
  if (!res.ok) throw new ImportError('source_error');
  try {
    return { data: (await res.json()) as T, headers: res.headers };
  } catch {
    throw new ImportError('source_error');
  }
}

/** Base de la API de una fuente; en los tests e2e apunta a un mock local. */
export function sourceBase(name: 'linear' | 'github' | 'calendly', fallback: string): string {
  const env = process.env[`IMPORT_${name.toUpperCase()}_API_URL`];
  return (env || fallback).replace(/\/$/, '');
}
