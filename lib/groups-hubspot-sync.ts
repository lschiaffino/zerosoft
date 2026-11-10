/**
 * Lines + HubSpot: todas las propiedades de la empresa y el sync de ida y
 * vuelta.
 *
 * - Esquema: la definición de cada propiedad de empresa de la cuenta (también
 *   las propias) y sus grupos, por workspace. Se importa al conectar, a pedido
 *   y cada 6 horas desde el cron de Lines.
 * - Valores: una fila por (workspace, empresa de HubSpot) con todos los
 *   valores en JSON; dos chats de la misma empresa comparten la fila. Se leen
 *   de a 100 con batch/read. La proyección angosta groups_hubspot_values (una
 *   fila por propiedad con valor) es la que usa el filtro de la bandeja.
 * - Lines → HubSpot: editar una propiedad hace PATCH de la empresa en el
 *   momento. Nada queda en cola: si HubSpot la rechaza, no se guarda.
 * - HubSpot → Lines: el cron busca cada minuto las empresas vinculadas que
 *   cambiaron (búsqueda por hs_lastmodifieddate, de a 100 empresas, con cursor
 *   que retoma), el panel refresca al abrir si la copia tiene más de un
 *   minuto, y un webhook firmado (opcional) avisa en el momento.
 * - Conflictos: gana la última escritura, por propiedad. Lo que escribimos
 *   lleva la hora que devolvió HubSpot; una lectura con hora anterior no la
 *   pisa. Lo que llega de HubSpot solo se guarda acá (nunca se vuelve a
 *   mandar) y un valor igual al local no es un cambio: no hay vuelta.
 * - Empresas borradas o fusionadas: el vínculo queda marcado como roto, con
 *   la empresa que quedó si fue una fusión. El sync sigue con las demás.
 *
 * Las llamadas salen por safeFetch (o el HubSpot falso). Server-only.
 */
import crypto from 'node:crypto';
import { getDb } from './db';
import { open } from './secret-box';
import { fakeMode } from './groups-integrations';
import { chatAccessSql, type GroupsViewer } from './groups-access';
import {
  HUBSPOT_API,
  HUBSPOT_WRITE_SCOPE,
  HubspotError,
  hubspotConn,
  hubspotFetcher,
  hubspotRecordUrl,
  markHubspotUsed,
  requireHubspotConn,
  type HubspotConn,
} from './groups-hubspot';
import {
  HUBSPOT_DEFAULT_PINNED,
  HUBSPOT_MAX_PINNED,
  HUBSPOT_PROP_NAME,
  HUBSPOT_SUGGEST_MIN,
  hubspotMulti,
  hubspotNumeric,
  hubspotPropKind,
  hubspotTime,
  nameSimilarity,
  nameTokens,
  type HubspotOption,
  type HubspotOwner,
  type HubspotPropDef,
  type HubspotPropKind,
  type HubspotSchemaDto,
} from './groups-hubspot-shared';

const BATCH = 100;
const SCHEMA_TTL_MS = 6 * 3_600_000;
const OPEN_TTL_MS = 60_000;
const VERIFY_EVERY_MS = 3_600_000;
/** El índice de búsqueda de HubSpot tarda en ver un cambio: cada pasada vuelve a mirar los últimos minutos. */
const SEARCH_OVERLAP_MS = 3 * 60_000;
const LOG_PER_APPLY = 50;
const LOG_KEEP_DAYS = 90;
const VALUE_MAX = 500;

export type SyncSource = 'link' | 'poll' | 'open' | 'manual' | 'webhook' | 'verify' | 'edit';

// ======================================================================
// HTTP con reintento ante el límite de HubSpot
// ======================================================================

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, fakeMode() ? Math.min(ms, 5) : ms));

interface CallOpts {
  /** Reintentos ante un 429 y cuánto se espera en total como mucho. */
  retries?: number;
  maxWaitMs?: number;
}

/** Lo que HubSpot dijo de un valor que no aceptó, en una línea. */
function validationDetail(json: Record<string, unknown>): string {
  const message = typeof json.message === 'string' ? json.message : '';
  const at = message.indexOf('[');
  if (at >= 0) {
    try {
      const items = JSON.parse(message.slice(at)) as Array<{ message?: string }>;
      const lines = items.map((i) => (typeof i?.message === 'string' ? i.message : '')).filter(Boolean);
      if (lines.length) return lines.join(' ').slice(0, 300);
    } catch {
      // No era una lista: va el mensaje entero.
    }
  }
  return message.slice(0, 300);
}

async function call(conn: HubspotConn, method: string, path: string, body?: unknown, opts: CallOpts = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const retries = opts.retries ?? 2;
  const maxWait = opts.maxWaitMs ?? 4_000;
  let waited = 0;
  const fail = async (err: HubspotError): Promise<never> => {
    await markHubspotUsed(conn.ws, err.code).catch(() => null);
    throw err;
  };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await hubspotFetcher()(`${HUBSPOT_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json', accept: 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return fail(new HubspotError('hubspot_unreachable', 502));
    }
    const text = await res.text().catch(() => '');
    if (res.status === 429) {
      // Límite por 10 segundos: se espera lo que pide HubSpot (o 1, 2, 4 s) y se reintenta. El diario no se reintenta.
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      if (/DAILY/i.test(text) || attempt >= retries || waited + wait > maxWait) return fail(new HubspotError('hubspot_rate_limited', 429));
      await pause(wait);
      waited += wait;
      continue;
    }
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (res.status === 401) return fail(new HubspotError('hubspot_invalid_token', 502));
    if (res.status === 403) return fail(new HubspotError('hubspot_missing_scopes', 502));
    // Un registro que no está o un valor inválido no son un problema de la conexión.
    if (res.status === 404) throw new HubspotError('hubspot_not_found', 404);
    if (res.status === 400 || res.status === 409 || res.status === 422) throw new HubspotError('hubspot_validation', 422, validationDetail(json));
    if (!res.ok) return fail(new HubspotError('hubspot_error', 502));
    return { status: res.status, json };
  }
}

const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : []);
const text = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

function parseObject(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string') out[k] = x;
    return out;
  } catch {
    return {};
  }
}

function parseArray<T>(raw: string | null | undefined): T[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ======================================================================
// Esquema
// ======================================================================

interface PropRow {
  name: string;
  label: string;
  type: string;
  field_type: string;
  group_name: string;
  description: string;
  options: string;
  read_only: number;
  calculated: number;
  hidden: number;
  custom: number;
  owner_ref: number;
  position: number;
}

function toDef(r: PropRow): HubspotPropDef {
  return {
    name: r.name,
    label: r.label || r.name,
    type: r.type,
    fieldType: r.field_type,
    kind: hubspotPropKind(r.type, r.field_type, r.owner_ref === 1),
    group: r.group_name,
    description: r.description,
    options: parseArray<HubspotOption>(r.options).filter((o) => o && typeof o.value === 'string'),
    readOnly: r.read_only === 1 || r.calculated === 1,
    calculated: r.calculated === 1,
    hidden: r.hidden === 1,
    custom: r.custom === 1,
  };
}

async function propRows(ws: string): Promise<PropRow[]> {
  return (await getDb().prepare('SELECT * FROM groups_hubspot_props WHERE user_id = ? AND archived = 0 ORDER BY position, label').all(ws)) as PropRow[];
}

/** Definiciones por nombre (todas las no archivadas, también las ocultas). */
async function loadDefs(ws: string): Promise<Map<string, HubspotPropDef>> {
  return new Map((await propRows(ws)).map((r) => [r.name, toDef(r)]));
}

/** Contabilidad de HubSpot (solo lectura y no creada por la cuenta): cambia sola, no va al registro. */
const isNoise = (def: HubspotPropDef | undefined) => !def || (def.readOnly && !def.custom);

/**
 * Importa de HubSpot la definición de todas las propiedades de empresa, sus
 * grupos y los dueños (si el token los puede leer). Lo que ya no viene queda
 * archivado.
 */
export async function refreshHubspotSchema(ws: string, opts: CallOpts = {}): Promise<{ props: number; groups: number; owners: number }> {
  const conn = await requireHubspotConn(ws);
  const db = getDb();
  const props = list((await call(conn, 'GET', '/crm/v3/properties/companies', undefined, opts)).json.results);
  let groups: Array<Record<string, unknown>> = [];
  try {
    groups = list((await call(conn, 'GET', '/crm/v3/properties/companies/groups', undefined, opts)).json.results);
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
  }
  const now = new Date().toISOString();
  const rows = props
    .filter((p) => HUBSPOT_PROP_NAME.test(text(p.name)) && p.archived !== true)
    .map((p) => {
      const meta = (p.modificationMetadata && typeof p.modificationMetadata === 'object' ? p.modificationMetadata : {}) as Record<string, unknown>;
      const fieldType = text(p.fieldType, 60) || 'text';
      const options = list(p.options)
        .slice(0, 500)
        .map((o) => ({ label: text(o.label, 200) || text(o.value, 200), value: text(o.value, 200) }))
        .filter((o) => o.value !== '');
      const calculated = p.calculated === true || fieldType.startsWith('calculation');
      return [
        ws,
        text(p.name, 120),
        text(p.label, 200),
        text(p.type, 40) || 'string',
        fieldType,
        text(p.groupName, 120),
        text(p.description, 500),
        JSON.stringify(options),
        meta.readOnlyValue === true ? 1 : 0,
        calculated ? 1 : 0,
        p.hidden === true ? 1 : 0,
        p.hubspotDefined === true ? 0 : 1,
        p.referencedObjectType === 'OWNER' || p.name === 'hubspot_owner_id' ? 1 : 0,
        Number.isFinite(Number(p.displayOrder)) ? Number(p.displayOrder) : 0,
        now,
      ];
    });
  for (const part of chunks(rows, 40)) {
    await db
      .prepare(
        `INSERT INTO groups_hubspot_props (user_id, name, label, type, field_type, group_name, description, options, read_only, calculated, hidden, custom, owner_ref, position, updated_at, archived)
         VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').join(', ')}
         ON CONFLICT(user_id, name) DO UPDATE SET label = excluded.label, type = excluded.type, field_type = excluded.field_type, group_name = excluded.group_name,
           description = excluded.description, options = excluded.options, read_only = excluded.read_only, calculated = excluded.calculated, hidden = excluded.hidden,
           custom = excluded.custom, owner_ref = excluded.owner_ref, position = excluded.position, updated_at = excluded.updated_at, archived = 0`,
      )
      .run(...part.flat());
  }
  // Solo si HubSpot devolvió propiedades: una respuesta vacía no archiva todo.
  if (rows.length) await db.prepare('UPDATE groups_hubspot_props SET archived = 1 WHERE user_id = ? AND updated_at != ?').run(ws, now);
  const groupRows = groups.filter((g) => text(g.name) && g.archived !== true).map((g, i) => [ws, text(g.name, 120), text(g.label, 200), Number.isFinite(Number(g.displayOrder)) ? Number(g.displayOrder) : i]);
  if (groupRows.length) {
    await db.prepare('DELETE FROM groups_hubspot_prop_groups WHERE user_id = ?').run(ws);
    for (const part of chunks(groupRows, 100)) {
      await db
        .prepare(`INSERT OR REPLACE INTO groups_hubspot_prop_groups (user_id, name, label, position) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')}`)
        .run(...part.flat());
    }
  }
  // Dueños: para mostrar el nombre y para el selector. Sin el permiso, queda la lista anterior (o vacía).
  let owners: HubspotOwner[] | null = null;
  if (conn.scopes.includes('crm.objects.owners.read')) {
    try {
      owners = [];
      let after = '';
      for (let page = 0; page < 10; page++) {
        const r = (await call(conn, 'GET', `/crm/v3/owners?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, undefined, opts)).json;
        for (const o of list(r.results)) {
          const id = text(o.id, 30);
          if (!/^\d{1,20}$/.test(id)) continue;
          owners.push({ id, name: [text(o.firstName, 80), text(o.lastName, 80)].filter(Boolean).join(' ') || text(o.email, 160) || id });
        }
        after = text(((r.paging as Record<string, unknown> | undefined)?.next as Record<string, unknown> | undefined)?.after, 100);
        if (!after) break;
      }
    } catch (err) {
      if (!(err instanceof HubspotError)) throw err;
      owners = null;
    }
  }
  if (owners) await db.prepare('UPDATE groups_hubspot SET schema_synced_at = ?, owners = ? WHERE user_id = ?').run(now, JSON.stringify(owners), ws);
  else await db.prepare('UPDATE groups_hubspot SET schema_synced_at = ? WHERE user_id = ?').run(now, ws);
  return { props: rows.length, groups: groupRows.length, owners: owners?.length ?? 0 };
}

interface StateRow {
  token: string;
  scopes: string;
  schema_synced_at: string | null;
  owners: string;
  pinned: string;
  sync_cursor: string;
  synced_at: string | null;
  verified_at: string | null;
}

async function stateRow(ws: string): Promise<StateRow | null> {
  return ((await getDb().prepare('SELECT token, scopes, schema_synced_at, owners, pinned, sync_cursor, synced_at, verified_at FROM groups_hubspot WHERE user_id = ?').get(ws)) as StateRow | undefined) ?? null;
}

function pinnedOf(row: StateRow | null, defs: Map<string, HubspotPropDef>): string[] {
  const saved = parseArray<string>(row?.pinned).filter((n) => typeof n === 'string');
  return (saved.length ? saved : HUBSPOT_DEFAULT_PINNED).filter((n) => defs.has(n) && !defs.get(n)?.hidden).slice(0, HUBSPOT_MAX_PINNED);
}

/** El esquema para la interfaz: propiedades visibles, grupos, dueños y fijadas. */
export async function getHubspotSchema(ws: string): Promise<HubspotSchemaDto> {
  const row = await stateRow(ws);
  if (!row?.token) return { connected: false, syncedAt: null, groups: [], props: [], owners: [], pinned: [], canWrite: false };
  const defs = await loadDefs(ws);
  const groups = (await getDb().prepare('SELECT name, label FROM groups_hubspot_prop_groups WHERE user_id = ? ORDER BY position, label').all(ws)) as Array<{ name: string; label: string }>;
  const props = [...defs.values()].filter((d) => !d.hidden);
  const used = new Set(props.map((p) => p.group));
  return {
    connected: true,
    syncedAt: row.schema_synced_at,
    groups: [...groups.filter((g) => used.has(g.name)), ...[...used].filter((g) => !groups.some((x) => x.name === g)).map((g) => ({ name: g, label: g }))],
    props,
    owners: parseArray<HubspotOwner>(row.owners).filter((o) => o && typeof o.id === 'string'),
    pinned: pinnedOf(row, defs),
    canWrite: parseArray<string>(row.scopes).includes(HUBSPOT_WRITE_SCOPE),
  };
}

/** Qué propiedades se muestran arriba y en los detalles del chat. Vacío vuelve a las de siempre. */
export async function setHubspotPinned(ws: string, names: unknown): Promise<string[]> {
  await requireHubspotConn(ws);
  const defs = await loadDefs(ws);
  const clean = [...new Set((Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && defs.has(n) && !defs.get(n)?.hidden))].slice(0, HUBSPOT_MAX_PINNED);
  await getDb().prepare('UPDATE groups_hubspot SET pinned = ? WHERE user_id = ?').run(JSON.stringify(clean), ws);
  return pinnedOf(await stateRow(ws), defs);
}

// ======================================================================
// Valores
// ======================================================================

interface CompanyRow {
  user_id: string;
  company_id: string;
  name: string;
  props: string;
  prop_times: string;
  hs_modified_at: string | null;
  fetched_at: string | null;
  missing: number;
  missing_reason: string;
  merged_into: string;
  merged_name: string;
}

async function companyRow(ws: string, id: string): Promise<CompanyRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_hubspot_companies WHERE user_id = ? AND company_id = ?').get(ws, id)) as CompanyRow | undefined) ?? null;
}

/** Actualiza la proyección para filtrar: una fila por propiedad con valor (las ocultas no entran). */
async function project(ws: string, companyId: string, changed: Array<[string, string]>, defs: Map<string, HubspotPropDef>): Promise<void> {
  const db = getDb();
  const visible = changed.filter(([name]) => defs.has(name) && !defs.get(name)?.hidden);
  const gone = visible.filter(([, v]) => v === '').map(([name]) => name);
  const set = visible.filter(([, v]) => v !== '');
  for (const part of chunks(gone, 200)) {
    await db.prepare(`DELETE FROM groups_hubspot_values WHERE user_id = ? AND company_id = ? AND name IN (${part.map(() => '?').join(',')})`).run(ws, companyId, ...part);
  }
  for (const part of chunks(set, 100)) {
    const args: Array<string | number | null> = [];
    for (const [name, value] of part) args.push(ws, companyId, name, value.slice(0, VALUE_MAX), hubspotNumeric(defs.get(name)?.kind ?? null, value));
    await db
      .prepare(
        `INSERT INTO groups_hubspot_values (user_id, company_id, name, value, num) VALUES ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT(user_id, company_id, name) DO UPDATE SET value = excluded.value, num = excluded.num`,
      )
      .run(...args);
  }
}

async function logChanges(
  ws: string,
  companyId: string,
  direction: 'in' | 'out',
  source: SyncSource,
  actor: string | null,
  changes: Array<{ name: string; old: string; next: string }>,
  at: string,
): Promise<void> {
  const db = getDb();
  for (const c of changes.slice(0, LOG_PER_APPLY)) {
    await db
      .prepare('INSERT INTO groups_hubspot_sync_log (id, user_id, company_id, direction, property, old_value, new_value, actor_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), ws, companyId, direction, c.name, c.old.slice(0, 2000), c.next.slice(0, 2000), actor, source, at);
  }
}

/** El nombre de la empresa también está copiado en el vínculo (la fila de la bandeja). */
async function renameLinks(ws: string, companyId: string, name: string): Promise<void> {
  if (!name) return;
  await getDb().prepare("UPDATE groups_hubspot_links SET name = ? WHERE user_id = ? AND object_type = 'company' AND object_id = ? AND name != ?").run(name.slice(0, 300), ws, companyId, name.slice(0, 300));
}

/**
 * Aplica una lectura de HubSpot a la copia local. Por propiedad: si el valor
 * es igual, no pasa nada; si es distinto y la lectura es posterior (o igual) a
 * lo último que se escribió desde acá, gana HubSpot; si es anterior, queda lo
 * local. Devuelve cuántos cambios aplicó.
 */
export async function applyHubspotSnapshot(
  ws: string,
  companyId: string,
  incoming: Record<string, string>,
  modifiedAt: string,
  source: SyncSource,
  defs?: Map<string, HubspotPropDef>,
  attempt = 0,
): Promise<number> {
  const db = getDb();
  const d = defs ?? (await loadDefs(ws));
  const now = new Date().toISOString();
  const tH = hubspotTime(modifiedAt) ?? Date.now();
  const stamp = new Date(tH).toISOString();
  const row = await companyRow(ws, companyId);
  if (!row || !row.fetched_at || row.missing === 1) {
    // Primera vez (o volvió a HubSpot): se guarda todo, sin llenar el registro.
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming)) if (v !== '') props[k] = v;
    await db
      .prepare(
        `INSERT INTO groups_hubspot_companies (user_id, company_id, name, props, prop_times, hs_modified_at, fetched_at, missing, missing_reason, merged_into, merged_name)
         VALUES (?, ?, ?, ?, '{}', ?, ?, 0, '', '', '')
         ON CONFLICT(user_id, company_id) DO UPDATE SET name = excluded.name, props = excluded.props, prop_times = '{}', hs_modified_at = excluded.hs_modified_at,
           fetched_at = excluded.fetched_at, missing = 0, missing_reason = '', merged_into = '', merged_name = ''`,
      )
      .run(ws, companyId, (props.name ?? '').slice(0, 300), JSON.stringify(props), stamp, now);
    await db.prepare('DELETE FROM groups_hubspot_values WHERE user_id = ? AND company_id = ?').run(ws, companyId);
    await project(ws, companyId, Object.entries(props), d);
    await db.prepare("UPDATE groups_hubspot_links SET missing = 0 WHERE user_id = ? AND object_type = 'company' AND object_id = ? AND missing = 1").run(ws, companyId);
    await renameLinks(ws, companyId, props.name ?? '');
    return 0;
  }
  const local = parseObject(row.props);
  const times = parseObject(row.prop_times);
  const changes: Array<{ name: string; old: string; next: string }> = [];
  for (const [name, next] of Object.entries(incoming)) {
    const old = local[name] ?? '';
    if (old === next) continue;
    const tL = times[name] ? (hubspotTime(times[name]) ?? 0) : 0;
    // Lo escribimos después de esta lectura: queda lo nuestro.
    if (tL > tH) continue;
    changes.push({ name, old, next });
    if (next === '') delete local[name];
    else local[name] = next;
    if (!isNoise(d.get(name))) times[name] = stamp;
  }
  // Compare-and-set con las horas por propiedad: si alguien editó mientras tanto, se vuelve a calcular.
  const res = await db
    .prepare('UPDATE groups_hubspot_companies SET name = ?, props = ?, prop_times = ?, hs_modified_at = ?, fetched_at = ? WHERE user_id = ? AND company_id = ? AND prop_times = ?')
    .run((local.name ?? row.name).slice(0, 300), JSON.stringify(local), JSON.stringify(times), stamp, now, ws, companyId, row.prop_times);
  if (res.changes === 0) return attempt < 2 ? applyHubspotSnapshot(ws, companyId, incoming, modifiedAt, source, d, attempt + 1) : 0;
  if (changes.length === 0) return 0;
  await project(
    ws,
    companyId,
    changes.map((c) => [c.name, c.next]),
    d,
  );
  const logged = changes.filter((c) => !isNoise(d.get(c.name)));
  await logChanges(ws, companyId, 'in', source, null, logged, now);
  if (changes.some((c) => c.name === 'name')) await renameLinks(ws, companyId, local.name ?? '');
  return logged.length;
}

/** La empresa ya no está en HubSpot (borrada o fusionada en otra): el vínculo queda roto, con aviso. */
async function markMissing(ws: string, companyId: string, reason: 'deleted' | 'merged', mergedInto = '', mergedName = ''): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO groups_hubspot_companies (user_id, company_id, missing, missing_reason, merged_into, merged_name, fetched_at) VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(user_id, company_id) DO UPDATE SET missing = 1, missing_reason = excluded.missing_reason, merged_into = excluded.merged_into, merged_name = excluded.merged_name, fetched_at = excluded.fetched_at`,
    )
    .run(ws, companyId, reason, mergedInto, mergedName.slice(0, 300), new Date().toISOString());
  await db.prepare('DELETE FROM groups_hubspot_values WHERE user_id = ? AND company_id = ?').run(ws, companyId);
  await db.prepare("UPDATE groups_hubspot_links SET missing = 1 WHERE user_id = ? AND object_type = 'company' AND object_id = ?").run(ws, companyId);
}

/** Si una empresa desapareció por una fusión, HubSpot guarda su id en hs_merged_object_ids de la que quedó. */
async function findMergeWinner(conn: HubspotConn, oldId: string, opts: CallOpts): Promise<{ id: string; name: string } | null> {
  try {
    const r = (
      await call(
        conn,
        'POST',
        '/crm/v3/objects/companies/search',
        { filterGroups: [{ filters: [{ propertyName: 'hs_merged_object_ids', operator: 'CONTAINS_TOKEN', value: oldId }] }], properties: ['name', 'hs_merged_object_ids'], limit: 5 },
        opts,
      )
    ).json;
    for (const raw of list(r.results)) {
      const p = (raw.properties ?? {}) as Record<string, unknown>;
      if (hubspotMulti(text(p.hs_merged_object_ids, 4000)).includes(oldId) && /^\d{1,20}$/.test(text(raw.id))) return { id: text(raw.id), name: text(p.name) };
    }
  } catch (err) {
    if (!(err instanceof HubspotError)) throw err;
  }
  return null;
}

function normalizeProps(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!HUBSPOT_PROP_NAME.test(k)) continue;
    out[k] = v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
  }
  return out;
}

export interface ImportResult {
  /** Empresas leídas. */
  read: number;
  /** Cambios que entraron al registro. */
  changes: number;
  /** Empresas que ya no están en HubSpot. */
  missing: string[];
}

/**
 * Trae de HubSpot todas las propiedades de estas empresas (de a 100 por
 * llamada) y las aplica a la copia local. Las que no vuelven quedan marcadas
 * como borradas o fusionadas.
 */
export async function importHubspotCompanies(ws: string, ids: string[], source: SyncSource, opts: CallOpts = {}): Promise<ImportResult> {
  const conn = await requireHubspotConn(ws);
  const wanted = [...new Set(ids.filter((id) => /^\d{1,20}$/.test(id)))];
  const out: ImportResult = { read: 0, changes: 0, missing: [] };
  if (wanted.length === 0) return out;
  let defs = await loadDefs(ws);
  if (defs.size === 0) {
    await refreshHubspotSchema(ws, opts);
    defs = await loadDefs(ws);
  }
  const properties = [...new Set([...defs.keys(), 'name', 'hs_lastmodifieddate', 'hs_merged_object_ids'])];
  for (const part of chunks(wanted, BATCH)) {
    const { json } = await call(conn, 'POST', '/crm/v3/objects/companies/batch/read', { properties, inputs: part.map((id) => ({ id })) }, opts);
    const seen = new Set<string>();
    for (const raw of list(json.results)) {
      const id = text(raw.id, 30);
      const props = normalizeProps(raw.properties);
      if (part.includes(id)) {
        seen.add(id);
        out.read++;
        out.changes += await applyHubspotSnapshot(ws, id, props, props.hs_lastmodifieddate || text(raw.updatedAt) || new Date().toISOString(), source, defs);
        continue;
      }
      // Pedimos una empresa fusionada y HubSpot devolvió la que quedó.
      for (const old of hubspotMulti(props.hs_merged_object_ids ?? '')) {
        if (!part.includes(old) || seen.has(old)) continue;
        seen.add(old);
        out.missing.push(old);
        await markMissing(ws, old, 'merged', id, props.name ?? '');
      }
    }
    for (const id of part) {
      if (seen.has(id)) continue;
      out.missing.push(id);
      const winner = await findMergeWinner(conn, id, opts);
      await markMissing(ws, id, winner ? 'merged' : 'deleted', winner?.id ?? '', winner?.name ?? '');
    }
  }
  await markHubspotUsed(ws).catch(() => null);
  return out;
}

// ======================================================================
// La pantalla de un chat
// ======================================================================

async function companyLink(ws: string, chatId: string): Promise<{ object_id: string; name: string } | null> {
  return (
    ((await getDb().prepare("SELECT object_id, name FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ? AND object_type = 'company'").get(chatId, ws)) as
      | { object_id: string; name: string }
      | undefined) ?? null
  );
}

export interface HubspotBroken {
  reason: 'deleted' | 'merged';
  /** Fusión: la empresa que quedó. */
  mergedInto: string;
  mergedName: string;
}

const brokenOf = (row: CompanyRow | null): HubspotBroken | null =>
  row?.missing === 1 ? { reason: row.missing_reason === 'merged' ? 'merged' : 'deleted', mergedInto: row.merged_into, mergedName: row.merged_name } : null;

export interface PinnedValue {
  name: string;
  label: string;
  kind: HubspotPropKind;
  value: string;
  /** Solo las opciones del valor (para mostrar la etiqueta) y el nombre del dueño. */
  options: HubspotOption[];
  ownerName?: string;
}

export interface ChatCompanySummary {
  id: string;
  /** Propiedades fijadas que tienen valor. */
  pinned: PinnedValue[];
  broken: HubspotBroken | null;
}

/** La empresa del chat con sus propiedades fijadas, para la sección compacta de los detalles. */
export async function chatCompanySummary(ws: string, chatId: string): Promise<ChatCompanySummary | null> {
  const link = await companyLink(ws, chatId);
  if (!link) return null;
  const row = await companyRow(ws, link.object_id);
  if (!row) return { id: link.object_id, pinned: [], broken: null };
  const state = await stateRow(ws);
  const defs = await loadDefs(ws);
  const values = parseObject(row.props);
  const owners = parseArray<HubspotOwner>(state?.owners);
  const pinned: PinnedValue[] = [];
  for (const name of pinnedOf(state, defs)) {
    const def = defs.get(name);
    const value = values[name] ?? '';
    if (!def || !value) continue;
    const picked = def.kind === 'multi' ? hubspotMulti(value) : [value];
    pinned.push({
      name,
      label: def.label,
      kind: def.kind,
      value,
      options: def.options.filter((o) => picked.includes(o.value)),
      ...(def.kind === 'owner' ? { ownerName: owners.find((o) => o.id === value)?.name ?? '' } : {}),
    });
  }
  return { id: link.object_id, pinned, broken: brokenOf(row) };
}

export interface SyncLogEntry {
  id: string;
  direction: 'in' | 'out';
  property: string;
  oldValue: string;
  newValue: string;
  /** Quién lo cambió desde Lines (los cambios que llegan de HubSpot no traen autor). */
  actor: string;
  source: string;
  at: string;
}

export interface ChatCompanyDto {
  connected: boolean;
  company: { id: string; name: string; url: string; broken: HubspotBroken | null } | null;
  values: Record<string, string>;
  /** Última vez que cambió cada propiedad (las que cambiaron desde que se vinculó). */
  times: Record<string, string>;
  /** Última lectura de HubSpot. */
  syncedAt: string | null;
  /** No se pudo refrescar recién: se muestra la copia guardada. */
  refreshError: string;
  /** El token puede escribir empresas. */
  canWrite: boolean;
  log: SyncLogEntry[];
}

async function syncLog(ws: string, companyId: string, limit = 50): Promise<SyncLogEntry[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT l.id, l.direction, l.property, l.old_value, l.new_value, l.source, l.created_at, COALESCE(NULLIF(u.name, ''), u.email, '') AS actor
       FROM groups_hubspot_sync_log l LEFT JOIN users u ON u.id = l.actor_id
       WHERE l.user_id = ? AND l.company_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?`,
    )
    .all(ws, companyId, limit)) as Array<{ id: string; direction: 'in' | 'out'; property: string; old_value: string; new_value: string; source: string; created_at: string; actor: string }>;
  return rows.map((r) => ({ id: r.id, direction: r.direction, property: r.property, oldValue: r.old_value, newValue: r.new_value, actor: r.actor ?? '', source: r.source, at: r.created_at }));
}

/**
 * Lo que muestra la pantalla de HubSpot de un chat: la empresa, todos sus
 * valores, cuándo se sincronizó y el registro. `refresh`: 'stale' trae de
 * HubSpot si la copia tiene más de un minuto, 'force' siempre ("Sincronizar
 * ahora"). `mask`: quien tiene los teléfonos ocultos no ve los de la empresa.
 * El que llama ya chequeó el acceso al chat.
 */
export async function chatCompany(ws: string, chatId: string, opts: { refresh?: 'stale' | 'force' | 'none'; mask?: boolean } = {}): Promise<ChatCompanyDto> {
  const conn = await hubspotConn(ws);
  const empty: ChatCompanyDto = { connected: Boolean(conn), company: null, values: {}, times: {}, syncedAt: null, refreshError: '', canWrite: false, log: [] };
  if (!conn) return empty;
  const link = await companyLink(ws, chatId);
  if (!link) return empty;
  let row = await companyRow(ws, link.object_id);
  let refreshError = '';
  const mode = opts.refresh ?? 'stale';
  const stale = !row?.fetched_at || Date.parse(row.fetched_at) < Date.now() - OPEN_TTL_MS;
  if (mode === 'force' || (mode === 'stale' && stale)) {
    try {
      await importHubspotCompanies(ws, [link.object_id], mode === 'force' ? 'manual' : 'open', { retries: 1, maxWaitMs: 2_000 });
      row = await companyRow(ws, link.object_id);
    } catch (err) {
      if (!(err instanceof HubspotError)) throw err;
      refreshError = err.code;
    }
  }
  const values = parseObject(row?.props);
  if (opts.mask) {
    const defs = await loadDefs(ws);
    for (const [name, def] of defs) if (def.fieldType === 'phonenumber' && values[name]) values[name] = '•••';
  }
  return {
    connected: true,
    company: { id: link.object_id, name: row?.name || link.name || link.object_id, url: hubspotRecordUrl(conn, 'company', link.object_id), broken: brokenOf(row) },
    values,
    times: parseObject(row?.prop_times),
    syncedAt: row?.fetched_at ?? null,
    refreshError,
    canWrite: conn.scopes.includes(HUBSPOT_WRITE_SCOPE),
    log: await syncLog(ws, link.object_id),
  };
}

// ======================================================================
// Lines → HubSpot
// ======================================================================

/** El valor como lo espera HubSpot, o un error si no corresponde al tipo de la propiedad. */
export function normalizeHubspotInput(def: HubspotPropDef, raw: unknown, owners: HubspotOwner[] = []): string {
  const bad = () => new HubspotError('hubspot_invalid_value', 400);
  if (def.kind === 'multi') {
    const values = Array.isArray(raw) ? raw.map(String) : hubspotMulti(String(raw ?? ''));
    const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
    if (clean.some((v) => !def.options.some((o) => o.value === v))) throw bad();
    return clean.join(';');
  }
  const v = String(raw ?? '').trim();
  if (v === '') return '';
  if (def.kind === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(v)) throw bad();
    return v;
  }
  if (def.kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || hubspotTime(v) === null) throw bad();
    return v;
  }
  if (def.kind === 'datetime') {
    const ms = hubspotTime(v);
    if (ms === null) throw bad();
    return new Date(ms).toISOString();
  }
  if (def.kind === 'bool') {
    if (v !== 'true' && v !== 'false') throw bad();
    return v;
  }
  if (def.kind === 'select') {
    // Con opciones conocidas, tiene que ser una de ellas (las que vienen de afuera no se pueden chequear acá).
    if (def.options.length && !def.options.some((o) => o.value === v)) throw bad();
    return v;
  }
  if (def.kind === 'owner') {
    if (!/^\d{1,20}$/.test(v) || (owners.length > 0 && !owners.some((o) => o.id === v))) throw bad();
    return v;
  }
  if (v.length > 10_000) throw bad();
  return String(raw ?? '').slice(0, 10_000);
}

/**
 * Edita una propiedad de la empresa del chat: PATCH en HubSpot en el momento
 * y, si HubSpot la acepta, la copia local, la proyección y el registro. Si la
 * rechaza (valor inválido, sin permiso de escritura, empresa borrada) no se
 * guarda nada y el error dice por qué. El que llama ya chequeó el acceso.
 */
export async function updateHubspotCompanyProperty(ws: string, actor: string, chatId: string, name: string, raw: unknown): Promise<{ value: string; updatedAt: string }> {
  const conn = await requireHubspotConn(ws);
  if (!conn.scopes.includes(HUBSPOT_WRITE_SCOPE)) throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_WRITE_SCOPE}`, 403);
  const link = await companyLink(ws, chatId);
  if (!link) throw new HubspotError('hubspot_not_linked');
  const defs = await loadDefs(ws);
  const def = defs.get(name);
  if (!def || def.hidden) throw new HubspotError('invalid_input');
  if (def.readOnly) throw new HubspotError('hubspot_read_only');
  const row = await companyRow(ws, link.object_id);
  if (row?.missing === 1) throw new HubspotError('hubspot_company_gone', 409);
  const state = await stateRow(ws);
  const value = normalizeHubspotInput(def, raw, parseArray<HubspotOwner>(state?.owners));
  const old = parseObject(row?.props)[name] ?? '';
  if (old === value) return { value, updatedAt: parseObject(row?.prop_times)[name] ?? '' };
  let json: Record<string, unknown>;
  try {
    ({ json } = await call(conn, 'PATCH', `/crm/v3/objects/companies/${link.object_id}`, { properties: { [name]: value } }, { retries: 2, maxWaitMs: 3_000 }));
  } catch (err) {
    if (err instanceof HubspotError && err.code === 'hubspot_not_found') {
      await markMissing(ws, link.object_id, 'deleted');
      throw new HubspotError('hubspot_company_gone', 409);
    }
    if (err instanceof HubspotError && err.code === 'hubspot_missing_scopes') throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_WRITE_SCOPE}`, 403);
    throw err;
  }
  // La hora de la escritura la pone HubSpot: con esa se compara lo que llegue después.
  const at = new Date(hubspotTime(text(json.updatedAt)) ?? Date.now()).toISOString();
  const db = getDb();
  const path = `$."${name}"`;
  if (!row) {
    await db
      .prepare("INSERT OR IGNORE INTO groups_hubspot_companies (user_id, company_id, name, props, prop_times) VALUES (?, ?, ?, '{}', '{}')")
      .run(ws, link.object_id, link.name);
  }
  if (value === '') {
    await db
      .prepare('UPDATE groups_hubspot_companies SET props = json_remove(props, ?), prop_times = json_set(prop_times, ?, ?) WHERE user_id = ? AND company_id = ?')
      .run(path, path, at, ws, link.object_id);
  } else {
    await db
      .prepare('UPDATE groups_hubspot_companies SET props = json_set(props, ?, ?), prop_times = json_set(prop_times, ?, ?) WHERE user_id = ? AND company_id = ?')
      .run(path, value, path, at, ws, link.object_id);
  }
  if (name === 'name' && value) {
    await db.prepare('UPDATE groups_hubspot_companies SET name = ? WHERE user_id = ? AND company_id = ?').run(value.slice(0, 300), ws, link.object_id);
    await renameLinks(ws, link.object_id, value);
  }
  await project(ws, link.object_id, [[name, value]], defs);
  await logChanges(ws, link.object_id, 'out', 'edit', actor, [{ name, old, next: value }], new Date().toISOString());
  await markHubspotUsed(ws).catch(() => null);
  return { value, updatedAt: at };
}

// ======================================================================
// HubSpot → Lines (cron)
// ======================================================================

interface Cursor {
  /** Desde cuándo se buscan cambios en esta pasada. */
  since?: string;
  /** Cuándo empezó la pasada (será el `since` de la próxima). */
  started?: string;
  /** Cuántas empresas vinculadas ya se miraron en esta pasada. */
  idx?: number;
  /** Lo mismo para la verificación completa (borradas y fusionadas). */
  vidx?: number;
}

function parseCursor(raw: string | null | undefined): Cursor {
  try {
    const v = JSON.parse(raw || '{}') as Cursor;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function linkedCompanyIds(ws: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare("SELECT DISTINCT object_id FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'company' ORDER BY object_id")
    .all(ws)) as Array<{ object_id: string }>;
  return rows.map((r) => r.object_id);
}

export interface SyncRunResult {
  workspaces: number;
  imported: number;
  changed: number;
  missing: number;
  limited: number;
}

/**
 * Una pasada del sync de un workspace (el cron ya la reclamó). Tres pasos, con
 * presupuesto de tiempo y cursor guardado después de cada tanda:
 * 1. empresas vinculadas que todavía no tienen copia local;
 * 2. empresas vinculadas modificadas desde la última pasada (búsqueda por
 *    hs_lastmodifieddate sobre tandas de 100 ids) y lectura de las que cambiaron;
 * 3. una vez por hora, lectura de todas: encuentra las borradas o fusionadas
 *    y cualquier cambio que la búsqueda no haya visto.
 */
async function syncWorkspace(ws: string, deadline: number, now: Date, out: SyncRunResult): Promise<void> {
  const db = getDb();
  const conn = await requireHubspotConn(ws);
  const state = await stateRow(ws);
  const opts: CallOpts = { retries: 3, maxWaitMs: 8_000 };
  if (!state?.schema_synced_at || Date.parse(state.schema_synced_at) < now.getTime() - SCHEMA_TTL_MS) await refreshHubspotSchema(ws, opts);
  const ids = await linkedCompanyIds(ws);
  if (ids.length === 0) return;
  const apply = (r: ImportResult) => {
    out.imported += r.read;
    out.changed += r.changes;
    out.missing += r.missing.length;
  };
  // 1. Sin copia local.
  const have = new Set(((await db.prepare('SELECT company_id FROM groups_hubspot_companies WHERE user_id = ?').all(ws)) as Array<{ company_id: string }>).map((r) => r.company_id));
  for (const part of chunks(ids.filter((id) => !have.has(id)), BATCH)) {
    if (Date.now() > deadline) return;
    apply(await importHubspotCompanies(ws, part, 'poll', opts));
  }
  // 2. Modificadas desde la última pasada.
  const cursor = parseCursor(state?.sync_cursor);
  const saveCursor = () => db.prepare('UPDATE groups_hubspot SET sync_cursor = ? WHERE user_id = ?').run(JSON.stringify(cursor), ws);
  if (!cursor.since) cursor.since = new Date(now.getTime() - SEARCH_OVERLAP_MS).toISOString();
  if (!cursor.started || (cursor.idx ?? 0) >= ids.length) {
    cursor.started = now.toISOString();
    cursor.idx = 0;
  }
  const known = new Map(
    ((await db.prepare('SELECT company_id, hs_modified_at FROM groups_hubspot_companies WHERE user_id = ? AND missing = 0').all(ws)) as Array<{ company_id: string; hs_modified_at: string | null }>).map((r) => [
      r.company_id,
      r.hs_modified_at ? (hubspotTime(r.hs_modified_at) ?? 0) : 0,
    ]),
  );
  const sinceMs = hubspotTime(cursor.since) ?? now.getTime() - SEARCH_OVERLAP_MS;
  while ((cursor.idx ?? 0) < ids.length) {
    if (Date.now() > deadline) {
      await saveCursor();
      return;
    }
    const part = ids.slice(cursor.idx ?? 0, (cursor.idx ?? 0) + BATCH);
    const { json } = await call(
      conn,
      'POST',
      '/crm/v3/objects/companies/search',
      {
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(sinceMs) },
              { propertyName: 'hs_object_id', operator: 'IN', values: part },
            ],
          },
        ],
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
        properties: ['hs_lastmodifieddate'],
        limit: BATCH,
      },
      opts,
    );
    const modified = list(json.results)
      .map((r) => ({ id: text(r.id, 30), at: hubspotTime(text(((r.properties ?? {}) as Record<string, unknown>).hs_lastmodifieddate)) ?? Number.MAX_SAFE_INTEGER }))
      // La copia local ya tiene esa versión (o una posterior): no hace falta leerla.
      .filter((r) => part.includes(r.id) && r.at > (known.get(r.id) ?? 0))
      .map((r) => r.id);
    if (modified.length) apply(await importHubspotCompanies(ws, modified, 'poll', opts));
    cursor.idx = (cursor.idx ?? 0) + part.length;
    await saveCursor();
  }
  // Pasada completa: la próxima mira desde que empezó esta, con un margen.
  cursor.since = new Date((hubspotTime(cursor.started) ?? now.getTime()) - SEARCH_OVERLAP_MS).toISOString();
  cursor.started = undefined;
  cursor.idx = 0;
  await saveCursor();
  await db.prepare('UPDATE groups_hubspot SET synced_at = ? WHERE user_id = ?').run(now.toISOString(), ws);
  // 3. Verificación completa, una vez por hora.
  if (!state?.verified_at) {
    // Recién conectado: todo se acaba de leer. La primera verificación es dentro de una hora.
    await db.prepare('UPDATE groups_hubspot SET verified_at = ? WHERE user_id = ? AND verified_at IS NULL').run(now.toISOString(), ws);
    return;
  }
  if (Date.parse(state.verified_at) > now.getTime() - VERIFY_EVERY_MS) return;
  while ((cursor.vidx ?? 0) < ids.length) {
    if (Date.now() > deadline) {
      await saveCursor();
      return;
    }
    const part = ids.slice(cursor.vidx ?? 0, (cursor.vidx ?? 0) + BATCH);
    apply(await importHubspotCompanies(ws, part, 'verify', opts));
    cursor.vidx = (cursor.vidx ?? 0) + part.length;
    await saveCursor();
  }
  cursor.vidx = 0;
  await saveCursor();
  await db.prepare('UPDATE groups_hubspot SET verified_at = ? WHERE user_id = ?').run(now.toISOString(), ws);
}

/**
 * Cron de Lines: trae a la copia local lo que cambió en HubSpot. Cada
 * workspace se reclama (sync_locked_until) para que dos corridas no hagan lo
 * mismo. Ante el límite de HubSpot, ese workspace espera (30 s, 1 min, 2...
 * hasta 15 min) y los demás siguen. `workspaceId` limita la corrida a uno.
 */
export async function syncHubspotCompanies(opts: { budgetMs?: number; now?: Date; limit?: number; workspaceId?: string } = {}): Promise<SyncRunResult> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const deadline = Date.now() + (opts.budgetMs ?? 12_000);
  const out: SyncRunResult = { workspaces: 0, imported: 0, changed: 0, missing: 0, limited: 0 };
  const rows = (await db
    .prepare(
      `SELECT h.user_id, h.sync_fails FROM groups_hubspot h
       WHERE h.token != '' AND (h.sync_backoff_until IS NULL OR h.sync_backoff_until < ?) AND (h.sync_locked_until IS NULL OR h.sync_locked_until < ?)
         AND EXISTS (SELECT 1 FROM groups_hubspot_links l WHERE l.user_id = h.user_id AND l.object_type = 'company')
         AND (? = '' OR h.user_id = ?)
       ORDER BY (h.synced_at IS NOT NULL), h.synced_at LIMIT ?`,
    )
    .all(nowIso, nowIso, opts.workspaceId ?? '', opts.workspaceId ?? '', opts.limit ?? 20)) as Array<{ user_id: string; sync_fails: number }>;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    const lock = new Date(Date.now() + 120_000).toISOString();
    const claim = await db
      .prepare('UPDATE groups_hubspot SET sync_locked_until = ? WHERE user_id = ? AND (sync_locked_until IS NULL OR sync_locked_until < ?)')
      .run(lock, r.user_id, nowIso);
    if (claim.changes === 0) continue;
    out.workspaces++;
    try {
      await syncWorkspace(r.user_id, deadline, now, out);
      await db.prepare('UPDATE groups_hubspot SET sync_fails = 0, sync_backoff_until = NULL WHERE user_id = ?').run(r.user_id);
    } catch (err) {
      if (!(err instanceof HubspotError)) throw err;
      // Límite, token vencido o sin permisos: este workspace espera cada vez más; los demás siguen.
      const fails = Number(r.sync_fails ?? 0) + 1;
      const wait = Math.min(15 * 60_000, 30_000 * 2 ** (fails - 1));
      if (err.code === 'hubspot_rate_limited') out.limited++;
      await db.prepare('UPDATE groups_hubspot SET sync_fails = ?, sync_backoff_until = ? WHERE user_id = ?').run(fails, new Date(now.getTime() + wait).toISOString(), r.user_id);
    } finally {
      await db.prepare('UPDATE groups_hubspot SET sync_locked_until = NULL WHERE user_id = ? AND sync_locked_until = ?').run(r.user_id, lock);
    }
  }
  // El registro guarda 90 días.
  await db.prepare('DELETE FROM groups_hubspot_sync_log WHERE created_at < ?').run(new Date(now.getTime() - LOG_KEEP_DAYS * 86_400_000).toISOString());
  return out;
}

// ======================================================================
// Webhook de HubSpot (opcional)
// ======================================================================

/**
 * Firma v3 de HubSpot: HMAC-SHA256 en base64, con el client secret de la app,
 * de método + URL + cuerpo + timestamp. El timestamp no puede tener más de 5
 * minutos.
 */
export function hubspotSignatureV3(secret: string, method: string, url: string, body: string, timestamp: string): string {
  return crypto.createHmac('sha256', secret).update(`${method}${url}${body}${timestamp}`).digest('base64');
}

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Eventos de un webhook de la private app (company.propertyChange,
 * company.deletion, company.merge...). No se confía en los valores que trae:
 * para cada workspace de esa cuenta cuya firma valida, se vuelven a leer de
 * HubSpot las empresas vinculadas que nombra. Devuelve null si ninguna firma
 * valida.
 */
export async function handleHubspotWebhook(input: { method: string; urls: string[]; body: string; signature: string; timestamp: string; now?: Date }): Promise<{ refreshed: number } | null> {
  const now = (input.now ?? new Date()).getTime();
  const ts = Number(input.timestamp);
  if (!input.signature || !Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60_000) return null;
  let events: Array<Record<string, unknown>> = [];
  try {
    events = list(JSON.parse(input.body)).slice(0, 200);
  } catch {
    return null;
  }
  const portals = [...new Set(events.map((e) => text(e.portalId, 30)).filter((p) => /^\d{1,20}$/.test(p)))].slice(0, 5);
  if (portals.length === 0) return null;
  const db = getDb();
  let valid = false;
  let refreshed = 0;
  for (const portal of portals) {
    const rows = (await db.prepare("SELECT user_id, webhook_secret FROM groups_hubspot WHERE portal_id = ? AND token != '' AND webhook_secret != '' LIMIT 20").all(portal)) as Array<{
      user_id: string;
      webhook_secret: string;
    }>;
    for (const row of rows) {
      let secret = '';
      try {
        secret = open(row.webhook_secret) || '';
      } catch {
        secret = '';
      }
      if (!secret || !input.urls.some((url) => sameSignature(hubspotSignatureV3(secret, input.method, url, input.body, input.timestamp), input.signature))) continue;
      valid = true;
      const linked = new Set(await linkedCompanyIds(row.user_id));
      const ids = new Set<string>();
      for (const e of events) {
        if (text(e.portalId, 30) !== portal || !text(e.subscriptionType, 60).startsWith('company.')) continue;
        for (const id of [e.objectId, e.primaryObjectId, e.newObjectId, ...(Array.isArray(e.mergedObjectIds) ? e.mergedObjectIds : [])]) {
          const s = text(id, 30);
          if (linked.has(s)) ids.add(s);
        }
      }
      if (ids.size === 0) continue;
      try {
        refreshed += (await importHubspotCompanies(row.user_id, [...ids].slice(0, BATCH), 'webhook', { retries: 1, maxWaitMs: 2_000 })).read;
      } catch (err) {
        // Lo trae la próxima pasada del cron.
        if (!(err instanceof HubspotError)) throw err;
      }
    }
  }
  return valid ? { refreshed } : null;
}

// ======================================================================
// Grupos sin empresa
// ======================================================================

export interface UnlinkedGroup {
  id: string;
  name: string;
  lineName: string;
  memberCount: number;
  /** Empresa de HubSpot con nombre parecido. Nunca se vincula sola. */
  suggestion: { id: string; name: string; domain: string; score: number } | null;
  /** Todavía no se buscó una sugerencia para este grupo. */
  pending: boolean;
}

const SUGGEST_TTL_MS = 24 * 3_600_000;

/** Grupos que la persona ve y que no tienen una empresa de HubSpot, con la sugerencia guardada si hay. */
export async function listUnlinkedGroups(ws: string, viewer: GroupsViewer, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: UnlinkedGroup[]; total: number }> {
  const where = ['c.user_id = ?', "c.kind = 'group'", 'c.hidden_at IS NULL', "NOT EXISTS (SELECT 1 FROM groups_hubspot_links zl WHERE zl.chat_id = c.id AND zl.object_type = 'company')"];
  const args: Array<string | number> = [ws];
  const access = chatAccessSql(viewer);
  if (access) {
    where.push(access.sql);
    args.push(...access.args);
  }
  const q = (opts.q ?? '').trim().slice(0, 100);
  if (q) {
    where.push("c.name LIKE ? ESCAPE '\\'");
    args.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  const limit = Math.min(Math.max(1, opts.limit ?? 25), 100);
  const offset = Math.max(0, opts.offset ?? 0);
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM groups_chats c WHERE ${where.join(' AND ')}`).get(...args)) as { n: number };
  const rows = (await db
    .prepare(
      `SELECT c.id, c.name, c.member_count, COALESCE(n.name, '') AS line_name, s.chat_name, s.company_id, s.company_name, s.domain, s.score, s.checked_at
       FROM groups_chats c LEFT JOIN groups_numbers n ON n.id = c.number_id LEFT JOIN groups_hubspot_suggest s ON s.chat_id = c.id
       WHERE ${where.join(' AND ')} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)) as Array<{
    id: string;
    name: string;
    member_count: number | null;
    line_name: string;
    chat_name: string | null;
    company_id: string | null;
    company_name: string | null;
    domain: string | null;
    score: number | null;
    checked_at: string | null;
  }>;
  const fresh = Date.now() - SUGGEST_TTL_MS;
  return {
    total: Number(total.n),
    rows: rows.map((r) => {
      const cached = r.checked_at !== null && r.chat_name === r.name && Date.parse(r.checked_at) > fresh;
      return {
        id: r.id,
        name: r.name,
        lineName: r.line_name,
        memberCount: Number(r.member_count ?? 0),
        suggestion: cached && r.company_id ? { id: r.company_id, name: r.company_name ?? '', domain: r.domain ?? '', score: Number(r.score ?? 0) } : null,
        pending: !cached,
      };
    }),
  };
}

/**
 * Busca en HubSpot la empresa con el nombre más parecido al de cada grupo (de
 * a pocos: la búsqueda de HubSpot tiene su propio límite) y guarda el
 * resultado un día. Solo propone: vincular lo confirma una persona. El que
 * llama pasa solo grupos que la persona puede ver.
 */
export async function suggestCompaniesForGroups(ws: string, chatIds: string[]): Promise<Record<string, UnlinkedGroup['suggestion']>> {
  const conn = await requireHubspotConn(ws);
  const db = getDb();
  const out: Record<string, UnlinkedGroup['suggestion']> = {};
  for (const chatId of [...new Set(chatIds)].slice(0, 10)) {
    const chat = (await db.prepare("SELECT id, name FROM groups_chats WHERE id = ? AND user_id = ? AND kind = 'group'").get(chatId, ws)) as { id: string; name: string } | undefined;
    if (!chat) continue;
    const tokens = nameTokens(chat.name);
    let best: UnlinkedGroup['suggestion'] = null;
    // Primero el nombre entero sin las palabras genéricas; si no hay nada, la palabra más larga.
    const longest = [...tokens].sort((a, b) => b.length - a.length)[0] ?? '';
    for (const query of [...new Set([tokens.join(' '), longest])].filter((x) => x.length >= 3)) {
      const { json } = await call(conn, 'POST', '/crm/v3/objects/companies/search', { query, limit: 10, properties: ['name', 'domain'] }, { retries: 2, maxWaitMs: 3_000 });
      for (const raw of list(json.results)) {
        const p = (raw.properties ?? {}) as Record<string, unknown>;
        const id = text(raw.id, 30);
        const name = text(p.name);
        const score = nameSimilarity(chat.name, name);
        if (/^\d{1,20}$/.test(id) && score >= HUBSPOT_SUGGEST_MIN && (!best || score > best.score)) best = { id, name, domain: text(p.domain), score: Math.round(score * 100) / 100 };
      }
      if (best) break;
    }
    await db
      .prepare(
        `INSERT INTO groups_hubspot_suggest (chat_id, user_id, chat_name, company_id, company_name, domain, score, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET chat_name = excluded.chat_name, company_id = excluded.company_id, company_name = excluded.company_name, domain = excluded.domain,
           score = excluded.score, checked_at = excluded.checked_at`,
      )
      .run(chat.id, ws, chat.name, best?.id ?? '', best?.name ?? '', best?.domain ?? '', best?.score ?? 0, new Date().toISOString());
    out[chat.id] = best;
  }
  return out;
}
