/**
 * Lines + Inbox, HubSpot: las propiedades del contacto y del negocio de un
 * chat, igual que las de la empresa (lib/groups-hubspot-sync.ts) pero sin
 * copia local de los valores:
 *
 * - Esquema: la definición de las propiedades de contactos y de negocios de la
 *   cuenta (también las propias) y sus grupos, por workspace, en
 *   hubspot_object_schema. Se importa la primera vez que se pide y cuando
 *   tiene más de 6 horas. Sin el permiso de leerlas, queda el error (y la
 *   interfaz dice qué permiso falta) hasta la próxima importación.
 * - Qué se muestra: el workspace elige (admins) y cada persona puede elegir
 *   las suyas, por objeto (hubspot_view_object_props). Igual en Lines e Inbox.
 * - Valores: se leen de HubSpot al abrir (batch/read) y quedan un minuto en
 *   memoria; "Sincronizar ahora" los vuelve a leer.
 * - Editar: PATCH del contacto o negocio en el momento, si el token puede
 *   escribirlos. Si HubSpot lo rechaza, no cambia nada y el error dice por qué.
 *
 * El que llama ya chequeó el acceso al chat. Server-only.
 */
import { getDb } from './db';
import { HubspotError, hubspotConn, hubspotRecordUrl, markHubspotUsed, requireHubspotConn, type HubspotConn } from './groups-hubspot';
import { hubspotCall, normalizeHubspotInput, type ChatCompanyDto, type PinnedValue } from './groups-hubspot-sync';
import {
  HUBSPOT_MAX_PINNED,
  HUBSPOT_OBJECT_DEFAULT_PINNED,
  HUBSPOT_PROP_NAME,
  hubspotMulti,
  hubspotPropKind,
  hubspotTime,
  type HubspotOption,
  type HubspotOwner,
  type HubspotPropDef,
  type HubspotPropGroup,
  type HubspotSchemaDto,
} from './groups-hubspot-shared';

export type HubspotObjectType = 'contact' | 'deal';
export const HUBSPOT_OBJECT_TYPES: readonly HubspotObjectType[] = ['contact', 'deal'];

const PLURAL: Record<HubspotObjectType, string> = { contact: 'contacts', deal: 'deals' };
/** Sin este no se leen las propiedades del objeto (HubSpot lo pide para /crm/v3/properties). */
export const HUBSPOT_OBJECT_SCHEMA_SCOPE: Record<HubspotObjectType, string> = { contact: 'crm.schemas.contacts.read', deal: 'crm.schemas.deals.read' };
/** Sin este no se edita el objeto. */
export const HUBSPOT_OBJECT_WRITE_SCOPE: Record<HubspotObjectType, string> = { contact: 'crm.objects.contacts.write', deal: 'crm.objects.deals.write' };

const SCHEMA_TTL_MS = 6 * 3_600_000;
const VALUES_TTL_MS = 60_000;
/** Datos del contacto que no ve quien tiene los teléfonos ocultos. */
const MASKED_CONTACT = new Set(['email', 'phone', 'mobilephone', 'hs_whatsapp_phone_number', 'work_email', 'hs_additional_emails']);

export const isHubspotObjectType = (v: unknown): v is HubspotObjectType => v === 'contact' || v === 'deal';

const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : []);
const text = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

function parseArray<T>(raw: string | null | undefined): T[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

// ======================================================================
// Esquema
// ======================================================================

/** Una propiedad como la da /crm/v3/properties, o null si no sirve. */
export function hubspotDefFromApi(p: Record<string, unknown>): HubspotPropDef | null {
  const name = text(p.name, 120);
  if (!HUBSPOT_PROP_NAME.test(name) || p.archived === true) return null;
  const meta = (p.modificationMetadata && typeof p.modificationMetadata === 'object' ? p.modificationMetadata : {}) as Record<string, unknown>;
  const type = text(p.type, 40) || 'string';
  const fieldType = text(p.fieldType, 60) || 'text';
  const calculated = p.calculated === true || fieldType.startsWith('calculation');
  const options: HubspotOption[] = list(p.options)
    .slice(0, 500)
    .map((o) => ({ label: text(o.label, 200) || text(o.value, 200), value: text(o.value, 200) }))
    .filter((o) => o.value !== '');
  const ownerRef = p.referencedObjectType === 'OWNER' || name === 'hubspot_owner_id';
  return {
    name,
    label: text(p.label, 200) || name,
    type,
    fieldType,
    kind: hubspotPropKind(type, fieldType, ownerRef),
    group: text(p.groupName, 120),
    description: text(p.description, 500),
    options,
    readOnly: meta.readOnlyValue === true || calculated,
    calculated,
    hidden: p.hidden === true,
    custom: p.hubspotDefined !== true,
  };
}

interface SchemaRow {
  props: string;
  groups: string;
  pinned: string;
  synced_at: string | null;
  error: string;
}

async function schemaRow(ws: string, type: HubspotObjectType): Promise<SchemaRow | null> {
  return ((await getDb().prepare('SELECT props, groups, pinned, synced_at, error FROM hubspot_object_schema WHERE ws = ? AND object_type = ?').get(ws, type)) as SchemaRow | undefined) ?? null;
}

/**
 * Importa de HubSpot la definición de las propiedades del contacto o del
 * negocio y sus grupos. Sin permiso, guarda el error y deja la lista anterior.
 * Devuelve el error ('' si se importó).
 */
export async function refreshHubspotObjectSchema(ws: string, type: HubspotObjectType): Promise<string> {
  const conn = await requireHubspotConn(ws);
  const db = getDb();
  const now = new Date().toISOString();
  let error = '';
  try {
    const props = list((await hubspotCall(conn, 'GET', `/crm/v3/properties/${PLURAL[type]}`, undefined, { quiet: true, retries: 1, maxWaitMs: 2_000 })).json.results);
    let groups: Array<Record<string, unknown>> = [];
    try {
      groups = list((await hubspotCall(conn, 'GET', `/crm/v3/properties/${PLURAL[type]}/groups`, undefined, { quiet: true, retries: 1, maxWaitMs: 2_000 })).json.results);
    } catch (err) {
      if (!(err instanceof HubspotError)) throw err;
    }
    const defs = props.map(hubspotDefFromApi).filter((d): d is HubspotPropDef => d !== null);
    const order = new Map(props.map((p, i) => [text(p.name, 120), Number.isFinite(Number(p.displayOrder)) ? Number(p.displayOrder) : i]));
    defs.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0) || a.label.localeCompare(b.label));
    const groupList: HubspotPropGroup[] = groups
      .filter((g) => text(g.name) && g.archived !== true)
      .sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0))
      .map((g) => ({ name: text(g.name, 120), label: text(g.label, 200) || text(g.name, 120) }));
    await db
      .prepare(
        `INSERT INTO hubspot_object_schema (ws, object_type, props, groups, pinned, synced_at, error) VALUES (?, ?, ?, ?, '[]', ?, '')
         ON CONFLICT(ws, object_type) DO UPDATE SET props = excluded.props, groups = excluded.groups, synced_at = excluded.synced_at, error = ''`,
      )
      .run(ws, type, JSON.stringify(defs), JSON.stringify(groupList), now);
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
    error = err.code === 'hubspot_missing_scopes' ? `hubspot_missing_scopes:${HUBSPOT_OBJECT_SCHEMA_SCOPE[type]}` : err.code;
    await db
      .prepare(
        `INSERT INTO hubspot_object_schema (ws, object_type, props, groups, pinned, synced_at, error) VALUES (?, ?, '[]', '[]', '[]', ?, ?)
         ON CONFLICT(ws, object_type) DO UPDATE SET synced_at = excluded.synced_at, error = excluded.error`,
      )
      .run(ws, type, now, error);
  }
  return error;
}

function defsOf(row: SchemaRow | null): Map<string, HubspotPropDef> {
  return new Map(parseArray<HubspotPropDef>(row?.props).filter((d) => d && typeof d.name === 'string').map((d) => [d.name, d]));
}

const visibleNames = (names: unknown, defs: Map<string, HubspotPropDef>): string[] =>
  [...new Set((Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && defs.has(n) && !defs.get(n)?.hidden))].slice(0, HUBSPOT_MAX_PINNED);

function pinnedOf(type: HubspotObjectType, row: SchemaRow | null, defs: Map<string, HubspotPropDef>): string[] {
  const saved = parseArray<string>(row?.pinned);
  return visibleNames(saved.length ? saved : HUBSPOT_OBJECT_DEFAULT_PINNED[type], defs);
}

async function mineOf(ws: string, viewer: string | undefined, type: HubspotObjectType, defs: Map<string, HubspotPropDef>): Promise<string[] | null> {
  if (!viewer) return null;
  const row = (await getDb().prepare('SELECT props FROM hubspot_view_object_props WHERE ws = ? AND user_id = ? AND object_type = ?').get(ws, viewer, type)) as { props: string } | undefined;
  return row ? visibleNames(parseArray<string>(row.props), defs) : null;
}

async function ownersOf(ws: string): Promise<HubspotOwner[]> {
  const row = (await getDb().prepare('SELECT owners FROM groups_hubspot WHERE user_id = ?').get(ws)) as { owners: string } | undefined;
  return parseArray<HubspotOwner>(row?.owners).filter((o) => o && typeof o.id === 'string');
}

/** El esquema del contacto o del negocio, importado si nunca se importó o tiene más de 6 horas. */
async function freshSchemaRow(ws: string, type: HubspotObjectType, force = false): Promise<SchemaRow | null> {
  const row = await schemaRow(ws, type);
  if (force || !row?.synced_at || Date.parse(row.synced_at) < Date.now() - SCHEMA_TTL_MS) {
    await refreshHubspotObjectSchema(ws, type).catch(() => null);
    return schemaRow(ws, type);
  }
  return row;
}

/** Lo mismo que getHubspotSchema (empresa) para el contacto o el negocio. */
export async function getHubspotObjectSchema(ws: string, type: HubspotObjectType, viewer?: string, opts: { refresh?: boolean } = {}): Promise<HubspotSchemaDto> {
  const conn = await hubspotConn(ws);
  if (!conn) return { connected: false, syncedAt: null, groups: [], props: [], owners: [], pinned: [], mine: null, canWrite: false, object: type, error: '' };
  const row = await freshSchemaRow(ws, type, opts.refresh);
  const defs = defsOf(row);
  const props = [...defs.values()].filter((d) => !d.hidden);
  const used = new Set(props.map((p) => p.group));
  const groups = parseArray<HubspotPropGroup>(row?.groups).filter((g) => g && used.has(g.name));
  return {
    connected: true,
    syncedAt: row?.synced_at ?? null,
    groups: [...groups, ...[...used].filter((g) => !groups.some((x) => x.name === g)).map((g) => ({ name: g, label: g }))],
    props,
    owners: await ownersOf(ws),
    pinned: pinnedOf(type, row, defs),
    mine: await mineOf(ws, viewer, type, defs),
    canWrite: conn.scopes.includes(HUBSPOT_OBJECT_WRITE_SCOPE[type]),
    object: type,
    error: row?.error ?? '',
  };
}

/** Las del contacto o negocio que ve una persona (null vuelve a las del workspace). */
export async function setHubspotObjectMine(ws: string, viewer: string, type: HubspotObjectType, names: unknown): Promise<void> {
  await requireHubspotConn(ws);
  const db = getDb();
  if (names === null) {
    await db.prepare('DELETE FROM hubspot_view_object_props WHERE ws = ? AND user_id = ? AND object_type = ?').run(ws, viewer, type);
    return;
  }
  const clean = visibleNames(names, defsOf(await freshSchemaRow(ws, type)));
  await db
    .prepare(
      `INSERT INTO hubspot_view_object_props (ws, user_id, object_type, props, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ws, user_id, object_type) DO UPDATE SET props = excluded.props, updated_at = excluded.updated_at`,
    )
    .run(ws, viewer, type, JSON.stringify(clean), new Date().toISOString());
}

/** Las del contacto o negocio que ve el workspace (admins). Vacío vuelve a las de siempre. */
export async function setHubspotObjectPinned(ws: string, type: HubspotObjectType, names: unknown): Promise<void> {
  await requireHubspotConn(ws);
  const row = await freshSchemaRow(ws, type);
  const clean = visibleNames(names, defsOf(row));
  await getDb()
    .prepare(
      `INSERT INTO hubspot_object_schema (ws, object_type, props, groups, pinned, synced_at, error) VALUES (?, ?, '[]', '[]', ?, NULL, '')
       ON CONFLICT(ws, object_type) DO UPDATE SET pinned = excluded.pinned`,
    )
    .run(ws, type, JSON.stringify(clean));
}

// ======================================================================
// Valores
// ======================================================================

interface CachedValues {
  at: number;
  values: Record<string, string>;
  names: Set<string>;
  updatedAt: string;
}
const valueCache: Map<string, CachedValues> = ((globalThis as unknown as { __hubspotObjectValues?: Map<string, CachedValues> }).__hubspotObjectValues ??= new Map());
const cacheKey = (ws: string, type: HubspotObjectType, id: string) => `${ws}:${type}:${id}`;

/** Lo que se lee siempre, aunque no se haya elegido: el nombre del registro. */
const NAME_PROPS: Record<HubspotObjectType, string[]> = { contact: ['firstname', 'lastname', 'email'], deal: ['dealname'] };

/**
 * Los valores de un contacto o negocio (las propiedades pedidas). Del minuto
 * en memoria si alcanza; si no, de HubSpot. null: el registro ya no existe.
 */
async function readValues(conn: HubspotConn, type: HubspotObjectType, id: string, names: string[], force: boolean): Promise<CachedValues | null> {
  const key = cacheKey(conn.ws, type, id);
  const want = [...new Set([...NAME_PROPS[type], ...names])];
  const hit = valueCache.get(key);
  if (!force && hit && hit.at > Date.now() - VALUES_TTL_MS && want.every((n) => hit.names.has(n))) return hit;
  const { json } = await hubspotCall(conn, 'POST', `/crm/v3/objects/${PLURAL[type]}/batch/read`, { properties: want, inputs: [{ id }] }, { retries: 1, maxWaitMs: 2_000 });
  const raw = list(json.results).find((r) => String(r.id ?? '') === id) ?? list(json.results)[0];
  if (!raw) {
    valueCache.delete(key);
    return null;
  }
  const props = (raw.properties && typeof raw.properties === 'object' ? raw.properties : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    if (s !== '') values[k] = s;
  }
  const out: CachedValues = { at: Date.now(), values, names: new Set(want), updatedAt: text(raw.updatedAt, 40) };
  valueCache.set(key, out);
  if (valueCache.size > 2_000) valueCache.delete(valueCache.keys().next().value as string);
  return out;
}

function recordName(type: HubspotObjectType, values: Record<string, string>, fallback: string): string {
  if (type === 'deal') return values.dealname || fallback;
  return [values.firstname, values.lastname].filter(Boolean).join(' ') || values.email || fallback;
}

function masked(type: HubspotObjectType, values: Record<string, string>, defs: Map<string, HubspotPropDef>): Record<string, string> {
  if (type !== 'contact') return values;
  const out = { ...values };
  for (const k of Object.keys(out)) if (MASKED_CONTACT.has(k) || defs.get(k)?.fieldType === 'phonenumber') out[k] = '•••';
  return out;
}

export interface ObjectOpts {
  /** 'force': "Sincronizar ahora". Si no, sirve lo leído en el último minuto. */
  refresh?: 'force' | 'cache';
  /** Teléfonos ocultos: tampoco ve el email ni los teléfonos del contacto. */
  mask?: boolean;
  /** Nombre guardado del registro (el vínculo), por si HubSpot no responde. */
  name?: string;
}

const emptyObject = (connected: boolean): ChatCompanyDto => ({ connected, company: null, values: {}, times: {}, syncedAt: null, refreshError: '', canWrite: false, log: [] });

/**
 * El contacto o negocio para el panel de HubSpot, con la misma forma que la
 * empresa (`company` es el registro): todos sus valores, cuándo se leyeron y
 * si el token lo puede editar. Sin registro (`id` vacío): `company` null.
 */
export async function hubspotObjectDto(ws: string, type: HubspotObjectType, id: string, opts: ObjectOpts = {}): Promise<ChatCompanyDto> {
  const conn = await hubspotConn(ws);
  if (!conn) return emptyObject(false);
  if (!/^\d{1,20}$/.test(id)) return emptyObject(true);
  const row = await freshSchemaRow(ws, type);
  const defs = defsOf(row);
  const names = [...defs.values()].filter((d) => !d.hidden).map((d) => d.name);
  const fallback = opts.name || id;
  const base = { connected: true, times: {}, log: [], canWrite: conn.scopes.includes(HUBSPOT_OBJECT_WRITE_SCOPE[type]) };
  try {
    const got = await readValues(conn, type, id, names.length ? names : HUBSPOT_OBJECT_DEFAULT_PINNED[type], opts.refresh === 'force');
    if (!got) {
      return { ...base, company: { id, name: fallback, url: hubspotRecordUrl(conn, type, id), broken: { reason: 'deleted', mergedInto: '', mergedName: '' } }, values: {}, syncedAt: null, refreshError: '' };
    }
    await markHubspotUsed(ws).catch(() => null);
    const values = opts.mask ? masked(type, got.values, defs) : got.values;
    return {
      ...base,
      company: { id, name: opts.mask && type === 'contact' && !got.values.firstname && !got.values.lastname ? fallback : recordName(type, got.values, fallback), url: hubspotRecordUrl(conn, type, id), broken: null },
      values,
      syncedAt: new Date(got.at).toISOString(),
      refreshError: '',
    };
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
    if (err.code === 'hubspot_not_found') {
      return { ...base, company: { id, name: fallback, url: hubspotRecordUrl(conn, type, id), broken: { reason: 'deleted', mergedInto: '', mergedName: '' } }, values: {}, syncedAt: null, refreshError: '' };
    }
    // Sin red o con el límite: el registro igual se muestra, sin valores, y el panel dice por qué.
    return { ...base, company: { id, name: fallback, url: hubspotRecordUrl(conn, type, id), broken: null }, values: {}, syncedAt: null, refreshError: err.code };
  }
}

/**
 * Las propiedades elegidas (por la persona o el workspace) del contacto o
 * negocio que tienen valor, para los detalles del chat. null si no se
 * pudieron leer (se muestran las de siempre).
 */
export async function hubspotObjectSummary(ws: string, type: HubspotObjectType, id: string, viewer?: string, mask = false): Promise<{ id: string; pinned: PinnedValue[] } | null> {
  const conn = await hubspotConn(ws);
  if (!conn || !/^\d{1,20}$/.test(id)) return null;
  const row = await freshSchemaRow(ws, type);
  const defs = defsOf(row);
  if (defs.size === 0) return null;
  const names = (await mineOf(ws, viewer, type, defs)) ?? pinnedOf(type, row, defs);
  let got: CachedValues | null;
  try {
    got = await readValues(conn, type, id, names, false);
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
    return null;
  }
  if (!got) return null;
  const values = mask ? masked(type, got.values, defs) : got.values;
  const owners = await ownersOf(ws);
  const pinned: PinnedValue[] = [];
  for (const name of names) {
    const def = defs.get(name);
    const value = values[name] ?? '';
    if (!def || !value) continue;
    const picked = def.kind === 'multi' ? hubspotMulti(value) : [value];
    pinned.push({
      name,
      label: def.label,
      kind: value === '•••' ? 'text' : def.kind,
      value,
      options: def.options.filter((o) => picked.includes(o.value)),
      ...(def.kind === 'owner' ? { ownerName: owners.find((o) => o.id === value)?.name ?? '' } : {}),
    });
  }
  return { id, pinned };
}

/**
 * Edita una propiedad del contacto o negocio: PATCH en HubSpot en el momento.
 * Si HubSpot la rechaza, no cambia nada y el error dice por qué.
 */
export async function updateHubspotObjectProperty(ws: string, type: HubspotObjectType, id: string, name: string, raw: unknown): Promise<{ value: string; updatedAt: string }> {
  const conn = await requireHubspotConn(ws);
  const scope = HUBSPOT_OBJECT_WRITE_SCOPE[type];
  if (!conn.scopes.includes(scope)) throw new HubspotError(`hubspot_missing_scopes:${scope}`, 403);
  if (!/^\d{1,20}$/.test(id)) throw new HubspotError('hubspot_not_linked');
  const defs = defsOf(await freshSchemaRow(ws, type));
  const def = defs.get(name);
  if (!def || def.hidden) throw new HubspotError('invalid_input');
  if (def.readOnly) throw new HubspotError('hubspot_read_only');
  const value = normalizeHubspotInput(def, raw, await ownersOf(ws));
  let json: Record<string, unknown>;
  try {
    ({ json } = await hubspotCall(conn, 'PATCH', `/crm/v3/objects/${PLURAL[type]}/${id}`, { properties: { [name]: value } }, { retries: 2, maxWaitMs: 3_000 }));
  } catch (err) {
    if (err instanceof HubspotError && err.code === 'hubspot_not_found') throw new HubspotError('hubspot_record_gone', 409);
    if (err instanceof HubspotError && err.code === 'hubspot_missing_scopes') throw new HubspotError(`hubspot_missing_scopes:${scope}`, 403);
    throw err;
  }
  const at = new Date(hubspotTime(text(json.updatedAt)) ?? Date.now()).toISOString();
  const hit = valueCache.get(cacheKey(ws, type, id));
  if (hit) {
    if (value === '') delete hit.values[name];
    else hit.values[name] = value;
  }
  await markHubspotUsed(ws).catch(() => null);
  return { value, updatedAt: at };
}

// ======================================================================
// De qué contacto y negocio es un chat
// ======================================================================

/** Lines: el contacto o negocio vinculado al chat ('' si no hay). */
export async function chatObjectLink(ws: string, chatId: string, type: HubspotObjectType): Promise<{ id: string; name: string }> {
  const row = (await getDb().prepare('SELECT object_id, name FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ? AND object_type = ?').get(chatId, ws, type)) as
    | { object_id: string; name: string }
    | undefined;
  return { id: row?.object_id ?? '', name: row?.name ?? '' };
}

/**
 * Inbox: el negocio del contacto (el primero que HubSpot asocia a ese
 * contacto). '' si no tiene o no se pudo leer.
 */
export async function contactDealId(ws: string, contactId: string): Promise<string> {
  if (!/^\d{1,20}$/.test(contactId)) return '';
  const conn = await hubspotConn(ws);
  if (!conn) return '';
  try {
    const { json } = await hubspotCall(conn, 'GET', `/crm/v4/objects/contacts/${contactId}/associations/deals?limit=20`, undefined, { quiet: true, retries: 1, maxWaitMs: 2_000 });
    const ids = list(json.results)
      .map((r) => text(r.toObjectId, 30))
      .filter((x) => /^\d{1,20}$/.test(x));
    // El más nuevo: el id más alto.
    return ids.sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : BigInt(b) < BigInt(a) ? -1 : 0))[0] ?? '';
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
    return '';
  }
}

/** Tests: vacía la copia en memoria. */
export function clearHubspotObjectCache(): void {
  valueCache.clear();
}
