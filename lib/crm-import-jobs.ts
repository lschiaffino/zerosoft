/**
 * CRM — migración desde HubSpot o Pipedrive por API, en jobs. Server-only.
 *
 * Flujo:
 * 1. createImportPreview: valida el token, lee owners, campos propios,
 *    pipelines, totales y una muestra, y guarda el job en 'preview' con el
 *    token cifrado (lib/secret-box). Nada se escribe en el CRM todavía.
 * 2. startImportJob: la persona revisa el mapeo, elige qué importar y a quién
 *    va cada owner; el job pasa a 'queued'.
 * 3. runImportStep: lo llaman /api/cron/minute y la pantalla de progreso
 *    (POST .../run). Reclama el job (compare-and-set de locked_until), arma el
 *    plan la primera vez (campos, pipelines y etapas) y procesa páginas hasta
 *    agotar el presupuesto de tiempo, guardando el cursor después de cada una.
 *    Así 50k contactos terminan en varias corridas cortas, sin el límite de 300 s.
 * 4. Al terminar, fallar o cancelar, el token se borra.
 *
 * Idempotencia: crm_external_ids guarda qué registro nuestro es cada id ajeno
 * (hubspot:<id>, pipedrive:<id>). Reimportar actualiza ese registro. Si no hay
 * id previo, un contacto con el mismo email o una empresa con el mismo dominio
 * se completan con las reglas del merge (solo lo vacío) en vez de duplicarse.
 *
 * Los registros se escriben directo (no por createContact/createDeal) para no
 * disparar workflows ni webhooks por cada fila importada.
 */
import { seal, open } from './secret-box';
import { CrmRefError } from './crm-refs';
import { setParentCompany, syncContactPrimary, syncDealPrimary } from './crm-assoc';
import { companyMergeFillPatch, normalizeCompanyDomain } from './crm-company-merge';
import { getCrmSettings } from './crm-currency';
import { LEAD_STATUSES, LIFECYCLE_STAGES, SOURCES } from './crm-constants';
import { coerceCustom, normalizeImportValue, parseImportDate, workspacePeople, type Person } from './crm-import';
import { createPipeline, listCustomFields, listPipelinesWithStages, mergeFillPatch, parseCustom } from './crm';
import {
  IMPORT_GROUPS,
  isFatalSourceError,
  phaseGroup,
  RateLimiter,
  SourceError,
  fieldNameFrom,
  type CrmSource,
  type ImportGroup,
  type ImportPhase,
  type ImportProvider,
  type SrcActivity,
  type SrcCompany,
  type SrcContact,
  type SrcDeal,
  type SrcField,
  type SrcList,
  type SrcRecord,
} from './crm-import-source';
import { createHubspotSource } from './crm-import-hubspot';
import { createPipedriveSource } from './crm-import-pipedrive';
import { fakeDatasetFromToken, fakeHubspotFetch, fakeImportAllowed, fakePipedriveFetch, isFakeToken } from './crm-import-fake';
import {
  ensureMigrated,
  getClient,
  getDb,
  txDb,
  type CrmCompanyRow,
  type CrmContactRow,
  type CrmCustomFieldRow,
  type Db,
} from './db';

// ---------- Tipos ----------

export type ImportJobStatus = 'preview' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface GroupCounts {
  total: number | null;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Ya importados que se editaron en zerosoft después: no se pisaron (solo se completó lo vacío). */
  kept?: number;
}

export type JobCounts = Record<ImportGroup, GroupCounts>;

export interface ImportJobOptions {
  groups: ImportGroup[];
  /** id de owner ajeno → id de persona del workspace ('' = el owner por defecto). */
  ownerMap: Record<string, string>;
  defaultOwnerId: string;
  /** Reemplazar con lo del otro CRM también lo que se editó en zerosoft después del último import. */
  overwriteLocal?: boolean;
}

export interface PreviewOwner {
  id: string;
  email: string;
  name: string;
  /** Persona del workspace con el mismo email, o null. */
  matchId: string | null;
}

export interface PreviewField {
  entity: SrcField['entity'];
  key: string;
  label: string;
  type: SrcField['type'];
  /** Ya hay un campo nuestro (de un import anterior o con el mismo nombre). */
  existing: boolean;
}

export interface PreviewPipeline {
  id: string;
  name: string;
  existing: boolean;
  stages: Array<{ name: string; probability: number; isWon: boolean; isLost: boolean }>;
}

export interface ImportPreview {
  counts: Partial<Record<ImportPhase, number | null>>;
  /** Fases sin permiso en el token (p. ej. emails sin sales-email-read): se saltean. */
  unavailable: ImportPhase[];
  samples: {
    companies: Array<{ name: string; domain: string }>;
    contacts: Array<{ name: string; email: string }>;
    deals: Array<{ name: string; amount: number | null; currency: string }>;
  };
  owners: PreviewOwner[];
  fields: PreviewField[];
  pipelines: PreviewPipeline[];
  /** Registros que ya vinieron de esta cuenta en un import anterior (se actualizan). */
  previouslyImported: number;
  /** De esos, los que se editaron en zerosoft después del último import (no se pisan salvo que se pida). */
  locallyEdited?: number;
}

interface PlanField extends SrcField {
  /** Nombre de nuestro custom field. */
  name: string;
}

interface Plan {
  fields: PlanField[];
  stages: Record<string, { id: string; pipelineId: string; won: boolean; lost: boolean }>;
  defaultStage: { id: string; pipelineId: string } | null;
  owners: Record<string, string>;
  defaultOwnerId: string;
  /** [empresa nuestra, id ajeno de la madre]: madres que todavía no se importaron. */
  pendingParents: Array<[string, string]>;
  /** Owners ajenos sin persona en el workspace (id → email): sus registros esperan a que se unan. */
  pendingOwners?: Record<string, string>;
  overwriteLocal?: boolean;
}

interface Cursor {
  phase: number;
  after: string | null;
}

interface JobRow {
  id: string;
  user_id: string;
  created_by: string;
  provider: ImportProvider;
  status: ImportJobStatus;
  token: string;
  options: string;
  preview: string;
  plan: string | null;
  cursor: string;
  counts: string;
  errors: string;
  error_count: number;
  failure: string;
  attempts: number;
  locked_until: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo que ve la UI: nunca el token. */
export interface ImportJobView {
  id: string;
  provider: ImportProvider;
  status: ImportJobStatus;
  options: ImportJobOptions;
  preview: ImportPreview;
  counts: JobCounts;
  /** 0-1 sobre los totales conocidos; null si no hay totales (Pipedrive). */
  progress: number | null;
  /** Fase en curso (mientras corre). */
  phase: ImportPhase | null;
  errors: string[];
  errorCount: number;
  failure: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const MAX_ERRORS = 100;
const MAX_ATTEMPTS = 5;
const PREVIEW_TTL_MIN = 120;

// ---------- Utilidades ----------

function nowDb(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function emptyCounts(): JobCounts {
  const c = (): GroupCounts => ({ total: null, processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 });
  return { companies: c(), contacts: c(), deals: c(), activities: c(), lists: c() };
}

/** Totales por grupo desde los conteos por fase (null si alguna fase no tiene total). */
export function groupTotals(counts: ImportPreview['counts'], phases: ImportPhase[]): Record<ImportGroup, number | null> {
  const out: Record<ImportGroup, number | null> = { companies: 0, contacts: 0, deals: 0, activities: 0, lists: 0 };
  for (const g of IMPORT_GROUPS) {
    const ps = phases.filter((p) => phaseGroup(p) === g);
    let sum: number | null = 0;
    for (const p of ps) {
      const n = counts[p];
      if (n === null || n === undefined) sum = null;
      else if (sum !== null) sum += n;
    }
    out[g] = sum;
  }
  return out;
}

export function jobProgress(counts: JobCounts, groups: ImportGroup[]): number | null {
  let total = 0;
  let done = 0;
  for (const g of groups) {
    const c = counts[g];
    if (c.total === null) return null;
    total += c.total;
    done += Math.min(c.processed, c.total);
  }
  return total === 0 ? 1 : done / total;
}

// ---------- Fuente ----------

type SourceFactory = (provider: ImportProvider, token: string, ctx: { ownerEmail: string }) => CrmSource;

const defaultFactory: SourceFactory = (provider, token, ctx) => {
  // Proveedor falso solo en tests/e2e (CRM_IMPORT_FAKE=1 con NODE_ENV=test o DEMO_MODE).
  if (fakeImportAllowed() && isFakeToken(token)) {
    const ds = fakeDatasetFromToken(token, ctx.ownerEmail);
    // Sin tope de pedidos: con `sleep` instantáneo, el limitador real (100 cada
    // 10 s) giraba en microtasks hasta que se vaciara la ventana y frenaba el
    // servidor entero.
    const limiter = new RateLimiter(Number.MAX_SAFE_INTEGER, 1);
    return provider === 'hubspot'
      ? createHubspotSource(token, { fetch: fakeHubspotFetch(ds), sleep: async () => {}, limiter })
      : createPipedriveSource(token, { fetch: fakePipedriveFetch(ds), sleep: async () => {}, limiter });
  }
  return provider === 'hubspot' ? createHubspotSource(token) : createPipedriveSource(token);
};

let sourceFactory: SourceFactory = defaultFactory;

/** Solo tests: reemplaza cómo se crea la fuente (null vuelve al default). */
export function setImportSourceFactory(f: SourceFactory | null): void {
  sourceFactory = f ?? defaultFactory;
}

async function creatorEmail(userId: string): Promise<string> {
  const row = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(userId)) as { email: string } | undefined;
  return row?.email ?? '';
}

// ---------- Vista previa ----------

export type PreviewResult =
  | { ok: true; job: ImportJobView }
  | { ok: false; code: 'invalid_token' | 'missing_scope' | 'provider_error' | 'import_running' };

export async function activeImportJob(userId: string): Promise<ImportJobView | null> {
  const row = (await getDb()
    .prepare(
      `SELECT * FROM crm_import_jobs WHERE user_id = ? AND status IN ('preview', 'queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId)) as JobRow | undefined;
  return row ? toView(row) : null;
}

async function existingFieldNames(userId: string, provider: ImportProvider): Promise<{ defs: CrmCustomFieldRow[]; ext: Map<string, string> }> {
  const defs = await listCustomFields(userId);
  const rows = (await getDb()
    .prepare(`SELECT external_id, record_id FROM crm_external_ids WHERE user_id = ? AND provider = ? AND object = 'field'`)
    .all(userId, provider)) as Array<{ external_id: string; record_id: string }>;
  return { defs, ext: new Map(rows.map((r) => [r.external_id, r.record_id])) };
}

/** Nombre nuestro de un campo ajeno: HubSpot ya trae nombres internos; Pipedrive, hashes (se usa la etiqueta). */
function wantedFieldName(provider: ImportProvider, f: SrcField): string {
  return fieldNameFrom(provider === 'hubspot' ? f.key : f.label);
}

export async function createImportPreview(
  userId: string,
  createdBy: string,
  provider: ImportProvider,
  token: string,
): Promise<PreviewResult> {
  const db = getDb();
  const active = await activeImportJob(userId);
  if (active && active.status !== 'preview') return { ok: false, code: 'import_running' };
  // Una vista previa vieja sin arrancar se descarta (y su token con ella).
  if (active) await cancelImportJob(userId, active.id);

  const source = sourceFactory(provider, token, { ownerEmail: await creatorEmail(createdBy) });
  let owners, fields, pipelines;
  try {
    owners = await source.owners();
    fields = await source.fields();
    pipelines = await source.pipelines();
  } catch (e) {
    return { ok: false, code: previewErrorCode(e) };
  }

  const counts: ImportPreview['counts'] = {};
  const unavailable: ImportPhase[] = [];
  for (const phase of source.phases()) {
    try {
      counts[phase] = await source.count(phase);
    } catch (e) {
      if (e instanceof SourceError && e.code === 'scope') {
        unavailable.push(phase);
        continue;
      }
      if (isFatalSourceError(e)) return { ok: false, code: previewErrorCode(e) };
      counts[phase] = null;
    }
  }

  const samples: ImportPreview['samples'] = { companies: [], contacts: [], deals: [] };
  for (const phase of ['companies', 'contacts', 'deals'] as const) {
    if (unavailable.includes(phase)) continue;
    try {
      const page = await source.page(phase, null, [], 5);
      for (const r of page.items) {
        if (r.kind === 'company') samples.companies.push({ name: r.name, domain: r.domain });
        if (r.kind === 'contact') samples.contacts.push({ name: `${r.firstName} ${r.lastName}`.trim(), email: r.email });
        if (r.kind === 'deal') samples.deals.push({ name: r.name, amount: r.amount, currency: r.currency });
      }
    } catch (e) {
      if (isFatalSourceError(e)) return { ok: false, code: previewErrorCode(e) };
    }
  }

  const people = await workspacePeople(userId, db);
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.id]));
  const { defs, ext } = await existingFieldNames(userId, provider);
  const ours = await listPipelinesWithStages(userId);
  const pipeExt = (await db
    .prepare(`SELECT external_id FROM crm_external_ids WHERE user_id = ? AND provider = ? AND object = 'pipeline'`)
    .all(userId, provider)) as Array<{ external_id: string }>;
  const prev = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM crm_external_ids WHERE user_id = ? AND provider = ? AND object IN ('company', 'contact', 'deal')`,
    )
    .get(userId, provider)) as { c: number };

  const preview: ImportPreview = {
    counts,
    unavailable,
    samples,
    owners: owners.map((o) => ({ ...o, matchId: (o.email && byEmail.get(o.email)) || null })),
    fields: fields.map((f) => ({
      entity: f.entity,
      key: f.key,
      label: f.label,
      type: f.type,
      existing:
        ext.has(`${f.entity}:${f.key}`) || defs.some((d) => d.entity === f.entity && d.name === wantedFieldName(provider, f)),
    })),
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      existing: pipeExt.some((x) => x.external_id === p.id) || ours.some((o) => o.name.toLowerCase() === p.name.toLowerCase()),
      stages: p.stages.map((s) => ({ name: s.name, probability: s.probability, isWon: s.isWon, isLost: s.isLost })),
    })),
    previouslyImported: prev.c,
    locallyEdited: await countEditedLocally(db, userId, provider),
  };

  const id = crypto.randomUUID();
  const options: ImportJobOptions = {
    groups: [...IMPORT_GROUPS],
    ownerMap: Object.fromEntries(preview.owners.filter((o) => o.matchId).map((o) => [o.id, o.matchId!])),
    defaultOwnerId: createdBy,
  };
  await db
    .prepare(
      `INSERT INTO crm_import_jobs (id, user_id, created_by, provider, status, token, options, preview, counts)
       VALUES (?, ?, ?, ?, 'preview', ?, ?, ?, ?)`,
    )
    .run(id, userId, createdBy, provider, seal(token), JSON.stringify(options), JSON.stringify(preview), JSON.stringify(emptyCounts()));
  return { ok: true, job: (await getImportJob(userId, id))! };
}

function previewErrorCode(e: unknown): 'invalid_token' | 'missing_scope' | 'provider_error' {
  if (e instanceof SourceError && e.code === 'auth') return 'invalid_token';
  // HubSpot responde 400 "Invalid request" a un token con forma inválida (no 401).
  if (e instanceof SourceError && e.code === 'http' && e.status === 400 && e.path.endsWith('/owners')) return 'invalid_token';
  if (e instanceof SourceError && e.code === 'scope') return 'missing_scope';
  return 'provider_error';
}

// ---------- Lectura ----------

function toView(row: JobRow): ImportJobView {
  const options = parseJson<ImportJobOptions>(row.options, { groups: [...IMPORT_GROUPS], ownerMap: {}, defaultOwnerId: '' });
  const counts = { ...emptyCounts(), ...parseJson<Partial<JobCounts>>(row.counts, {}) };
  const preview = parseJson<ImportPreview>(row.preview, {
    counts: {},
    unavailable: [],
    samples: { companies: [], contacts: [], deals: [] },
    owners: [],
    fields: [],
    pipelines: [],
    previouslyImported: 0,
  });
  const cursor = parseJson<Cursor>(row.cursor, { phase: 0, after: null });
  const phases = jobPhases(row.provider, options, preview);
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    options,
    preview,
    counts,
    progress: row.status === 'done' ? 1 : jobProgress(counts, options.groups),
    phase: row.status === 'running' || row.status === 'queued' ? (phases[cursor.phase] ?? null) : null,
    errors: parseJson<string[]>(row.errors, []).slice(0, 50),
    errorCount: row.error_count,
    failure: row.failure,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const PROVIDER_PHASES: Record<ImportProvider, ImportPhase[]> = {
  hubspot: ['companies', 'contacts', 'deals', 'notes', 'calls', 'meetings', 'tasks', 'emails', 'lists'],
  pipedrive: ['companies', 'contacts', 'deals', 'notes', 'activities'],
};

function jobPhases(provider: ImportProvider, options: ImportJobOptions, preview: ImportPreview): ImportPhase[] {
  return PROVIDER_PHASES[provider].filter((p) => options.groups.includes(phaseGroup(p)) && !preview.unavailable.includes(p));
}

export async function getImportJob(userId: string, id: string): Promise<ImportJobView | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM crm_import_jobs WHERE id = ? AND user_id = ?')
    .get(id, userId)) as JobRow | undefined;
  return row ? toView(row) : null;
}

/**
 * Imports anteriores: solo los que se arrancaron. Una vista previa que nunca
 * se confirmó (o se canceló antes de correr) no es un import: no se lista.
 */
export async function listImportJobs(userId: string, limit = 10): Promise<ImportJobView[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM crm_import_jobs WHERE user_id = ? AND status != 'preview' AND NOT (status = 'cancelled' AND started_at IS NULL)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit)) as JobRow[];
  return rows.map(toView);
}

// ---------- Arrancar y cancelar ----------

export type StartResult = { ok: true; job: ImportJobView } | { ok: false; code: 'not_found' | 'invalid_owner' | 'invalid_input' };

export async function startImportJob(userId: string, id: string, options: ImportJobOptions): Promise<StartResult> {
  const db = getDb();
  const job = await getImportJob(userId, id);
  if (!job || job.status !== 'preview') return { ok: false, code: 'not_found' };
  const groups = IMPORT_GROUPS.filter((g) => options.groups.includes(g));
  if (!groups.length) return { ok: false, code: 'invalid_input' };
  const people = new Set((await workspacePeople(userId, db)).map((p) => p.id));
  if (!people.has(options.defaultOwnerId)) return { ok: false, code: 'invalid_owner' };
  const ownerMap: Record<string, string> = {};
  for (const [src, person] of Object.entries(options.ownerMap)) {
    if (!person) continue;
    if (!people.has(person)) return { ok: false, code: 'invalid_owner' };
    ownerMap[src.slice(0, 64)] = person;
  }
  const counts = emptyCounts();
  const totals = groupTotals(job.preview.counts, jobPhases(job.provider, { ...options, groups }, job.preview));
  for (const g of IMPORT_GROUPS) counts[g].total = groups.includes(g) ? totals[g] : 0;
  const res = await db
    .prepare(
      `UPDATE crm_import_jobs SET status = 'queued', options = ?, counts = ?, cursor = '{"phase":0,"after":null}', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'preview'`,
    )
    .run(
      JSON.stringify({ groups, ownerMap, defaultOwnerId: options.defaultOwnerId, overwriteLocal: options.overwriteLocal === true }),
      JSON.stringify(counts),
      nowDb(),
      id,
      userId,
    );
  if (!res.changes) return { ok: false, code: 'not_found' };
  return { ok: true, job: (await getImportJob(userId, id))! };
}

/**
 * Cancela (en cola o corriendo) y borra el token. Una vista previa que se
 * descarta (Cancelar o Volver) se borra entera: no llegó a ser un import.
 */
export async function cancelImportJob(userId: string, id: string): Promise<boolean> {
  const dropped = await getDb()
    .prepare(`DELETE FROM crm_import_jobs WHERE id = ? AND user_id = ? AND status = 'preview'`)
    .run(id, userId);
  if (dropped.changes > 0) return true;
  const res = await getDb()
    .prepare(
      `UPDATE crm_import_jobs SET status = 'cancelled', token = '', locked_until = NULL, finished_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status IN ('preview', 'queued', 'running')`,
    )
    .run(nowDb(), nowDb(), id, userId);
  return res.changes > 0;
}

// ---------- Plan (primera corrida) ----------

async function extLookup(db: Db, userId: string, provider: string, object: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const rows = (await db
      .prepare(
        `SELECT external_id, record_id FROM crm_external_ids
         WHERE user_id = ? AND provider = ? AND object = ? AND external_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(userId, provider, object, ...chunk)) as Array<{ external_id: string; record_id: string }>;
    for (const r of rows) out.set(r.external_id, r.record_id);
  }
  return out;
}

/** `touch: false` deja la fecha del último import como estaba (el registro no se reescribió). */
async function extSet(db: Db, userId: string, provider: string, object: string, externalId: string, recordId: string, touch = true) {
  await db
    .prepare(
      `INSERT INTO crm_external_ids (user_id, provider, object, external_id, record_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider, object, external_id) DO UPDATE SET record_id = excluded.record_id${touch ? ', imported_at = excluded.imported_at' : ''}`,
    )
    .run(userId, provider, object, externalId, recordId, nowDb());
}

const RECORD_TABLES: Record<string, string> = { company: 'crm_companies', contact: 'crm_contacts', deal: 'crm_deals', activity: 'crm_activities' };

/** ¿El registro se editó en zerosoft después del último import que lo escribió? */
async function editedLocally(db: Db, userId: string, provider: string, object: string, externalId: string): Promise<boolean> {
  const row = (await db
    .prepare(
      `SELECT r.updated_at > COALESCE(e.imported_at, e.created_at) AS edited FROM crm_external_ids e
       JOIN ${RECORD_TABLES[object]} r ON r.id = e.record_id
       WHERE e.user_id = ? AND e.provider = ? AND e.object = ? AND e.external_id = ?`,
    )
    .get(userId, provider, object, externalId)) as { edited: number } | undefined;
  return Boolean(row?.edited);
}

/** Cuántos registros ya importados de este proveedor se editaron en zerosoft después del último import. */
async function countEditedLocally(db: Db, userId: string, provider: string): Promise<number> {
  let n = 0;
  for (const [object, table] of Object.entries(RECORD_TABLES)) {
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM crm_external_ids e JOIN ${table} r ON r.id = e.record_id
         WHERE e.user_id = ? AND e.provider = ? AND e.object = ? AND r.updated_at > COALESCE(e.imported_at, e.created_at)`,
      )
      .get(userId, provider, object)) as { c: number };
    n += Number(row.c);
  }
  return n;
}

/** Registro editado acá: no se pisa; cuenta como conservado. */
function keep(ctx: WriteCtx): void {
  ctx.counts.kept = (ctx.counts.kept ?? 0) + 1;
}

async function buildPlan(job: JobRow, source: CrmSource, options: ImportJobOptions): Promise<Plan> {
  const db = getDb();
  const userId = job.user_id;
  const provider = job.provider;
  const plan: Plan = {
    fields: [],
    stages: {},
    defaultStage: null,
    owners: options.ownerMap,
    defaultOwnerId: options.defaultOwnerId,
    pendingParents: [],
    overwriteLocal: options.overwriteLocal === true,
    pendingOwners: Object.fromEntries(
      parseJson<ImportPreview>(job.preview, { owners: [] } as unknown as ImportPreview)
        .owners.filter((o) => o.email && !options.ownerMap[o.id])
        .map((o) => [o.id, o.email.toLowerCase()]),
    ),
  };
  const entities = new Set<string>(options.groups.filter((g) => g !== 'activities'));

  // Campos propios: reusa el de un import anterior o uno con el mismo nombre; si no, lo crea.
  const srcFields = (await source.fields()).filter((f) => entities.has(f.entity));
  if (srcFields.length) {
    const { defs, ext } = await existingFieldNames(userId, provider);
    for (const f of srcFields) {
      const extKey = `${f.entity}:${f.key}`;
      let def = defs.find((d) => d.id === ext.get(extKey));
      const wanted = wantedFieldName(provider, f);
      def ??= defs.find((d) => d.entity === f.entity && d.name === wanted);
      if (def) {
        // Select reusado: suma las opciones que falten.
        if ((def.type === 'select' || def.type === 'multiselect') && f.options.length) {
          const cur = parseJson<string[]>(def.options, []);
          const merged = [...cur, ...f.options.filter((o) => !cur.some((c) => c.toLowerCase() === o.toLowerCase()))].slice(0, 100);
          if (merged.length !== cur.length) {
            await db.prepare('UPDATE crm_custom_fields SET options = ? WHERE id = ?').run(JSON.stringify(merged), def.id);
          }
        }
      } else {
        let name = wanted;
        for (let n = 2; defs.some((d) => d.entity === f.entity && d.name === name); n++) name = `${wanted.slice(0, 60)}_${n}`;
        const id = crypto.randomUUID();
        const position = defs.filter((d) => d.entity === f.entity).length;
        const options = f.type === 'currency' ? ['USD'] : f.options;
        await db
          .prepare(
            `INSERT INTO crm_custom_fields (id, user_id, entity, name, label, type, options, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, userId, f.entity, name, f.label.slice(0, 100), f.type, JSON.stringify(options), position);
        def = (await db.prepare('SELECT * FROM crm_custom_fields WHERE id = ?').get(id)) as CrmCustomFieldRow;
        defs.push(def);
      }
      await extSet(db, userId, provider, 'field', extKey, def.id);
      plan.fields.push({ ...f, name: def.name, type: def.type });
    }
  }

  // Pipelines y etapas: por id anterior, si no por nombre, si no se crean.
  if (options.groups.includes('deals')) {
    const srcPipes = await source.pipelines();
    const pipeExt = await extLookup(db, userId, provider, 'pipeline', srcPipes.map((p) => p.id));
    const stageExt = await extLookup(db, userId, provider, 'stage', srcPipes.flatMap((p) => p.stages.map((s) => s.id)));
    let ours = await listPipelinesWithStages(userId);
    const norm = (s: string) => s.trim().toLowerCase();
    for (const sp of srcPipes) {
      let pipe = ours.find((p) => p.id === pipeExt.get(sp.id)) ?? ours.find((p) => norm(p.name) === norm(sp.name));
      if (!pipe) {
        const created = await createPipeline(userId, sp.name.slice(0, 100) || 'Pipeline');
        ours = await listPipelinesWithStages(userId);
        pipe = ours.find((p) => p.id === created.id)!;
      }
      await extSet(db, userId, provider, 'pipeline', sp.id, pipe.id);
      let position = pipe.stages.reduce((m, s) => Math.max(m, s.position), -1);
      for (const ss of sp.stages) {
        let stage = pipe.stages.find((s) => s.id === stageExt.get(ss.id)) ?? pipe.stages.find((s) => norm(s.name) === norm(ss.name));
        if (!stage) {
          const id = crypto.randomUUID();
          position += 1;
          await db
            .prepare(
              'INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(id, pipe.id, ss.name.slice(0, 100) || 'Stage', ss.probability, position, ss.isWon ? 1 : 0, ss.isLost ? 1 : 0);
          stage = { id, pipeline_id: pipe.id, name: ss.name, probability: ss.probability, position, is_won: ss.isWon ? 1 : 0, is_lost: ss.isLost ? 1 : 0 } as (typeof pipe.stages)[number];
          pipe.stages.push(stage);
        }
        await extSet(db, userId, provider, 'stage', ss.id, stage.id);
        plan.stages[ss.id] = { id: stage.id, pipelineId: pipe.id, won: !!stage.is_won, lost: !!stage.is_lost };
      }
    }
    const first = ours.find((p) => p.stages.length);
    if (first) plan.defaultStage = { id: first.stages[0].id, pipelineId: first.id };
  }
  return plan;
}

// ---------- Escritura de una página ----------

interface WriteCtx {
  db: Db;
  userId: string;
  provider: ImportProvider;
  plan: Plan;
  defs: CrmCustomFieldRow[];
  baseCurrency: string;
  counts: GroupCounts;
  errors: string[];
}

function ownerFor(ctx: WriteCtx, srcOwner: string): string {
  return (srcOwner && ctx.plan.owners[srcOwner]) || ctx.plan.defaultOwnerId;
}

/** Valor ajeno → texto que entiende coerceCustom (etiquetas de opciones, fechas epoch). */
function customRaw(ctx: WriteCtx, entity: SrcField['entity'], raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ctx.plan.fields) {
    if (f.entity !== entity) continue;
    let v = raw[f.key];
    if (!v) continue;
    if (f.type === 'select') v = f.optionMap?.[v] ?? v;
    else if (f.type === 'multiselect') {
      v = v
        .split(f.separator ?? ';')
        .map((x) => f.optionMap?.[x.trim()] ?? x.trim())
        .filter(Boolean)
        .join(',');
    } else if (f.type === 'date' && /^\d{11,}$/.test(v)) v = new Date(Number(v)).toISOString().slice(0, 10);
    else if (f.type === 'user') continue;
    out[f.name] = v;
  }
  return out;
}

function customValues(ctx: WriteCtx, entity: SrcField['entity'], raw: Record<string, string>, label: string) {
  const warnings: string[] = [];
  const defs = ctx.defs.filter((d) => d.entity === entity);
  const out = coerceCustom(defs, customRaw(ctx, entity, raw), 0, warnings);
  for (const w of warnings) pushError(ctx, w.replace(/^Row 0:/, `${label}:`));
  return out;
}

function pushError(ctx: WriteCtx, msg: string) {
  ctx.errors.push(msg.slice(0, 300));
}

function inEnum<T extends string>(list: readonly T[], v: string): T | null {
  return (list as readonly string[]).includes(v) ? (v as T) : null;
}

/** Columna = valor solo para lo que vino con dato (re-import: lo ajeno manda, lo vacío no pisa). */
function nonEmpty(cols: Array<[string, string | number | null]>): Array<[string, string | number | null]> {
  return cols.filter(([, v]) => v !== '' && v !== null && v !== undefined);
}

async function updateRow(db: Db, table: string, id: string, cols: Array<[string, string | number | null]>) {
  if (!cols.length) return;
  await db
    .prepare(`UPDATE ${table} SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...cols.map(([, v]) => v), nowDb(), id);
}

async function insertRow(db: Db, table: string, cols: Array<[string, string | number | null]>) {
  await db
    .prepare(`INSERT INTO ${table} (${cols.map(([c]) => c).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(([, v]) => v));
}

async function writeCompany(ctx: WriteCtx, src: SrcCompany, extMap: Map<string, string>): Promise<void> {
  const { db, userId } = ctx;
  const domain = normalizeCompanyDomain(src.domain);
  const lifecycle = inEnum(LIFECYCLE_STAGES, normalizeImportValue('lifecycleStage', src.lifecycleStage));
  const custom = customValues(ctx, 'companies', src.custom, `company ${src.id}`);
  const cols: Array<[string, string | number | null]> = [
    ['name', src.name.slice(0, 200) || domain],
    ['domain', domain],
    ['industry', src.industry.slice(0, 200)],
    ['employees', src.employees],
    ['phone', src.phone.slice(0, 60)],
    ['website', src.website.slice(0, 300)],
    ['city', src.city.slice(0, 120)],
    ['country', src.country.slice(0, 120)],
    ['lifecycle_stage', lifecycle ?? ''],
    ['owner_id', ownerFor(ctx, src.ownerId)],
  ];
  const byExt = extMap.get(src.id);
  let existing = byExt
    ? ((await db.prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?').get(byExt, userId)) as CrmCompanyRow | undefined)
    : undefined;
  let id: string;
  let touch = true;
  if (existing && !ctx.plan.overwriteLocal && (await editedLocally(db, userId, ctx.provider, 'company', src.id))) {
    // Editada en zerosoft después del último import: solo se completa lo vacío.
    const drop = { ...existing, ...Object.fromEntries(cols), custom: JSON.stringify({ ...custom, ...parseCustom(existing.custom) }), parent_company_id: null } as CrmCompanyRow;
    await updateRow(db, 'crm_companies', existing.id, companyMergeFillPatch(existing, drop));
    id = existing.id;
    touch = false;
    keep(ctx);
  } else if (existing) {
    // Re-import: lo que viene del otro CRM actualiza; los custom se suman.
    const merged = { ...parseCustom(existing.custom), ...custom };
    await updateRow(db, 'crm_companies', existing.id, [...nonEmpty(cols), ['custom', JSON.stringify(merged)]]);
    id = existing.id;
    ctx.counts.updated++;
  } else {
    existing = domain
      ? ((await db
          .prepare(`SELECT * FROM crm_companies WHERE user_id = ? AND domain != '' AND lower(domain) = ? ORDER BY created_at LIMIT 1`)
          .get(userId, domain)) as CrmCompanyRow | undefined)
      : undefined;
    if (existing) {
      // Misma empresa por dominio: reglas del merge (solo completa lo vacío).
      const drop = { ...existing, ...Object.fromEntries(cols), custom: JSON.stringify(custom), parent_company_id: null } as CrmCompanyRow;
      const patch = companyMergeFillPatch(existing, drop);
      await updateRow(db, 'crm_companies', existing.id, patch);
      id = existing.id;
      ctx.counts.updated++;
    } else {
      id = crypto.randomUUID();
      await insertRow(db, 'crm_companies', [
        ['id', id],
        ['user_id', userId],
        ...cols.map(([c, v]): [string, string | number | null] => [c, c === 'lifecycle_stage' ? v || 'lead' : v]),
        ['custom', JSON.stringify(custom)],
      ]);
      ctx.counts.created++;
    }
  }
  await extSet(db, userId, ctx.provider, 'company', src.id, id, touch);
  extMap.set(src.id, id);
  if (src.parentId) {
    const parent = extMap.get(src.parentId) ?? (await extLookup(db, userId, ctx.provider, 'company', [src.parentId])).get(src.parentId);
    if (parent) await setParent(ctx, id, parent, src.id);
    else ctx.plan.pendingParents.push([id, src.parentId]);
  }
}

async function setParent(ctx: WriteCtx, childId: string, parentId: string, label: string) {
  if (childId === parentId) return;
  try {
    await setParentCompany(ctx.userId, childId, parentId, ctx.db);
  } catch (e) {
    if (!(e instanceof CrmRefError)) throw e;
    pushError(ctx, `company ${label}: parent skipped (${e.code})`);
  }
}

async function writeContact(ctx: WriteCtx, src: SrcContact, extMap: Map<string, string>, companyExt: Map<string, string>) {
  const { db, userId } = ctx;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(src.email) ? src.email : '';
  if (src.email && !email) pushError(ctx, `contact ${src.id}: invalid email "${src.email.slice(0, 80)}", imported without it`);
  const lifecycle = inEnum(LIFECYCLE_STAGES, normalizeImportValue('lifecycleStage', src.lifecycleStage));
  const leadStatus = inEnum(LEAD_STATUSES, normalizeImportValue('leadStatus', src.leadStatus));
  const source = src.source ? (inEnum(SOURCES, normalizeImportValue('source', src.source)) ?? 'other') : '';
  const custom = customValues(ctx, 'contacts', src.custom, `contact ${src.id}`);
  const cols: Array<[string, string | number | null]> = [
    ['first_name', src.firstName.slice(0, 120)],
    ['last_name', src.lastName.slice(0, 120)],
    ['email', email],
    ['phone', src.phone.slice(0, 60)],
    ['job_title', src.jobTitle.slice(0, 200)],
    ['website', src.website.slice(0, 300)],
    ['city', src.city.slice(0, 120)],
    ['country', src.country.slice(0, 120)],
    ['lifecycle_stage', lifecycle ?? ''],
    ['lead_status', leadStatus ?? ''],
    ['source', source],
    ['owner_id', ownerFor(ctx, src.ownerId)],
  ];
  const byExt = extMap.get(src.id);
  let existing = byExt
    ? ((await db.prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?').get(byExt, userId)) as CrmContactRow | undefined)
    : undefined;
  let id: string;
  let deduped = false;
  let touch = true;
  if (existing && !ctx.plan.overwriteLocal && (await editedLocally(db, userId, ctx.provider, 'contact', src.id))) {
    const drop = { ...existing, ...Object.fromEntries(cols), custom: JSON.stringify({ ...custom, ...parseCustom(existing.custom) }) } as CrmContactRow;
    await updateRow(db, 'crm_contacts', existing.id, mergeFillPatch(existing, drop));
    id = existing.id;
    deduped = true;
    touch = false;
    keep(ctx);
  } else if (existing) {
    const merged = { ...parseCustom(existing.custom), ...custom };
    await updateRow(db, 'crm_contacts', existing.id, [...nonEmpty(cols), ['custom', JSON.stringify(merged)]]);
    id = existing.id;
    ctx.counts.updated++;
  } else {
    existing = email
      ? ((await db
          .prepare('SELECT * FROM crm_contacts WHERE user_id = ? AND lower(email) = ? ORDER BY created_at LIMIT 1')
          .get(userId, email)) as CrmContactRow | undefined)
      : undefined;
    if (existing) {
      const drop = { ...existing, ...Object.fromEntries(cols), custom: JSON.stringify(custom) } as CrmContactRow;
      await updateRow(db, 'crm_contacts', existing.id, mergeFillPatch(existing, drop));
      id = existing.id;
      deduped = true;
      ctx.counts.updated++;
    } else {
      id = crypto.randomUUID();
      await insertRow(db, 'crm_contacts', [
        ['id', id],
        ['user_id', userId],
        ...cols.map(([c, v]): [string, string | number | null] => [
          c,
          c === 'lifecycle_stage' ? v || 'lead' : c === 'lead_status' ? v || 'new' : v,
        ]),
        ['custom', JSON.stringify(custom)],
      ]);
      ctx.counts.created++;
    }
  }
  await extSet(db, userId, ctx.provider, 'contact', src.id, id, touch);
  extMap.set(src.id, id);

  // Empresas: la primaria del otro CRM queda primaria (salvo en un contacto que
  // ya existía con su primaria: ahí solo se suman como secundarias).
  const hasPrimary =
    deduped && !!(await db.prepare('SELECT 1 FROM crm_contact_companies WHERE contact_id = ? AND is_primary = 1').get(id));
  for (const c of src.companies) {
    const companyId = companyExt.get(c.id);
    if (!companyId) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO crm_contact_companies (contact_id, company_id, user_id, is_primary, label, created_at)
         VALUES (?, ?, ?, 0, '', ?)`,
      )
      .run(id, companyId, userId, nowDb());
    if (c.primary && !hasPrimary) {
      await db.prepare('UPDATE crm_contact_companies SET is_primary = 0 WHERE contact_id = ? AND company_id != ?').run(id, companyId);
      await db.prepare('UPDATE crm_contact_companies SET is_primary = 1 WHERE contact_id = ? AND company_id = ?').run(id, companyId);
    }
  }
  if (src.companies.length) await syncContactPrimary(id, db);
}

async function writeDeal(
  ctx: WriteCtx,
  src: SrcDeal,
  extMap: Map<string, string>,
  contactExt: Map<string, string>,
  companyExt: Map<string, string>,
) {
  const { db, userId } = ctx;
  const stage = ctx.plan.stages[src.stageId] ?? null;
  const target = stage ?? (ctx.plan.defaultStage ? { ...ctx.plan.defaultStage, won: false, lost: false } : null);
  if (!target) {
    ctx.counts.failed++;
    pushError(ctx, `deal ${src.id}: no pipeline to put it in`);
    return;
  }
  if (!stage) pushError(ctx, `deal ${src.id}: stage "${src.stageId}" not found, used the first stage`);
  const currency = /^[A-Z]{3}$/.test(src.currency) ? src.currency : ctx.baseCurrency;
  const closeDate = src.closeDate ? parseImportDate(src.closeDate) : null;
  const closedAt = target.won || target.lost ? (closeDate ? `${closeDate} 00:00:00` : nowDb()) : null;
  const custom = customValues(ctx, 'deals', src.custom, `deal ${src.id}`);
  const cols: Array<[string, string | number | null]> = [
    ['name', src.name.slice(0, 200) || 'Deal'],
    ['amount', src.amount !== null ? Math.max(src.amount, 0) : null],
    ['currency', currency],
    ['close_date', closeDate],
    ['description', src.description.slice(0, 5000)],
    ['lost_reason', target.lost ? src.lostReason.slice(0, 200) : ''],
    ['owner_id', ownerFor(ctx, src.ownerId)],
  ];
  const byExt = extMap.get(src.id);
  const existing = byExt
    ? ((await db.prepare('SELECT id, custom, stage_id FROM crm_deals WHERE id = ? AND user_id = ?').get(byExt, userId)) as
        | { id: string; custom: string; stage_id: string }
        | undefined)
    : undefined;
  let id: string;
  let touch = true;
  if (existing && !ctx.plan.overwriteLocal && (await editedLocally(db, userId, ctx.provider, 'deal', src.id))) {
    // Editado acá: etapa, monto y owner quedan como están; solo se suman los campos propios nuevos.
    const merged = { ...custom, ...parseCustom(existing.custom) };
    await updateRow(db, 'crm_deals', existing.id, [['custom', JSON.stringify(merged)]]);
    id = existing.id;
    touch = false;
    keep(ctx);
  } else if (existing) {
    const merged = { ...parseCustom(existing.custom), ...custom };
    const stageCols: Array<[string, string | number | null]> =
      existing.stage_id !== target.id
        ? [
            ['pipeline_id', target.pipelineId],
            ['stage_id', target.id],
            ['closed_at', closedAt],
          ]
        : [];
    await updateRow(db, 'crm_deals', existing.id, [...nonEmpty(cols), ...stageCols, ['custom', JSON.stringify(merged)]]);
    id = existing.id;
    ctx.counts.updated++;
  } else {
    id = crypto.randomUUID();
    const pos = (
      (await db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM crm_deals WHERE stage_id = ?').get(target.id)) as { m: number }
    ).m;
    await insertRow(db, 'crm_deals', [
      ['id', id],
      ['user_id', userId],
      ['pipeline_id', target.pipelineId],
      ['stage_id', target.id],
      ...cols.map(([c, v]): [string, string | number | null] => [c, c === 'amount' ? (v ?? 0) : c === 'description' || c === 'lost_reason' ? (v ?? '') : v]),
      ['position', pos + 1024],
      ['closed_at', closedAt],
      ['custom', JSON.stringify(custom)],
    ]);
    ctx.counts.created++;
  }
  await extSet(db, userId, ctx.provider, 'deal', src.id, id, touch);
  extMap.set(src.id, id);

  for (const cid of src.contactIds) {
    const contactId = contactExt.get(cid);
    if (contactId) await db.prepare('INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)').run(id, contactId);
  }
  for (const c of src.companies) {
    const companyId = companyExt.get(c.id);
    if (!companyId) continue;
    if (c.primary) await db.prepare('UPDATE crm_deal_companies SET is_primary = 0 WHERE deal_id = ? AND company_id != ?').run(id, companyId);
    await db
      .prepare(
        `INSERT INTO crm_deal_companies (deal_id, company_id, user_id, is_primary, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(deal_id, company_id) DO UPDATE SET is_primary = MAX(is_primary, excluded.is_primary)`,
      )
      .run(id, companyId, userId, c.primary ? 1 : 0, nowDb());
  }
  if (src.companies.length) await syncDealPrimary(id, db);
}

async function writeActivity(
  ctx: WriteCtx,
  src: SrcActivity,
  extMap: Map<string, string>,
  links: { contacts: Map<string, string>; companies: Map<string, string>; deals: Map<string, string> },
) {
  const { db, userId } = ctx;
  const contactId = src.contactIds.map((x) => links.contacts.get(x)).find(Boolean) ?? null;
  const companyId = src.companyIds.map((x) => links.companies.get(x)).find(Boolean) ?? null;
  const dealId = src.dealIds.map((x) => links.deals.get(x)).find(Boolean) ?? null;
  // Sin registro donde mostrarla, solo las tareas tienen sentido (van a la lista de tareas).
  if (!contactId && !companyId && !dealId && src.type !== 'task') {
    ctx.counts.skipped++;
    return;
  }
  const at = src.at || nowDb();
  const due = src.dueAt || null;
  const done = src.done ? 1 : 0;
  const cols: Array<[string, string | number | null]> = [
    ['owner_id', ownerFor(ctx, src.ownerId)],
    ['type', src.type],
    ['subject', src.subject.slice(0, 300)],
    ['body', src.body.slice(0, 20_000)],
    ['due_at', due],
    ['done', done],
    ['done_at', done ? at : null],
    ['direction', src.direction],
    ['outcome', src.outcome.slice(0, 60)],
    ['duration_min', src.durationMin],
    ['contact_id', contactId],
    ['company_id', companyId],
    ['deal_id', dealId],
  ];
  const byExt = extMap.get(src.id);
  const existing = byExt
    ? ((await db.prepare('SELECT id FROM crm_activities WHERE id = ? AND user_id = ?').get(byExt, userId)) as { id: string } | undefined)
    : undefined;
  let id: string;
  let touch = true;
  if (existing && !ctx.plan.overwriteLocal && (await editedLocally(db, userId, ctx.provider, 'activity', src.id))) {
    id = existing.id;
    touch = false;
    keep(ctx);
  } else if (existing) {
    await updateRow(db, 'crm_activities', existing.id, cols);
    id = existing.id;
    ctx.counts.updated++;
  } else {
    id = crypto.randomUUID();
    // Las tareas vencidas del otro CRM no disparan "tarea vencida" al entrar.
    const fired = src.type === 'task' && !done && due && due <= nowDb() ? nowDb() : null;
    await insertRow(db, 'crm_activities', [
      ['id', id],
      ['user_id', userId],
      ...cols,
      ['due_fired_at', fired],
      ['created_at', at],
      ['updated_at', at],
    ]);
    ctx.counts.created++;
  }
  await extSet(db, userId, ctx.provider, 'activity', src.id, id, touch);
}

/** Escribe una página en una transacción. Devuelve la cantidad procesada. */
async function writePage(
  job: JobRow,
  plan: Plan,
  phase: ImportPhase,
  items: SrcRecord[],
  counts: GroupCounts,
  errors: string[],
): Promise<void> {
  const userId = job.user_id;
  const provider = job.provider;
  const db0 = getDb();
  const defs = await listCustomFields(userId);
  const { baseCurrency } = await getCrmSettings(userId, db0);
  const obj = phase === 'companies' ? 'company' : phase === 'contacts' ? 'contact' : phase === 'deals' ? 'deal' : phase === 'lists' ? 'list' : 'activity';
  await ensureMigrated();
  const tx = await getClient().transaction('write');
  const db = txDb(tx);
  try {
    const ctx: WriteCtx = { db, userId, provider, plan, defs, baseCurrency, counts, errors };
    const extMap = await extLookup(db, userId, provider, obj, items.map((i) => i.id));
    const companyIds = items.flatMap((i) =>
      i.kind === 'contact' || i.kind === 'deal'
        ? i.companies.map((c) => c.id)
        : i.kind === 'activity'
          ? i.companyIds
          : i.kind === 'list' && i.entity === 'company'
            ? i.memberIds
            : [],
    );
    const contactIds = items.flatMap((i) =>
      i.kind === 'deal' || i.kind === 'activity' ? i.contactIds : i.kind === 'list' && i.entity === 'contact' ? i.memberIds : [],
    );
    const dealIds = items.flatMap((i) => (i.kind === 'activity' ? i.dealIds : []));
    const companyExt = await extLookup(db, userId, provider, 'company', companyIds);
    const contactExt = await extLookup(db, userId, provider, 'contact', contactIds);
    const dealExt = await extLookup(db, userId, provider, 'deal', dealIds);
    for (const item of items) {
      counts.processed++;
      try {
        if (item.kind === 'company') await writeCompany(ctx, item, extMap);
        else if (item.kind === 'contact') await writeContact(ctx, item, extMap, companyExt);
        else if (item.kind === 'deal') await writeDeal(ctx, item, extMap, contactExt, companyExt);
        else if (item.kind === 'list') await writeList(ctx, item, extMap, item.entity === 'contact' ? contactExt : companyExt);
        else await writeActivity(ctx, item, extMap, { contacts: contactExt, companies: companyExt, deals: dealExt });
      } catch (e) {
        counts.failed++;
        pushError(ctx, `${obj} ${item.id}: ${e instanceof CrmRefError ? e.code : 'write_failed'}`);
      }
    }
    await recordPendingOwners(ctx, obj, items, extMap);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/**
 * Lista de HubSpot → etiqueta (la misma de un import anterior o una con ese
 * nombre) puesta en los contactos o empresas ya importados que son miembros.
 */
async function writeList(ctx: WriteCtx, src: SrcList, extMap: Map<string, string>, members: Map<string, string>): Promise<void> {
  const { db, userId } = ctx;
  // Otro tramo de miembros de la misma lista: la lista ya se contó.
  const continuation = src.first === false;
  if (continuation) ctx.counts.processed--;
  let tagId = extMap.get(src.id) ?? null;
  if (tagId && !(await db.prepare('SELECT 1 AS one FROM crm_tags WHERE id = ? AND user_id = ?').get(tagId, userId))) tagId = null;
  tagId ??= ((await db.prepare('SELECT id FROM crm_tags WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, src.name)) as { id: string } | undefined)?.id ?? null;
  if (tagId) {
    if (!continuation) ctx.counts.updated++;
  } else {
    tagId = crypto.randomUUID();
    await db.prepare(`INSERT INTO crm_tags (id, user_id, name, color) VALUES (?, ?, ?, 'crm')`).run(tagId, userId, src.name);
    if (!continuation) ctx.counts.created++;
  }
  await extSet(db, userId, ctx.provider, 'list', src.id, tagId);
  let missing = 0;
  for (const m of src.memberIds) {
    const recordId = members.get(m);
    if (!recordId) {
      missing++;
      continue;
    }
    await db
      .prepare('INSERT OR IGNORE INTO crm_record_tags (tag_id, user_id, entity, record_id) VALUES (?, ?, ?, ?)')
      .run(tagId, userId, src.entity, recordId);
  }
  if (missing) pushError(ctx, `list ${src.name}: ${missing} members were not imported, skipped`);
}

/**
 * Registros de esta tanda cuyo owner ajeno no es miembro todavía: quedan
 * anotados (crm_import_pending_owners) para pasárselos cuando se una.
 */
async function recordPendingOwners(ctx: WriteCtx, obj: string, items: SrcRecord[], before: Map<string, string>): Promise<void> {
  const pending = ctx.plan.pendingOwners ?? {};
  if (obj === 'list' || !Object.keys(pending).length) return;
  const mine = items.filter((i) => i.kind !== 'list' && pending[(i as { ownerId: string }).ownerId]);
  if (!mine.length) return;
  const ext = await extLookup(ctx.db, ctx.userId, ctx.provider, obj, mine.map((i) => i.id));
  for (const i of mine) {
    const recordId = ext.get(i.id) ?? before.get(i.id);
    if (!recordId) continue;
    const ownerId = (i as { ownerId: string }).ownerId;
    await ctx.db
      .prepare(
        `INSERT INTO crm_import_pending_owners (workspace_id, email, provider, external_owner_id, entity, record_id, default_owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, entity, record_id) DO UPDATE SET email = excluded.email, external_owner_id = excluded.external_owner_id,
           default_owner_id = excluded.default_owner_id`,
      )
      .run(ctx.userId, pending[ownerId], ctx.provider, ownerId.slice(0, 64), obj, recordId, ctx.plan.defaultOwnerId);
  }
}

async function resolvePendingParents(job: JobRow, plan: Plan, errors: string[]): Promise<void> {
  if (!plan.pendingParents.length) return;
  const db = getDb();
  const parents = await extLookup(db, job.user_id, job.provider, 'company', plan.pendingParents.map(([, p]) => p));
  const ctx = { db, userId: job.user_id, errors } as unknown as WriteCtx;
  for (const [child, parentExt] of plan.pendingParents) {
    const parent = parents.get(parentExt);
    if (parent) await setParent(ctx, child, parent, parentExt);
    else errors.push(`company ${parentExt}: parent company not found in the import, skipped`);
  }
  plan.pendingParents = [];
}

// ---------- Corrida ----------

export interface RunStepOptions {
  /** Tiempo máximo de esta corrida (ms). */
  budgetMs?: number;
  /** Tope de páginas (tests: avanzar de a una). */
  maxPages?: number;
  /** Tamaño de página pedido a la fuente. */
  pageSize?: number;
}

export type RunStepResult = 'not_claimed' | 'progress' | 'done' | 'failed' | 'cancelled';

/**
 * Tramo de un POST .../run (pantalla de progreso abierta): corto y con
 * páginas chicas. La escritura en SQLite es sincrónica: un tramo largo sin
 * pausas dejaba al resto del servidor esperando (y a cancelar también). El
 * cron usa presupuestos más grandes.
 */
export const REQUEST_STEP_BUDGET_MS = 4_000;
export const REQUEST_PAGE_SIZE = 50;
/** Registros por transacción dentro de una página; entre tandas se cede el event loop. */
const WRITE_BATCH = 25;

const yieldToServer = () => new Promise<void>((r) => setImmediate(r));

/** Reclama el job: un solo proceso a la vez (cron y pantalla de progreso). */
async function claimJob(id: string, lockMs: number): Promise<JobRow | null> {
  const db = getDb();
  const now = nowDb();
  const res = await db
    .prepare(
      `UPDATE crm_import_jobs
       SET locked_until = ?, status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running') AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(nowDb(new Date(Date.now() + lockMs)), now, now, id, now);
  if (!res.changes) return null;
  return (await db.prepare('SELECT * FROM crm_import_jobs WHERE id = ?').get(id)) as JobRow;
}

async function finish(id: string, status: 'done' | 'failed', failure = ''): Promise<void> {
  await getDb()
    .prepare(
      `UPDATE crm_import_jobs SET status = ?, failure = ?, token = '', locked_until = NULL, finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(status, failure, nowDb(), nowDb(), id);
}

export async function runImportStep(id: string, opts: RunStepOptions = {}): Promise<RunStepResult> {
  const budgetMs = opts.budgetMs ?? 20_000;
  const deadline = Date.now() + budgetMs;
  const job = await claimJob(id, budgetMs + 120_000);
  if (!job) return 'not_claimed';
  const db = getDb();
  const token = open(job.token);
  if (!token) {
    await finish(id, 'failed', 'token_missing');
    return 'failed';
  }
  // Corre con el acceso de quien lo creó: si dejó de administrar el workspace, se corta.
  if (job.created_by !== job.user_id) {
    const { workspaceRole } = await import('./api-auth');
    const { isWorkspacePerson } = await import('./crm-refs');
    const role = (await isWorkspacePerson(job.user_id, job.created_by)) ? await workspaceRole(job.user_id, job.created_by) : null;
    if (role !== 'owner' && role !== 'admin') {
      await finish(id, 'failed', 'forbidden');
      return 'failed';
    }
  }
  const options = parseJson<ImportJobOptions>(job.options, { groups: [], ownerMap: {}, defaultOwnerId: job.created_by });
  const preview = parseJson<ImportPreview>(job.preview, { unavailable: [] } as unknown as ImportPreview);
  const counts = { ...emptyCounts(), ...parseJson<Partial<JobCounts>>(job.counts, {}) };
  const cursor = parseJson<Cursor>(job.cursor, { phase: 0, after: null });
  const errors = parseJson<string[]>(job.errors, []);
  let errorCount = job.error_count;
  const phases = jobPhases(job.provider, options, { ...preview, unavailable: preview.unavailable ?? [] });
  const source = sourceFactory(job.provider, token, { ownerEmail: await creatorEmail(job.created_by) });

  try {
    let plan = parseJson<Plan | null>(job.plan, null);
    if (!plan) {
      plan = await buildPlan(job, source, options);
      await db.prepare('UPDATE crm_import_jobs SET plan = ? WHERE id = ?').run(JSON.stringify(plan), id);
    }
    const running = async () =>
      ((await db.prepare('SELECT status FROM crm_import_jobs WHERE id = ?').get(id)) as { status: ImportJobStatus } | undefined)?.status ===
      'running';
    let pages = 0;
    while (cursor.phase < phases.length && Date.now() < deadline && pages < (opts.maxPages ?? Infinity)) {
      if (pages > 0) await yieldToServer();
      // Cancelar tiene efecto acá (entre páginas) y entre tandas de una página.
      if (!(await running())) return 'cancelled';
      const phase = phases[cursor.phase];
      const page = await source.page(phase, cursor.after, plan.fields, opts.pageSize ?? 100);
      const newErrors: string[] = [];
      for (let i = 0; i < page.items.length; i += WRITE_BATCH) {
        if (i > 0) {
          await yieldToServer();
          // Lo de esta página se rehace en la próxima corrida (se actualiza, no duplica).
          if (!(await running())) return 'cancelled';
        }
        await writePage(job, plan, phase, page.items.slice(i, i + WRITE_BATCH), counts[phaseGroup(phase)], newErrors);
      }
      cursor.after = page.next;
      if (!page.next) {
        if (phase === 'companies') await resolvePendingParents(job, plan, newErrors);
        cursor.phase++;
        cursor.after = null;
      }
      errorCount += newErrors.length;
      errors.push(...newErrors.slice(0, Math.max(0, MAX_ERRORS - errors.length)));
      pages++;
      // El cursor se guarda después de cada página: si la corrida se corta, la
      // próxima retoma desde acá (y la página repetida se actualiza, no duplica).
      await db
        .prepare(
          `UPDATE crm_import_jobs SET cursor = ?, counts = ?, errors = ?, error_count = ?, plan = ?, attempts = 0, failure = '', updated_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(JSON.stringify(cursor), JSON.stringify(counts), JSON.stringify(errors), errorCount, JSON.stringify(plan), nowDb(), id);
    }
    if (cursor.phase >= phases.length) {
      await finish(id, 'done');
      return 'done';
    }
    await db.prepare('UPDATE crm_import_jobs SET locked_until = NULL WHERE id = ?').run(id);
    return 'progress';
  } catch (e) {
    const code = e instanceof SourceError ? `${e.code}${e.status ? `_${e.status}` : ''}` : 'internal_error';
    if (isFatalSourceError(e) || job.attempts + 1 >= MAX_ATTEMPTS) {
      await finish(id, 'failed', code);
      return 'failed';
    }
    await db
      .prepare('UPDATE crm_import_jobs SET attempts = attempts + 1, failure = ?, locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(code, nowDb(), id);
    return 'progress';
  }
}

/**
 * Cron: descarta vistas previas viejas (y sus tokens) y avanza los jobs en
 * cola o corriendo con el presupuesto que queda.
 */
export async function processImportJobs(opts: { budgetMs?: number; limit?: number } = {}): Promise<{ jobs: number }> {
  const db = getDb();
  const start = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  // Vistas previas abandonadas: se borran (con su token), no quedan en el historial.
  await db
    .prepare(`DELETE FROM crm_import_jobs WHERE status = 'preview' AND created_at < ?`)
    .run(nowDb(new Date(Date.now() - PREVIEW_TTL_MIN * 60_000)));
  const rows = (await db
    .prepare(
      `SELECT id FROM crm_import_jobs WHERE status IN ('queued', 'running') AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(nowDb(), opts.limit ?? 5)) as Array<{ id: string }>;
  let jobs = 0;
  for (const r of rows) {
    const left = budget - (Date.now() - start);
    if (left < 3000) break;
    if ((await runImportStep(r.id, { budgetMs: left })) !== 'not_claimed') jobs++;
  }
  return { jobs };
}

/** Personas del workspace para la tabla de owners. */
export async function importPeople(userId: string): Promise<Person[]> {
  return workspacePeople(userId);
}

