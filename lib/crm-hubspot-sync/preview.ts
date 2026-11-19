/**
 * CRM ↔ HubSpot — vista previa de un sync ("qué pasaría"). Server-only.
 *
 * Lee HubSpot y el CRM y arma un informe. No escribe en HubSpot ni toca un
 * registro del CRM: lo único que guarda es su propia fila
 * (crm_hubspot_previews) y, mientras corre, su tabla de trabajo
 * (crm_hubspot_preview_rows), que se borra al terminar, fallar o cancelar.
 *
 * Corre por tramos, como el importador (lib/crm-import-jobs.ts): cada tramo
 * reclama la fila (compare-and-set de locked_until), avanza hasta agotar su
 * tiempo y guarda el cursor. La pantalla abierta empuja tramos
 * (POST /api/crm/hubspot-sync/preview/run) y /api/cron/minute la sigue si se
 * cierra. Hay una vista previa por workspace: arrancar otra reemplaza la
 * anterior.
 *
 * Etapas:
 * 1. schema: dueños, pipelines con etapas y propiedades de los tres objetos,
 *    contra las personas, pipelines y campos propios del workspace.
 * 2. Empresas del CRM con su dominio limpio (a la tabla de trabajo): el
 *    dominio se guarda como se escribió, así que la clave se calcula acá.
 * 3. contactos, empresas y negocios de HubSpot por fecha de modificación
 *    (lib/crm-hubspot-sync/reader.ts). Cada registro se anota con su clave
 *    (email o dominio), el registro nuestro que le corresponde y qué difiere.
 * 4. compare: lo que solo se sabe con todo leído (dos de HubSpot para uno
 *    nuestro, lo que solo está de este lado), los conteos y las muestras.
 *
 * Cómo se empareja:
 * - Primero lo ya vinculado: crm_hubspot_links (el sync) y crm_external_ids
 *   (lo que trajo el importador). Un id que HubSpot fusionó en otro cuenta
 *   como el que quedó (hs_merged_object_ids).
 * - Contactos: por email, con la misma expresión SQL de la regla de un
 *   contacto por email (lower(trim(email)), lib/crm-contact-email.ts) de los
 *   dos lados. También los emails secundarios de HubSpot.
 * - Empresas: por dominio limpio. HubSpot no deduplica dominios: dos empresas
 *   con el mismo quedan como ambiguas.
 * - Negocios: solo por vínculo existente (no hay una clave confiable).
 *
 * Límite diario de HubSpot: la vista previa queda en 'waiting' y se retoma
 * más tarde; no insiste.
 */
import { getDb, type Db } from '../db';
import { listCustomFields, listPipelinesWithStages } from '../crm';
import { emailKeySql } from '../crm-contact-email';
import { normalizeCompanyDomain } from '../crm-domain';
import { fieldNameFrom } from '../crm-import-source';
import { workspacePeople } from '../crm-import';
import { HubspotApiError, hubspotStatusError, type HubspotClient } from '../hubspot/client';
import { missingHubspotScopes } from '../hubspot/token';
import { SYNC_READ_SCOPES, openSyncConnection, syncHubspotClient } from './connection';
import {
  HS_READ_PROPS,
  LINK_OBJECT,
  LOCAL_COLUMNS,
  LOCAL_TABLES,
  STANDARD_FIELDS,
  ZEROSOFT_ONLY_FIELDS,
  additionalEmails,
  decodeDiff,
  diffRecord,
  encodeDiff,
  hubspotCompanyDomain,
  hubspotLabel,
  mergedIds,
  type ComparePlan,
  type LocalRow,
} from './fields';
import { START_CURSOR, readModifiedPage, type HsRecord, type ModifiedCursor } from './reader';
import {
  PREVIEW_ACTIVE,
  PREVIEW_LIST_MAX,
  PREVIEW_OBJECTS,
  PREVIEW_SAMPLE_SIZE,
  emptyCounts,
  type ObjectReport,
  type OwnersReport,
  type PipelinesReport,
  type PreviewBucket,
  type PreviewObject,
  type PreviewProgress,
  type PreviewReport,
  type PreviewSample,
  type PreviewStage,
  type PreviewStatus,
  type PreviewView,
  type PropertiesReport,
} from './types';

// ---------- Fila ----------

type Phase = 'schema' | 'local_companies' | 'contacts' | 'companies' | 'deals' | 'compare_contacts' | 'compare_companies' | 'compare_deals';
const PHASES: readonly Phase[] = ['schema', 'local_companies', 'contacts', 'companies', 'deals', 'compare_contacts', 'compare_companies', 'compare_deals'];

interface Cursor {
  phase: number;
  /** Lectura de HubSpot en curso. */
  read: ModifiedCursor;
  /** Lectura de empresas del CRM en curso (último id). */
  localAfter: string;
}

interface PreviewRow {
  id: string;
  user_id: string;
  created_by: string;
  portal_id: string;
  status: PreviewStatus;
  cursor: string;
  plan: string;
  progress: string;
  report: string;
  failure: string;
  attempts: number;
  locked_until: string | null;
  resume_after: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Fallas seguidas que se toleran antes de dar la vista previa por fallida. */
const MAX_ATTEMPTS = 8;
/** Cuánto se espera para volver a intentar después del límite diario de HubSpot. */
export const DAILY_RETRY_MS = 30 * 60_000;
/** Tramo de un POST .../run: corto, para que cancelar y el resto del servidor no esperen. */
export const REQUEST_STEP_BUDGET_MS = 6_000;
const LOCAL_PAGE = 500;
const ROW_COLUMNS = ['preview_id', 'side', 'object', 'ref_id', 'match_key', 'local_id', 'via', 'bucket', 'diff', 'newer', 'label', 'detail', 'modified_at'];

const iso = (d = new Date()) => d.toISOString();

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const emptyProgress = (): PreviewProgress => ({ stage: 'schema', objects: {} });
const startCursor = (): Cursor => ({ phase: 0, read: { ...START_CURSOR }, localAfter: '' });

function stageOf(phase: Phase | undefined): PreviewStage {
  if (phase === 'schema' || phase === 'local_companies') return 'schema';
  if (phase === 'contacts' || phase === 'companies' || phase === 'deals') return phase;
  return 'compare';
}

function toView(row: PreviewRow): PreviewView {
  const done = row.status === 'done';
  return {
    id: row.id,
    status: row.status,
    portalId: row.portal_id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    failure: row.failure,
    resumeAfter: row.status === 'waiting' ? row.resume_after : null,
    progress: { ...emptyProgress(), ...parseJson<Partial<PreviewProgress>>(row.progress, {}) },
    report: done ? parseJson<PreviewReport | null>(row.report, null) : null,
  };
}

async function rowOf(ws: string): Promise<PreviewRow | null> {
  return ((await getDb().prepare('SELECT * FROM crm_hubspot_previews WHERE user_id = ?').get(ws)) as PreviewRow | undefined) ?? null;
}

/** La vista previa del workspace (la última), o null. */
export async function getPreview(ws: string): Promise<PreviewView | null> {
  const row = await rowOf(ws);
  return row ? toView(row) : null;
}

async function dropRows(previewId: string): Promise<void> {
  await getDb().prepare('DELETE FROM crm_hubspot_preview_rows WHERE preview_id = ?').run(previewId);
}

export type StartResult = { ok: true; preview: PreviewView } | { ok: false; code: 'not_connected' | 'missing_scope'; missing?: string[] };

/** Arranca una vista previa nueva (reemplaza la anterior, corra o no). No lee nada todavía. */
export async function startPreview(ws: string, actor: string): Promise<StartResult> {
  const conn = await openSyncConnection(ws);
  if (!conn) return { ok: false, code: 'not_connected' };
  const missing = missingHubspotScopes(conn.scopes, SYNC_READ_SCOPES);
  if (missing.length) return { ok: false, code: 'missing_scope', missing };
  const db = getDb();
  const prev = await rowOf(ws);
  if (prev) await dropRows(prev.id);
  const now = iso();
  const id = crypto.randomUUID();
  // El id nuevo deja sin efecto a un tramo de la anterior que todavía esté corriendo (escribe con WHERE id = el viejo).
  await db
    .prepare(
      `INSERT INTO crm_hubspot_previews (id, user_id, created_by, portal_id, status, cursor, plan, progress, report, failure, attempts, locked_until, resume_after, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, '{}', '', 0, NULL, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, created_by = excluded.created_by, portal_id = excluded.portal_id, status = 'queued',
         cursor = excluded.cursor, plan = '{}', progress = excluded.progress, report = '{}', failure = '', attempts = 0, locked_until = NULL,
         resume_after = NULL, started_at = NULL, finished_at = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    )
    .run(id, ws, actor, conn.portalId, JSON.stringify(startCursor()), JSON.stringify(emptyProgress()), now, now);
  return { ok: true, preview: (await getPreview(ws))! };
}

/** Cancela la que esté corriendo o en espera y borra su tabla de trabajo. */
export async function cancelPreview(ws: string): Promise<boolean> {
  const row = await rowOf(ws);
  if (!row || !PREVIEW_ACTIVE.includes(row.status)) return false;
  const now = iso();
  const res = await getDb()
    .prepare(`UPDATE crm_hubspot_previews SET status = 'cancelled', locked_until = NULL, resume_after = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running', 'waiting')`)
    .run(now, now, row.id);
  await dropRows(row.id);
  return res.changes > 0;
}

// ---------- Tabla de trabajo ----------

interface WorkRow {
  side: 'hs' | 'alt' | 'local';
  object: string;
  refId: string;
  /** Email o dominio tal como vino: la clave la calcula SQLite (lower(trim())). */
  key: string;
  localId?: string;
  via?: string;
  bucket?: string;
  diff?: string;
  newer?: string;
  label?: string;
  detail?: string;
  modifiedAt?: string;
}

async function putRows(db: Db, previewId: string, rows: WorkRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await db
      .prepare(
        `INSERT OR REPLACE INTO crm_hubspot_preview_rows (${ROW_COLUMNS.join(', ')})
         VALUES ${chunk.map(() => '(?, ?, ?, ?, lower(trim(?)), ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      )
      .run(
        ...chunk.flatMap((r) => [previewId, r.side, r.object, r.refId, r.key, r.localId ?? '', r.via ?? '', r.bucket ?? '', r.diff ?? '', r.newer ?? '', r.label ?? '', r.detail ?? '', r.modifiedAt ?? '']),
      );
  }
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

async function inChunks<T>(values: string[], size: number, run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(values.filter(Boolean))];
  for (let i = 0; i < unique.length; i += size) out.push(...(await run(unique.slice(i, i + size))));
  return out;
}

// ---------- Etapa 1: dueños, pipelines y propiedades ----------

async function getAll<T>(client: HubspotClient, path: string): Promise<T[]> {
  const out: T[] = [];
  let after = '';
  for (let i = 0; i < 200; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await client.send(`${path}${sep}limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    const body = res.json() as { results?: T[]; paging?: { next?: { after?: string } } };
    out.push(...(body.results ?? []));
    after = body.paging?.next?.after ?? '';
    if (!after) break;
  }
  return out;
}

interface HsOwner {
  id: string | number;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface HsPipeline {
  id: string;
  label?: string;
  archived?: boolean;
  stages?: Array<{ id: string; label?: string; archived?: boolean }>;
}

interface HsProperty {
  name: string;
  label?: string;
  hubspotDefined?: boolean;
  calculated?: boolean;
  archived?: boolean;
  hidden?: boolean;
  modificationMetadata?: { readOnlyValue?: boolean };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function importerIds(ws: string, object: string): Promise<Map<string, string>> {
  const rows = (await getDb().prepare(`SELECT external_id, record_id FROM crm_external_ids WHERE user_id = ? AND provider = 'hubspot' AND object = ?`).all(ws, object)) as Array<{
    external_id: string;
    record_id: string;
  }>;
  return new Map(rows.map((r) => [r.external_id, r.record_id]));
}

async function schemaStep(ws: string, client: HubspotClient): Promise<{ plan: ComparePlan; report: PreviewReport }> {
  // Dueños: por email contra las personas del workspace.
  const [owners, archivedOwners, people] = await Promise.all([getAll<HsOwner>(client, '/crm/v3/owners'), getAll<HsOwner>(client, '/crm/v3/owners?archived=true'), workspacePeople(ws)]);
  const plan: ComparePlan = { owners: {}, stages: {} };
  const byEmail = new Map(people.map((p) => [p.email.trim().toLowerCase(), p]));
  const hubspotOnly: OwnersReport['hubspotOnly'] = [];
  const matchedEmails = new Set<string>();
  for (const o of owners) {
    const email = (o.email ?? '').trim().toLowerCase();
    const person = email ? byEmail.get(email) : undefined;
    if (person) {
      plan.owners[String(o.id)] = person.id;
      matchedEmails.add(email);
    } else hubspotOnly.push({ name: [o.firstName, o.lastName].filter(Boolean).join(' ').slice(0, 120), email: email.slice(0, 200) });
  }
  const zerosoftOnly = people.filter((p) => !matchedEmails.has(p.email.trim().toLowerCase())).map((p) => ({ name: p.name.slice(0, 120), email: p.email.slice(0, 200) }));
  const ownersReport: OwnersReport = {
    hubspot: owners.length,
    zerosoft: people.length,
    matched: matchedEmails.size,
    hubspotOnly: hubspotOnly.slice(0, PREVIEW_LIST_MAX),
    hubspotOnlyTotal: hubspotOnly.length,
    zerosoftOnly: zerosoftOnly.slice(0, PREVIEW_LIST_MAX),
    zerosoftOnlyTotal: zerosoftOnly.length,
    archived: archivedOwners.length,
  };

  // Pipelines y etapas: por lo que ya vinculó el importador y, si no, por nombre.
  const pipesRes = await client.send('/crm/v3/pipelines/deals', { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
  if (!pipesRes.ok) throw hubspotStatusError(pipesRes.status, pipesRes.path);
  const hsPipes = ((pipesRes.json() as { results?: HsPipeline[] }).results ?? []).filter((p) => !p.archived);
  const [ours, pipeIds, stageIds] = await Promise.all([listPipelinesWithStages(ws), importerIds(ws, 'pipeline'), importerIds(ws, 'stage')]);
  const usedPipes = new Set<string>();
  const usedStages = new Set<string>();
  const pipelines: PipelinesReport = { hubspot: [], zerosoftOnly: [], zerosoftOnlyStages: [], unmatchedStages: 0 };
  for (const hp of hsPipes) {
    const name = (hp.label ?? hp.id).slice(0, 120);
    const mine = ours.find((p) => p.id === pipeIds.get(hp.id)) ?? ours.find((p) => same(p.name, name));
    if (mine) usedPipes.add(mine.id);
    const stages = (hp.stages ?? [])
      .filter((s) => !s.archived)
      .map((s) => {
        const label = (s.label ?? s.id).slice(0, 120);
        const stage = mine ? (mine.stages.find((x) => x.id === stageIds.get(s.id)) ?? mine.stages.find((x) => same(x.name, label))) : undefined;
        if (stage) {
          plan.stages[s.id] = stage.id;
          usedStages.add(stage.id);
        } else pipelines.unmatchedStages++;
        return { name: label, matched: Boolean(stage) };
      });
    pipelines.hubspot.push({ name, match: mine ? mine.name : null, stages });
  }
  for (const p of ours) {
    if (!usedPipes.has(p.id)) pipelines.zerosoftOnly.push({ name: p.name, stages: p.stages.map((s) => s.name) });
    else for (const s of p.stages) if (!usedStages.has(s.id)) pipelines.zerosoftOnlyStages.push({ pipeline: p.name, stage: s.name });
  }
  pipelines.hubspot = pipelines.hubspot.slice(0, PREVIEW_LIST_MAX);
  pipelines.zerosoftOnly = pipelines.zerosoftOnly.slice(0, PREVIEW_LIST_MAX);
  pipelines.zerosoftOnlyStages = pipelines.zerosoftOnlyStages.slice(0, PREVIEW_LIST_MAX);

  // Propiedades: las estándar que el sync empareja y las propias de cada lado.
  const [fields, fieldIds] = await Promise.all([listCustomFields(ws), importerIds(ws, 'field')]);
  const properties: PreviewReport['properties'] = {};
  for (const object of PREVIEW_OBJECTS) {
    const res = await client.send(`/crm/v3/properties/${object}`, { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    const defs = ((res.json() as { results?: HsProperty[] }).results ?? []).filter((d) => !d.archived);
    const standard = STANDARD_FIELDS[object];
    const mapped = new Set(Object.values(standard));
    const mine = fields.filter((f) => f.entity === object);
    const used = new Set<string>();
    const hubspotOnlyProps: PropertiesReport['hubspotOnly'] = [];
    let customMatched = 0;
    let builtIn = 0;
    for (const d of defs) {
      if (mapped.has(d.name)) continue;
      // Como el importador: solo las propias de la cuenta se llevan a un campo propio.
      if (d.hubspotDefined || d.calculated || d.hidden) {
        builtIn++;
        continue;
      }
      const field = mine.find((f) => f.id === fieldIds.get(`${object}:${d.name}`)) ?? mine.find((f) => f.name === fieldNameFrom(d.name));
      if (field) {
        used.add(field.id);
        customMatched++;
      } else hubspotOnlyProps.push({ name: d.name, label: (d.label || d.name).slice(0, 120) });
    }
    const zerosoftOnlyFields = mine.filter((f) => !used.has(f.id)).map((f) => ({ name: f.name, label: f.label.slice(0, 120) }));
    properties[object] = {
      standard: Object.keys(standard),
      readOnlyInHubspot: Object.entries(standard)
        .filter(([, prop]) => defs.find((d) => d.name === prop)?.modificationMetadata?.readOnlyValue === true)
        .map(([field]) => field),
      customMatched,
      hubspotOnly: hubspotOnlyProps.slice(0, PREVIEW_LIST_MAX),
      hubspotOnlyTotal: hubspotOnlyProps.length,
      zerosoftOnly: zerosoftOnlyFields.slice(0, PREVIEW_LIST_MAX),
      zerosoftOnlyTotal: zerosoftOnlyFields.length,
      zerosoftStandardOnly: ZEROSOFT_ONLY_FIELDS[object],
      hubspotBuiltIn: builtIn,
    };
  }
  return { plan, report: { objects: {}, owners: ownersReport, pipelines, properties } };
}

// ---------- Etapa 2: empresas del CRM con su dominio limpio ----------

/** Devuelve el último id leído, o '' si no queda nada. */
async function localCompaniesStep(ws: string, previewId: string, after: string): Promise<string> {
  const db = getDb();
  const rows = (await db.prepare('SELECT id, domain FROM crm_companies WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?').all(ws, after, LOCAL_PAGE)) as Array<{ id: string; domain: string }>;
  await putRows(
    db,
    previewId,
    rows.map((r) => ({ side: 'local', object: 'company', refId: r.id, key: normalizeCompanyDomain(r.domain) })),
  );
  return rows.length === LOCAL_PAGE ? rows[rows.length - 1].id : '';
}

// ---------- Etapa 3: una página de HubSpot ----------

interface StepCtx {
  ws: string;
  previewId: string;
  portalId: string;
  plan: ComparePlan;
}

/** Vínculos de estos ids de HubSpot: primero los del sync, después los del importador. */
async function linksFor(ctx: StepCtx, object: PreviewObject, ids: string[]): Promise<Map<string, { localId: string; via: 'sync' | 'import' }>> {
  const db = getDb();
  const out = new Map<string, { localId: string; via: 'sync' | 'import' }>();
  const imported = await inChunks(ids, 400, async (chunk) =>
    (await db
      .prepare(`SELECT external_id AS hid, record_id AS id FROM crm_external_ids WHERE user_id = ? AND provider = 'hubspot' AND object = ? AND external_id IN (${marks(chunk.length)})`)
      .all(ctx.ws, LINK_OBJECT[object], ...chunk)) as Array<{ hid: string; id: string }>,
  );
  for (const r of imported) out.set(r.hid, { localId: r.id, via: 'import' });
  const synced = await inChunks(ids, 400, async (chunk) =>
    (await db
      .prepare(`SELECT hubspot_id AS hid, record_id AS id FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND hubspot_id IN (${marks(chunk.length)})`)
      .all(ctx.ws, ctx.portalId, LINK_OBJECT[object], ...chunk)) as Array<{ hid: string; id: string }>,
  );
  for (const r of synced) out.set(r.hid, { localId: r.id, via: 'sync' });
  return out;
}

async function localRows(ws: string, object: PreviewObject, ids: string[]): Promise<Map<string, LocalRow>> {
  const db = getDb();
  const rows = await inChunks(ids, 400, async (chunk) =>
    (await db.prepare(`SELECT ${LOCAL_COLUMNS[object].join(', ')} FROM ${LOCAL_TABLES[object]} WHERE user_id = ? AND id IN (${marks(chunk.length)})`).all(ws, ...chunk)) as LocalRow[],
  );
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** Para cada registro de HubSpot, los contactos nuestros con alguno de sus emails (comparación en SQL, de los dos lados igual). */
async function contactsByEmail(ws: string, pairs: Array<{ hid: string; email: string }>): Promise<Map<string, string[]>> {
  const db = getDb();
  const out = new Map<string, string[]>();
  for (let i = 0; i < pairs.length; i += 200) {
    const chunk = pairs.slice(i, i + 200);
    const rows = (await db
      .prepare(
        `WITH hs(hid, raw) AS (VALUES ${chunk.map(() => '(?, ?)').join(', ')})
         SELECT hs.hid AS hid, c.id AS id FROM hs
         JOIN crm_contacts c ON c.user_id = ? AND trim(c.email) != '' AND ${emailKeySql('c')} = lower(trim(hs.raw))`,
      )
      .all(...chunk.flatMap((p) => [p.hid, p.email]), ws)) as Array<{ hid: string; id: string }>;
    for (const r of rows) {
      const list = out.get(r.hid) ?? [];
      if (!list.includes(r.id)) list.push(r.id);
      out.set(r.hid, list);
    }
  }
  return out;
}

/** Empresas nuestras con ese dominio limpio (de la tabla de trabajo). */
async function companiesByDomain(previewId: string, domains: string[]): Promise<Map<string, string[]>> {
  const db = getDb();
  const rows = await inChunks(domains, 400, async (chunk) =>
    (await db
      .prepare(`SELECT match_key AS k, ref_id AS id FROM crm_hubspot_preview_rows WHERE preview_id = ? AND side = 'local' AND object = 'company' AND match_key IN (${marks(chunk.length)})`)
      .all(previewId, ...chunk)) as Array<{ k: string; id: string }>,
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.k, [...(out.get(r.k) ?? []), r.id]);
  return out;
}

function dbMs(raw: unknown): number {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return 0;
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : 0;
}

/** Anota una página de HubSpot en la tabla de trabajo. Solo lee del CRM. */
export async function classifyPage(ctx: StepCtx, object: PreviewObject, records: HsRecord[]): Promise<void> {
  if (!records.length) return;
  const db = getDb();
  const obj = LINK_OBJECT[object];
  const links = await linksFor(ctx, object, records.flatMap((r) => [r.id, ...mergedIds(r.properties)]));
  const linkOf = (r: HsRecord) => {
    const all = [r.id, ...mergedIds(r.properties)].map((id) => links.get(id)).filter((x): x is { localId: string; via: 'sync' | 'import' } => Boolean(x));
    return all.find((l) => l.via === 'sync') ?? all[0];
  };

  // Coincidencias por clave: email (contactos) o dominio (empresas). Los negocios no tienen.
  const keyOf = new Map<string, string>();
  let byKey = new Map<string, string[]>();
  const alt: WorkRow[] = [];
  if (object === 'contacts') {
    const pairs: Array<{ hid: string; email: string }> = [];
    for (const r of records) {
      const email = (r.properties.email ?? '').trim();
      const extra = additionalEmails(r.properties);
      keyOf.set(r.id, email || extra[0] || '');
      for (const e of [email, ...extra]) if (e) pairs.push({ hid: r.id, email: e });
      extra.forEach((e, n) => alt.push({ side: 'alt', object: obj, refId: `${r.id}:${n}`, key: e }));
    }
    byKey = await contactsByEmail(ctx.ws, pairs);
  } else if (object === 'companies') {
    for (const r of records) keyOf.set(r.id, hubspotCompanyDomain(r.properties));
    const byDomain = await companiesByDomain(ctx.previewId, [...keyOf.values()]);
    for (const r of records) {
      const hit = byDomain.get(keyOf.get(r.id) ?? '');
      if (hit) byKey.set(r.id, hit);
    }
  }

  const wanted = new Set<string>();
  for (const r of records) {
    const link = linkOf(r);
    if (link) wanted.add(link.localId);
    for (const id of byKey.get(r.id) ?? []) wanted.add(id);
  }
  const locals = await localRows(ctx.ws, object, [...wanted]);

  const rows: WorkRow[] = records.map((r) => {
    const link = linkOf(r);
    // Un vínculo a un registro que ya no existe de este lado no cuenta: se vuelve a emparejar por clave.
    const linked = link && locals.has(link.localId) ? link : undefined;
    const key = keyOf.get(r.id) ?? '';
    const matches = (byKey.get(r.id) ?? []).filter((id) => locals.has(id));
    let bucket: string;
    let localId = '';
    let via = '';
    if (linked) {
      localId = linked.localId;
      via = linked.via;
      // Vinculado a uno, pero su email es de otro contacto: no se decide solo.
      bucket = object === 'contacts' && matches.some((id) => id !== localId) ? 'conflict' : 'linked';
    } else if (object === 'deals') bucket = 'create_zerosoft';
    else if (!key) bucket = 'no_key_hubspot';
    else if (matches.length === 0) bucket = 'create_zerosoft';
    else if (matches.length === 1) {
      bucket = 'matched';
      localId = matches[0];
      via = object === 'contacts' ? 'email' : 'domain';
    } else bucket = 'multi_zerosoft';
    let diff = '';
    let newer = '';
    const local = localId ? locals.get(localId) : undefined;
    if (local && (bucket === 'linked' || bucket === 'matched')) {
      diff = encodeDiff(diffRecord(object, r.properties, local, ctx.plan));
      if (diff) {
        const mine = dbMs(local.updated_at);
        newer = r.modifiedMs && mine ? (r.modifiedMs > mine ? 'hubspot' : 'zerosoft') : '';
      }
    }
    return { side: 'hs', object: obj, refId: r.id, key, localId, via, bucket, diff, newer, ...hubspotLabel(object, r.properties, r.id), modifiedAt: r.modifiedMs ? new Date(r.modifiedMs).toISOString() : '' };
  });
  await putRows(db, ctx.previewId, [...rows, ...alt]);
}

// ---------- Etapa 4: lo que se sabe con todo leído ----------

const LOCAL_LABEL: Record<PreviewObject, { label: string; detail: string }> = {
  contacts: { label: `trim(c.first_name || ' ' || c.last_name)`, detail: 'c.email' },
  companies: { label: 'c.name', detail: 'c.domain' },
  deals: { label: 'c.name', detail: `CASE WHEN c.amount > 0 THEN trim(rtrim(rtrim(printf('%.2f', c.amount), '0'), '.') || ' ' || c.currency) ELSE '' END` },
};

/** Arma el informe de un objeto con SQL sobre la tabla de trabajo. No toca el CRM. */
export async function compareObject(ctx: StepCtx, object: PreviewObject): Promise<ObjectReport> {
  const db = getDb();
  const obj = LINK_OBJECT[object];
  const P = ctx.previewId;
  const T = 'crm_hubspot_preview_rows';

  // Dos registros de HubSpot ya vinculados al mismo nuestro (un import los juntó).
  await db
    .prepare(
      `UPDATE ${T} SET bucket = 'multi_hubspot' WHERE preview_id = ? AND side = 'hs' AND object = ? AND bucket = 'linked'
       AND local_id IN (SELECT local_id FROM ${T} WHERE preview_id = ? AND side = 'hs' AND object = ? AND bucket = 'linked' GROUP BY local_id HAVING COUNT(*) > 1)`,
    )
    .run(P, obj, P, obj);
  // Coincide por clave con uno nuestro que ya es de otro registro de HubSpot (o de varios).
  await db
    .prepare(
      `UPDATE ${T} SET bucket = 'multi_hubspot' WHERE preview_id = ? AND side = 'hs' AND object = ? AND bucket = 'matched'
       AND local_id IN (SELECT local_id FROM ${T} WHERE preview_id = ? AND side = 'hs' AND object = ? AND local_id != '' GROUP BY local_id HAVING COUNT(*) > 1)`,
    )
    .run(P, obj, P, obj);
  // Misma clave en varios registros de HubSpot que todavía no están vinculados (HubSpot no deduplica dominios).
  await db
    .prepare(
      `UPDATE ${T} SET bucket = 'multi_hubspot' WHERE preview_id = ? AND side = 'hs' AND object = ? AND match_key != '' AND bucket IN ('matched', 'create_zerosoft', 'multi_zerosoft')
       AND match_key IN (SELECT match_key FROM ${T} WHERE preview_id = ? AND side = 'hs' AND object = ? AND match_key != '' AND bucket IN ('matched', 'create_zerosoft', 'multi_zerosoft', 'multi_hubspot') GROUP BY match_key HAVING COUNT(*) > 1)`,
    )
    .run(P, obj, P, obj);

  const counts = emptyCounts();
  const grouped = (await db
    .prepare(
      `SELECT bucket, COUNT(*) AS n, SUM(CASE WHEN diff != '' THEN 1 ELSE 0 END) AS differ,
         SUM(CASE WHEN diff != '' AND substr(diff, 1, 1) != ';' THEN 1 ELSE 0 END) AS clash,
         SUM(CASE WHEN diff != '' AND newer = 'hubspot' THEN 1 ELSE 0 END) AS hs_newer,
         SUM(CASE WHEN diff != '' AND newer = 'zerosoft' THEN 1 ELSE 0 END) AS zs_newer
       FROM ${T} WHERE preview_id = ? AND side = 'hs' AND object = ? GROUP BY bucket`,
    )
    .all(P, obj)) as Array<{ bucket: string; n: number; differ: number; clash: number; hs_newer: number; zs_newer: number }>;
  let hubspot = 0;
  const update = { conflicting: 0, hubspotNewer: 0, zerosoftNewer: 0 };
  for (const g of grouped) {
    hubspot += Number(g.n);
    if (g.bucket in counts) counts[g.bucket as PreviewBucket] += Number(g.n);
    if (g.bucket === 'linked' || g.bucket === 'matched') {
      counts.update += Number(g.differ);
      update.conflicting += Number(g.clash);
      update.hubspotNewer += Number(g.hs_newer);
      update.zerosoftNewer += Number(g.zs_newer);
    }
  }

  // Lo nuestro que ningún registro de HubSpot reclamó.
  const table = LOCAL_TABLES[object];
  const linkedSql = `(EXISTS (SELECT 1 FROM crm_hubspot_links l WHERE l.user_id = c.user_id AND l.portal_id = ? AND l.object = ? AND l.record_id = c.id)
      OR EXISTS (SELECT 1 FROM crm_external_ids e WHERE e.user_id = c.user_id AND e.provider = 'hubspot' AND e.object = ? AND e.record_id = c.id))`;
  const linkedArgs = [ctx.portalId, obj, obj];
  let keySql = `''`;
  let join = '';
  const joinArgs: string[] = [];
  if (object === 'contacts') keySql = emailKeySql('c');
  if (object === 'companies') {
    join = `LEFT JOIN ${T} lk ON lk.preview_id = ? AND lk.side = 'local' AND lk.object = 'company' AND lk.ref_id = c.id`;
    joinArgs.push(P);
    keySql = `COALESCE(lk.match_key, '')`;
  }
  const bucketSql =
    object === 'deals'
      ? `CASE WHEN ${linkedSql} THEN 'gone_hubspot' ELSE 'create_hubspot' END`
      : `CASE WHEN ${linkedSql} THEN 'gone_hubspot'
           WHEN ${keySql} = '' THEN 'no_key_zerosoft'
           WHEN EXISTS (SELECT 1 FROM ${T} k WHERE k.preview_id = ? AND k.object = ? AND k.side IN ('hs', 'alt') AND k.match_key = ${keySql}) THEN 'duplicate_zerosoft'
           ELSE 'create_hubspot' END`;
  const bucketArgs = object === 'deals' ? linkedArgs : [...linkedArgs, P, obj];
  const localSql = `SELECT c.id AS id, ${LOCAL_LABEL[object].label} AS label, ${LOCAL_LABEL[object].detail} AS detail, ${bucketSql} AS b
     FROM ${table} c ${join}
     WHERE c.user_id = ? AND NOT EXISTS (SELECT 1 FROM ${T} r WHERE r.preview_id = ? AND r.side = 'hs' AND r.object = ? AND r.local_id = c.id AND r.local_id != '')`;
  const localArgs = [...bucketArgs, ...joinArgs, ctx.ws, P, obj];
  const localGroups = (await db.prepare(`SELECT b, COUNT(*) AS n FROM (${localSql}) GROUP BY b`).all(...localArgs)) as Array<{ b: string; n: number }>;
  for (const g of localGroups) if (g.b in counts) counts[g.b as PreviewBucket] += Number(g.n);
  const zerosoft = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(ctx.ws)) as { n: number }).n);

  // Muestras.
  const samples: ObjectReport['samples'] = {};
  const hsSample = async (bucket: PreviewBucket, where: string, args: string[]) => {
    if (!counts[bucket]) return;
    const rows = (await db
      .prepare(`SELECT ref_id, local_id, label, detail, diff, newer FROM ${T} WHERE preview_id = ? AND side = 'hs' AND object = ? AND ${where} ORDER BY ref_id LIMIT ${PREVIEW_SAMPLE_SIZE}`)
      .all(P, obj, ...args)) as Array<{ ref_id: string; local_id: string; label: string; detail: string; diff: string; newer: string }>;
    samples[bucket] = rows.map((r): PreviewSample => {
      const base: PreviewSample = { label: r.label, detail: r.detail, hubspotId: r.ref_id, ...(r.local_id ? { zerosoftId: r.local_id } : {}) };
      if (bucket !== 'update') return base;
      const d = decodeDiff(r.diff);
      return { ...base, conflicting: d.conflicting, filling: d.filling, newer: r.newer === 'hubspot' || r.newer === 'zerosoft' ? r.newer : '' };
    });
  };
  for (const b of ['linked', 'matched', 'create_zerosoft', 'no_key_hubspot', 'multi_zerosoft', 'multi_hubspot', 'conflict'] as const) await hsSample(b, 'bucket = ?', [b]);
  await hsSample('update', `bucket IN ('linked', 'matched') AND diff != ''`, []);
  for (const b of ['create_hubspot', 'no_key_zerosoft', 'duplicate_zerosoft', 'gone_hubspot'] as const) {
    if (!counts[b]) continue;
    const rows = (await db.prepare(`SELECT id, label, detail FROM (${localSql}) WHERE b = ? ORDER BY id LIMIT ${PREVIEW_SAMPLE_SIZE}`).all(...localArgs, b)) as Array<{ id: string; label: string | null; detail: string | null }>;
    samples[b] = rows.map((r) => ({ label: (r.label || r.detail || '').slice(0, 160), detail: r.label ? (r.detail ?? '').slice(0, 200) : '', zerosoftId: r.id }));
  }
  return { hubspot, zerosoft, counts, update, samples };
}

// ---------- Corrida ----------

export interface RunStepOptions {
  budgetMs?: number;
  /** Tope de páginas de HubSpot o de tandas (tests: avanzar de a una). */
  maxPages?: number;
  /** Registros por página de HubSpot (1 a 200). */
  pageSize?: number;
}

export type RunStepResult = 'not_claimed' | 'progress' | 'waiting' | 'done' | 'failed' | 'cancelled';

async function claim(ws: string, lockMs: number): Promise<PreviewRow | null> {
  const db = getDb();
  const now = iso();
  const res = await db
    .prepare(
      `UPDATE crm_hubspot_previews SET locked_until = ?, status = 'running', resume_after = NULL, started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE user_id = ? AND status IN ('queued', 'running', 'waiting') AND (locked_until IS NULL OR locked_until < ?) AND (resume_after IS NULL OR resume_after <= ?)`,
    )
    .run(iso(new Date(Date.now() + lockMs)), now, now, ws, now, now);
  if (!res.changes) return null;
  return rowOf(ws);
}

async function fail(id: string, code: string): Promise<'failed'> {
  const now = iso();
  await getDb().prepare(`UPDATE crm_hubspot_previews SET status = 'failed', failure = ?, locked_until = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'`).run(code, now, now, id);
  await dropRows(id);
  return 'failed';
}

/** Quien la arrancó tiene que seguir siendo admin del workspace: el informe muestra registros de todos. */
async function creatorStillAdmin(row: PreviewRow): Promise<boolean> {
  if (row.created_by === row.user_id) return true;
  const { workspaceRole } = await import('../api-auth');
  const { isWorkspacePerson } = await import('../crm-refs');
  if (!(await isWorkspacePerson(row.user_id, row.created_by))) return false;
  const role = await workspaceRole(row.user_id, row.created_by);
  return role === 'owner' || role === 'admin';
}

/**
 * Un tramo. Lo llaman la pantalla abierta y el cron; un solo proceso a la vez
 * por workspace. Devuelve en qué quedó.
 */
export async function runPreviewStep(ws: string, opts: RunStepOptions = {}): Promise<RunStepResult> {
  const budgetMs = opts.budgetMs ?? 20_000;
  const deadline = Date.now() + budgetMs;
  const job = await claim(ws, budgetMs + 60_000);
  if (!job) return 'not_claimed';
  const db = getDb();
  const id = job.id;
  const conn = await openSyncConnection(ws);
  if (!conn) return fail(id, 'not_connected');
  if (conn.portalId !== job.portal_id) return fail(id, 'portal_changed');
  if (!(await creatorStillAdmin(job))) return fail(id, 'forbidden');

  const cursor = { ...startCursor(), ...parseJson<Partial<Cursor>>(job.cursor, {}) };
  let plan = parseJson<ComparePlan>(job.plan, { owners: {}, stages: {} });
  const progress: PreviewProgress = { ...emptyProgress(), ...parseJson<Partial<PreviewProgress>>(job.progress, {}) };
  const report = parseJson<PreviewReport>(job.report, { objects: {} });
  report.objects ??= {};
  const client = syncHubspotClient(conn.token, { portalId: conn.portalId, maxWaitMs: 3_000 });
  const ctx: StepCtx = { ws, previewId: id, portalId: conn.portalId, plan };
  const running = async () => ((await db.prepare('SELECT status FROM crm_hubspot_previews WHERE id = ?').get(id)) as { status: string } | undefined)?.status === 'running';
  // Cancelada o reemplazada por otra mientras este tramo corría: lo que haya anotado se borra (ese id ya no corre más).
  const stopped = async (): Promise<'cancelled'> => {
    await dropRows(id);
    return 'cancelled';
  };
  const save = async () => {
    progress.stage = stageOf(PHASES[cursor.phase]);
    await db
      .prepare(`UPDATE crm_hubspot_previews SET cursor = ?, plan = ?, progress = ?, report = ?, attempts = 0, failure = '', updated_at = ? WHERE id = ? AND status = 'running'`)
      .run(JSON.stringify(cursor), JSON.stringify(plan), JSON.stringify(progress), JSON.stringify(report), iso(), id);
  };

  try {
    let pages = 0;
    while (cursor.phase < PHASES.length && Date.now() < deadline && pages < (opts.maxPages ?? Infinity)) {
      if (pages > 0) await new Promise<void>((r) => setImmediate(r));
      // Cancelar (o una vista previa nueva) tiene efecto acá, entre páginas.
      if (!(await running())) return stopped();
      const phase = PHASES[cursor.phase];
      if (phase === 'schema') {
        const out = await schemaStep(ws, client);
        plan = out.plan;
        ctx.plan = plan;
        Object.assign(report, out.report, { objects: report.objects });
        cursor.phase++;
      } else if (phase === 'local_companies') {
        cursor.localAfter = await localCompaniesStep(ws, id, cursor.localAfter);
        if (!cursor.localAfter) cursor.phase++;
      } else if (phase === 'contacts' || phase === 'companies' || phase === 'deals') {
        const page = await readModifiedPage(client, phase, cursor.read, HS_READ_PROPS[phase], { limit: opts.pageSize ?? 100 });
        if (!(await running())) return stopped();
        await classifyPage(ctx, phase, page.records);
        const seen = progress.objects[phase] ?? { read: 0, total: null };
        // El total lo dice la primera consulta (sin filtro de fecha); las siguientes repiten el borde.
        if (cursor.read.since === 0 && !cursor.read.tie && page.total !== null) seen.total = page.total;
        seen.read = seen.total === null ? seen.read + page.records.length : Math.min(seen.total, seen.read + page.records.length);
        progress.objects[phase] = seen;
        if (page.next) cursor.read = page.next;
        else {
          const n = (await db.prepare(`SELECT COUNT(*) AS n FROM crm_hubspot_preview_rows WHERE preview_id = ? AND side = 'hs' AND object = ?`).get(id, LINK_OBJECT[phase])) as { n: number };
          progress.objects[phase] = { read: Number(n.n), total: Number(n.n) };
          cursor.read = { ...START_CURSOR };
          cursor.phase++;
        }
      } else {
        const object = phase.replace('compare_', '') as PreviewObject;
        report.objects[object] = await compareObject(ctx, object);
        cursor.phase++;
      }
      pages++;
      await save();
    }
    if (cursor.phase >= PHASES.length) {
      const now = iso();
      const res = await db
        .prepare(`UPDATE crm_hubspot_previews SET status = 'done', locked_until = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'`)
        .run(now, now, id);
      await dropRows(id);
      return res.changes ? 'done' : 'cancelled';
    }
    await db.prepare('UPDATE crm_hubspot_previews SET locked_until = NULL WHERE id = ?').run(id);
    // Si la cancelaron justo después de la última página, esa página no queda guardada.
    if (!(await running())) return stopped();
    return 'progress';
  } catch (err) {
    const api = err instanceof HubspotApiError ? err : null;
    const now = iso();
    // Límite diario de la cuenta: no se insiste. Se retoma más tarde con lo ya leído.
    if (api?.code === 'rate_limited' && api.policy === 'daily') {
      await db
        .prepare(`UPDATE crm_hubspot_previews SET status = 'waiting', failure = 'daily_limit', resume_after = ?, locked_until = NULL, updated_at = ? WHERE id = ? AND status = 'running'`)
        .run(iso(new Date(Date.now() + DAILY_RETRY_MS)), now, id);
      return 'waiting';
    }
    if (api?.code === 'auth') return fail(id, 'invalid_token');
    if (api?.code === 'scope') return fail(id, 'missing_scope');
    const code = api ? (api.code === 'rate_limited' ? 'hubspot_busy' : api.code === 'network' ? 'network' : 'provider_error') : 'internal_error';
    // La ráfaga de HubSpot afloja sola: no gasta intentos.
    const spend = api?.code === 'rate_limited' || api?.code === 'locked' ? 0 : 1;
    if (job.attempts + spend >= MAX_ATTEMPTS) return fail(id, code);
    await db.prepare('UPDATE crm_hubspot_previews SET attempts = attempts + ?, failure = ?, locked_until = NULL, updated_at = ? WHERE id = ?').run(spend, code, now, id);
    return 'progress';
  }
}

/**
 * Cron: avanza las vistas previas en curso con el tiempo que queda y limpia
 * filas de trabajo que quedaron sin su vista previa.
 */
export async function processHubspotPreviews(opts: { budgetMs?: number; limit?: number } = {}): Promise<{ previews: number }> {
  const db = getDb();
  const start = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const now = iso();
  const rows = (await db
    .prepare(
      `SELECT user_id FROM crm_hubspot_previews WHERE status IN ('queued', 'running', 'waiting') AND (locked_until IS NULL OR locked_until < ?) AND (resume_after IS NULL OR resume_after <= ?)
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(now, now, opts.limit ?? 3)) as Array<{ user_id: string }>;
  let previews = 0;
  for (const r of rows) {
    const left = budget - (Date.now() - start);
    if (left < 3_000) break;
    if ((await runPreviewStep(r.user_id, { budgetMs: left })) !== 'not_claimed') previews++;
  }
  await sweepOrphanRows();
  return { previews };
}

/**
 * Borra filas de trabajo de vistas previas que ya no existen (un proceso que
 * murió a mitad de un tramo). No recorre la tabla: busca el siguiente
 * preview_id por el índice, así que cuesta una búsqueda por vista previa.
 */
export async function sweepOrphanRows(): Promise<number> {
  const db = getDb();
  let last = '';
  let removed = 0;
  for (let i = 0; i < 50; i++) {
    const row = (await db.prepare('SELECT MIN(preview_id) AS id FROM crm_hubspot_preview_rows WHERE preview_id > ?').get(last)) as { id: string | null } | undefined;
    if (!row?.id) break;
    last = row.id;
    const alive = await db.prepare('SELECT 1 AS x FROM crm_hubspot_previews WHERE id = ?').get(last);
    if (!alive) removed += (await db.prepare('DELETE FROM crm_hubspot_preview_rows WHERE preview_id = ?').run(last)).changes;
  }
  return removed;
}
