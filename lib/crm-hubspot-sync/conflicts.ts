/**
 * CRM ↔ HubSpot, bloque S4: resolver a mano los conflictos del sync y
 * reintentar los cambios que HubSpot rechazó. Server-only; solo admins (las
 * rutas pasan por syncAdmin).
 *
 * Un conflicto (crm_hubspot_sync_conflicts, que anotan S2 y S3) es un
 * registro con campos que cambiaron de los dos lados desde el último sync. La
 * fila guarda solo nombres de campos. Acá un admin elige, por campo, qué lado
 * queda:
 *
 * - "Dejar HubSpot": se lee el registro en HubSpot (solo lectura), se escribe
 *   ese valor acá y el shadow del vínculo pasa a ese valor. Si la escritura en
 *   HubSpot está prendida, el trigger encola el cambio pero al vaciarla no hay
 *   diferencia con el shadow y no sale nada (el mismo guardia de eco de S3).
 * - "Dejar zerosoft": acá no se toca nada; el shadow pasa al valor que tiene
 *   HubSpot ahora. Para la entrada queda como "cambió solo acá" (no lo pisa) y
 *   para la salida como un cambio de acá con HubSpot al día: si la escritura
 *   está prendida se encola y sale por el camino normal de S3 (conversión,
 *   reintentos, nunca borra); si está apagada, sale cuando un admin la prenda.
 *   Esta resolución nunca escribe en HubSpot por su cuenta.
 *
 * Si HubSpot vuelve a cambiar el campo antes de que salga, el conflicto se
 * anota otra vez: no hay pisada silenciosa ni vuelta infinita.
 *
 * Solo se resuelven campos que están en la fila del conflicto (un pedido no
 * puede pisar otros campos). Un valor de HubSpot que acá no tiene equivalente
 * (un dueño sin persona, una etapa u opción que no existe) o un email que ya
 * es de otro contacto no se puede dejar: el campo sigue en conflicto, con un
 * código. Los conflictos de actividades y los de fusión (dos registros de acá
 * para uno de HubSpot) solo se descartan: se resuelven en el registro.
 *
 * Los valores se leen y se muestran al admin en la respuesta; nunca se
 * guardan ni se loguean. Lo guardado sigue siendo solo nombres de campos.
 */
import { getClient, getDb, txDb, type Db } from '../db';
import { parseCustom } from '../crm';
import { findContactByEmail } from '../crm-contact-email';
import { workspacePeople } from '../crm-import';
import { HubspotApiError, hubspotStatusError, type HubspotClient } from '../hubspot/client';
import { isBlockingConnectionError, openSyncConnection, syncHubspotClient } from './connection';
import { updateRecord } from './inbound';
import { INBOUND_PROPS, emptyPlan, localCustom, localValues, mapCustom, mapRecord, same, type InboundPlan, type Values } from './inbound-map';
import { UNKNOWN_REMOTE } from './outbound-map';
import type { SyncObject } from './reader';
import type { ConflictErrorCode, ConflictItem, ConflictKeep, ConflictList, ConflictObject, ConflictValue, DetailResult, ResolveResult, ResolveSummary } from './conflicts-types';

export type { ConflictErrorCode, ConflictItem, ConflictKeep, ConflictList, ConflictObject, ConflictValue, DetailResult, ResolveResult, ResolveSummary };

/** Conflictos por pedido de "resolver todos". */
export const RESOLVE_BATCH = 50;
/** Página del listado. */
export const LIST_PAGE = 50;

const OBJECT_OF: Record<string, SyncObject> = { contact: 'contacts', company: 'companies', deal: 'deals' };
const TABLE: Record<SyncObject, string> = { contacts: 'crm_contacts', companies: 'crm_companies', deals: 'crm_deals' };

const iso = (d = new Date()) => d.toISOString();

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------- Listado ----------

interface ConflictRow {
  object: string;
  record_id: string;
  hubspot_id: string;
  kind: string;
  fields: string;
  updated_at: string;
}

function nameSql(object: string): string {
  if (object === 'contact') return `SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS n, email AS e FROM crm_contacts WHERE id = ? AND user_id = ?`;
  if (object === 'company') return `SELECT name AS n, domain AS e FROM crm_companies WHERE id = ? AND user_id = ?`;
  return `SELECT name AS n, '' AS e FROM crm_deals WHERE id = ? AND user_id = ?`;
}

async function itemOf(db: Db, ws: string, r: ConflictRow): Promise<ConflictItem> {
  const object = (['contact', 'company', 'deal', 'activity'].includes(r.object) ? r.object : 'activity') as ConflictObject;
  let name = '';
  if (object !== 'activity') {
    const hit = (await db.prepare(nameSql(object)).get(r.record_id, ws)) as { n: string | null; e: string | null } | undefined;
    name = (hit?.n || hit?.e || '').trim();
  }
  const kind = r.kind === 'merge' ? 'merge' : 'fields';
  return {
    object,
    recordId: r.record_id,
    kind,
    fields: r.fields.split(',').filter(Boolean),
    name,
    resolvable: kind === 'fields' && object !== 'activity',
    updatedAt: r.updated_at,
  };
}

/** Los conflictos de un workspace, los más recientes primero. */
export async function listConflicts(ws: string, opts: { object?: ConflictObject; offset?: number } = {}): Promise<ConflictList> {
  const db = getDb();
  const groups = (await db.prepare('SELECT object, COUNT(*) AS n FROM crm_hubspot_sync_conflicts WHERE user_id = ? GROUP BY object').all(ws)) as Array<{ object: string; n: number }>;
  const byObject: ConflictList['byObject'] = {};
  for (const g of groups) byObject[g.object as ConflictObject] = Number(g.n);
  const total = groups.reduce((n, g) => n + Number(g.n), 0);
  const offset = Math.max(0, Math.min(opts.offset ?? 0, 100_000));
  const rows = (await db
    .prepare(
      `SELECT object, record_id, hubspot_id, kind, fields, updated_at FROM crm_hubspot_sync_conflicts
       WHERE user_id = ? ${opts.object ? 'AND object = ?' : ''} ORDER BY updated_at DESC, record_id LIMIT ? OFFSET ?`,
    )
    .all(...(opts.object ? [ws, opts.object, LIST_PAGE + 1, offset] : [ws, LIST_PAGE + 1, offset]))) as ConflictRow[];
  const items: ConflictItem[] = [];
  for (const r of rows.slice(0, LIST_PAGE)) items.push(await itemOf(db, ws, r));
  return { total, byObject, items, more: rows.length > LIST_PAGE };
}

// ---------- Lectura de HubSpot ----------

interface Session {
  portalId: string;
  client: HubspotClient;
  plan: InboundPlan;
}

/** La conexión y el plan de la entrada; null con el código de por qué no se puede leer HubSpot. */
async function openSession(ws: string): Promise<Session | { code: ConflictErrorCode }> {
  if (process.env.CRM_HUBSPOT_SYNC_DISABLED === '1') return { code: 'blocked' };
  const conn = await openSyncConnection(ws);
  if (!conn) return { code: 'not_connected' };
  if (isBlockingConnectionError(conn.lastError)) return { code: 'blocked' };
  const inbound = (await getDb().prepare('SELECT portal_id, plan FROM crm_hubspot_inbound WHERE user_id = ?').get(ws)) as { portal_id: string; plan: string } | undefined;
  // Los vínculos y el shadow son de la cuenta que trajo la entrada: con otra cuenta conectada no se resuelve nada.
  if (!inbound || inbound.portal_id !== conn.portalId) return { code: 'blocked' };
  return { portalId: conn.portalId, client: syncHubspotClient(conn.token, { portalId: conn.portalId, maxWaitMs: 4_000 }), plan: parseJson<InboundPlan>(inbound.plan, emptyPlan()) };
}

/** Lee registros de HubSpot por id (solo lectura). Los que allá no están no vuelven. */
async function readRemote(s: Session, object: SyncObject, ids: string[]): Promise<Map<string, Values>> {
  const props = [...INBOUND_PROPS[object], ...(s.plan.fields[object] ?? []).map((f) => f.key)];
  const out = new Map<string, Values>();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await s.client.send(`/crm/v3/objects/${object}/batch/read`, {
      method: 'POST',
      body: { inputs: ids.slice(i, i + 100).map((id) => ({ id })), properties: props },
      retries: 2,
      retry5xx: true,
      maxWaitMs: 4_000,
    });
    if (!res.ok && res.status !== 207) throw hubspotStatusError(res.status, res.path);
    for (const r of (res.json() as { results?: Array<{ id: string | number; properties?: Record<string, string | null> }> }).results ?? []) {
      const p = r.properties ?? {};
      const mapped = mapRecord(object, p, s.plan);
      const custom = mapCustom(s.plan.fields[object] ?? [], p);
      const values: Values = { ...mapped.values, ...custom.values };
      for (const f of [...mapped.skip, ...custom.skip]) values[f] = UNKNOWN_REMOTE;
      out.set(String(r.id), values);
    }
  }
  return out;
}

function localOf(object: SyncObject, row: Record<string, unknown>, plan: InboundPlan): Values {
  return { ...localValues(object, row), ...localCustom(plan.fields[object] ?? [], parseCustom(String(row.custom ?? '{}'))) };
}

// ---------- Valores para mostrar ----------

interface Labels {
  people: Map<string, string>;
  stages: Map<string, string>;
}

async function labelsFor(ws: string): Promise<Labels> {
  const people = new Map((await workspacePeople(ws)).map((p) => [p.id, p.name || p.email]));
  const stages = new Map(
    ((await getDb().prepare('SELECT s.id, s.name FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id WHERE p.user_id = ?').all(ws)) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  );
  return { people, stages };
}

function display(field: string, v: string, labels: Labels): string {
  if (!v) return '';
  if (field === 'owner_id') return labels.people.get(v) ?? '';
  if (field === 'stage_id') return labels.stages.get(v) ?? '';
  if (field.startsWith('custom.')) {
    const parsed = parseJson<unknown>(v, v);
    if (Array.isArray(parsed)) return parsed.map(String).join(', ');
    return typeof parsed === 'object' && parsed !== null ? '' : String(parsed);
  }
  return v;
}

// ---------- Detalle ----------

async function conflictRow(ws: string, object: string, recordId: string, db: Db = getDb()): Promise<ConflictRow | null> {
  return (
    ((await db
      .prepare('SELECT object, record_id, hubspot_id, kind, fields, updated_at FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND object = ? AND record_id = ?')
      .get(ws, object, recordId)) as ConflictRow | undefined) ?? null
  );
}

interface LinkRow {
  hubspot_id: string;
  shadow: string;
  state: string;
}

async function linkOf(db: Db, ws: string, portalId: string, object: string, recordId: string): Promise<LinkRow | null> {
  return (
    ((await db
      .prepare('SELECT hubspot_id, shadow, state FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND record_id = ? AND portal_id = ?')
      .get(ws, object, recordId, portalId)) as LinkRow | undefined) ?? null
  );
}

function providerCode(e: unknown): ConflictErrorCode {
  if (e instanceof HubspotApiError && (e.code === 'rate_limited' || e.code === 'locked')) return 'hubspot_busy';
  if (e instanceof HubspotApiError && e.code === 'auth') return 'blocked';
  return 'provider_error';
}

/** Lo de cada lado de un conflicto, leído ahora (los valores van solo en la respuesta). */
export async function conflictDetail(ws: string, object: ConflictObject, recordId: string): Promise<DetailResult> {
  const row = await conflictRow(ws, object, recordId);
  if (!row) return { ok: false, code: 'not_found' };
  const item = await itemOf(getDb(), ws, row);
  if (!item.resolvable) return { ok: false, code: 'not_resolvable' };
  const s = await openSession(ws);
  if ('code' in s) return { ok: false, code: s.code };
  const so = OBJECT_OF[object];
  const db = getDb();
  const link = await linkOf(db, ws, s.portalId, object, recordId);
  const local = (await db.prepare(`SELECT * FROM ${TABLE[so]} WHERE id = ? AND user_id = ?`).get(recordId, ws)) as Record<string, unknown> | undefined;
  if (!link || link.state !== 'linked' || !local) return { ok: false, code: 'not_found' };
  let remote: Map<string, Values>;
  try {
    remote = await readRemote(s, so, [link.hubspot_id]);
  } catch (e) {
    return { ok: false, code: providerCode(e) };
  }
  const r = remote.get(link.hubspot_id);
  if (!r) return { ok: false, code: 'hubspot_missing' };
  const l = localOf(so, local, s.plan);
  const labels = await labelsFor(ws);
  const values = item.fields.map((field): ConflictValue => {
    const rv = field in r ? r[field] : UNKNOWN_REMOTE;
    const lv = l[field] ?? '';
    return {
      field,
      here: display(field, lv, labels),
      hubspot: rv === UNKNOWN_REMOTE ? null : display(field, rv, labels),
      equal: rv !== UNKNOWN_REMOTE && same(field, lv, rv),
    };
  });
  return { ok: true, item, values };
}

// ---------- Resolver ----------

interface Choice {
  object: Exclude<ConflictObject, 'activity'>;
  recordId: string;
  /** Campo → lado que queda. */
  keep: Map<string, ConflictKeep>;
}

/** Encola el registro para la salida (como el trigger), solo si la escritura está prendida. */
async function enqueue(db: Db, ws: string, object: string, recordId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO crm_hubspot_outbox (user_id, object, record_id, to_object, to_id, version, attempts, next_at, code, state, queued_at)
       SELECT ?, ?, ?, '', '', lower(hex(randomblob(8))), 0, '', '', 'pending', datetime('now')
       WHERE EXISTS (SELECT 1 FROM crm_hubspot_outbound o WHERE o.user_id = ? AND o.mode = 'on')
       ON CONFLICT(user_id, object, record_id, to_object, to_id) DO UPDATE SET version = excluded.version, attempts = 0, next_at = '', code = '', state = 'pending', queued_at = excluded.queued_at`,
    )
    .run(ws, object, recordId, ws);
}

/**
 * Aplica una elección ya leída de HubSpot, en una transacción: relee el
 * conflicto, el vínculo y el registro (pudieron cambiar desde la lectura) y
 * solo toca campos que siguen en conflicto.
 */
async function applyChoice(ws: string, s: Session, c: Choice, remote: Values, summary: ResolveSummary): Promise<void> {
  const so = OBJECT_OF[c.object];
  const tx = await getClient().transaction('write');
  const db = txDb(tx);
  try {
    const row = await conflictRow(ws, c.object, c.recordId, db);
    const link = await linkOf(db, ws, s.portalId, c.object, c.recordId);
    const local = (await db.prepare(`SELECT * FROM ${TABLE[so]} WHERE id = ? AND user_id = ?`).get(c.recordId, ws)) as Record<string, unknown> | undefined;
    if (!row || row.kind !== 'fields' || !link || !local) {
      await tx.rollback();
      return;
    }
    const open = new Set(row.fields.split(',').filter(Boolean));
    const l = localOf(so, local, s.plan);
    const shadow = parseJson<Values>(link.shadow, {});
    const takeHubspot: string[] = [];
    let here = false;
    for (const [field, keep] of c.keep) {
      if (!open.has(field)) continue;
      const r = field in remote ? remote[field] : UNKNOWN_REMOTE;
      const lv = l[field] ?? '';
      if (r !== UNKNOWN_REMOTE && same(field, lv, r)) {
        // Ya son iguales: solo se corre el shadow.
        shadow[field] = r;
      } else if (keep === 'hubspot') {
        if (r === UNKNOWN_REMOTE) {
          summary.kept.push({ field, code: 'hubspot_value_unmapped' });
          continue;
        }
        if (c.object === 'contact' && field === 'email' && r && (await findContactByEmail(ws, r, db, c.recordId))) {
          summary.kept.push({ field, code: 'email_taken' });
          continue;
        }
        takeHubspot.push(field);
        shadow[field] = r;
      } else {
        // Queda lo de acá: el shadow pasa a lo que HubSpot tiene ahora, así el cambio de acá es el único y sale por S3.
        shadow[field] = r;
        here = true;
      }
      open.delete(field);
      summary.resolved++;
    }
    if (takeHubspot.length) await updateRecord({ db, ws, plan: s.plan }, so, c.recordId, local, remote, takeHubspot);
    await db
      .prepare('UPDATE crm_hubspot_links SET shadow = ?, updated_at = ? WHERE user_id = ? AND object = ? AND record_id = ? AND portal_id = ?')
      .run(JSON.stringify(shadow), iso(), ws, c.object, c.recordId, s.portalId);
    if (open.size) {
      await db
        .prepare('UPDATE crm_hubspot_sync_conflicts SET fields = ?, updated_at = ? WHERE user_id = ? AND object = ? AND record_id = ?')
        .run([...open].join(','), iso(), ws, c.object, c.recordId);
    } else {
      await db.prepare('DELETE FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND object = ? AND record_id = ?').run(ws, c.object, c.recordId);
    }
    if (here) await enqueue(db, ws, c.object, c.recordId);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/** Lee HubSpot para un grupo de elecciones del mismo objeto y las aplica. */
async function resolveGroup(ws: string, s: Session, object: Choice['object'], choices: Choice[], summary: ResolveSummary): Promise<void> {
  const so = OBJECT_OF[object];
  const db = getDb();
  const withLink: Array<{ c: Choice; hubspotId: string }> = [];
  for (const c of choices) {
    const link = await linkOf(db, ws, s.portalId, object, c.recordId);
    if (link && link.state === 'linked') withLink.push({ c, hubspotId: link.hubspot_id });
  }
  if (!withLink.length) return;
  const remote = await readRemote(s, so, [...new Set(withLink.map((x) => x.hubspotId))]);
  for (const { c, hubspotId } of withLink) {
    const r = remote.get(hubspotId);
    // Ya no está en HubSpot (archivado o fusionado allá): el barrido de la entrada marca el vínculo; acá no se toca.
    if (!r) continue;
    await applyChoice(ws, s, c, r, summary);
  }
}

/** Conflictos que todavía se pueden resolver campo por campo. */
async function remaining(ws: string): Promise<number> {
  return Number(
    ((await getDb()
      .prepare(`SELECT COUNT(*) AS n FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND kind = 'fields' AND object IN ('contact', 'company', 'deal')`)
      .get(ws)) as { n: number }).n,
  );
}

/** Resuelve un registro: `keep` por campo (los campos que no están en el conflicto se ignoran). */
export async function resolveConflict(ws: string, object: ConflictObject, recordId: string, keep: Record<string, ConflictKeep>): Promise<ResolveResult> {
  const row = await conflictRow(ws, object, recordId);
  if (!row) return { ok: false, code: 'not_found' };
  if (object === 'activity' || row.kind !== 'fields') return { ok: false, code: 'not_resolvable' };
  const s = await openSession(ws);
  if ('code' in s) return { ok: false, code: s.code };
  const summary: ResolveSummary = { resolved: 0, kept: [] };
  const choice: Choice = { object, recordId, keep: new Map(Object.entries(keep).filter(([, v]) => v === 'here' || v === 'hubspot')) };
  const link = await linkOf(getDb(), ws, s.portalId, object, recordId);
  if (!link || link.state !== 'linked') return { ok: false, code: 'not_found' };
  try {
    const remote = await readRemote(s, OBJECT_OF[object], [link.hubspot_id]);
    const r = remote.get(link.hubspot_id);
    if (!r) return { ok: false, code: 'hubspot_missing' };
    await applyChoice(ws, s, choice, r, summary);
  } catch (e) {
    return { ok: false, code: providerCode(e) };
  }
  return { ok: true, ...summary, remaining: await remaining(ws) };
}

/**
 * Resuelve de una vez los conflictos de campos (de un objeto o de todos)
 * dejando el mismo lado en todos sus campos. Por tandas, los más viejos
 * primero: un registro que no se pudo resolver entero vuelve al final (se le
 * corre la fecha), así la pantalla puede seguir llamando mientras queden.
 */
export async function resolveAllConflicts(ws: string, keep: ConflictKeep, object?: Choice['object']): Promise<ResolveResult> {
  const s = await openSession(ws);
  if ('code' in s) return { ok: false, code: s.code };
  const rows = (await getDb()
    .prepare(
      `SELECT object, record_id, hubspot_id, kind, fields, updated_at FROM crm_hubspot_sync_conflicts
       WHERE user_id = ? AND kind = 'fields' AND object IN (${object ? '?' : "'contact', 'company', 'deal'"}) ORDER BY updated_at ASC, record_id LIMIT ?`,
    )
    .all(...(object ? [ws, object, RESOLVE_BATCH] : [ws, RESOLVE_BATCH]))) as ConflictRow[];
  const summary: ResolveSummary = { resolved: 0, kept: [] };
  const groups = new Map<Choice['object'], Choice[]>();
  for (const r of rows) {
    const o = r.object as Choice['object'];
    const list = groups.get(o) ?? [];
    list.push({ object: o, recordId: r.record_id, keep: new Map(r.fields.split(',').filter(Boolean).map((f) => [f, keep])) });
    groups.set(o, list);
  }
  try {
    for (const [o, choices] of groups) await resolveGroup(ws, s, o, choices, summary);
  } catch (e) {
    return { ok: false, code: providerCode(e) };
  }
  return { ok: true, ...summary, remaining: await remaining(ws) };
}

/** Saca un conflicto de la lista sin tocar ningún valor (actividades y fusiones; también cualquier otro). */
export async function dismissConflict(ws: string, object: ConflictObject, recordId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM crm_hubspot_sync_conflicts WHERE user_id = ? AND object = ? AND record_id = ?').run(ws, object, recordId);
  return res.changes > 0;
}

// ---------- Cambios rechazados ----------

/**
 * Vuelve a poner en la cola los cambios que HubSpot rechazó varias veces
 * (state 'failed'). Salen por el camino normal de S3, y solo si la escritura
 * sigue prendida. Devuelve cuántos.
 */
export async function retryFailedOutbound(ws: string): Promise<number> {
  const res = await getDb()
    .prepare(
      `UPDATE crm_hubspot_outbox SET state = 'pending', attempts = 0, next_at = '', code = ''
       WHERE user_id = ? AND state = 'failed' AND EXISTS (SELECT 1 FROM crm_hubspot_outbound o WHERE o.user_id = ? AND o.mode = 'on')`,
    )
    .run(ws, ws);
  return res.changes;
}
