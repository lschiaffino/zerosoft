/**
 * CRM ↔ HubSpot, bloque S2: HubSpot → zerosoft. Server-only.
 *
 * Trae empresas, contactos, negocios (con pipelines y etapas) y notas,
 * llamadas, reuniones, tareas y emails a la actividad del CRM, y los mantiene
 * al día. No escribe en HubSpot y no borra nada acá.
 *
 * Arranca apagado: corre solo después de que un admin lo arranca
 * (crm_hubspot_sync_settings.enabled) y mientras no esté pausado
 * (syncGate, que también mira el freno global CRM_HUBSPOT_SYNC_DISABLED).
 *
 * Cómo corre: por tramos, desde /api/cron/minute (y la pantalla abierta empuja
 * tramos mientras trae todo la primera vez). Cada tramo reclama la fila del
 * workspace (compare-and-set de locked_until) y lee por objeto, en orden
 * (empresas, contactos, negocios, actividades), páginas de la búsqueda de
 * HubSpot ordenadas por fecha de modificación (lib/crm-hubspot-sync/reader.ts).
 * Cada página se escribe en una transacción junto con su cursor: si el
 * proceso muere a mitad, la página se vuelve a leer y, como cada registro va
 * por su vínculo, nada se duplica.
 *
 * Primera vuelta = traer todo (cursor desde 0). Cuando todos los objetos
 * llegan al final, la vuelta siguiente arranca 3 minutos antes del registro
 * más nuevo visto (el índice de búsqueda de HubSpot tarda en ponerse al día);
 * lo que se relee y no cambió se saltea por su fecha de modificación.
 *
 * Identidad: crm_hubspot_links (un registro nuestro ↔ uno de HubSpot, por
 * cuenta). Para un registro sin vínculo se busca, en orden: un vínculo del
 * importador (crm_external_ids), un contacto con el mismo email (o uno de
 * los secundarios de HubSpot), una empresa con el mismo dominio (solo si hay
 * una y no está vinculada a otro). Los negocios no se emparejan por nombre.
 * Si nada coincide, se crea.
 *
 * Qué valor queda: lib/crm-hubspot-sync/inbound-map.ts (resolve). HubSpot
 * gana en lo que no se tocó acá desde el último sync; si cambió de los dos
 * lados, queda lo nuestro y se anota el conflicto (solo nombres de campos).
 *
 * Archivados en HubSpot: cada 15 minutos se listan y su vínculo queda
 * 'archived'; el registro nuestro no se toca. Si reaparece, vuelve a
 * 'linked'. Fusionados: el vínculo del que desapareció pasa al que quedó; si
 * los dos estaban vinculados a registros distintos, se anota para fusionarlos
 * a mano. Un registro vinculado que se borró acá no se vuelve a crear.
 *
 * Dueños: por email contra las personas del workspace (owner y equipo). Un
 * dueño sin persona queda sin asignar (lo ve quien ve los registros sin dueño,
 * como cualquier registro del workspace).
 *
 * Límites de HubSpot: el cliente compartido espera y reintenta los 429 de
 * ráfaga; si no afloja, el tramo corta y la vuelta siguiente espera cada vez
 * más (1, 2, 4… hasta 30 minutos). El límite diario espera 30 minutos.
 *
 * Nada de esto loguea: los errores quedan como códigos (sin datos) en la fila.
 */
import { getClient, getDb, txDb, type CrmCustomFieldRow, type Db } from '../db';
import { listCustomFields, listPipelinesWithStages, createPipeline, parseCustom } from '../crm';
import { syncContactPrimary, syncDealPrimary, setParentCompany } from '../crm-assoc';
import { getCrmSettings } from '../crm-currency';
import { findContactByEmail, emailFreeSql } from '../crm-contact-email';
import { normalizeCompanyDomain } from '../crm-domain';
import { workspacePeople } from '../crm-import';
import { hubspotFieldType } from '../crm-import-hubspot';
import { fieldNameFrom } from '../crm-import-source';
import { HubspotApiError, hubspotStatusError, type HubspotClient } from '../hubspot/client';
import { missingHubspotScopes } from '../hubspot/token';
import { SYNC_READ_SCOPES, getSyncSettings, isBlockingConnectionError, markConnectionError, openSyncConnection, syncGate, syncHubspotClient } from './connection';
import { LINK_OBJECT, mergedIds } from './fields';
import {
  INBOUND_ASSOC,
  INBOUND_FIELDS,
  INBOUND_OBJECTS,
  INBOUND_PROPS,
  emptyPlan,
  contactEmails,
  isActivityObject,
  localCustom,
  localValues,
  mapActivity,
  mapCustom,
  mapRecord,
  resolve,
  type InboundObject,
  type InboundPlan,
  type PlanField,
  type Values,
} from './inbound-map';
import { emptyInboundCounts, type InboundCounts, type InboundErrorEntry, type InboundObjectName, type InboundState, type InboundView } from './inbound-types';
import { START_CURSOR, readModifiedPage, type ActivityObject, type HsRecord, type ModifiedCursor, type SyncObject } from './reader';

// ---------- Constantes ----------

/** Cada cuánto se busca lo que cambió en HubSpot. */
export const LIVE_INTERVAL_MS = 60_000;
/** Margen hacia atrás de cada vuelta: el índice de búsqueda de HubSpot tarda en incluir lo recién cambiado. */
export const OVERLAP_MS = 3 * 60_000;
/** Cada cuánto se renuevan dueños, pipelines y campos propios. */
export const PLAN_TTL_MS = 10 * 60_000;
/** Cada cuánto se listan los archivados de HubSpot. */
export const SWEEP_INTERVAL_MS = 15 * 60_000;
/** Espera ante el límite diario de HubSpot. */
export const DAILY_WAIT_MS = 30 * 60_000;
/** Espera tras una vuelta fallida: 1 minuto, el doble cada vez, hasta 30. */
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;
/** Tramo de un POST .../inbound/run: corto, para no tener al servidor ocupado. */
export const REQUEST_STEP_BUDGET_MS = 6_000;
/** Registros por página de HubSpot. */
export const PAGE_SIZE = 100;
const MAX_ERRORS = 20;
const SYNC_OBJECTS: readonly SyncObject[] = ['companies', 'contacts', 'deals'];

const iso = (d = new Date()) => d.toISOString();
const nowDb = () => iso().slice(0, 19).replace('T', ' ');

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------- Fila ----------

interface ObjectCursor {
  read: ModifiedCursor;
  /** Fecha de modificación más nueva vista (ms). */
  hw: number;
  /** Esta vuelta ya llegó al final. */
  done: boolean;
  /** Llegó al final al menos una vez. */
  caughtUp: boolean;
  readCount: number;
  total: number | null;
  error: string;
  /** Un registro no se pudo guardar: la vuelta siguiente relee desde su fecha (hasta 3 veces seguidas). */
  retryFrom?: number;
  retries?: number;
}

interface Cursors {
  objects: Partial<Record<InboundObject, ObjectCursor>>;
  /** Barrido de archivados en curso: objeto y página. */
  sweep: { i: number; after: string } | null;
}

interface InboundRow {
  user_id: string;
  portal_id: string;
  status: string;
  objects: string;
  cursors: string;
  plan: string;
  plan_at: string | null;
  counts: string;
  errors: string;
  failure: string;
  attempts: number;
  locked_until: string | null;
  next_run_at: string | null;
  sweep_at: string | null;
  started_by: string;
  started_at: string | null;
  initial_done_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
}

type Toggles = Record<InboundObject, boolean>;
type Counts = Partial<Record<InboundObject, InboundCounts>>;

const freshCursor = (): ObjectCursor => ({ read: { ...START_CURSOR }, hw: 0, done: false, caughtUp: false, readCount: 0, total: null, error: '' });

function defaultToggles(scopes: string[]): Toggles {
  const t = Object.fromEntries(INBOUND_OBJECTS.map((o) => [o, true])) as Toggles;
  // Los emails registrados piden un permiso aparte: sin él, arrancan apagados.
  t.emails = scopes.includes('sales-email-read');
  return t;
}

function toggles(raw: string): Toggles {
  const saved = parseJson<Partial<Toggles>>(raw, {});
  return Object.fromEntries(INBOUND_OBJECTS.map((o) => [o, saved[o] !== false])) as Toggles;
}

async function rowOf(ws: string, db: Db = getDb()): Promise<InboundRow | null> {
  return ((await db.prepare('SELECT * FROM crm_hubspot_inbound WHERE user_id = ?').get(ws)) as InboundRow | undefined) ?? null;
}

// ---------- Vista ----------

async function linkedCounts(ws: string, portalId: string): Promise<InboundView['linked']> {
  const rows = (await getDb()
    .prepare('SELECT object, state, COUNT(*) AS n FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? GROUP BY object, state')
    .all(ws, portalId)) as Array<{ object: string; state: string; n: number }>;
  const out = { companies: 0, contacts: 0, deals: 0, activities: 0, archived: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.state === 'archived') out.archived += n;
    if (r.state !== 'linked') continue;
    if (r.object === 'company') out.companies += n;
    else if (r.object === 'contact') out.contacts += n;
    else if (r.object === 'deal') out.deals += n;
    else if (r.object === 'activity') out.activities += n;
  }
  return out;
}

/** El estado de la entrada para la pantalla (solo conteos y códigos). */
export async function getInbound(ws: string): Promise<InboundView> {
  const [row, settings, conn] = await Promise.all([rowOf(ws), getSyncSettings(ws), openSyncConnection(ws)]);
  const scopes = conn?.scopes ?? [];
  const objects = row ? toggles(row.objects) : defaultToggles(scopes);
  const cursors = parseJson<Cursors>(row?.cursors, { objects: {}, sweep: null });
  const progress: InboundView['progress'] = {};
  for (const o of INBOUND_OBJECTS) {
    const c = cursors.objects?.[o];
    if (c) progress[o] = { read: c.readCount, total: c.total, caughtUp: c.caughtUp, error: c.error };
  }
  let state: InboundState = 'off';
  if (row && settings.enabled) {
    if (!conn || isBlockingConnectionError(conn.lastError) || row.failure === 'invalid_token' || row.failure === 'portal_changed') state = 'blocked';
    else if (settings.paused) state = 'paused';
    else if (row.failure === 'daily_limit') state = 'waiting';
    else if (row.failure) state = 'retrying';
    else state = row.initial_done_at ? 'live' : 'initial';
  }
  const conflicts = row
    ? Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_hubspot_sync_conflicts WHERE user_id = ?').get(ws)) as { n: number }).n)
    : 0;
  return {
    state,
    started: Boolean(row),
    objects,
    progress,
    counts: parseJson<Counts>(row?.counts, {}),
    linked: row ? await linkedCounts(ws, row.portal_id) : { companies: 0, contacts: 0, deals: 0, activities: 0, archived: 0 },
    conflicts,
    errors: parseJson<InboundErrorEntry[]>(row?.errors, []),
    failure: row?.failure ?? '',
    startedAt: row?.started_at ?? null,
    initialDoneAt: row?.initial_done_at ?? null,
    lastRunAt: row?.last_run_at ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    emailScopeMissing: Boolean(conn) && !scopes.includes('sales-email-read'),
  };
}

// ---------- Arrancar, pausar, objetos ----------

export type InboundActionResult = { ok: true; inbound: InboundView } | { ok: false; code: 'not_connected' | 'missing_scope' | 'portal_changed' | 'key_invalid' | 'not_started'; missing?: string[] };

/**
 * Arranca (o retoma) la entrada. Valida la conexión, prende el sync y deja la
 * fila lista para el próximo tramo. Si ya se había arrancado con esta cuenta,
 * sigue desde sus cursores (nada se vuelve a crear: los vínculos quedan).
 */
export async function startInbound(ws: string, actor: string, objects?: Partial<Record<InboundObjectName, boolean>>): Promise<InboundActionResult> {
  const conn = await openSyncConnection(ws);
  if (!conn) return { ok: false, code: 'not_connected' };
  if (isBlockingConnectionError(conn.lastError)) return { ok: false, code: conn.lastError === 'portal_changed' ? 'portal_changed' : 'key_invalid' };
  const missing = missingHubspotScopes(conn.scopes, SYNC_READ_SCOPES);
  if (missing.length) return { ok: false, code: 'missing_scope', missing };
  const db = getDb();
  const now = iso();
  const prev = await rowOf(ws);
  const base = prev && prev.portal_id === conn.portalId ? toggles(prev.objects) : defaultToggles(conn.scopes);
  const chosen = { ...base, ...pickToggles(objects) };
  if (prev && prev.portal_id === conn.portalId) {
    await db
      .prepare(
        `UPDATE crm_hubspot_inbound SET objects = ?, failure = '', attempts = 0, next_run_at = ?, started_by = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE user_id = ?`,
      )
      .run(JSON.stringify(chosen), now, actor, now, now, ws);
  } else {
    // Primera vez, u otra cuenta de HubSpot: los cursores y el plan de la anterior no sirven.
    await db
      .prepare(
        `INSERT INTO crm_hubspot_inbound (user_id, portal_id, status, objects, cursors, plan, plan_at, counts, errors, failure, attempts, locked_until, next_run_at, sweep_at, started_by, started_at, initial_done_at, last_run_at, last_success_at, created_at, updated_at)
         VALUES (?, ?, 'initial', ?, '{}', '{}', NULL, '{}', '[]', '', 0, NULL, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET portal_id = excluded.portal_id, status = 'initial', objects = excluded.objects, cursors = '{}', plan = '{}', plan_at = NULL,
           counts = '{}', errors = '[]', failure = '', attempts = 0, locked_until = NULL, next_run_at = excluded.next_run_at, sweep_at = NULL, started_by = excluded.started_by,
           started_at = excluded.started_at, initial_done_at = NULL, last_run_at = NULL, last_success_at = NULL, updated_at = excluded.updated_at`,
      )
      .run(ws, conn.portalId, JSON.stringify(chosen), now, actor, now, now, now);
  }
  await db
    .prepare(
      `INSERT INTO crm_hubspot_sync_settings (user_id, enabled, direction, paused, updated_by, updated_at) VALUES (?, 1, 'hubspot_to_zerosoft', 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET enabled = 1, paused = 0, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(ws, actor, now);
  return { ok: true, inbound: await getInbound(ws) };
}

function pickToggles(objects: Partial<Record<InboundObjectName, boolean>> | undefined): Partial<Toggles> {
  const out: Partial<Toggles> = {};
  for (const o of INBOUND_OBJECTS) if (typeof objects?.[o] === 'boolean') out[o] = objects[o];
  return out;
}

/** Pausa o retoma. Pausado, ningún tramo lee ni escribe (el que esté corriendo corta en la página siguiente). */
export async function setInboundPaused(ws: string, actor: string, paused: boolean): Promise<InboundActionResult> {
  const row = await rowOf(ws);
  const settings = await getSyncSettings(ws);
  if (!row || !settings.enabled) return { ok: false, code: 'not_started' };
  const now = iso();
  const db = getDb();
  await db.prepare('UPDATE crm_hubspot_sync_settings SET paused = ?, updated_by = ?, updated_at = ? WHERE user_id = ?').run(paused ? 1 : 0, actor, now, ws);
  // Retomar no espera la espera anterior.
  if (!paused) await db.prepare(`UPDATE crm_hubspot_inbound SET next_run_at = ?, attempts = 0, failure = CASE WHEN failure IN ('invalid_token', 'portal_changed') THEN failure ELSE '' END, updated_at = ? WHERE user_id = ?`).run(now, now, ws);
  return { ok: true, inbound: await getInbound(ws) };
}

/** Qué objetos se traen. Uno apagado guarda su cursor: al prenderlo sigue desde ahí. */
export async function setInboundObjects(ws: string, objects: Partial<Record<InboundObjectName, boolean>>): Promise<InboundActionResult> {
  const row = await rowOf(ws);
  if (!row) return { ok: false, code: 'not_started' };
  const next = { ...toggles(row.objects), ...pickToggles(objects) };
  await getDb().prepare('UPDATE crm_hubspot_inbound SET objects = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(next), iso(), ws);
  return { ok: true, inbound: await getInbound(ws) };
}

// ---------- Plan: dueños, pipelines y etapas, campos propios ----------

interface HsPipeline {
  id: string;
  label?: string;
  archived?: boolean;
  displayOrder?: number;
  stages?: Array<{ id: string; label?: string; archived?: boolean; displayOrder?: number; metadata?: { probability?: string; isClosed?: string } }>;
}

interface HsProperty {
  name: string;
  label?: string;
  type: string;
  fieldType: string;
  hubspotDefined?: boolean;
  calculated?: boolean;
  archived?: boolean;
  hidden?: boolean;
  showCurrencySymbol?: boolean;
  options?: Array<{ label: string; value: string; hidden?: boolean }>;
}

async function getAll<T>(client: HubspotClient, path: string): Promise<T[]> {
  const out: T[] = [];
  let after = '';
  for (let i = 0; i < 100; i++) {
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

async function extIds(db: Db, ws: string, object: string): Promise<Map<string, string>> {
  const rows = (await db.prepare(`SELECT external_id, record_id FROM crm_external_ids WHERE user_id = ? AND provider = 'hubspot' AND object = ?`).all(ws, object)) as Array<{
    external_id: string;
    record_id: string;
  }>;
  return new Map(rows.map((r) => [r.external_id, r.record_id]));
}

async function extSet(db: Db, ws: string, object: string, externalId: string, recordId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO crm_external_ids (user_id, provider, object, external_id, record_id, imported_at) VALUES (?, 'hubspot', ?, ?, ?, ?)
       ON CONFLICT(user_id, provider, object, external_id) DO UPDATE SET record_id = excluded.record_id`,
    )
    .run(ws, object, externalId, recordId, nowDb());
}

/** ¿La clave sigue entrando a esta cuenta? Solo un "no" claro corta. */
async function samePortal(client: HubspotClient, portalId: string): Promise<boolean> {
  const res = await client.send('/account-info/v3/details', { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
  if (res.status === 401) throw hubspotStatusError(res.status, res.path);
  if (!res.ok) return true;
  const seen = (res.json() as { portalId?: unknown }).portalId;
  return seen === undefined || seen === null || String(seen) === portalId;
}

/**
 * Arma el plan: dueños por email, pipelines y etapas (por lo que vinculó el
 * importador, por nombre o creándolos acá) y campos propios (los mismos
 * criterios del importador: se reusa el campo de un import anterior o uno con
 * el mismo nombre; si no, se crea). Nunca crea nada en HubSpot.
 */
export async function buildInboundPlan(ws: string, client: HubspotClient, toggled: Toggles): Promise<InboundPlan> {
  const db = getDb();
  const plan = emptyPlan();
  const [owners, archivedOwners, people] = await Promise.all([
    getAll<{ id: string | number; email?: string }>(client, '/crm/v3/owners'),
    getAll<{ id: string | number; email?: string }>(client, '/crm/v3/owners?archived=true'),
    workspacePeople(ws),
  ]);
  const byEmail = new Map(people.map((p) => [p.email.trim().toLowerCase(), p.id]));
  for (const o of [...owners, ...archivedOwners]) {
    const id = String(o.id);
    if (plan.knownOwners.includes(id)) continue;
    plan.knownOwners.push(id);
    const person = byEmail.get((o.email ?? '').trim().toLowerCase());
    if (person) plan.owners[id] = person;
  }

  if (toggled.deals) {
    const res = await client.send('/crm/v3/pipelines/deals', { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    const hsPipes = ((res.json() as { results?: HsPipeline[] }).results ?? []).filter((p) => !p.archived).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const [pipeIds, stageIds] = await Promise.all([extIds(db, ws, 'pipeline'), extIds(db, ws, 'stage')]);
    let ours = await listPipelinesWithStages(ws);
    const norm = (s: string) => s.trim().toLowerCase();
    for (const hp of hsPipes) {
      const name = (hp.label ?? hp.id).trim().slice(0, 100) || 'Pipeline';
      let pipe = ours.find((p) => p.id === pipeIds.get(hp.id)) ?? ours.find((p) => norm(p.name) === norm(name));
      if (!pipe) {
        const created = await createPipeline(ws, name);
        ours = await listPipelinesWithStages(ws);
        pipe = ours.find((p) => p.id === created.id)!;
      }
      await extSet(db, ws, 'pipeline', hp.id, pipe.id);
      let position = pipe.stages.reduce((m, s) => Math.max(m, s.position), -1);
      const stages = [...(hp.stages ?? [])].filter((s) => !s.archived).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      for (const hs of stages) {
        const label = (hs.label ?? hs.id).trim().slice(0, 100) || 'Stage';
        const prob = Number(hs.metadata?.probability ?? 0);
        const closed = hs.metadata?.isClosed === 'true';
        let stage = pipe.stages.find((s) => s.id === stageIds.get(hs.id)) ?? pipe.stages.find((s) => norm(s.name) === norm(label));
        if (!stage) {
          const id = crypto.randomUUID();
          position += 1;
          const won = closed && prob >= 1;
          const lost = closed && prob <= 0;
          await db
            .prepare('INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, pipe.id, label, Math.round((Number.isFinite(prob) ? prob : 0) * 100), position, won ? 1 : 0, lost ? 1 : 0);
          stage = { id, pipeline_id: pipe.id, name: label, probability: 0, position, is_won: won ? 1 : 0, is_lost: lost ? 1 : 0 } as (typeof pipe.stages)[number];
          pipe.stages.push(stage);
        }
        await extSet(db, ws, 'stage', hs.id, stage.id);
        plan.stages[hs.id] = { id: stage.id, pipelineId: pipe.id, won: Boolean(stage.is_won), lost: Boolean(stage.is_lost) };
        plan.defaultStage ??= { id: stage.id, pipelineId: pipe.id };
      }
    }
    const first = ours.find((p) => p.stages.length);
    plan.defaultStage ??= first ? { id: first.stages[0].id, pipelineId: first.id } : null;
  }

  const defs: CrmCustomFieldRow[] = await listCustomFields(ws);
  const fieldIds = await extIds(db, ws, 'field');
  for (const object of SYNC_OBJECTS) {
    if (!toggled[object]) continue;
    const res = await client.send(`/crm/v3/properties/${object}`, { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    const props = ((res.json() as { results?: HsProperty[] }).results ?? []).filter((p) => !p.hubspotDefined && !p.archived && !p.calculated && !p.hidden);
    const fields: PlanField[] = [];
    for (const p of props.slice(0, 200)) {
      const type = hubspotFieldType(p);
      const opts = (p.options ?? []).filter((o) => !o.hidden && o.label);
      const options = type === 'select' || type === 'multiselect' ? opts.map((o) => o.label.slice(0, 100)).slice(0, 100) : [];
      const extKey = `${object}:${p.name}`;
      const wanted = fieldNameFrom(p.name);
      let def = defs.find((d) => d.id === fieldIds.get(extKey)) ?? defs.find((d) => d.entity === object && d.name === wanted);
      if (def) {
        if ((def.type === 'select' || def.type === 'multiselect') && options.length) {
          const cur = parseJson<string[]>(def.options, []);
          const merged = [...cur, ...options.filter((o) => !cur.some((c) => c.toLowerCase() === o.toLowerCase()))].slice(0, 100);
          if (merged.length !== cur.length) {
            await db.prepare('UPDATE crm_custom_fields SET options = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(merged), def.id, ws);
            def = { ...def, options: JSON.stringify(merged) };
          }
        }
      } else {
        let name = wanted;
        for (let n = 2; defs.some((d) => d.entity === object && d.name === name); n++) name = `${wanted.slice(0, 60)}_${n}`;
        const id = crypto.randomUUID();
        const position = defs.filter((d) => d.entity === object).length;
        const stored = type === 'currency' ? ['USD'] : options;
        await db
          .prepare('INSERT INTO crm_custom_fields (id, user_id, entity, name, label, type, options, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, ws, object, name, (p.label || p.name).slice(0, 100), type, JSON.stringify(stored), position);
        def = (await db.prepare('SELECT * FROM crm_custom_fields WHERE id = ?').get(id)) as CrmCustomFieldRow;
        defs.push(def);
      }
      await extSet(db, ws, 'field', extKey, def.id);
      fields.push({
        key: p.name,
        name: def.name,
        type: def.type,
        options: parseJson<string[]>(def.options, []),
        optionMap: opts.length ? Object.fromEntries(opts.map((o) => [o.value, o.label])) : undefined,
      });
    }
    plan.fields[object] = fields;
  }
  return plan;
}

// ---------- Asociaciones ----------

type AssocMap = Map<string, Array<{ id: string; primary: boolean }>>;
const PRIMARY_TYPE_IDS = new Set([1, 5]);

async function readAssociations(client: HubspotClient, from: InboundObject, to: SyncObject, ids: string[]): Promise<AssocMap> {
  const out: AssocMap = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await client.send(`/crm/v4/associations/${from}/${to}/batch/read`, {
      method: 'POST',
      body: { inputs: ids.slice(i, i + 100).map((id) => ({ id })) },
      retries: 2,
      retry5xx: true,
      maxWaitMs: 4_000,
    });
    // 207: algunos ids sin asociaciones; el cuerpo trae los que sí.
    if (!res.ok && res.status !== 207) throw hubspotStatusError(res.status, res.path);
    const body = res.json() as { results?: Array<{ from: { id: string | number }; to: Array<{ toObjectId: string | number; associationTypes?: Array<{ category?: string; typeId?: number; label?: string | null }> }> }> };
    for (const r of body.results ?? []) {
      out.set(
        String(r.from.id),
        (r.to ?? []).map((t) => ({
          id: String(t.toObjectId),
          primary: (t.associationTypes ?? []).some((a) => (a.category === 'HUBSPOT_DEFINED' && PRIMARY_TYPE_IDS.has(Number(a.typeId))) || a.label === 'Primary'),
        })),
      );
    }
  }
  return out;
}

// ---------- Escritura de una página ----------

interface LinkRow {
  object: string;
  record_id: string;
  hubspot_id: string;
  hubspot_modified_at: string | null;
  shadow: string;
  state: string;
}

interface PageCtx {
  db: Db;
  ws: string;
  portalId: string;
  plan: InboundPlan;
  counts: InboundCounts;
  /** Códigos de error de esta página (se suman al registro de errores). */
  codes: Map<string, number>;
  /** Hay un dueño o una etapa que el plan no conoce. */
  stale: boolean;
  /** El plan se renovó en este tramo: lo que siga sin conocerse ya no se arregla renovando. */
  planFresh: boolean;
}

const TABLE: Record<SyncObject, string> = { contacts: 'crm_contacts', companies: 'crm_companies', deals: 'crm_deals' };

function note(ctx: PageCtx, code: string): void {
  ctx.codes.set(code, (ctx.codes.get(code) ?? 0) + 1);
}

async function linkByHubspot(ctx: PageCtx, object: string, hubspotId: string): Promise<LinkRow | null> {
  return (
    ((await ctx.db
      .prepare('SELECT object, record_id, hubspot_id, hubspot_modified_at, shadow, state FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND hubspot_id = ?')
      .get(ctx.ws, ctx.portalId, object, hubspotId)) as LinkRow | undefined) ?? null
  );
}

/** Vínculo de un registro nuestro con esta cuenta (uno con otra cuenta de HubSpot, de antes de reconectar, no cuenta y se reemplaza). */
async function linkOfRecord(ctx: PageCtx, object: string, recordId: string): Promise<LinkRow | null> {
  return (
    ((await ctx.db
      .prepare('SELECT object, record_id, hubspot_id, hubspot_modified_at, shadow, state FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND record_id = ?')
      .get(ctx.ws, ctx.portalId, object, recordId)) as LinkRow | undefined) ?? null
  );
}

async function putLink(ctx: PageCtx, object: string, recordId: string, hubspotId: string, modifiedMs: number, shadow: Values, state = 'linked'): Promise<void> {
  const now = iso();
  await ctx.db
    .prepare(
      `INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id, hubspot_modified_at, shadow, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, object, record_id) DO UPDATE SET portal_id = excluded.portal_id, hubspot_id = excluded.hubspot_id,
         hubspot_modified_at = excluded.hubspot_modified_at, shadow = excluded.shadow, state = excluded.state, updated_at = excluded.updated_at`,
    )
    .run(ctx.ws, object, recordId, ctx.portalId, hubspotId, modifiedMs ? iso(new Date(modifiedMs)) : null, JSON.stringify(shadow), state, now, now);
}

async function noteConflict(ctx: PageCtx, object: string, recordId: string, hubspotId: string, kind: string, fields: string[]): Promise<void> {
  const now = iso();
  await ctx.db
    .prepare(
      `INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, object, record_id) DO UPDATE SET hubspot_id = excluded.hubspot_id, kind = excluded.kind, fields = excluded.fields, updated_at = excluded.updated_at`,
    )
    .run(ctx.ws, object, recordId, hubspotId, kind, fields.join(',').slice(0, 1000), now, now);
}

async function clearConflict(ctx: PageCtx, object: string, recordId: string): Promise<void> {
  await ctx.db.prepare(`DELETE FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND object = ? AND record_id = ? AND kind = 'fields'`).run(ctx.ws, object, recordId);
}

/** ¿El registro se editó acá después de que lo trajo el importador? */
async function editedAfterImport(ctx: PageCtx, object: SyncObject | 'activity', hubspotKey: string): Promise<boolean> {
  const table = object === 'activity' ? 'crm_activities' : TABLE[object];
  const linkObject = object === 'activity' ? 'activity' : LINK_OBJECT[object];
  const row = (await ctx.db
    .prepare(
      `SELECT r.updated_at > COALESCE(e.imported_at, e.created_at) AS edited FROM crm_external_ids e JOIN ${table} r ON r.id = e.record_id
       WHERE e.user_id = ? AND e.provider = 'hubspot' AND e.object = ? AND e.external_id = ?`,
    )
    .get(ctx.ws, linkObject, hubspotKey)) as { edited: number } | undefined;
  return Boolean(row?.edited);
}

/** Vínculo que dejó el importador: el registro tiene que existir en este workspace y no estar vinculado a otro. */
async function importerRecord(ctx: PageCtx, linkObject: string, table: string, hubspotKey: string): Promise<{ id: string; row: Record<string, unknown> } | null> {
  const row = (await ctx.db
    .prepare(
      `SELECT r.* FROM crm_external_ids e JOIN ${table} r ON r.id = e.record_id AND r.user_id = e.user_id
       WHERE e.user_id = ? AND e.provider = 'hubspot' AND e.object = ? AND e.external_id = ?`,
    )
    .get(ctx.ws, linkObject, hubspotKey)) as Record<string, unknown> | undefined;
  if (!row) return null;
  const id = String(row.id);
  return (await linkOfRecord(ctx, linkObject, id)) ? null : { id, row };
}

/** ¿El registro nuestro ya vino del importador desde otro registro de HubSpot? Entonces no es de este. */
async function importedFromOther(ctx: PageCtx, linkObject: string, recordId: string, hubspotIds: string[]): Promise<boolean> {
  const rows = (await ctx.db
    .prepare(`SELECT external_id FROM crm_external_ids WHERE user_id = ? AND provider = 'hubspot' AND object = ? AND record_id = ?`)
    .all(ctx.ws, linkObject, recordId)) as Array<{ external_id: string }>;
  // Un id que HubSpot fusionó en este registro cuenta como el mismo.
  return rows.some((r) => !hubspotIds.includes(r.external_id));
}

/** `seen`: ya estaba al día con esta versión de HubSpot (la relectura del margen); no se cuenta. */
type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'seen';

interface Assoc {
  companies?: AssocMap;
  contacts?: AssocMap;
  deals?: AssocMap;
}

/** Registros nuestros vinculados a estos ids de HubSpot (para asociaciones). */
async function localIds(ctx: PageCtx, object: SyncObject, hubspotIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(hubspotIds)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const rows = (await ctx.db
      .prepare(
        `SELECT hubspot_id, record_id FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND state = 'linked' AND hubspot_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(ctx.ws, ctx.portalId, LINK_OBJECT[object], ...chunk)) as Array<{ hubspot_id: string; record_id: string }>;
    for (const r of rows) out.set(r.hubspot_id, r.record_id);
  }
  return out;
}

/** Valor de columna a partir del texto normalizado. */
function columnValue(field: string, v: string): string | number | null {
  if (field === 'owner_id' || field === 'close_date' || field === 'contact_id' || field === 'company_id' || field === 'deal_id' || field === 'due_at') return v || null;
  if (field === 'employees' || field === 'duration_min') return v ? Math.round(Number(v)) : null;
  if (field === 'amount') return v ? Number(v) : 0;
  if (field === 'done') return v === '1' ? 1 : 0;
  if (field === 'lifecycle_stage') return v || 'lead';
  if (field === 'lead_status') return v || 'new';
  return v;
}

/** El registro está para fusionarse con otro que HubSpot fusionó: se anota y el vínculo del que desapareció queda 'merged'. */
async function handleMerges(ctx: PageCtx, linkObject: string, rec: HsRecord, current: LinkRow | null): Promise<LinkRow | null> {
  let link = current;
  for (const mid of mergedIds(rec.properties)) {
    if (mid === rec.id) continue;
    const gone = await linkByHubspot(ctx, linkObject, mid);
    if (!gone || gone.state === 'merged') continue;
    if (!link) {
      // El que quedó todavía no tenía vínculo: hereda el del que desapareció.
      await ctx.db
        .prepare(`UPDATE crm_hubspot_links SET hubspot_id = ?, state = 'linked', updated_at = ? WHERE user_id = ? AND object = ? AND record_id = ?`)
        .run(rec.id, iso(), ctx.ws, linkObject, gone.record_id);
      link = { ...gone, hubspot_id: rec.id, state: 'linked' };
    } else if (gone.record_id !== link.record_id) {
      // Dos registros nuestros para uno de HubSpot: se fusionan a mano (acá no se borra nada).
      await ctx.db.prepare(`UPDATE crm_hubspot_links SET state = 'merged', updated_at = ? WHERE user_id = ? AND object = ? AND record_id = ?`).run(iso(), ctx.ws, linkObject, gone.record_id);
      await noteConflict(ctx, linkObject, gone.record_id, rec.id, 'merge', []);
      note(ctx, 'merged_in_hubspot');
    }
  }
  return link;
}

async function applyRecord(ctx: PageCtx, object: SyncObject, rec: HsRecord, assoc: Assoc, maps: { companies: Map<string, string>; contacts: Map<string, string> }): Promise<Outcome> {
  const { db, ws } = ctx;
  const linkObject = LINK_OBJECT[object];
  const table = TABLE[object];
  const mapped = mapRecord(object, rec.properties, ctx.plan);
  if (mapped.stale && !ctx.planFresh) {
    ctx.stale = true;
    return 'skipped';
  }
  let link = await handleMerges(ctx, linkObject, rec, await linkByHubspot(ctx, linkObject, rec.id));
  // Ya está al día con esta versión de HubSpot (la relectura del margen de cada vuelta).
  if (link && link.state === 'linked' && link.hubspot_modified_at && rec.modifiedMs && Date.parse(link.hubspot_modified_at) >= rec.modifiedMs) return 'seen';
  if (link?.state === 'deleted_here' || link?.state === 'merged') return 'skipped';

  const fields = ctx.plan.fields[object] ?? [];
  const custom = mapCustom(fields, rec.properties);
  const remote: Values = { ...mapped.values, ...custom.values };
  for (const f of custom.skip) mapped.skip.add(f);
  let trusted = false;
  let recordId = link?.record_id ?? '';
  if (!link) {
    const sameIds = [rec.id, ...mergedIds(rec.properties)];
    let fromImport: Awaited<ReturnType<typeof importerRecord>> = null;
    let importedAs = rec.id;
    for (const id of sameIds) {
      fromImport = await importerRecord(ctx, linkObject, table, id);
      if (fromImport) {
        importedAs = id;
        break;
      }
    }
    // crm_external_ids no guarda de qué cuenta de HubSpot vino: el vínculo del importador vale si la clave coincide
    // (email o dominio, o vacía acá); solo así HubSpot pisa lo que nadie tocó desde el import. Los deals nunca son "de confianza".
    const importKeyOk = (r: Record<string, unknown>) => {
      if (object === 'contacts') {
        const local = String(r.email ?? '').trim().toLowerCase();
        return !local || contactEmails(rec.properties).includes(local);
      }
      if (object === 'companies') {
        const local = normalizeCompanyDomain(String(r.domain ?? ''));
        return !local || local === remote.domain;
      }
      return false;
    };
    if (fromImport) {
      recordId = fromImport.id;
      trusted = importKeyOk(fromImport.row) && !(await editedAfterImport(ctx, object, importedAs));
    } else if (object === 'contacts') {
      for (const email of contactEmails(rec.properties)) {
        const hit = await findContactByEmail(ws, email, db);
        if (hit && !(await linkOfRecord(ctx, linkObject, hit.id)) && !(await importedFromOther(ctx, linkObject, hit.id, sameIds))) {
          recordId = hit.id;
          break;
        }
      }
    } else if (object === 'companies' && remote.domain) {
      const hits = (await db
        .prepare(`SELECT id, domain FROM crm_companies WHERE user_id = ? AND domain != '' AND instr(lower(domain), ?) > 0 LIMIT 50`)
        .all(ws, remote.domain)) as Array<{ id: string; domain: string }>;
      const same = hits.filter((h) => normalizeCompanyDomain(h.domain) === remote.domain);
      const free: string[] = [];
      for (const h of same) if (!(await linkOfRecord(ctx, linkObject, h.id)) && !(await importedFromOther(ctx, linkObject, h.id, sameIds))) free.push(h.id);
      if (free.length > 1) {
        // Dos empresas nuestras con ese dominio: no se adivina. Se fusionan acá y la vuelta siguiente la vincula.
        note(ctx, 'ambiguous_match');
        return 'skipped';
      }
      if (free.length === 1) recordId = free[0];
    }
  }

  const row = recordId ? ((await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(recordId, ws)) as Record<string, unknown> | undefined) : undefined;
  if (link && !row) {
    // Se borró acá: no se vuelve a crear.
    await db.prepare(`UPDATE crm_hubspot_links SET state = 'deleted_here', updated_at = ? WHERE user_id = ? AND object = ? AND record_id = ?`).run(iso(), ws, linkObject, link.record_id);
    return 'skipped';
  }

  let outcome: Outcome;
  let shadow: Values;
  if (!row) {
    const created = await insertRecord(ctx, object, rec.id, remote, mapped.skip, Boolean((rec.properties.dealstage ?? '').trim()));
    if (!created) return 'skipped';
    recordId = created.id;
    shadow = created.shadow;
    outcome = 'created';
  } else {
    const local: Values = { ...localValues(object, row), ...localCustom(fields, parseCustom(String(row.custom ?? '{}'))) };
    const res = resolve(remote, local, link ? parseJson<Values>(link.shadow, {}) : {}, { trusted, skip: mapped.skip });
    // El email es la identidad del contacto: si en HubSpot pasó a ser el de otro contacto nuestro, no se pisa.
    if (object === 'contacts' && res.apply.includes('email') && remote.email && (await findContactByEmail(ws, remote.email, db, recordId))) {
      res.apply = res.apply.filter((f) => f !== 'email');
      res.conflicts.push('email');
      const prev = link ? parseJson<Values>(link.shadow, {}).email : undefined;
      if (prev === undefined) delete res.shadow.email;
      else res.shadow.email = prev;
    }
    await updateRecord(ctx, object, recordId, row, remote, res.apply);
    shadow = res.shadow;
    outcome = res.apply.length ? 'updated' : 'unchanged';
    if (res.conflicts.length) {
      await noteConflict(ctx, linkObject, recordId, rec.id, 'fields', res.conflicts);
      ctx.counts.conflicts++;
    } else await clearConflict(ctx, linkObject, recordId);
  }
  await putLink(ctx, linkObject, recordId, rec.id, rec.modifiedMs, shadow);
  await writeAssociations(ctx, object, recordId, rec, assoc, maps, outcome === 'created');
  return outcome;
}

async function insertRecord(ctx: PageCtx, object: SyncObject, hubspotId: string, remote: Values, skip: Set<string>, hasStage = false): Promise<{ id: string; shadow: Values } | null> {
  const { db, ws } = ctx;
  const id = crypto.randomUUID();
  const shadow: Values = {};
  const cols: Array<[string, string | number | null]> = [
    ['id', id],
    ['user_id', ws],
  ];
  const custom: Record<string, unknown> = {};
  for (const [field, v] of Object.entries(remote)) {
    if (skip.has(field)) continue;
    shadow[field] = v;
    if (field.startsWith('custom.')) {
      if (v) custom[field.slice(7)] = JSON.parse(v) as unknown;
    } else if (field !== 'stage_id' && field !== 'lost_reason') cols.push([field, columnValue(field, v)]);
  }
  cols.push(['custom', JSON.stringify(custom)]);
  if (object === 'deals') {
    const stage = remote.stage_id && !skip.has('stage_id') ? Object.values(ctx.plan.stages).find((s) => s.id === remote.stage_id) : undefined;
    // Una etapa de HubSpot sin equivalente (un pipeline archivado allá): no se crea en otro lugar ni como abierto; se anota.
    if (!stage && hasStage) {
      note(ctx, 'stage_unmapped');
      return null;
    }
    const target = stage ?? (ctx.plan.defaultStage ? { ...ctx.plan.defaultStage, won: false, lost: false } : null);
    if (!target) {
      note(ctx, 'no_pipeline');
      return null;
    }
    const pos = ((await db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM crm_deals WHERE stage_id = ?').get(target.id)) as { m: number }).m;
    const closedAt = target.won || target.lost ? (remote.close_date ? `${remote.close_date} 00:00:00` : nowDb()) : null;
    cols.push(['pipeline_id', target.pipelineId], ['stage_id', target.id], ['position', Number(pos) + 1024], ['closed_at', closedAt], ['lost_reason', target.lost ? (remote.lost_reason ?? '') : '']);
    // Sin moneda en HubSpot: la moneda base del workspace (como el importador).
    if (!cols.some(([c]) => c === 'currency')) cols.push(['currency', (await getCrmSettings(ws, db)).baseCurrency]);
  }
  const marks = cols.map(() => '?').join(', ');
  const names = cols.map(([c]) => c).join(', ');
  if (object === 'contacts' && remote.email) {
    // Como createContact: el chequeo del email va en la misma sentencia.
    const guard = emailFreeSql(ws, remote.email);
    const res = await db.prepare(`INSERT INTO crm_contacts (${names}) SELECT ${marks} WHERE ${guard.sql}`).run(...cols.map(([, v]) => v), ...guard.args);
    if (res.changes) return { id, shadow };
    // El email ya es de otro contacto (vinculado a otro registro de HubSpot): se crea sin email y se anota.
    const withoutEmail = cols.map(([c, v]): [string, string | number | null] => [c, c === 'email' ? '' : v]);
    await db.prepare(`INSERT INTO crm_contacts (${names}) VALUES (${marks})`).run(...withoutEmail.map(([, v]) => v));
    delete shadow.email;
    note(ctx, 'email_taken');
    ctx.counts.conflicts++;
    await noteConflict(ctx, 'contact', id, hubspotId, 'fields', ['email']);
    return { id, shadow };
  }
  await db.prepare(`INSERT INTO ${TABLE[object]} (${names}) VALUES (${marks})`).run(...cols.map(([, v]) => v));
  return { id, shadow };
}

async function updateRecord(ctx: PageCtx, object: SyncObject, id: string, row: Record<string, unknown>, remote: Values, apply: string[]): Promise<void> {
  if (!apply.length) return;
  const cols: Array<[string, string | number | null]> = [];
  let custom: Record<string, unknown> | null = null;
  for (const field of apply) {
    const v = remote[field] ?? '';
    if (field.startsWith('custom.')) {
      custom ??= parseCustom(String(row.custom ?? '{}'));
      const name = field.slice(7);
      if (v) custom[name] = JSON.parse(v) as unknown;
      else delete custom[name];
    } else if (field === 'stage_id') {
      const stage = Object.values(ctx.plan.stages).find((s) => s.id === v);
      if (!stage) continue;
      const closedAt = stage.won || stage.lost ? (remote.close_date ? `${remote.close_date} 00:00:00` : nowDb()) : null;
      cols.push(['pipeline_id', stage.pipelineId], ['stage_id', stage.id], ['closed_at', closedAt]);
    } else cols.push([field, columnValue(field, v)]);
  }
  if (custom) cols.push(['custom', JSON.stringify(custom)]);
  if (!cols.length) return;
  await ctx.db
    .prepare(`UPDATE ${TABLE[object]} SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(...cols.map(([, v]) => v), nowDb(), id, ctx.ws);
}

/** Asociaciones de HubSpot: solo se suman (nunca se quita una que exista acá). */
async function writeAssociations(
  ctx: PageCtx,
  object: SyncObject,
  id: string,
  rec: HsRecord,
  assoc: Assoc,
  maps: { companies: Map<string, string>; contacts: Map<string, string> },
  created: boolean,
): Promise<void> {
  const { db, ws } = ctx;
  const now = nowDb();
  if (object === 'companies') {
    const parent = (rec.properties.hs_parent_company_id ?? '').trim();
    if (!parent) return;
    const parentId = maps.companies.get(parent) ?? (await localIds(ctx, 'companies', [parent])).get(parent);
    const current = (await db.prepare('SELECT parent_company_id AS p FROM crm_companies WHERE id = ?').get(id)) as { p: string | null } | undefined;
    if (parentId && parentId !== id && !current?.p) {
      try {
        await setParentCompany(ws, id, parentId, db);
      } catch {
        note(ctx, 'parent_skipped');
      }
    }
    return;
  }
  const companies = assoc.companies?.get(rec.id) ?? [];
  if (object === 'contacts') {
    if (!companies.length) return;
    const hasPrimary = !created && Boolean(await db.prepare('SELECT 1 AS one FROM crm_contact_companies WHERE contact_id = ? AND is_primary = 1').get(id));
    for (const c of companies) {
      const companyId = maps.companies.get(c.id);
      if (!companyId) continue;
      await db.prepare(`INSERT OR IGNORE INTO crm_contact_companies (contact_id, company_id, user_id, is_primary, label, created_at) VALUES (?, ?, ?, 0, '', ?)`).run(id, companyId, ws, now);
      if (c.primary && !hasPrimary) {
        await db.prepare('UPDATE crm_contact_companies SET is_primary = 0 WHERE contact_id = ? AND company_id != ?').run(id, companyId);
        await db.prepare('UPDATE crm_contact_companies SET is_primary = 1 WHERE contact_id = ? AND company_id = ?').run(id, companyId);
      }
    }
    await syncContactPrimary(id, db);
    return;
  }
  for (const c of assoc.contacts?.get(rec.id) ?? []) {
    const contactId = maps.contacts.get(c.id);
    if (contactId) await db.prepare('INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)').run(id, contactId);
  }
  if (!companies.length) return;
  const hasPrimary = !created && Boolean(await db.prepare('SELECT 1 AS one FROM crm_deal_companies WHERE deal_id = ? AND is_primary = 1').get(id));
  for (const c of companies) {
    const companyId = maps.companies.get(c.id);
    if (!companyId) continue;
    const primary = c.primary && !hasPrimary;
    if (primary) await db.prepare('UPDATE crm_deal_companies SET is_primary = 0 WHERE deal_id = ? AND company_id != ?').run(id, companyId);
    await db
      .prepare(
        `INSERT INTO crm_deal_companies (deal_id, company_id, user_id, is_primary, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(deal_id, company_id) DO UPDATE SET is_primary = MAX(is_primary, excluded.is_primary)`,
      )
      .run(id, companyId, ws, primary ? 1 : 0, now);
  }
  await syncDealPrimary(id, db);
}

async function applyActivity(ctx: PageCtx, object: ActivityObject, rec: HsRecord, assoc: Assoc, maps: { companies: Map<string, string>; contacts: Map<string, string>; deals: Map<string, string> }): Promise<Outcome> {
  const { db, ws } = ctx;
  const key = `${object}:${rec.id}`;
  const mapped = mapActivity(object, rec.properties, ctx.plan, nowDb());
  if (mapped.stale && !ctx.planFresh) {
    ctx.stale = true;
    return 'skipped';
  }
  const link = await linkByHubspot(ctx, 'activity', key);
  if (link && link.state === 'linked' && link.hubspot_modified_at && rec.modifiedMs && Date.parse(link.hubspot_modified_at) >= rec.modifiedMs) return 'seen';
  if (link?.state === 'deleted_here') return 'skipped';
  // Una asociación que no se leyó (objeto apagado) o que no apunta a nada vinculado acá no borra la que hay: se saltea.
  const skip = new Set<string>(mapped.skip);
  const pick = (field: string, to: SyncObject, m: Map<string, string>): string => {
    const read = assoc[to];
    if (!read) {
      skip.add(field);
      return '';
    }
    const list = read.get(rec.id) ?? [];
    const hit = list.map((x) => m.get(x.id)).find(Boolean);
    if (!hit && list.length) skip.add(field);
    return hit ?? '';
  };
  const remote: Values = {
    ...mapped.values,
    contact_id: pick('contact_id', 'contacts', maps.contacts),
    company_id: pick('company_id', 'companies', maps.companies),
    deal_id: pick('deal_id', 'deals', maps.deals),
  };
  let recordId = link?.record_id ?? '';
  let trusted = false;
  if (!link) {
    const fromImport = await importerRecord(ctx, 'activity', 'crm_activities', key);
    // Sin clave para confirmar que es la misma (crm_external_ids no guarda la cuenta): se vincula, pero solo se completa lo vacío.
    if (fromImport) recordId = fromImport.id;
  }
  const row = recordId ? ((await db.prepare('SELECT * FROM crm_activities WHERE id = ? AND user_id = ?').get(recordId, ws)) as Record<string, unknown> | undefined) : undefined;
  if (link && !row) {
    await db.prepare(`UPDATE crm_hubspot_links SET state = 'deleted_here', updated_at = ? WHERE user_id = ? AND object = 'activity' AND record_id = ?`).run(iso(), ws, link.record_id);
    return 'skipped';
  }
  if (!row) {
    // Sin un registro nuestro donde mostrarla, solo una tarea tiene sentido (va a la lista de tareas).
    if (!remote.contact_id && !remote.company_id && !remote.deal_id && mapped.type !== 'task') return 'skipped';
    const id = crypto.randomUUID();
    const done = remote.done === '1';
    const due = remote.due_at || null;
    const fired = mapped.type === 'task' && !done && due && due <= nowDb() ? nowDb() : null;
    await db
      .prepare(
        `INSERT INTO crm_activities (id, user_id, owner_id, type, subject, body, due_at, done, done_at, direction, outcome, duration_min, contact_id, company_id, deal_id, due_fired_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, ws, remote.owner_id || null, mapped.type, remote.subject, remote.body, due, done ? 1 : 0, done ? remote.at : null, remote.direction, remote.outcome,
        columnValue('duration_min', remote.duration_min), remote.contact_id || null, remote.company_id || null, remote.deal_id || null, fired, remote.at, remote.at,
      );
    await putLink(ctx, 'activity', id, key, rec.modifiedMs, remote);
    return 'created';
  }
  const res = resolve(remote, localValues(object, row), link ? parseJson<Values>(link.shadow, {}) : {}, { trusted, skip });
  const cols: Array<[string, string | number | null]> = [];
  for (const field of res.apply) {
    if (field === 'at') cols.push(['created_at', remote.at]);
    else cols.push([field, columnValue(field, remote[field] ?? '')]);
    if (field === 'done') cols.push(['done_at', remote.done === '1' ? remote.at : null]);
  }
  if (cols.length) await db.prepare(`UPDATE crm_activities SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...cols.map(([, v]) => v), nowDb(), recordId, ws);
  if (res.conflicts.length) {
    await noteConflict(ctx, 'activity', recordId, key, 'fields', res.conflicts);
    ctx.counts.conflicts++;
  } else await clearConflict(ctx, 'activity', recordId);
  await putLink(ctx, 'activity', recordId, key, rec.modifiedMs, res.shadow);
  return res.apply.length ? 'updated' : 'unchanged';
}

/** Escribe una página en una transacción, con el guardado del estado (cursor y conteos) en la misma. */
async function writePage(
  ws: string,
  portalId: string,
  plan: InboundPlan,
  planFresh: boolean,
  object: InboundObject,
  records: HsRecord[],
  assoc: Assoc,
  counts: InboundCounts,
  save: (db: Db) => Promise<void>,
): Promise<{ stale: boolean; codes: Map<string, number>; failedFrom: number }> {
  const tx = await getClient().transaction('write');
  const db = txDb(tx);
  const ctx: PageCtx = { db, ws, portalId, plan, counts: { ...counts }, codes: new Map(), stale: false, planFresh };
  try {
    const assocIds = (to: SyncObject) => [...(assoc[to]?.values() ?? [])].flatMap((l) => l.map((x) => x.id));
    const maps = {
      companies: await localIds(ctx, 'companies', assocIds('companies')),
      contacts: await localIds(ctx, 'contacts', assocIds('contacts')),
      deals: await localIds(ctx, 'deals', assocIds('deals')),
    };
    // Una página puede traer el mismo registro dos veces (el borde de fecha se relee): cuenta una.
    const seen = new Set<string>();
    let failedFrom = 0;
    for (const rec of records) {
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      let outcome: Outcome;
      // Cada registro en su savepoint: uno que falla a mitad no deja nada a medias (ni un alta sin vínculo).
      await db.prepare('SAVEPOINT hs_rec').run();
      try {
        outcome = isActivityObject(object) ? await applyActivity(ctx, object, rec, assoc, maps) : await applyRecord(ctx, object, rec, assoc, maps);
        await db.prepare('RELEASE hs_rec').run();
      } catch {
        await db.prepare('ROLLBACK TO hs_rec').run();
        await db.prepare('RELEASE hs_rec').run();
        ctx.counts.failed++;
        note(ctx, 'write_failed');
        // Sin fecha no hay desde dónde releer: queda en los errores.
        if (rec.modifiedMs) failedFrom = failedFrom ? Math.min(failedFrom, rec.modifiedMs) : rec.modifiedMs;
        continue;
      }
      if (ctx.stale) break;
      if (outcome === 'seen') continue;
      ctx.counts.read++;
      ctx.counts[outcome]++;
      // Lo recién creado ya puede ser destino de una asociación de esta misma página (empresa madre, por ejemplo).
      if (!isActivityObject(object) && (outcome === 'created' || outcome === 'updated')) {
        const id = (await linkByHubspot(ctx, LINK_OBJECT[object], rec.id))?.record_id;
        if (id) maps[object].set(rec.id, id);
      }
    }
    if (ctx.stale) {
      await tx.rollback();
      return { stale: true, codes: new Map(), failedFrom: 0 };
    }
    Object.assign(counts, ctx.counts);
    await save(db);
    await tx.commit();
    return { stale: false, codes: ctx.codes, failedFrom };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

// ---------- Corrida ----------

export interface RunStepOptions {
  budgetMs?: number;
  /** Tope de páginas (tests: avanzar de a una). */
  maxPages?: number;
  pageSize?: number;
  /** Hora (tests). */
  now?: () => number;
}

export type RunStepResult = 'not_claimed' | 'progress' | 'idle' | 'waiting' | 'retrying' | 'blocked' | 'paused';

async function claim(ws: string, lockMs: number, now: number): Promise<InboundRow | null> {
  const at = iso(new Date(now));
  const res = await getDb()
    .prepare(
      `UPDATE crm_hubspot_inbound SET locked_until = ?, updated_at = ? WHERE user_id = ? AND (locked_until IS NULL OR locked_until < ?) AND (next_run_at IS NULL OR next_run_at <= ?)`,
    )
    .run(iso(new Date(now + lockMs)), at, ws, at, at);
  if (!res.changes) return null;
  return rowOf(ws);
}

function pushErrors(list: InboundErrorEntry[], object: string, codes: Map<string, number>, at: string): InboundErrorEntry[] {
  const out = [...list];
  for (const [code, count] of codes) out.unshift({ at, object, code, count });
  return out.slice(0, MAX_ERRORS);
}

/**
 * Un tramo de un workspace. Lo llaman el cron y la pantalla abierta (un solo
 * proceso a la vez por el claim). Devuelve en qué quedó.
 */
export async function runInboundStep(ws: string, opts: RunStepOptions = {}): Promise<RunStepResult> {
  const clock = opts.now ?? Date.now;
  const gate = await syncGate(ws);
  if (!gate.run) return gate.reason === 'paused' ? 'paused' : gate.reason === 'off' || gate.reason === 'disabled_globally' ? 'not_claimed' : 'blocked';
  const budgetMs = opts.budgetMs ?? 20_000;
  const start = clock();
  const deadline = start + budgetMs;
  const row = await claim(ws, budgetMs + 120_000, start);
  if (!row) return 'not_claimed';
  // Lo que escribe este tramo (estado, esperas, liberar) solo vale mientras el turno siga siendo suyo.
  const mine = row.locked_until ?? '';
  const db = getDb();
  const conn = await openSyncConnection(ws);
  if (!conn) return release(ws, mine, 'blocked');
  let plan = parseJson<InboundPlan>(row.plan, emptyPlan());
  let planAt = row.plan_at;
  let cursors = parseJson<Cursors>(row.cursors, { objects: {}, sweep: null });
  cursors.objects ??= {};
  let counts = parseJson<Counts>(row.counts, {});
  let errors = parseJson<InboundErrorEntry[]>(row.errors, []);
  let initialDone = row.initial_done_at;
  let sweepAt = row.sweep_at;
  let status = row.status;
  // La clave ahora es de otra cuenta (se reconectó): lo de la anterior no sirve y se empieza de cero con esta.
  if (row.portal_id !== conn.portalId) {
    plan = emptyPlan();
    planAt = null;
    cursors = { objects: {}, sweep: null };
    counts = {};
    errors = [];
    initialDone = null;
    sweepAt = null;
    status = 'initial';
  }
  const objects = toggles(row.objects);
  const client = syncHubspotClient(conn.token, { portalId: conn.portalId, maxWaitMs: 3_000 });
  let planFresh = false;
  let pages = 0;

  // `progress`: se escribió algo de HubSpot (o se cerró la vuelta): el último problema queda atrás y las esperas vuelven a empezar.
  const persist = async (target: Db, extra: { done?: boolean; progress?: boolean } = {}) => {
    const now = iso(new Date(clock()));
    const ok = extra.progress === false ? 0 : 1;
    const res = await target
      .prepare(
        `UPDATE crm_hubspot_inbound SET portal_id = ?, status = ?, cursors = ?, plan = ?, plan_at = ?, counts = ?, errors = ?,
           failure = CASE WHEN ? THEN '' ELSE failure END, attempts = CASE WHEN ? THEN 0 ELSE attempts END,
           sweep_at = ?, initial_done_at = ?, last_run_at = ?, last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END, updated_at = ? WHERE user_id = ? AND locked_until = ?`,
      )
      .run(conn.portalId, status, JSON.stringify(cursors), JSON.stringify(plan), planAt, JSON.stringify(counts), JSON.stringify(errors), ok, ok, sweepAt, initialDone, now, extra.done ? 1 : 0, now, now, ws, mine);
    // Otro tramo tomó el turno (este se pasó de tiempo): no se pisa lo suyo; la página en curso se descarta.
    if (!res.changes) throw new LockLost();
  };
  const stillOn = async () => {
    const s = await getSyncSettings(ws);
    return s.enabled && !s.paused;
  };

  try {
    const planStale = !planAt || clock() - Date.parse(planAt) > PLAN_TTL_MS;
    if (planStale) {
      if (!(await samePortal(client, conn.portalId))) {
        await markConnectionError(ws, 'portal_changed');
        return fail(ws, mine, 'portal_changed', errors, clock());
      }
      plan = await buildInboundPlan(ws, client, objects);
      planAt = iso(new Date(clock()));
      planFresh = true;
      await persist(db, { progress: false });
    }

    const order = INBOUND_OBJECTS.filter((o) => objects[o]);
    while (clock() < deadline && pages < (opts.maxPages ?? Infinity)) {
      if (pages > 0) {
        await new Promise<void>((r) => setImmediate(r));
        if (!(await stillOn())) break;
      }
      const object = order.find((o) => !(cursors.objects[o]?.done ?? false));
      if (!object) {
        // Todos al día en esta vuelta: archivados (cada 15 minutos) y cierre de la vuelta.
        if (!sweepAt || clock() - Date.parse(sweepAt) > SWEEP_INTERVAL_MS) {
          const finished = await sweepArchived(ws, conn.portalId, client, cursors, objects, counts);
          pages++;
          if (finished) sweepAt = iso(new Date(clock()));
          await persist(db);
          if (!finished) continue;
        }
        for (const o of INBOUND_OBJECTS) {
          const c = cursors.objects[o];
          if (!c) continue;
          c.done = false;
          const from = c.retryFrom ? Math.min(c.hw - OVERLAP_MS, c.retryFrom - 1) : c.hw - OVERLAP_MS;
          c.retries = c.retryFrom ? (c.retries ?? 0) + 1 : 0;
          c.retryFrom = 0;
          c.read = { since: Math.max(0, from), tieAfter: '', tie: false };
        }
        if (!initialDone) initialDone = iso(new Date(clock()));
        status = 'live';
        await persist(db, { done: true });
        await db.prepare('UPDATE crm_hubspot_inbound SET next_run_at = ?, locked_until = NULL WHERE user_id = ? AND locked_until = ?').run(iso(new Date(clock() + LIVE_INTERVAL_MS)), ws, mine);
        return 'idle';
      }
      const cur = (cursors.objects[object] ??= freshCursor());
      const fields = isActivityObject(object) ? [] : (plan.fields[object] ?? []).map((f) => f.key);
      let page;
      try {
        page = await readModifiedPage(client, object, cur.read, [...INBOUND_PROPS[object], ...fields], { limit: opts.pageSize ?? PAGE_SIZE });
      } catch (e) {
        // Sin permiso para este objeto (los emails piden uno aparte): se saltea en esta vuelta y se sigue con los demás.
        if (e instanceof HubspotApiError && e.code === 'scope') {
          // Se anota una vez, no en cada vuelta.
          if (cur.error !== 'missing_scope') errors = pushErrors(errors, object, new Map([['missing_scope', 1]]), iso(new Date(clock())));
          cur.error = 'missing_scope';
          cur.done = true;
          await persist(db);
          pages++;
          continue;
        }
        throw e;
      }
      const ids = [...new Set(page.records.map((r) => r.id))];
      const assoc: Assoc = {};
      for (const to of INBOUND_ASSOC[object]) if (objects[to] && ids.length) assoc[to] = await readAssociations(client, object, to, ids);
      if (cur.read.since === 0 && !cur.read.tie && page.total !== null && !cur.caughtUp) cur.total = page.total;
      const objCounts = (counts[object] ??= emptyInboundCounts());
      const before = { ...cursors.objects[object] } as ObjectCursor;
      const nextCursor = (): void => {
        cur.error = page.incomplete ? 'incomplete' : '';
        for (const r of page.records) cur.hw = Math.max(cur.hw, r.modifiedMs);
        if (!cur.caughtUp) cur.readCount = cur.total === null ? cur.readCount + page.records.length : Math.min(cur.total, cur.readCount + page.records.length);
        if (page.next) cur.read = page.next;
        else {
          cur.done = true;
          cur.caughtUp = true;
          if (cur.total !== null) cur.readCount = cur.total;
        }
      };
      nextCursor();
      const out = await writePage(ws, conn.portalId, plan, planFresh, object, page.records, assoc, objCounts, (tx) => persist(tx));
      if (out.stale) {
        // Un dueño o una etapa nuevos en HubSpot: se renueva el plan y se vuelve a escribir la misma página.
        cursors.objects[object] = before;
        plan = await buildInboundPlan(ws, client, objects);
        planAt = iso(new Date(clock()));
        planFresh = true;
        await persist(db, { progress: false });
        pages++;
        continue;
      }
      if (out.failedFrom && (cur.retries ?? 0) < 3) cur.retryFrom = cur.retryFrom ? Math.min(cur.retryFrom, out.failedFrom) : out.failedFrom;
      if (out.codes.size || out.failedFrom) {
        errors = pushErrors(errors, object, out.codes, iso(new Date(clock())));
        await persist(db);
      }
      pages++;
    }
    return release(ws, mine, 'progress');
  } catch (err) {
    if (err instanceof LockLost) return 'not_claimed';
    const api = err instanceof HubspotApiError ? err : null;
    const now = clock();
    if (api?.code === 'auth') {
      await markConnectionError(ws, 'invalid_token');
      return fail(ws, mine, 'invalid_token', errors, now);
    }
    if (api?.code === 'rate_limited' && api.policy === 'daily') {
      await setFailure(ws, mine, 'daily_limit', errors, now, now + DAILY_WAIT_MS, false);
      return 'waiting';
    }
    const code = api ? (api.code === 'rate_limited' || api.code === 'locked' ? 'hubspot_busy' : api.code === 'network' ? 'network' : api.code === 'scope' ? 'missing_scope' : 'provider_error') : 'internal_error';
    const attempts = Number(row.attempts) + 1;
    await setFailure(ws, mine, code, errors, now, now + backoffMs(attempts), true);
    return 'retrying';
  }
}

class LockLost extends Error {}

async function release(ws: string, mine: string, result: RunStepResult): Promise<RunStepResult> {
  await getDb().prepare('UPDATE crm_hubspot_inbound SET locked_until = NULL WHERE user_id = ? AND locked_until = ?').run(ws, mine);
  return result;
}

async function setFailure(ws: string, mine: string, code: string, errors: InboundErrorEntry[], now: number, nextRun: number, countAttempt: boolean): Promise<void> {
  const list = pushErrors(errors, '', new Map([[code, 1]]), iso(new Date(now)));
  await getDb()
    .prepare(
      `UPDATE crm_hubspot_inbound SET failure = ?, errors = ?, attempts = attempts + ?, next_run_at = ?, last_run_at = ?, locked_until = NULL, updated_at = ? WHERE user_id = ? AND locked_until = ?`,
    )
    .run(code, JSON.stringify(list), countAttempt ? 1 : 0, iso(new Date(nextRun)), iso(new Date(now)), iso(new Date(now)), ws, mine);
}

/** La clave ya no sirve: no se reintenta hasta que un admin reconecte (syncGate frena por la conexión). */
async function fail(ws: string, mine: string, code: 'invalid_token' | 'portal_changed', errors: InboundErrorEntry[], now: number): Promise<RunStepResult> {
  await setFailure(ws, mine, code, errors, now, now, false);
  return 'blocked';
}

/**
 * Archivados de HubSpot: la búsqueda no los devuelve, así que se listan. Los
 * que tienen vínculo quedan 'archived'. Devuelve true si terminó el barrido.
 */
async function sweepArchived(ws: string, portalId: string, client: HubspotClient, cursors: Cursors, objects: Toggles, counts: Counts): Promise<boolean> {
  const db = getDb();
  const state = cursors.sweep ?? { i: 0, after: '' };
  const list = SYNC_OBJECTS.filter((o) => objects[o]);
  const object = list[state.i];
  if (!object) {
    cursors.sweep = null;
    return true;
  }
  const res = await client.send(`/crm/v3/objects/${object}?archived=true&limit=100&properties=hs_object_id${state.after ? `&after=${encodeURIComponent(state.after)}` : ''}`, {
    retries: 2,
    retry5xx: true,
    maxWaitMs: 4_000,
  });
  if (!res.ok) throw hubspotStatusError(res.status, res.path);
  const body = res.json() as { results?: Array<{ id: string | number }>; paging?: { next?: { after?: string } } };
  const ids = (body.results ?? []).map((r) => String(r.id));
  if (ids.length) {
    const r = await db
      .prepare(
        `UPDATE crm_hubspot_links SET state = 'archived', updated_at = ? WHERE user_id = ? AND portal_id = ? AND object = ? AND state = 'linked' AND hubspot_id IN (${ids.map(() => '?').join(',')})`,
      )
      .run(iso(), ws, portalId, LINK_OBJECT[object], ...ids);
    if (r.changes) (counts[object] ??= emptyInboundCounts()).archived += r.changes;
  }
  const after = body.paging?.next?.after ?? '';
  cursors.sweep = after ? { i: state.i, after } : { i: state.i + 1, after: '' };
  if (!after && state.i + 1 >= list.length) {
    cursors.sweep = null;
    return true;
  }
  return false;
}

/**
 * Cron: avanza la entrada de los workspaces con el sync prendido, sin pausar
 * y con su turno vencido.
 */
export async function processHubspotInbound(opts: { budgetMs?: number; limit?: number } = {}): Promise<{ workspaces: number }> {
  if (process.env.CRM_HUBSPOT_SYNC_DISABLED === '1') return { workspaces: 0 };
  const start = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const now = iso();
  const rows = (await getDb()
    .prepare(
      `SELECT i.user_id FROM crm_hubspot_inbound i JOIN crm_hubspot_sync_settings s ON s.user_id = i.user_id
       WHERE s.enabled = 1 AND s.paused = 0 AND (i.next_run_at IS NULL OR i.next_run_at <= ?) AND (i.locked_until IS NULL OR i.locked_until < ?)
       ORDER BY i.next_run_at ASC LIMIT ?`,
    )
    .all(now, now, opts.limit ?? 5)) as Array<{ user_id: string }>;
  let n = 0;
  for (const r of rows) {
    const left = budget - (Date.now() - start);
    if (left < 3_000) break;
    if ((await runInboundStep(r.user_id, { budgetMs: left })) !== 'not_claimed') n++;
  }
  return { workspaces: n };
}
