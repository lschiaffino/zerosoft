/**
 * CRM ↔ HubSpot, bloque S3: zerosoft → HubSpot. Server-only.
 *
 * Manda a HubSpot lo que cambia acá en empresas, contactos y negocios
 * vinculados (propiedades, dueño, pipeline y etapa), crea en HubSpot lo que se
 * crea acá y agrega las asociaciones que se agregan acá. Nunca borra en
 * HubSpot: borrar o archivar acá solo marca el vínculo.
 *
 * Apagado por defecto, aparte de la entrada: un admin lo prende en Ajustes ›
 * Integraciones ("Escribir en HubSpot") después de mirar la vista previa (qué
 * campos y cuántos registros saldrían). Necesita la entrada (S2) al día: se
 * apoya en sus vínculos, su plan (dueños, etapas, campos propios) y su shadow.
 * La pausa del sync pausa las dos direcciones (syncGate).
 *
 * Cola: crm_hubspot_outbox, que llenan triggers de la base (migración
 * 20261121_1947) con cada alta o cambio de un campo sincronizado y cada
 * asociación nueva, solo en un workspace con la escritura prendida. La fila
 * no lleva valores: al vaciarla se compara el registro con el shadow de su
 * vínculo (outbound-map.ts: planPush). Por eso no hay eco:
 * - lo que escribió la entrada ya está en el shadow: no hay diferencia y no
 *   sale nada (ni una lectura a HubSpot);
 * - lo que manda la salida corre el shadow a ese valor: cuando la entrada lo
 *   vuelve a leer, HubSpot y acá son iguales y no hay conflicto.
 *
 * Conflictos, en las dos direcciones: si un campo cambió acá y también en
 * HubSpot desde el último sync, no se manda (queda lo de cada lado) y se anota
 * en crm_hubspot_sync_conflicts con el nombre del campo, nunca el valor.
 *
 * Corre desde /api/cron/minute: reclama la fila del workspace
 * (compare-and-set de locked_until) y vacía la cola por tandas. Límites de
 * HubSpot como la entrada: ráfaga → esperas crecientes (1, 2, 4… hasta 30
 * minutos), límite diario → 30 minutos. Un cambio que HubSpot rechaza (400)
 * se reintenta sin las propiedades rechazadas y, si sigue, queda anotado.
 *
 * Nada de esto loguea: los errores quedan como códigos (sin datos) en la fila.
 */
import { getClient, getDb, txDb, type Db } from '../db';
import { parseCustom } from '../crm';
import { HubspotApiError, hubspotStatusError, type HubspotClient } from '../hubspot/client';
import { getSyncSettings, getSyncStatus, isBlockingConnectionError, markConnectionError, openSyncConnection, syncGate, syncHubspotClient } from './connection';
import { LINK_OBJECT } from './fields';
import { BACKOFF_MAX_MS, DAILY_WAIT_MS, LIVE_INTERVAL_MS, PLAN_TTL_MS, backoffMs } from './inbound';
import { INBOUND_PROPS, emptyPlan, localCustom, localValues, mapCustom, mapRecord, same, type InboundPlan, type Values } from './inbound-map';
import { UNKNOWN_REMOTE, changedHere, ownersOut, planPush, standardProps, toHubspot, type OutboundCtx, type PropDefs, type PushPlan } from './outbound-map';
import {
  OUTBOUND_OBJECT_NAMES,
  emptyOutboundCounts,
  type OutboundCounts,
  type OutboundErrorEntry,
  type OutboundObjectName,
  type OutboundPreview,
  type OutboundPreviewObject,
  type OutboundState,
  type OutboundView,
} from './outbound-types';
import type { SyncObject } from './reader';

// ---------- Constantes ----------

/** Cambios por tanda. */
export const OUTBOX_BATCH = 50;
/** Intentos de un cambio que HubSpot rechaza antes de dejarlo anotado. */
export const MAX_ITEM_ATTEMPTS = 4;
/** Una asociación espera a que su otro extremo se cree en HubSpot hasta estos intentos. */
const MAX_ASSOC_WAITS = 10;
/** Cuánto vale una vista previa para prender la escritura. */
export const PREVIEW_FRESH_MS = 60 * 60_000;
/** Registros vinculados que lee la vista previa por objeto. */
export const PREVIEW_CAP = 20_000;
/** Tramo de un pedido de la pantalla. */
export const REQUEST_STEP_BUDGET_MS = 6_000;
const MAX_ERRORS = 20;

const TABLE: Record<SyncObject, string> = { contacts: 'crm_contacts', companies: 'crm_companies', deals: 'crm_deals' };
const OBJECT_OF: Record<string, SyncObject> = { contact: 'contacts', company: 'companies', deal: 'deals' };

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

// ---------- Filas ----------

interface OutboundRow {
  user_id: string;
  mode: string;
  portal_id: string;
  props: string;
  props_at: string | null;
  counts: string;
  errors: string;
  failure: string;
  attempts: number;
  locked_until: string | null;
  next_run_at: string | null;
  preview: string;
  preview_at: string | null;
  enabled_by: string;
  enabled_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
}

interface InboundInfo {
  portal_id: string;
  objects: string;
  plan: string;
  initial_done_at: string | null;
}

interface OutboxItem {
  object: string;
  record_id: string;
  to_object: string;
  to_id: string;
  version: string;
  attempts: number;
  creating_at: string | null;
}

interface LinkRow {
  record_id: string;
  hubspot_id: string;
  shadow: string;
  state: string;
}

type Counts = Partial<Record<OutboundObjectName, OutboundCounts>>;
type Toggles = Record<OutboundObjectName, boolean>;

async function rowOf(ws: string, db: Db = getDb()): Promise<OutboundRow | null> {
  return ((await db.prepare('SELECT * FROM crm_hubspot_outbound WHERE user_id = ?').get(ws)) as OutboundRow | undefined) ?? null;
}

async function inboundOf(ws: string): Promise<InboundInfo | null> {
  return ((await getDb().prepare('SELECT portal_id, objects, plan, initial_done_at FROM crm_hubspot_inbound WHERE user_id = ?').get(ws)) as InboundInfo | undefined) ?? null;
}

/** Los objetos que trae la entrada son los que escribe la salida. */
function togglesOf(inbound: InboundInfo | null): Toggles {
  const saved = parseJson<Partial<Toggles>>(inbound?.objects, {});
  return Object.fromEntries(OUTBOUND_OBJECT_NAMES.map((o) => [o, saved[o] !== false])) as Toggles;
}

// ---------- Vista ----------

type Blocker = OutboundView['blocker'];

async function blockerOf(ws: string): Promise<{ blocker: Blocker; missing: string[]; portalId: string; inbound: InboundInfo | null }> {
  const [status, inbound] = await Promise.all([getSyncStatus(ws), inboundOf(ws)]);
  if (!status.connected) return { blocker: 'not_connected', missing: [], portalId: '', inbound };
  const missing = status.missingWrite;
  if (!inbound || !inbound.initial_done_at || inbound.portal_id !== status.portalId || !status.settings.enabled) return { blocker: 'read_sync_first', missing, portalId: status.portalId, inbound };
  if (missing.length) return { blocker: 'missing_write_scope', missing, portalId: status.portalId, inbound };
  return { blocker: '', missing, portalId: status.portalId, inbound };
}

/** El estado de la salida para la pantalla (solo conteos, nombres de campos y códigos). */
export async function getOutbound(ws: string): Promise<OutboundView> {
  const [row, settings, conn, b] = await Promise.all([rowOf(ws), getSyncSettings(ws), openSyncConnection(ws), blockerOf(ws)]);
  const enabled = row?.mode === 'on';
  let state: OutboundState = b.blocker ? 'unavailable' : 'off';
  if (enabled) {
    if (!conn || isBlockingConnectionError(conn.lastError) || row!.failure === 'invalid_token' || row!.failure === 'portal_changed' || row!.failure === 'missing_scope') state = 'blocked';
    else if (!settings.enabled || settings.paused) state = 'paused';
    else if (row!.failure === 'daily_limit') state = 'waiting';
    else if (row!.failure) state = 'retrying';
    else state = 'on';
  }
  const q = (await getDb()
    .prepare(`SELECT state, COUNT(*) AS n FROM crm_hubspot_outbox WHERE user_id = ? GROUP BY state`)
    .all(ws)) as Array<{ state: string; n: number }>;
  const preview = row ? parseJson<OutboundPreview | null>(row.preview, null) : null;
  return {
    state,
    enabled,
    blocker: b.blocker,
    missingScopes: b.missing,
    objects: togglesOf(b.inbound),
    counts: parseJson<Counts>(row?.counts, {}),
    queued: Number(q.find((r) => r.state === 'pending')?.n ?? 0),
    due: Number(
      ((await getDb().prepare(`SELECT COUNT(*) AS n FROM crm_hubspot_outbox WHERE user_id = ? AND state = 'pending' AND next_at <= ?`).get(ws, iso())) as { n: number }).n,
    ),
    failedItems: Number(q.find((r) => r.state === 'failed')?.n ?? 0),
    errors: parseJson<OutboundErrorEntry[]>(row?.errors, []),
    failure: row?.failure ?? '',
    preview: preview && preview.at ? preview : null,
    previewFresh: Boolean(row?.preview_at && Date.now() - Date.parse(row.preview_at) < PREVIEW_FRESH_MS),
    enabledAt: enabled ? (row?.enabled_at ?? null) : null,
    lastRunAt: row?.last_run_at ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
  };
}

// ---------- Vista previa ----------

/** Lo nuestro de un registro, normalizado como lo compara el sync. */
function localOf(object: SyncObject, row: Record<string, unknown>, plan: InboundPlan): Values {
  return { ...localValues(object, row), ...localCustom(plan.fields[object] ?? [], parseCustom(String(row.custom ?? '{}'))) };
}

/**
 * Recorre los registros vinculados de un objeto y llama `each` con los que
 * cambiaron acá desde el último sync (y los campos). Por id, de a 500.
 */
async function scanChanged(ws: string, portalId: string, object: SyncObject, plan: InboundPlan, cap: number, each: (id: string, fields: string[]) => void): Promise<{ truncated: boolean }> {
  const db = getDb();
  let after = '';
  let seen = 0;
  for (;;) {
    const rows = (await db
      .prepare(
        `SELECT l.record_id AS link_record_id, l.shadow AS link_shadow, r.* FROM crm_hubspot_links l JOIN ${TABLE[object]} r ON r.id = l.record_id AND r.user_id = l.user_id
         WHERE l.user_id = ? AND l.portal_id = ? AND l.object = ? AND l.state = 'linked' AND l.record_id > ? ORDER BY l.record_id LIMIT 500`,
      )
      .all(ws, portalId, LINK_OBJECT[object], after)) as Array<Record<string, unknown> & { link_record_id: string; link_shadow: string }>;
    if (!rows.length) return { truncated: false };
    for (const r of rows) {
      const fields = changedHere(localOf(object, r, plan), parseJson<Values>(r.link_shadow, {}));
      if (fields.length) each(r.link_record_id, fields);
      if (++seen >= cap) return { truncated: true };
    }
    after = rows[rows.length - 1].link_record_id;
  }
}

async function queuedCounts(ws: string, object: SyncObject, portalId: string): Promise<{ create: number; associations: number }> {
  const link = LINK_OBJECT[object];
  const row = (await getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN q.to_object = '' AND NOT EXISTS (SELECT 1 FROM crm_hubspot_links l WHERE l.user_id = q.user_id AND l.object = q.object AND l.record_id = q.record_id AND l.portal_id = ?) THEN 1 ELSE 0 END) AS c,
         SUM(CASE WHEN q.to_object != '' THEN 1 ELSE 0 END) AS a
       FROM crm_hubspot_outbox q WHERE q.user_id = ? AND q.object = ? AND q.state = 'pending'`,
    )
    .get(portalId, ws, link)) as { c: number | null; a: number | null } | undefined;
  return { create: Number(row?.c ?? 0), associations: Number(row?.a ?? 0) };
}

export type OutboundActionResult = { ok: true; outbound: OutboundView } | { ok: false; code: 'not_connected' | 'read_sync_first' | 'missing_write_scope' | 'preview_required' | 'portal_changed' | 'key_invalid'; missing?: string[] };

/**
 * La vista previa (dry run): qué saldría a HubSpot si se prende la escritura
 * ahora. Solo lee la base (no llama a HubSpot): registros vinculados con
 * campos cambiados acá, y lo que ya está en la cola. Guarda nombres de campos
 * y conteos, nunca valores.
 */
export async function previewOutbound(ws: string): Promise<OutboundActionResult> {
  const b = await blockerOf(ws);
  if (b.blocker === 'not_connected' || b.blocker === 'read_sync_first') return { ok: false, code: b.blocker };
  const plan = parseJson<InboundPlan>(b.inbound?.plan, emptyPlan());
  const toggled = togglesOf(b.inbound);
  const objects: OutboundPreview['objects'] = {};
  for (const o of OUTBOUND_OBJECT_NAMES) {
    if (!toggled[o]) continue;
    const out: OutboundPreviewObject = { records: 0, fields: {}, create: 0, associations: 0 };
    const res = await scanChanged(ws, b.portalId, o, plan, PREVIEW_CAP, (_id, fields) => {
      out.records++;
      for (const f of fields) out.fields[f] = (out.fields[f] ?? 0) + 1;
    });
    if (res.truncated) out.truncated = true;
    Object.assign(out, await queuedCounts(ws, o, b.portalId));
    objects[o] = out;
  }
  const at = iso();
  const preview: OutboundPreview = { at, objects };
  await getDb()
    .prepare(
      `INSERT INTO crm_hubspot_outbound (user_id, portal_id, preview, preview_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET portal_id = excluded.portal_id, preview = excluded.preview, preview_at = excluded.preview_at, updated_at = excluded.updated_at`,
    )
    .run(ws, b.portalId, JSON.stringify(preview), at, at);
  return { ok: true, outbound: await getOutbound(ws) };
}

/**
 * Prende o apaga la escritura. Prender pide la entrada al día, los permisos
 * de escritura y una vista previa reciente; pone en la cola los registros
 * vinculados que cambiaron acá desde el último sync (lo que mostró la vista
 * previa). Apagar deja la cola como está: lo que quede se compara de nuevo con
 * HubSpot si se vuelve a prender.
 */
export async function setOutboundMode(ws: string, actor: string, on: boolean): Promise<OutboundActionResult> {
  const now = iso();
  const db = getDb();
  if (!on) {
    await db.prepare(`UPDATE crm_hubspot_outbound SET mode = 'off', updated_at = ? WHERE user_id = ?`).run(now, ws);
    return { ok: true, outbound: await getOutbound(ws) };
  }
  const conn = await openSyncConnection(ws);
  if (conn && isBlockingConnectionError(conn.lastError)) return { ok: false, code: conn.lastError === 'portal_changed' ? 'portal_changed' : 'key_invalid' };
  const b = await blockerOf(ws);
  if (b.blocker) return { ok: false, code: b.blocker, ...(b.blocker === 'missing_write_scope' ? { missing: b.missing } : {}) };
  const row = await rowOf(ws);
  // Ya prendida: no se toca el turno ni las esperas de una vuelta en curso.
  if (row?.mode === 'on' && row.portal_id === b.portalId) return { ok: true, outbound: await getOutbound(ws) };
  if (!row?.preview_at || Date.now() - Date.parse(row.preview_at) >= PREVIEW_FRESH_MS || row.portal_id !== b.portalId) return { ok: false, code: 'preview_required' };
  // Primero prendida (los triggers empiezan a anotar), después lo que ya había cambiado acá.
  await db
    .prepare(
      `UPDATE crm_hubspot_outbound SET mode = 'on', portal_id = ?, failure = '', attempts = 0, locked_until = NULL, next_run_at = ?, enabled_by = ?, enabled_at = ?, updated_at = ? WHERE user_id = ?`,
    )
    .run(b.portalId, now, actor, now, now, ws);
  const plan = parseJson<InboundPlan>(b.inbound?.plan, emptyPlan());
  const toggled = togglesOf(b.inbound);
  for (const o of OUTBOUND_OBJECT_NAMES) {
    if (!toggled[o]) continue;
    const ids: string[] = [];
    await scanChanged(ws, b.portalId, o, plan, Number.MAX_SAFE_INTEGER, (id) => ids.push(id));
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      await db
        .prepare(
          `INSERT OR IGNORE INTO crm_hubspot_outbox (user_id, object, record_id, to_object, to_id, version, queued_at)
           VALUES ${part.map(() => `(?, ?, ?, '', '', lower(hex(randomblob(8))), datetime('now'))`).join(', ')}`,
        )
        .run(...part.flatMap((id) => [ws, LINK_OBJECT[o], id]));
    }
  }
  return { ok: true, outbound: await getOutbound(ws) };
}

// ---------- Plan de la salida ----------

interface HsPropertyApi {
  name: string;
  type: string;
  calculated?: boolean;
  modificationMetadata?: { readOnlyValue?: boolean };
  options?: Array<{ label: string; value: string; hidden?: boolean }>;
}

/** Definiciones de las propiedades que la salida puede escribir (estándar y propias del plan). */
async function loadPropDefs(client: HubspotClient, objects: SyncObject[], plan: InboundPlan): Promise<Partial<Record<SyncObject, PropDefs>>> {
  const out: Partial<Record<SyncObject, PropDefs>> = {};
  for (const object of objects) {
    const res = await client.send(`/crm/v3/properties/${object}`, { retries: 2, retry5xx: true, maxWaitMs: 4_000 });
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    const wanted = new Set([...standardProps(object), ...(plan.fields[object] ?? []).map((f) => f.key)]);
    const defs: PropDefs = {};
    for (const p of (res.json() as { results?: HsPropertyApi[] }).results ?? []) {
      if (!wanted.has(p.name)) continue;
      defs[p.name] = {
        type: p.type,
        readOnly: p.modificationMetadata?.readOnlyValue === true || p.calculated === true,
        ...(p.options?.length ? { options: p.options.map((o) => ({ value: String(o.value), label: String(o.label ?? '') })) } : {}),
      };
    }
    out[object] = defs;
  }
  return out;
}

/** Etapa nuestra → etapa y pipeline de HubSpot (los vínculos que dejó la entrada). */
async function stagesOut(ws: string, plan: InboundPlan): Promise<Map<string, { stage: string; pipeline: string }>> {
  const pipes = (await getDb()
    .prepare(`SELECT external_id, record_id FROM crm_external_ids WHERE user_id = ? AND provider = 'hubspot' AND object = 'pipeline'`)
    .all(ws)) as Array<{ external_id: string; record_id: string }>;
  const pipeOut = new Map(pipes.map((p) => [p.record_id, p.external_id]));
  const out = new Map<string, { stage: string; pipeline: string }>();
  for (const [hsStage, s] of Object.entries(plan.stages)) {
    const pipeline = pipeOut.get(s.pipelineId);
    if (pipeline && !out.has(s.id)) out.set(s.id, { stage: hsStage, pipeline });
  }
  return out;
}

// ---------- Vaciar la cola ----------

export interface OutboundStepOptions {
  budgetMs?: number;
  /** Tope de tandas (tests). */
  maxBatches?: number;
  now?: () => number;
}

export type OutboundStepResult = 'not_claimed' | 'progress' | 'idle' | 'waiting' | 'retrying' | 'blocked' | 'paused';

class LockLost extends Error {}

interface StepCtx {
  db: Db;
  ws: string;
  portalId: string;
  client: HubspotClient;
  plan: InboundPlan;
  defs: Partial<Record<SyncObject, PropDefs>>;
  owners: Map<string, string>;
  stages: Map<string, { stage: string; pipeline: string }>;
  toggled: Toggles;
  counts: Counts;
  codes: Map<string, number>;
  clock: () => number;
}

function note(ctx: StepCtx, object: string, code: string, n = 1): void {
  const key = `${object}|${code}`;
  ctx.codes.set(key, (ctx.codes.get(key) ?? 0) + n);
}

function bump(ctx: StepCtx, object: SyncObject, k: keyof OutboundCounts, n = 1): void {
  (ctx.counts[object] ??= emptyOutboundCounts())[k] += n;
}

function ctxFor(ctx: StepCtx, object: SyncObject): OutboundCtx {
  return { owners: ctx.owners, stages: ctx.stages, fields: ctx.plan.fields[object] ?? [], defs: ctx.defs[object] ?? {} };
}

/** Saca un cambio de la cola, salvo que haya llegado uno más nuevo mientras tanto. */
async function done(db: Db, ws: string, item: OutboxItem): Promise<void> {
  await db
    .prepare('DELETE FROM crm_hubspot_outbox WHERE user_id = ? AND object = ? AND record_id = ? AND to_object = ? AND to_id = ? AND version = ?')
    .run(ws, item.object, item.record_id, item.to_object, item.to_id, item.version);
}

/** Un cambio que no salió: se reintenta más tarde y, pasado el tope, queda anotado como fallido hasta que el registro se edite otra vez. */
async function retryLater(ctx: StepCtx, item: OutboxItem, code: string, max = MAX_ITEM_ATTEMPTS): Promise<void> {
  const attempts = item.attempts + 1;
  const state = attempts >= max ? 'failed' : 'pending';
  const next = iso(new Date(ctx.clock() + Math.min(backoffMs(attempts) * 2, BACKOFF_MAX_MS)));
  await ctx.db
    .prepare('UPDATE crm_hubspot_outbox SET attempts = ?, state = ?, next_at = ?, code = ? WHERE user_id = ? AND object = ? AND record_id = ? AND to_object = ? AND to_id = ? AND version = ?')
    .run(attempts, state, next, code, ctx.ws, item.object, item.record_id, item.to_object, item.to_id, item.version);
}

/** Lee registros de HubSpot por id. Los que no están (archivados o borrados allá) no vuelven. */
async function readRemote(ctx: StepCtx, object: SyncObject, ids: string[]): Promise<Map<string, Record<string, string | null>>> {
  const props = [...INBOUND_PROPS[object], ...(ctx.plan.fields[object] ?? []).map((f) => f.key)];
  const out = new Map<string, Record<string, string | null>>();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await ctx.client.send(`/crm/v3/objects/${object}/batch/read`, {
      method: 'POST',
      body: { inputs: ids.slice(i, i + 100).map((id) => ({ id })), properties: props },
      retries: 2,
      retry5xx: true,
      maxWaitMs: 4_000,
    });
    if (!res.ok && res.status !== 207) throw hubspotStatusError(res.status, res.path);
    for (const r of (res.json() as { results?: Array<{ id: string | number; properties?: Record<string, string | null> }> }).results ?? []) out.set(String(r.id), r.properties ?? {});
  }
  return out;
}

/** Valores de HubSpot como los compara el sync; lo que la entrada no sabe traducir queda como desconocido. */
function remoteValues(ctx: StepCtx, object: SyncObject, props: Record<string, string | null>): Values {
  const mapped = mapRecord(object, props, ctx.plan);
  const custom = mapCustom(ctx.plan.fields[object] ?? [], props);
  const out: Values = { ...mapped.values, ...custom.values };
  for (const f of [...mapped.skip, ...custom.skip]) out[f] = UNKNOWN_REMOTE;
  return out;
}

/** Nombres de las propiedades que un 400 de HubSpot dice que no acepta (el mensaje puede traer valores: solo se usan los nombres, en memoria). */
function rejectedProps(res: { json(): Record<string, unknown> }): string[] {
  const body = res.json() as { message?: unknown; errors?: Array<{ context?: { propertyName?: unknown[] } }> };
  const names = new Set<string>();
  for (const e of body.errors ?? []) for (const n of e.context?.propertyName ?? []) names.add(String(n));
  const msg = typeof body.message === 'string' ? body.message : '';
  for (const m of msg.matchAll(/"name"\s*:\s*"([a-z0-9_]+)"/gi)) names.add(m[1]);
  return [...names];
}

type WriteResult = { ok: true; id: string; sent: Record<string, string> } | { ok: false; code: 'not_found' | 'email_taken' | 'value_not_accepted' | 'rejected'; existingId?: string };

/**
 * Escribe propiedades en HubSpot (PATCH de un registro o POST de uno nuevo).
 * Un 400 por propiedades que HubSpot no acepta se reintenta una vez sin
 * ellas; un 409 de email repetido en un contacto, sin el email.
 */
async function writeProps(ctx: StepCtx, object: SyncObject, hubspotId: string | null, props: Record<string, string>): Promise<WriteResult> {
  let sent = { ...props };
  for (let round = 0; round < 3; round++) {
    const res = hubspotId
      ? await ctx.client.send(`/crm/v3/objects/${object}/${encodeURIComponent(hubspotId)}`, { method: 'PATCH', body: { properties: sent }, retries: 2, retry5xx: true, maxWaitMs: 4_000 })
      : // Un alta no se reintenta a ciegas ante un 5xx o un corte: podría haberse creado.
        await ctx.client.send(`/crm/v3/objects/${object}`, { method: 'POST', body: { properties: sent }, retries: 2, retry5xx: false, retryNetwork: false, maxWaitMs: 4_000 });
    if (res.ok) return { ok: true, id: hubspotId ?? String((res.json() as { id?: unknown }).id ?? ''), sent };
    if (res.status === 404 && hubspotId) return { ok: false, code: 'not_found' };
    if (res.status === 409 && object === 'contacts') {
      const existing = /Existing ID:\s*(\d+)/i.exec(String((res.json() as { message?: unknown }).message ?? ''))?.[1];
      if (!hubspotId) return { ok: false, code: 'email_taken', existingId: existing };
      if (!('email' in sent)) return { ok: false, code: 'email_taken' };
      note(ctx, object, 'email_taken');
      const { email: _drop, ...rest } = sent;
      sent = rest;
      if (!Object.keys(sent).length) return { ok: false, code: 'email_taken' };
      continue;
    }
    if (res.status === 400) {
      const bad = rejectedProps(res).filter((n) => n in sent);
      if (!bad.length || round === 2) return { ok: false, code: 'value_not_accepted' };
      note(ctx, object, 'value_not_accepted', bad.length);
      for (const n of bad) delete sent[n];
      if (!Object.keys(sent).length) return { ok: false, code: 'value_not_accepted' };
      continue;
    }
    // Otro 4xx de este registro (una propiedad única repetida, un 409, un 422): queda en este cambio, no frena la cola.
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 423 && res.status !== 429) return { ok: false, code: 'rejected' };
    throw hubspotStatusError(res.status, res.path);
  }
  return { ok: false, code: 'value_not_accepted' };
}

/** Pasa los campos de `fields` a propiedades de HubSpot; lo que no se puede, con su código. */
function convert(ctx: StepCtx, object: SyncObject, local: Values, fields: string[]): { props: Record<string, string>; byField: Map<string, string[]>; skipped: string[] } {
  const props: Record<string, string> = {};
  const byField = new Map<string, string[]>();
  const skipped: string[] = [];
  const oc = ctxFor(ctx, object);
  for (const f of fields) {
    const c = toHubspot(object, f, local[f] ?? '', oc);
    if (!c.ok) {
      note(ctx, object, c.code);
      skipped.push(f);
      continue;
    }
    Object.assign(props, c.props);
    byField.set(f, Object.keys(c.props));
  }
  return { props, byField, skipped };
}

/** Corre el shadow del vínculo a los valores que quedaron iguales de los dos lados (en una transacción con sacar el cambio de la cola). */
/**
 * Anota los conflictos de esta vuelta sin borrar los que anotó la entrada: a
 * la lista guardada se le sacan los campos que quedaron iguales (`resolved`)
 * y se le suman los nuevos. Solo nombres de campos.
 */
async function mergeConflicts(db: Db, ws: string, linkObject: string, recordId: string, hubspotId: string, conflicts: string[], resolved: string[]): Promise<void> {
  const row = (await db.prepare(`SELECT fields FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND object = ? AND record_id = ? AND kind = 'fields'`).get(ws, linkObject, recordId)) as
    | { fields: string }
    | undefined;
  const merged = new Set((row?.fields ?? '').split(',').filter(Boolean));
  for (const f of resolved) merged.delete(f);
  for (const f of conflicts) merged.add(f);
  if (!merged.size) {
    await db.prepare(`DELETE FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND object = ? AND record_id = ? AND kind = 'fields'`).run(ws, linkObject, recordId);
    return;
  }
  const now = iso();
  await db
    .prepare(
      `INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields, created_at, updated_at) VALUES (?, ?, ?, ?, 'fields', ?, ?, ?)
       ON CONFLICT(user_id, object, record_id) DO UPDATE SET hubspot_id = excluded.hubspot_id, kind = excluded.kind, fields = excluded.fields, updated_at = excluded.updated_at`,
    )
    .run(ws, linkObject, recordId, hubspotId, [...merged].join(',').slice(0, 1000), now, now);
}

async function settle(ctx: StepCtx, object: SyncObject, recordId: string, item: OutboxItem, values: Values, conflicts: string[], hubspotId: string): Promise<void> {
  const tx = await getClient().transaction('write');
  const db = txDb(tx);
  try {
    const link = (await db
      .prepare('SELECT shadow FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND record_id = ? AND portal_id = ?')
      .get(ctx.ws, LINK_OBJECT[object], recordId, ctx.portalId)) as { shadow: string } | undefined;
    if (link && Object.keys(values).length) {
      const shadow = { ...parseJson<Values>(link.shadow, {}), ...values };
      await db
        .prepare('UPDATE crm_hubspot_links SET shadow = ?, updated_at = ? WHERE user_id = ? AND object = ? AND record_id = ? AND portal_id = ?')
        .run(JSON.stringify(shadow), iso(), ctx.ws, LINK_OBJECT[object], recordId, ctx.portalId);
    }
    await mergeConflicts(db, ctx.ws, LINK_OBJECT[object], recordId, hubspotId, conflicts, Object.keys(values));
    await done(db, ctx.ws, item);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/** Cambios de registros de un objeto: los vinculados se comparan y se mandan; los nuevos se crean (o se vinculan). */
async function pushRecords(ctx: StepCtx, object: SyncObject, items: OutboxItem[]): Promise<void> {
  const ids = items.map((i) => i.record_id);
  const ph = ids.map(() => '?').join(',');
  const rows = (await ctx.db.prepare(`SELECT * FROM ${TABLE[object]} WHERE user_id = ? AND id IN (${ph})`).all(ctx.ws, ...ids)) as Array<Record<string, unknown>>;
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const links = (await ctx.db
    .prepare(`SELECT record_id, hubspot_id, shadow, state FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND portal_id = ? AND record_id IN (${ph})`)
    .all(ctx.ws, LINK_OBJECT[object], ctx.portalId, ...ids)) as LinkRow[];
  const linkOf = new Map(links.map((l) => [l.record_id, l]));

  const toCompare: Array<{ item: OutboxItem; link: LinkRow; local: Values; shadow: Values }> = [];
  for (const item of items) {
    const row = byId.get(item.record_id);
    const link = linkOf.get(item.record_id);
    if (!row) {
      // Borrado acá: el trigger ya marcó el vínculo. En HubSpot no se borra nada.
      await done(ctx.db, ctx.ws, item);
      continue;
    }
    if (link && link.state !== 'linked') {
      // Archivado o fusionado en HubSpot, o borrado acá y restaurado sin vínculo: no se escribe.
      bump(ctx, object, 'skipped');
      await done(ctx.db, ctx.ws, item);
      continue;
    }
    const local = localOf(object, row, ctx.plan);
    if (!link) {
      await createRecord(ctx, object, item, local);
      continue;
    }
    const shadow = parseJson<Values>(link.shadow, {});
    // Sin cambios contra el shadow: lo escribió la entrada (o ya salió). Ni se le pregunta a HubSpot.
    if (!changedHere(local, shadow).length) {
      bump(ctx, object, 'skipped');
      await done(ctx.db, ctx.ws, item);
      continue;
    }
    toCompare.push({ item, link, local, shadow });
  }
  if (!toCompare.length) return;

  const remote = await readRemote(ctx, object, toCompare.map((x) => x.link.hubspot_id));
  for (const { item, link, local, shadow } of toCompare) {
    const props = remote.get(link.hubspot_id);
    if (!props) {
      // HubSpot ya no lo tiene (archivado, borrado o fusionado allá): no se escribe. El barrido de la entrada marca el vínculo.
      note(ctx, object, 'not_found');
      await done(ctx.db, ctx.ws, item);
      continue;
    }
    const plan: PushPlan = planPush(local, shadow, remoteValues(ctx, object, props));
    // Un negocio que pasa acá a una etapa perdida lleva su motivo en el mismo envío (la entrada no lo sigue mientras allá no está perdido).
    if (object === 'deals' && plan.push.includes('stage_id') && local.lost_reason && !plan.push.includes('lost_reason') && Object.values(ctx.plan.stages).some((st) => st.id === local.stage_id && st.lost)) {
      plan.push.push('lost_reason');
    }
    const settled: Values = {};
    for (const f of plan.agree) settled[f] = local[f];
    const { props: out, byField } = convert(ctx, object, local, plan.push);
    if (plan.conflicts.length) bump(ctx, object, 'conflicts');
    if (!Object.keys(out).length) {
      if (!plan.conflicts.length) bump(ctx, object, 'skipped');
      await settle(ctx, object, item.record_id, item, settled, plan.conflicts, link.hubspot_id);
      continue;
    }
    const res = await writeProps(ctx, object, link.hubspot_id, out);
    if (!res.ok) {
      if (res.code === 'not_found') {
        note(ctx, object, 'not_found');
        await done(ctx.db, ctx.ws, item);
        continue;
      }
      bump(ctx, object, 'failed');
      note(ctx, object, res.code);
      await retryLater(ctx, item, res.code);
      continue;
    }
    // Solo los campos que salieron enteros corren el shadow; uno sin mandar sigue pendiente para la próxima edición.
    for (const [f, keys] of byField) if (keys.every((k) => k in res.sent)) settled[f] = local[f];
    bump(ctx, object, 'updated');
    await settle(ctx, object, item.record_id, item, settled, plan.conflicts, link.hubspot_id);
  }
}

/** Un registro de HubSpot que ya es este (mismo email, mismo dominio, o el alta anterior que no llegó a vincularse). */
async function findExisting(ctx: StepCtx, object: SyncObject, item: OutboxItem, local: Values): Promise<{ id: string | null; ambiguous?: boolean; taken?: boolean; uncertain?: boolean }> {
  const linked = async (id: string) =>
    Boolean(await ctx.db.prepare('SELECT 1 AS one FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND hubspot_id = ?').get(ctx.ws, ctx.portalId, LINK_OBJECT[object], id));
  const search = async (filters: Array<Record<string, string>>): Promise<string[]> => {
    const res = await ctx.client.send(`/crm/v3/objects/${object}/search`, {
      method: 'POST',
      body: { filterGroups: [{ filters }], properties: ['hs_object_id'], limit: 10 },
      retries: 2,
      retry5xx: true,
      maxWaitMs: 4_000,
    });
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    return ((res.json() as { results?: Array<{ id: string | number }> }).results ?? []).map((r) => String(r.id));
  };
  if (object === 'contacts' && local.email) {
    const res = await ctx.client.send(`/crm/v3/objects/contacts/batch/read`, {
      method: 'POST',
      body: { idProperty: 'email', inputs: [{ id: local.email }], properties: ['email'] },
      retries: 2,
      retry5xx: true,
      maxWaitMs: 4_000,
    });
    if (!res.ok && res.status !== 207) throw hubspotStatusError(res.status, res.path);
    const hit = ((res.json() as { results?: Array<{ id: string | number }> }).results ?? [])[0];
    if (!hit) return { id: null };
    return (await linked(String(hit.id))) ? { id: null, taken: true } : { id: String(hit.id) };
  }
  let hits: string[] = [];
  const nameKey = object === 'contacts' ? [local.first_name, local.last_name].filter(Boolean).join(' ') : local.name;
  // Un alta anterior que pudo haberse hecho, sin clave para buscarla: no se vuelve a crear a ciegas.
  if (item.creating_at && !(object === 'companies' && local.domain) && !nameKey) return { id: null, uncertain: true };
  if (object === 'contacts' && item.creating_at) {
    const since = Date.parse(item.creating_at) - 60_000;
    hits = await search([
      ...(local.first_name ? [{ propertyName: 'firstname', operator: 'EQ', value: local.first_name }] : []),
      ...(local.last_name ? [{ propertyName: 'lastname', operator: 'EQ', value: local.last_name }] : []),
      { propertyName: 'createdate', operator: 'GTE', value: String(Number.isFinite(since) ? since : 0) },
    ]);
  } else if (object === 'companies' && local.domain) hits = await search([{ propertyName: 'domain', operator: 'EQ', value: local.domain }]);
  else if (item.creating_at && local.name) {
    // Un alta anterior pudo haberse hecho sin llegar a guardar el vínculo: se busca por nombre desde ese momento.
    const since = Date.parse(item.creating_at) - 60_000;
    hits = await search([
      { propertyName: object === 'deals' ? 'dealname' : 'name', operator: 'EQ', value: local.name },
      { propertyName: 'createdate', operator: 'GTE', value: String(Number.isFinite(since) ? since : 0) },
    ]);
  }
  const free: string[] = [];
  for (const id of hits) if (!(await linked(id))) free.push(id);
  if (free.length > 1) return { id: null, ambiguous: true };
  return { id: free[0] ?? null };
}

/** Un registro nuevo acá: se vincula al que ya esté en HubSpot (email o dominio) o se crea allá, con sus asociaciones. */
async function createRecord(ctx: StepCtx, object: SyncObject, item: OutboxItem, local: Values): Promise<void> {
  const fields = Object.keys(local).filter((f) => local[f] !== '');
  const existing = await findExisting(ctx, object, item, local);
  if (existing.ambiguous || existing.taken || existing.uncertain) {
    const code = existing.ambiguous ? 'ambiguous_match' : existing.taken ? 'email_taken' : 'create_uncertain';
    note(ctx, object, code);
    bump(ctx, object, 'failed');
    await retryLater(ctx, item, code, 1);
    return;
  }
  let hubspotId = existing.id;
  const shadow: Values = {};
  const conflicts: string[] = [];
  if (hubspotId) {
    // Ya estaba allá: lo igual queda vinculado, lo vacío allá se completa con lo de acá y lo distinto es un conflicto.
    const props = (await readRemote(ctx, object, [hubspotId])).get(hubspotId);
    if (!props) {
      hubspotId = null;
    } else {
      const remote = remoteValues(ctx, object, props);
      const fill: string[] = [];
      for (const [f, r] of Object.entries(remote)) {
        const l = local[f] ?? '';
        if (r === UNKNOWN_REMOTE) continue;
        if (same(f, l, r)) shadow[f] = r;
        else if (r === '') fill.push(f);
        // Vacío acá y con valor allá: sin shadow, la entrada lo completa en su próxima vuelta.
        else if (l !== '') conflicts.push(f);
      }
      const { props: out, byField } = convert(ctx, object, local, fill);
      if (Object.keys(out).length) {
        const res = await writeProps(ctx, object, hubspotId, out);
        if (res.ok) for (const [f, keys] of byField) if (keys.every((k) => k in res.sent)) shadow[f] = local[f];
      }
      bump(ctx, object, 'matched');
      if (conflicts.length) bump(ctx, object, 'conflicts');
    }
  }
  if (!hubspotId) {
    const { props, byField, skipped } = convert(ctx, object, local, fields);
    if (object === 'deals' && (skipped.includes('stage_id') || !props.dealstage)) {
      // Sin una etapa equivalente allá no hay dónde crearlo.
      bump(ctx, object, 'failed');
      await retryLater(ctx, item, 'stage_unmapped', 1);
      return;
    }
    await ctx.db
      .prepare('UPDATE crm_hubspot_outbox SET creating_at = ? WHERE user_id = ? AND object = ? AND record_id = ? AND to_object = ? AND to_id = ?')
      .run(iso(new Date(ctx.clock())), ctx.ws, item.object, item.record_id, item.to_object, item.to_id);
    const res = await writeProps(ctx, object, null, props);
    if (!res.ok) {
      if (res.code === 'email_taken' && res.existingId && !(await ctx.db.prepare('SELECT 1 AS one FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND hubspot_id = ?').get(ctx.ws, ctx.portalId, LINK_OBJECT[object], res.existingId))) {
        // Apareció allá entre la búsqueda y el alta: la vuelta siguiente lo vincula.
        await retryLater(ctx, item, 'email_taken');
        return;
      }
      bump(ctx, object, 'failed');
      note(ctx, object, res.code);
      await retryLater(ctx, item, res.code);
      return;
    }
    hubspotId = res.id;
    for (const [f, keys] of byField) if (keys.every((k) => k in res.sent)) shadow[f] = local[f];
    bump(ctx, object, 'created');
  }
  const linkObject = LINK_OBJECT[object];
  const now = iso();
  const tx = await getClient().transaction('write');
  const db = txDb(tx);
  try {
    const put = await db
      .prepare(
        `INSERT INTO crm_hubspot_links (user_id, object, record_id, portal_id, hubspot_id, hubspot_modified_at, shadow, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'linked', ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(ctx.ws, linkObject, item.record_id, ctx.portalId, hubspotId, JSON.stringify(shadow), now, now);
    if (!put.changes) note(ctx, object, 'linked_meanwhile');
    if (conflicts.length) await mergeConflicts(db, ctx.ws, linkObject, item.record_id, hubspotId!, conflicts, []);
    // Sus asociaciones con registros vinculados van a la cola (se agregan allá en esta misma vuelta o la siguiente).
    const pairs = await localPairs(db, ctx.ws, linkObject, item.record_id);
    for (const p of pairs) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO crm_hubspot_outbox (user_id, object, record_id, to_object, to_id, version, queued_at) VALUES (?, ?, ?, ?, ?, lower(hex(randomblob(8))), datetime('now'))`,
        )
        .run(ctx.ws, p.from, p.fromId, p.to, p.toId);
    }
    await done(db, ctx.ws, item);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/** Asociaciones de un registro nuestro, como pares (de contacto o negocio hacia empresa o contacto). */
async function localPairs(db: Db, ws: string, linkObject: string, id: string): Promise<Array<{ from: string; fromId: string; to: string; toId: string }>> {
  const out: Array<{ from: string; fromId: string; to: string; toId: string }> = [];
  if (linkObject === 'contact') {
    for (const r of (await db.prepare('SELECT company_id AS id FROM crm_contact_companies WHERE user_id = ? AND contact_id = ?').all(ws, id)) as Array<{ id: string }>) out.push({ from: 'contact', fromId: id, to: 'company', toId: r.id });
    for (const r of (await db.prepare('SELECT dc.deal_id AS id FROM crm_deal_contacts dc JOIN crm_deals d ON d.id = dc.deal_id AND d.user_id = ? WHERE dc.contact_id = ?').all(ws, id)) as Array<{ id: string }>) out.push({ from: 'deal', fromId: r.id, to: 'contact', toId: id });
  } else if (linkObject === 'deal') {
    for (const r of (await db.prepare('SELECT company_id AS id FROM crm_deal_companies WHERE user_id = ? AND deal_id = ?').all(ws, id)) as Array<{ id: string }>) out.push({ from: 'deal', fromId: id, to: 'company', toId: r.id });
    for (const r of (await db.prepare('SELECT dc.contact_id AS id FROM crm_deal_contacts dc JOIN crm_deals d ON d.id = dc.deal_id AND d.user_id = ? WHERE dc.deal_id = ?').all(ws, id)) as Array<{ id: string }>) out.push({ from: 'deal', fromId: id, to: 'contact', toId: r.id });
  } else {
    for (const r of (await db.prepare('SELECT contact_id AS id FROM crm_contact_companies WHERE user_id = ? AND company_id = ?').all(ws, id)) as Array<{ id: string }>) out.push({ from: 'contact', fromId: r.id, to: 'company', toId: id });
    for (const r of (await db.prepare('SELECT deal_id AS id FROM crm_deal_companies WHERE user_id = ? AND company_id = ?').all(ws, id)) as Array<{ id: string }>) out.push({ from: 'deal', fromId: r.id, to: 'company', toId: id });
  }
  return out;
}

/** ¿Sigue existiendo acá esa asociación? */
async function stillAssociated(db: Db, ws: string, item: OutboxItem): Promise<boolean> {
  const q =
    item.object === 'contact'
      ? 'SELECT 1 AS one FROM crm_contact_companies WHERE user_id = ? AND contact_id = ? AND company_id = ?'
      : item.to_object === 'company'
        ? 'SELECT 1 AS one FROM crm_deal_companies WHERE user_id = ? AND deal_id = ? AND company_id = ?'
        : 'SELECT 1 AS one FROM crm_deal_contacts dc JOIN crm_deals d ON d.id = dc.deal_id AND d.user_id = ? WHERE dc.deal_id = ? AND dc.contact_id = ?';
  return Boolean(await db.prepare(q).get(ws, item.record_id, item.to_id));
}

/** Asociaciones agregadas acá: si los dos registros están vinculados y HubSpot no la tiene, se agrega allá. Nunca se quita una. */
async function pushAssociations(ctx: StepCtx, items: OutboxItem[]): Promise<void> {
  const linkId = async (object: string, id: string): Promise<string | null> =>
    ((await ctx.db
      .prepare(`SELECT hubspot_id FROM crm_hubspot_links WHERE user_id = ? AND portal_id = ? AND object = ? AND record_id = ? AND state = 'linked'`)
      .get(ctx.ws, ctx.portalId, object, id)) as { hubspot_id: string } | undefined)?.hubspot_id ?? null;
  const waiting = async (object: string, id: string) =>
    Boolean(await ctx.db.prepare(`SELECT 1 AS one FROM crm_hubspot_outbox WHERE user_id = ? AND object = ? AND record_id = ? AND to_object = '' AND state = 'pending'`).get(ctx.ws, object, id));
  const ready: Array<{ item: OutboxItem; from: SyncObject; to: SyncObject; fromHs: string; toHs: string }> = [];
  for (const item of items) {
    const from = OBJECT_OF[item.object];
    const to = OBJECT_OF[item.to_object];
    if (!from || !to || !ctx.toggled[from] || !ctx.toggled[to] || !(await stillAssociated(ctx.db, ctx.ws, item))) {
      await done(ctx.db, ctx.ws, item);
      continue;
    }
    const [fromHs, toHs] = [await linkId(item.object, item.record_id), await linkId(item.to_object, item.to_id)];
    if (!fromHs || !toHs) {
      // Un extremo todavía no está en HubSpot: si está en la cola para crearse, se espera; si no, no hay a dónde asociar.
      if ((!fromHs && (await waiting(item.object, item.record_id))) || (!toHs && (await waiting(item.to_object, item.to_id)))) await retryLater(ctx, item, 'waiting_link', MAX_ASSOC_WAITS);
      else await done(ctx.db, ctx.ws, item);
      continue;
    }
    ready.push({ item, from, to, fromHs, toHs });
  }
  const groups = new Map<string, typeof ready>();
  for (const r of ready) {
    const k = `${r.from}/${r.to}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [key, list] of groups) {
    const [from, to] = key.split('/') as [SyncObject, SyncObject];
    const have = new Map<string, Set<string>>();
    const ids = [...new Set(list.map((r) => r.fromHs))];
    for (let i = 0; i < ids.length; i += 100) {
      const res = await ctx.client.send(`/crm/v4/associations/${from}/${to}/batch/read`, {
        method: 'POST',
        body: { inputs: ids.slice(i, i + 100).map((id) => ({ id })) },
        retries: 2,
        retry5xx: true,
        maxWaitMs: 4_000,
      });
      if (!res.ok && res.status !== 207) throw hubspotStatusError(res.status, res.path);
      for (const r of (res.json() as { results?: Array<{ from: { id: string | number }; to?: Array<{ toObjectId: string | number }> }> }).results ?? []) {
        have.set(String(r.from.id), new Set((r.to ?? []).map((t) => String(t.toObjectId))));
      }
    }
    for (const r of list) {
      if (have.get(r.fromHs)?.has(r.toHs)) {
        // Ya está allá (la trajo la entrada, o se agregó de los dos lados).
        bump(ctx, from, 'skipped');
        await done(ctx.db, ctx.ws, r.item);
        continue;
      }
      const res = await ctx.client.send(`/crm/v4/objects/${from}/${encodeURIComponent(r.fromHs)}/associations/default/${to}/${encodeURIComponent(r.toHs)}`, {
        method: 'PUT',
        retries: 2,
        retry5xx: true,
        maxWaitMs: 4_000,
      });
      if (res.ok) {
        bump(ctx, from, 'associations');
        await done(ctx.db, ctx.ws, r.item);
      } else if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 423 && res.status !== 429) {
        note(ctx, from, res.status === 404 ? 'not_found' : 'association_rejected');
        bump(ctx, from, 'failed');
        await retryLater(ctx, r.item, res.status === 404 ? 'not_found' : 'association_rejected');
      } else throw hubspotStatusError(res.status, res.path);
    }
  }
}

async function claim(ws: string, lockMs: number, now: number): Promise<OutboundRow | null> {
  const at = iso(new Date(now));
  const res = await getDb()
    .prepare(
      `UPDATE crm_hubspot_outbound SET locked_until = ?, updated_at = ? WHERE user_id = ? AND mode = 'on' AND (locked_until IS NULL OR locked_until < ?) AND (next_run_at IS NULL OR next_run_at <= ?)`,
    )
    .run(iso(new Date(now + lockMs)), at, ws, at, at);
  if (!res.changes) return null;
  return rowOf(ws);
}

function pushErrors(list: OutboundErrorEntry[], codes: Map<string, number>, at: string): OutboundErrorEntry[] {
  const out = [...list];
  for (const [key, count] of codes) {
    const [object, code] = key.split('|');
    out.unshift({ at, object, code, count });
  }
  return out.slice(0, MAX_ERRORS);
}

/**
 * Un tramo de un workspace: vacía la cola por tandas mientras quede tiempo.
 * Lo llaman el cron y la pantalla abierta (un solo proceso a la vez por el claim).
 */
export async function runOutboundStep(ws: string, opts: OutboundStepOptions = {}): Promise<OutboundStepResult> {
  const clock = opts.now ?? Date.now;
  const gate = await syncGate(ws);
  if (!gate.run) return gate.reason === 'paused' ? 'paused' : gate.reason === 'off' || gate.reason === 'disabled_globally' ? 'not_claimed' : 'blocked';
  const inbound = await inboundOf(ws);
  const conn = await openSyncConnection(ws);
  // La salida se apoya en los vínculos y el plan de la entrada: sin ella al día, no corre.
  if (!conn || !inbound?.initial_done_at || inbound.portal_id !== conn.portalId) return 'not_claimed';
  const budgetMs = opts.budgetMs ?? 20_000;
  const start = clock();
  const deadline = start + budgetMs;
  const row = await claim(ws, budgetMs + 120_000, start);
  if (!row) return 'not_claimed';
  const mine = row.locked_until ?? '';
  const db = getDb();
  if (row.portal_id && row.portal_id !== conn.portalId) {
    // Otra cuenta de HubSpot: la escritura se apaga hasta que un admin mire la vista previa de nuevo.
    await db.prepare(`UPDATE crm_hubspot_outbound SET mode = 'off', locked_until = NULL, failure = 'portal_changed' WHERE user_id = ? AND locked_until = ?`).run(ws, mine);
    return 'blocked';
  }
  const plan = parseJson<InboundPlan>(inbound.plan, emptyPlan());
  const toggled = togglesOf(inbound);
  const objects = OUTBOUND_OBJECT_NAMES.filter((o) => toggled[o]);
  let defs = parseJson<Partial<Record<SyncObject, PropDefs>>>(row.props, {});
  let propsAt = row.props_at;
  const counts = parseJson<Counts>(row.counts, {});
  let errors = parseJson<OutboundErrorEntry[]>(row.errors, []);
  const client = syncHubspotClient(conn.token, { portalId: conn.portalId, maxWaitMs: 3_000 });
  const ctx: StepCtx = { db, ws, portalId: conn.portalId, client, plan, defs, owners: ownersOut(plan), stages: await stagesOut(ws, plan), toggled, counts, codes: new Map(), clock };

  const persist = async (extra: { success?: boolean } = {}) => {
    const now = iso(new Date(clock()));
    if (ctx.codes.size) {
      errors = pushErrors(errors, ctx.codes, now);
      ctx.codes = new Map();
    }
    const ok = extra.success ? 1 : 0;
    const res = await db
      .prepare(
        `UPDATE crm_hubspot_outbound SET props = ?, props_at = ?, counts = ?, errors = ?, failure = CASE WHEN ? THEN '' ELSE failure END, attempts = CASE WHEN ? THEN 0 ELSE attempts END,
           last_run_at = ?, last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END, updated_at = ? WHERE user_id = ? AND locked_until = ?`,
      )
      .run(JSON.stringify(defs), propsAt, JSON.stringify(counts), JSON.stringify(errors), ok, ok, now, ok, now, now, ws, mine);
    if (!res.changes) throw new LockLost();
  };

  try {
    if (!propsAt || clock() - Date.parse(propsAt) > PLAN_TTL_MS) {
      defs = await loadPropDefs(client, objects, plan);
      ctx.defs = defs;
      propsAt = iso(new Date(clock()));
    }
    let batches = 0;
    while (clock() < deadline && batches < (opts.maxBatches ?? Infinity)) {
      const now = iso(new Date(clock()));
      const items = (await db
        .prepare(
          `SELECT object, record_id, to_object, to_id, version, attempts, creating_at FROM crm_hubspot_outbox
           WHERE user_id = ? AND state = 'pending' AND next_at <= ? ORDER BY (to_object != ''), queued_at LIMIT ?`,
        )
        .all(ws, now, OUTBOX_BATCH)) as OutboxItem[];
      if (!items.length) {
        await persist({ success: true });
        await db.prepare('UPDATE crm_hubspot_outbound SET next_run_at = ?, locked_until = NULL WHERE user_id = ? AND locked_until = ?').run(iso(new Date(clock() + LIVE_INTERVAL_MS)), ws, mine);
        return 'idle';
      }
      // Lo que llegó del sync o de la pantalla mientras tanto: la pausa corta en la tanda siguiente.
      if (batches > 0) {
        const s = await getSyncSettings(ws);
        const still = (await rowOf(ws))?.mode === 'on';
        if (!s.enabled || s.paused || !still) break;
      }
      for (const o of OUTBOUND_OBJECT_NAMES) {
        const mineItems = items.filter((i) => i.to_object === '' && OBJECT_OF[i.object] === o);
        if (!mineItems.length) continue;
        if (!toggled[o]) {
          // El sync no trae este objeto: tampoco se escribe.
          for (const i of mineItems) await done(db, ws, i);
          continue;
        }
        await pushRecords(ctx, o, mineItems);
      }
      const assoc = items.filter((i) => i.to_object !== '');
      if (assoc.length) await pushAssociations(ctx, assoc);
      await persist({ success: true });
      batches++;
    }
    await db.prepare('UPDATE crm_hubspot_outbound SET locked_until = NULL WHERE user_id = ? AND locked_until = ?').run(ws, mine);
    return 'progress';
  } catch (err) {
    if (err instanceof LockLost) return 'not_claimed';
    const api = err instanceof HubspotApiError ? err : null;
    const now = clock();
    // Lo que ya salió en esta vuelta queda contado.
    await persist().catch(() => {});
    if (api?.code === 'auth') {
      await markConnectionError(ws, 'invalid_token');
      await setFailure(ws, mine, 'invalid_token', now, now, false);
      return 'blocked';
    }
    if (api?.code === 'scope') {
      // Sin permiso de escritura: espera larga; un admin tiene que darle el permiso a la clave.
      await setFailure(ws, mine, 'missing_scope', now, now + DAILY_WAIT_MS, false);
      return 'blocked';
    }
    if (api?.code === 'rate_limited' && api.policy === 'daily') {
      await setFailure(ws, mine, 'daily_limit', now, now + DAILY_WAIT_MS, false);
      return 'waiting';
    }
    const code = api ? (api.code === 'rate_limited' || api.code === 'locked' ? 'hubspot_busy' : api.code === 'network' ? 'network' : 'provider_error') : 'internal_error';
    await setFailure(ws, mine, code, now, now + backoffMs(Number(row.attempts) + 1), true);
    return 'retrying';
  }
}

async function setFailure(ws: string, mine: string, code: string, now: number, nextRun: number, countAttempt: boolean): Promise<void> {
  const row = await rowOf(ws);
  const list = pushErrors(parseJson<OutboundErrorEntry[]>(row?.errors, []), new Map([[`|${code}`, 1]]), iso(new Date(now)));
  await getDb()
    .prepare(
      `UPDATE crm_hubspot_outbound SET failure = ?, errors = ?, attempts = attempts + ?, next_run_at = ?, last_run_at = ?, locked_until = NULL, updated_at = ? WHERE user_id = ? AND locked_until = ?`,
    )
    .run(code, JSON.stringify(list), countAttempt ? 1 : 0, iso(new Date(nextRun)), iso(new Date(now)), iso(new Date(now)), ws, mine);
}

/** Cron: vacía la cola de los workspaces con la escritura prendida y su turno vencido. */
export async function processHubspotOutbound(opts: { budgetMs?: number; limit?: number } = {}): Promise<{ workspaces: number }> {
  if (process.env.CRM_HUBSPOT_SYNC_DISABLED === '1') return { workspaces: 0 };
  const start = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const now = iso();
  const rows = (await getDb()
    .prepare(
      `SELECT o.user_id FROM crm_hubspot_outbound o JOIN crm_hubspot_sync_settings s ON s.user_id = o.user_id
       WHERE o.mode = 'on' AND s.enabled = 1 AND s.paused = 0 AND (o.next_run_at IS NULL OR o.next_run_at <= ?) AND (o.locked_until IS NULL OR o.locked_until < ?)
       ORDER BY o.next_run_at ASC LIMIT ?`,
    )
    .all(now, now, opts.limit ?? 5)) as Array<{ user_id: string }>;
  let n = 0;
  for (const r of rows) {
    const left = budget - (Date.now() - start);
    if (left < 3_000) break;
    if ((await runOutboundStep(r.user_id, { budgetMs: left })) !== 'not_claimed') n++;
  }
  return { workspaces: n };
}

