/**
 * Lines: integración con HubSpot.
 *
 * - Conexión: una clave de HubSpot por workspace (una service key o el token
 *   de una private app heredada; HubSpot ya no deja crear private apps
 *   nuevas). El cliente HTTP y la validación de la clave son los compartidos
 *   de lib/hubspot/. Se guarda
 *   cifrado (secret-box) y nunca vuelve por la API; al guardarlo se valida y
 *   se leen sus permisos (scopes).
 * - Vínculo: cada chat o grupo puede tener una empresa, un negocio y un
 *   contacto de HubSpot. Guardamos el id y una copia de pocas propiedades
 *   (nombre, dueño, etapa) que se refresca al abrir el chat.
 * - Coincidencia: para un chat 1 a 1 sin contacto, se busca en HubSpot el
 *   contacto con ese teléfono y se propone (con su empresa). Solo se vincula
 *   solo si el workspace prendió "vincular cuando hay una única coincidencia".
 * - Registro: una nota por chat y por día (UTC) en los registros vinculados,
 *   con la conversación de ese día. La actualiza el cron o la acción manual.
 *   El cron solo registra chats de líneas visibles para todo el workspace: lo
 *   de una línea restringida no se copia solo a HubSpot.
 * - Propiedades de la empresa: el esquema completo, los valores locales, el
 *   sync de ida y vuelta y el filtro de la bandeja viven en
 *   lib/groups-hubspot-sync.ts (usa la conexión de este módulo).
 *
 * Las llamadas salen por safeFetch. Con GROUPS_INTEGRATIONS_FAKE=1 (tests,
 * demo) responde lib/groups-hubspot-fake.ts y nada sale a internet.
 * Server-only.
 */
import { getDb } from './db';
import { open, seal } from './secret-box';
import { safeFetch } from './safe-fetch';
import { HubspotApiError, bindHubspotTokenPortal, createHubspotClient, hubspotBudget, type HubspotClient } from './hubspot/client';
import { inspectHubspotToken, looksLikeHubspotToken, type HubspotTokenInfo, type HubspotTokenKind } from './hubspot/token';
import { hubspotScopeForRequest } from './hubspot/scopes';
import type { FetchLike } from './groups-provider';
import { fakeMode } from './groups-integrations';
import { fakeHubspotFetch } from './groups-hubspot-fake';
import { mediaKind } from './groups-rules';
import { clearGroupCompany, clearWorkspaceGroupCompanies, propagateGroupCompany } from './groups-identity';

const API = 'https://api.hubapi.com';

export const HUBSPOT_TYPES = ['company', 'deal', 'contact'] as const;
export type HubspotType = (typeof HUBSPOT_TYPES)[number];

/**
 * Permisos de la clave. `read` hacen falta siempre (el último es para
 * leer la definición de las propiedades de la empresa); `sync` para editar
 * propiedades desde Lines; `optional` para el nombre y el selector de dueño;
 * `log` solo para dejar notas.
 */
export const HUBSPOT_SCOPES = {
  read: ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.schemas.companies.read'],
  sync: ['crm.objects.companies.write'],
  optional: ['crm.objects.owners.read'],
  log: ['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write'],
} as const;
/** Sin este no se edita una empresa desde Lines. */
export const HUBSPOT_WRITE_SCOPE = 'crm.objects.companies.write';
/** Sin este no se puede escribir una nota. */
const NOTE_SCOPE = 'crm.objects.contacts.write';
/** Sin este no se crean contactos (a mano o al entrar un chat nuevo). */
export const HUBSPOT_CONTACT_WRITE_SCOPE = 'crm.objects.contacts.write';

/** Los permisos que se prueban uno por uno cuando HubSpot no informa los de la clave. */
const LINES_PROBE_SCOPES = [
  ...HUBSPOT_SCOPES.read,
  ...HUBSPOT_SCOPES.optional,
  'crm.schemas.contacts.read',
  'crm.schemas.deals.read',
  ...HUBSPOT_SCOPES.log,
] as const;

const PLURAL: Record<HubspotType, string> = { company: 'companies', deal: 'deals', contact: 'contacts' };
const TYPE_ID: Record<HubspotType, string> = { contact: '0-1', company: '0-2', deal: '0-3' };
/** Tipos de asociación nota → registro (definidos por HubSpot). */
const NOTE_ASSOC: Record<HubspotType, number> = { contact: 202, company: 190, deal: 214 };
const PROPS: Record<HubspotType, string[]> = {
  company: ['name', 'domain', 'hubspot_owner_id', 'lifecyclestage'],
  deal: ['dealname', 'dealstage', 'pipeline', 'amount', 'deal_currency_code', 'closedate', 'hubspot_owner_id'],
  contact: ['firstname', 'lastname', 'email', 'company', 'associatedcompanyid', 'hubspot_owner_id', 'lifecyclestage', 'phone', 'mobilephone', 'hs_whatsapp_phone_number'],
};
const LIFECYCLE: Record<string, string> = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  marketingqualifiedlead: 'Marketing qualified lead',
  salesqualifiedlead: 'Sales qualified lead',
  opportunity: 'Opportunity',
  customer: 'Customer',
  evangelist: 'Evangelist',
  other: 'Other',
};

const REFRESH_MS = 10 * 60_000;
const MATCH_TTL_MS = 60 * 60_000;
const NOTE_MIN_GAP_MS = 10 * 60_000;
const NOTE_MAX_MESSAGES = 400;
const NOTE_MAX_CHARS = 60_000;
const MANUAL_DAYS = 7;

export class HubspotError extends Error {
  constructor(
    public code: string,
    public status = 400,
    /** Lo que dijo HubSpot (un valor que no aceptó). Nunca lleva el token. */
    public detail = '',
  ) {
    super(code);
    this.name = 'HubspotError';
  }
}

// ======================================================================
// Conexión
// ======================================================================

interface ConnRow {
  user_id: string;
  token: string;
  portal_id: string;
  ui_domain: string;
  scopes: string;
  auto_link: number;
  log_notes: number;
  auto_create?: number;
  last_error: string;
  last_used_at: string | null;
  schema_synced_at?: string | null;
  synced_at?: string | null;
  webhook_secret?: string;
  token_kind?: string;
}

export interface HubspotConn {
  ws: string;
  token: string;
  portalId: string;
  uiDomain: string;
  scopes: string[];
  autoLink: boolean;
  logNotes: boolean;
  /** Crear el contacto en HubSpot cuando entra un chat 1:1 nuevo de Lines. */
  autoCreate: boolean;
}

export interface HubspotDto {
  connected: boolean;
  portalId: string;
  /** Permisos que tiene el token guardado. */
  scopes: string[];
  /** Permisos que le faltan para dejar notas. */
  missingLogScopes: string[];
  autoLink: boolean;
  logNotes: boolean;
  /** Crear el contacto en HubSpot cuando entra un chat 1:1 nuevo (apagado por defecto). */
  autoCreate: boolean;
  /** Permisos que le faltan para crear contactos. */
  missingContactScopes: string[];
  lastError: string;
  lastUsedAt: string | null;
  /** Permisos que le faltan para editar propiedades de la empresa desde Lines. */
  missingSyncScopes: string[];
  /** Última importación de las propiedades y última pasada del sync. */
  schemaSyncedAt: string | null;
  syncedAt: string | null;
  /** Hay un secreto guardado para validar los webhooks de HubSpot (nunca vuelve). */
  webhook: boolean;
  /** Con qué se conectó: una service key o una private app heredada ('unknown' si no se pudo saber). */
  tokenKind: HubspotTokenKind;
  /** Estado del sync para el admin (Ajustes): lo agrega la ruta, no lo trae getHubspot. */
  sync?: HubspotSyncStatus | null;
}

type Conn = HubspotConn;

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function connRow(ws: string): Promise<ConnRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_hubspot WHERE user_id = ?').get(ws)) as ConnRow | undefined) ?? null;
}

function toConn(row: ConnRow | null): Conn | null {
  if (!row || !row.token) return null;
  let token = '';
  try {
    token = open(row.token) || '';
  } catch {
    token = '';
  }
  if (!token) return null;
  // El cupo diario de HubSpot es de la cuenta: lo comparten todas las claves que entran a ella.
  bindHubspotTokenPortal(token, row.portal_id);
  return {
    ws: row.user_id,
    token,
    portalId: row.portal_id,
    uiDomain: row.ui_domain || 'app.hubspot.com',
    scopes: parseList(row.scopes),
    autoLink: row.auto_link === 1,
    logNotes: row.log_notes === 1,
    autoCreate: row.auto_create === 1,
  };
}

async function getConn(ws: string): Promise<Conn | null> {
  return toConn(await connRow(ws));
}

/** La conexión del workspace con el token abierto. Solo para el servidor: nunca se devuelve. */
export const hubspotConn = getConn;

export async function requireHubspotConn(ws: string): Promise<HubspotConn> {
  return requireConn(ws);
}

async function requireConn(ws: string): Promise<Conn> {
  const conn = await getConn(ws);
  if (!conn) throw new HubspotError('hubspot_not_connected', 409);
  return conn;
}

function toDto(row: ConnRow | null): HubspotDto {
  const connected = Boolean(row?.token);
  const scopes = connected && row ? parseList(row.scopes) : [];
  return {
    connected,
    portalId: connected && row ? row.portal_id : '',
    scopes,
    missingLogScopes: connected ? HUBSPOT_SCOPES.log.filter((s) => !scopes.includes(s)) : [],
    autoLink: connected && row?.auto_link === 1,
    logNotes: connected && row?.log_notes === 1,
    autoCreate: connected && row?.auto_create === 1,
    missingContactScopes: connected && !scopes.includes(HUBSPOT_CONTACT_WRITE_SCOPE) ? [HUBSPOT_CONTACT_WRITE_SCOPE] : [],
    lastError: connected && row ? row.last_error : '',
    lastUsedAt: connected && row ? row.last_used_at : null,
    missingSyncScopes: connected ? HUBSPOT_SCOPES.sync.filter((s) => !scopes.includes(s)) : [],
    schemaSyncedAt: connected && row ? (row.schema_synced_at ?? null) : null,
    syncedAt: connected && row ? (row.synced_at ?? null) : null,
    webhook: connected && Boolean(row?.webhook_secret),
    tokenKind: connected && (row?.token_kind === 'service_key' || row?.token_kind === 'private_app') ? row.token_kind : 'unknown',
  };
}

/** Estado de la conexión (sin el token). */
export async function getHubspot(ws: string): Promise<HubspotDto> {
  return toDto(await connRow(ws));
}

export async function hubspotConnected(ws: string): Promise<boolean> {
  const row = (await getDb().prepare("SELECT 1 AS x FROM groups_hubspot WHERE user_id = ? AND token != ''").get(ws)) as { x: number } | undefined;
  return Boolean(row);
}

export async function markHubspotUsed(ws: string, error = ''): Promise<void> {
  return markUsed(ws, error);
}

async function markUsed(ws: string, error = ''): Promise<void> {
  await getDb().prepare('UPDATE groups_hubspot SET last_error = ?, last_used_at = ? WHERE user_id = ?').run(error, new Date().toISOString(), ws);
}

// ======================================================================
// HTTP (real o falso)
// ======================================================================

function fetcher(): FetchLike {
  return fakeMode() ? fakeHubspotFetch : (url, init) => safeFetch(url, init, 15_000);
}

/** El fetch hacia HubSpot (safeFetch, o el falso en tests y demo). */
export const hubspotFetcher = fetcher;
export const HUBSPOT_API = API;

/** Un error del cliente compartido con los códigos que muestra Lines. */
function fromApiError(err: unknown): unknown {
  if (!(err instanceof HubspotApiError)) return err;
  if (err.code === 'network') return new HubspotError('hubspot_unreachable', 502);
  if (err.code === 'rate_limited' || err.code === 'locked') return new HubspotError('hubspot_rate_limited', 429);
  if (err.code === 'auth') return new HubspotError('hubspot_invalid_token', 502);
  if (err.code === 'scope') return new HubspotError('hubspot_missing_scopes', 502);
  if (err.code === 'not_found') return new HubspotError('hubspot_not_found', 404);
  return new HubspotError('hubspot_error', 502);
}

/**
 * El cliente compartido (lib/hubspot/client.ts) con el fetch de Lines. El
 * presupuesto es el de la clave y su cuenta: lo comparte con el importador
 * del CRM si usan la misma. Una acción de pantalla no espera más de 3 s por
 * un lugar. Con el HubSpot falso no hay presupuesto.
 */
export function hubspotClient(token: string, maxWaitMs = 3_000): HubspotClient {
  return createHubspotClient({ token, fetch: fetcher(), budget: fakeMode() ? null : hubspotBudget({ token, maxWaitMs }) });
}

/** Lecturas y escrituras que se pueden repetir sin duplicar nada (una búsqueda es una lectura aunque vaya por POST). */
const isRepeatable = (method: string, path: string) => method !== 'POST' || /\/(search|batch\/read)$/.test(path.split('?')[0] ?? '');

async function request(token: string, method: string, path: string, body?: unknown, auth = true): Promise<Record<string, unknown>> {
  let res;
  // Ante el límite de HubSpot (429) se espera y se reintenta; un 5xx o un corte de red solo en lo que no duplica nada
  // (crear una nota o un contacto no se repite: si el primero llegó, saldrían dos).
  const repeatable = isRepeatable(method, path);
  try {
    res = await hubspotClient(token).send(path, { method, body, auth, retries: 2, maxWaitMs: 4_000, retry5xx: repeatable, retryNetwork: repeatable });
  } catch (err) {
    throw fromApiError(err);
  }
  if (res.status === 401) throw new HubspotError('hubspot_invalid_token', 502);
  if (res.status === 403) throw new HubspotError('hubspot_missing_scopes', 502);
  if (res.status === 404) throw new HubspotError('hubspot_not_found', 404);
  if (!res.ok) throw new HubspotError('hubspot_error', 502);
  return res.json();
}

/** Llamada con la conexión del workspace: anota el último error (o lo limpia). */
async function hs(conn: Conn, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  try {
    return await request(conn.token, method, path, body);
  } catch (err) {
    // Un 404 de un registro no es un problema de la conexión.
    if (err instanceof HubspotError && err.code !== 'hubspot_not_found') {
      // Sin permiso: se anota cuál falta, para que Ajustes lo diga.
      const scope = err.code === 'hubspot_missing_scopes' ? hubspotScopeForRequest(method, path, conn.scopes) : null;
      await markUsed(conn.ws, scope ? `${err.code}:${scope}` : err.code).catch(() => null);
    }
    throw err;
  }
}

/**
 * Valida la clave (una service key o el token de una private app heredada):
 * de qué cuenta es, de qué tipo y qué permisos tiene. La validación es la
 * compartida de lib/hubspot/token.ts; si HubSpot no informa los permisos de
 * esa clave, se prueban los que usa Lines.
 */
async function inspectToken(token: string): Promise<HubspotTokenInfo> {
  try {
    return await inspectHubspotToken(token, { client: hubspotClient(token, 10_000), probe: LINES_PROBE_SCOPES });
  } catch (err) {
    throw fromApiError(err);
  }
}

/** Conecta (o cambia el token). Valida el token y sus permisos antes de guardar. */
export async function connectHubspot(ws: string, actor: string, rawToken: string): Promise<HubspotDto> {
  const token = String(rawToken ?? '').trim();
  if (!looksLikeHubspotToken(token)) throw new HubspotError('hubspot_invalid_token');
  let info: HubspotTokenInfo;
  try {
    info = await inspectToken(token);
  } catch (err) {
    // Un token que HubSpot rechaza es un dato mal cargado, no una falla del servidor.
    if (err instanceof HubspotError && err.code === 'hubspot_invalid_token') throw new HubspotError('hubspot_invalid_token', 400);
    throw err;
  }
  const missing = HUBSPOT_SCOPES.read.filter((s) => !info.scopes.includes(s));
  if (missing.length) throw new HubspotError(`hubspot_missing_scopes:${missing.join(' ')}`);
  const db = getDb();
  const prev = await connRow(ws);
  // Otra cuenta de HubSpot: los vínculos de la anterior no sirven.
  if (prev && prev.portal_id && prev.portal_id !== info.portalId) await clearWorkspaceData(ws);
  const now = new Date().toISOString();
  const canLog = info.scopes.includes(NOTE_SCOPE);
  await db
    .prepare(
      `INSERT INTO groups_hubspot (user_id, token, portal_id, ui_domain, scopes, auto_link, log_notes, last_error, created_by, created_at, updated_at, token_kind)
       VALUES (?, ?, ?, ?, ?, 0, 0, '', ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, portal_id = excluded.portal_id, ui_domain = excluded.ui_domain,
         scopes = excluded.scopes, last_error = '', updated_at = excluded.updated_at, token_kind = excluded.token_kind,
         log_notes = CASE WHEN ? = 1 THEN groups_hubspot.log_notes ELSE 0 END`,
    )
    .run(ws, seal(token), info.portalId, info.uiDomain, JSON.stringify(info.scopes), actor, now, now, info.kind, canLog ? 1 : 0);
  caches.delete(ws);
  // Al conectar se importan las propiedades de la empresa. Si falla, lo reintenta el cron.
  const { refreshHubspotSchema } = await import('./groups-hubspot-sync');
  await refreshHubspotSchema(ws).catch(() => null);
  return getHubspot(ws);
}

/** Ajustes: vincular solo con una única coincidencia y dejar la conversación como notas. */
export async function updateHubspotSettings(ws: string, patch: { autoLink?: boolean; logNotes?: boolean; autoCreate?: boolean; webhookSecret?: string }): Promise<HubspotDto> {
  const conn = await requireConn(ws);
  if (patch.logNotes === true && !conn.scopes.includes(NOTE_SCOPE)) throw new HubspotError(`hubspot_missing_scopes:${NOTE_SCOPE}`);
  if (patch.autoCreate === true && !conn.autoCreate && !conn.scopes.includes(HUBSPOT_CONTACT_WRITE_SCOPE)) throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_CONTACT_WRITE_SCOPE}`);
  const db = getDb();
  if (typeof patch.autoCreate === 'boolean' && patch.autoCreate !== conn.autoCreate) {
    // Vale para los chats que entren desde ahora: los de antes no se suben solos.
    const now = new Date().toISOString();
    await db.prepare('UPDATE groups_hubspot SET auto_create = ?, auto_create_since = ?, updated_at = ? WHERE user_id = ?').run(patch.autoCreate ? 1 : 0, patch.autoCreate ? now : null, now, ws);
  }
  if (typeof patch.autoLink === 'boolean') await db.prepare('UPDATE groups_hubspot SET auto_link = ?, updated_at = ? WHERE user_id = ?').run(patch.autoLink ? 1 : 0, new Date().toISOString(), ws);
  if (typeof patch.logNotes === 'boolean') await db.prepare('UPDATE groups_hubspot SET log_notes = ?, updated_at = ? WHERE user_id = ?').run(patch.logNotes ? 1 : 0, new Date().toISOString(), ws);
  if (typeof patch.webhookSecret === 'string') {
    // El client secret de la private app, para validar la firma de sus webhooks. Vacío lo borra.
    const secret = patch.webhookSecret.trim();
    if (secret.length > 200 || /\s/.test(secret)) throw new HubspotError('invalid_input');
    await db.prepare('UPDATE groups_hubspot SET webhook_secret = ?, updated_at = ? WHERE user_id = ?').run(secret ? seal(secret) : '', new Date().toISOString(), ws);
  }
  return getHubspot(ws);
}

async function clearWorkspaceData(ws: string): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM groups_hubspot_links WHERE user_id = ?').run(ws);
  await clearWorkspaceGroupCompanies(ws);
  await db.prepare('DELETE FROM groups_contact_links WHERE user_id = ?').run(ws);
  await db.prepare('DELETE FROM groups_hubspot_matches WHERE user_id = ?').run(ws);
  await db.prepare('DELETE FROM groups_hubspot_notes WHERE user_id = ?').run(ws);
  for (const table of ['groups_hubspot_props', 'groups_hubspot_prop_groups', 'groups_hubspot_companies', 'groups_hubspot_values', 'groups_hubspot_sync_log', 'groups_hubspot_suggest']) {
    await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(ws);
  }
  // Las propiedades de contacto y negocio y lo que cada persona fijó son de la cuenta anterior; usan `ws`, no `user_id`.
  for (const table of ['hubspot_object_schema', 'hubspot_view_props', 'hubspot_view_object_props']) {
    await db.prepare(`DELETE FROM ${table} WHERE ws = ?`).run(ws);
  }
  await db
    .prepare(
      "UPDATE groups_hubspot SET schema_synced_at = NULL, owners = '[]', pinned = '[]', sync_cursor = '{}', synced_at = NULL, verified_at = NULL, sync_backoff_until = NULL, sync_fails = 0, webhook_secret = '' WHERE user_id = ?",
    )
    .run(ws);
}

/**
 * Desconecta: borra el token y apaga los ajustes. Los vínculos quedan
 * guardados (sin mostrarse) por si se vuelve a conectar la misma cuenta.
 */
export async function disconnectHubspot(ws: string): Promise<boolean> {
  const res = await getDb()
    .prepare("UPDATE groups_hubspot SET token = '', token_kind = '', scopes = '[]', auto_link = 0, log_notes = 0, auto_create = 0, auto_create_since = NULL, last_error = '', webhook_secret = '', updated_at = ? WHERE user_id = ? AND token != ''")
    .run(new Date().toISOString(), ws);
  caches.delete(ws);
  // El esquema del contacto y del negocio es de esa cuenta: otra cuenta lo vuelve a importar.
  await getDb().prepare('DELETE FROM hubspot_object_schema WHERE ws = ?').run(ws);
  return res.changes > 0;
}

// ======================================================================
// Estado del sync (Ajustes › Integraciones)
// ======================================================================

export interface HubspotSyncProblem {
  kind: 'note' | 'link';
  chatId: string;
  chatName: string;
  /** Código de error de la API (groups.errors.*) para una nota; 'deleted' o 'merged' para un vínculo roto. */
  code: string;
}

export interface HubspotSyncStatus {
  /** Empresas de HubSpot vinculadas a algún chat y cuántas ya no están (borradas o fusionadas). */
  linkedCompanies: number;
  brokenLinks: number;
  /** Corridas seguidas del sync de empresas que fallaron y cuándo vuelve a intentar (null: anda). */
  failures: number;
  retryAt: string | null;
  /** Notas de los últimos 7 días que no se pudieron dejar en HubSpot. */
  noteErrors: number;
  /** Los primeros casos, de líneas que ve todo el workspace (para decir cuáles son). */
  problems: HubspotSyncProblem[];
}

/** Qué pasa con el sync: lo que Ajustes muestra al admin. Los nombres de chats de líneas restringidas no salen. */
export async function getHubspotSyncStatus(ws: string, now = new Date()): Promise<HubspotSyncStatus> {
  const db = getDb();
  const one = async (sql: string, ...args: Array<string | number>) => Number(((await db.prepare(sql).get(...args)) as { n: number } | undefined)?.n ?? 0);
  const linkedCompanies = await one("SELECT COUNT(DISTINCT object_id) AS n FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'company'", ws);
  const brokenLinks = await one("SELECT COUNT(DISTINCT object_id) AS n FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'company' AND missing = 1", ws);
  const since = dayOf(new Date(now.getTime() - (MANUAL_DAYS - 1) * 86_400_000));
  const noteErrors = await one("SELECT COUNT(*) AS n FROM groups_hubspot_notes WHERE user_id = ? AND last_error != '' AND day >= ?", ws, since);
  const state = (await db.prepare('SELECT sync_fails, sync_backoff_until FROM groups_hubspot WHERE user_id = ?').get(ws)) as { sync_fails: number | null; sync_backoff_until: string | null } | undefined;
  const failures = Number(state?.sync_fails ?? 0);
  const notes = (await db
    .prepare(
      `SELECT n.chat_id, c.name, n.last_error FROM groups_hubspot_notes n JOIN groups_chats c ON c.id = n.chat_id
       JOIN groups_numbers nb ON nb.id = c.number_id AND nb.visibility = 'all'
       WHERE n.user_id = ? AND n.last_error != '' AND n.day >= ? ORDER BY n.synced_at DESC LIMIT 5`,
    )
    .all(ws, since)) as Array<{ chat_id: string; name: string; last_error: string }>;
  const links = (await db
    .prepare(
      `SELECT l.chat_id, c.name, COALESCE(co.missing_reason, 'deleted') AS reason FROM groups_hubspot_links l JOIN groups_chats c ON c.id = l.chat_id
       JOIN groups_numbers nb ON nb.id = c.number_id AND nb.visibility = 'all'
       LEFT JOIN groups_hubspot_companies co ON co.user_id = l.user_id AND co.company_id = l.object_id
       WHERE l.user_id = ? AND l.object_type = 'company' AND l.missing = 1 ORDER BY l.created_at DESC LIMIT 5`,
    )
    .all(ws)) as Array<{ chat_id: string; name: string; reason: string }>;
  return {
    linkedCompanies,
    brokenLinks,
    failures,
    retryAt: failures > 0 && state?.sync_backoff_until && state.sync_backoff_until > now.toISOString() ? state.sync_backoff_until : null,
    noteErrors,
    problems: [
      ...links.map((r): HubspotSyncProblem => ({ kind: 'link', chatId: r.chat_id, chatName: r.name, code: r.reason === 'merged' ? 'merged' : 'deleted' })),
      ...notes.map((r): HubspotSyncProblem => ({ kind: 'note', chatId: r.chat_id, chatName: r.name, code: r.last_error })),
    ],
  };
}

/**
 * Vuelve a leer qué permisos tiene la clave guardada. Los permisos se leen al
 * conectar: si después se agregan o se sacan en HubSpot, sin esto Lines sigue
 * con los de antes hasta reconectar. Una clave que HubSpot ya no acepta queda
 * anotada como error de la conexión.
 */
export async function recheckHubspotScopes(ws: string): Promise<string[]> {
  const conn = await requireConn(ws);
  let info: HubspotTokenInfo;
  try {
    info = await inspectToken(conn.token);
  } catch (err) {
    if (err instanceof HubspotError && err.code !== 'hubspot_not_found') await markUsed(ws, err.code).catch(() => null);
    throw err;
  }
  // La clave guardada entra a otra cuenta que la que se conectó: no se pisa nada, se avisa.
  const row = await connRow(ws);
  if (row?.portal_id && row.portal_id !== info.portalId) {
    await markUsed(ws, 'hubspot_invalid_token').catch(() => null);
    throw new HubspotError('hubspot_invalid_token', 502);
  }
  const canLog = info.scopes.includes(NOTE_SCOPE);
  const canCreate = info.scopes.includes(HUBSPOT_CONTACT_WRITE_SCOPE);
  await getDb()
    .prepare(
      `UPDATE groups_hubspot SET scopes = ?, token_kind = ?, updated_at = ?,
         log_notes = CASE WHEN ? = 1 THEN log_notes ELSE 0 END,
         auto_create = CASE WHEN ? = 1 THEN auto_create ELSE 0 END WHERE user_id = ?`,
    )
    .run(JSON.stringify(info.scopes), info.kind, new Date().toISOString(), canLog ? 1 : 0, canCreate ? 1 : 0, ws);
  return info.scopes;
}

// ======================================================================
// Registros
// ======================================================================

export interface HubspotRecord {
  type: HubspotType;
  id: string;
  name: string;
  /** Link al registro en HubSpot. */
  url: string;
  /** Empresa: dominio. */
  domain?: string;
  /** Nombre del dueño en HubSpot (si el token puede leer owners). */
  owner?: string;
  /** Empresa y contacto: etapa del ciclo de vida. */
  lifecycle?: string;
  /** Negocio: etapa (su nombre en el pipeline), monto, moneda y fecha de cierre (ISO). */
  stage?: string;
  amount?: number;
  currency?: string;
  closeDate?: string;
  /** Contacto: email y empresa. */
  email?: string;
  company?: string;
  companyId?: string;
  /** El registro ya no existe en HubSpot (o el token no lo ve). */
  missing?: boolean;
}

interface WsCache {
  until: number;
  owners: Map<string, string>;
  stages: Map<string, string> | null;
}
const caches: Map<string, WsCache> = ((globalThis as unknown as { __groupsHubspotCache?: Map<string, WsCache> }).__groupsHubspotCache ??= new Map());

function cacheFor(ws: string): WsCache {
  let c = caches.get(ws);
  if (!c || c.until < Date.now()) {
    c = { until: Date.now() + REFRESH_MS, owners: new Map(), stages: null };
    caches.set(ws, c);
    if (caches.size > 500) caches.delete(caches.keys().next().value as string);
  }
  return c;
}

/** Nombre del dueño. Si el token no puede leer owners, queda vacío. */
async function ownerName(conn: Conn, ownerId: string): Promise<string> {
  if (!/^\d{1,20}$/.test(ownerId)) return '';
  const cache = cacheFor(conn.ws);
  const hit = cache.owners.get(ownerId);
  if (hit !== undefined) return hit;
  let name = '';
  try {
    const o = await request(conn.token, 'GET', `/crm/v3/owners/${ownerId}`);
    name = [o.firstName, o.lastName].filter((x) => typeof x === 'string' && x).join(' ') || (typeof o.email === 'string' ? o.email : '');
  } catch {
    name = '';
  }
  cache.owners.set(ownerId, name);
  return name;
}

/** Nombre de una etapa de negocio; si no se pueden leer los pipelines, el id. */
async function stageName(conn: Conn, stageId: string): Promise<string> {
  if (!stageId) return '';
  const cache = cacheFor(conn.ws);
  if (!cache.stages) {
    cache.stages = new Map();
    try {
      const r = await request(conn.token, 'GET', '/crm/v3/pipelines/deals');
      for (const p of (Array.isArray(r.results) ? r.results : []) as Array<{ stages?: Array<{ id?: string; label?: string }> }>) {
        for (const s of p.stages ?? []) if (s.id && s.label) cache.stages.set(String(s.id), String(s.label));
      }
    } catch {
      // Sin pipelines: se muestra el id de la etapa.
    }
  }
  return cache.stages.get(stageId) ?? stageId;
}

export function hubspotRecordUrl(conn: Pick<HubspotConn, 'uiDomain' | 'portalId'>, type: HubspotType, id: string): string {
  return recordUrl(conn, type, id);
}

function recordUrl(conn: Pick<Conn, 'uiDomain' | 'portalId'>, type: HubspotType, id: string): string {
  return `https://${conn.uiDomain}/contacts/${conn.portalId}/record/${TYPE_ID[type]}/${id}`;
}

type RawObject = { id?: unknown; properties?: Record<string, unknown> };
const prop = (raw: RawObject, key: string): string => {
  const v = raw.properties?.[key];
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};

async function toRecord(conn: Conn, type: HubspotType, raw: RawObject): Promise<HubspotRecord> {
  const id = String(raw.id ?? '');
  const base: HubspotRecord = { type, id, name: '', url: recordUrl(conn, type, id) };
  const owner = await ownerName(conn, prop(raw, 'hubspot_owner_id'));
  if (owner) base.owner = owner;
  const lifecycle = prop(raw, 'lifecyclestage');
  if (type === 'company') {
    base.name = prop(raw, 'name') || prop(raw, 'domain') || id;
    if (prop(raw, 'domain')) base.domain = prop(raw, 'domain');
    if (lifecycle) base.lifecycle = LIFECYCLE[lifecycle] ?? lifecycle;
  } else if (type === 'deal') {
    base.name = prop(raw, 'dealname') || id;
    const stage = await stageName(conn, prop(raw, 'dealstage'));
    if (stage) base.stage = stage;
    const amount = Number(prop(raw, 'amount'));
    if (prop(raw, 'amount') && Number.isFinite(amount)) base.amount = amount;
    if (/^[A-Za-z]{3}$/.test(prop(raw, 'deal_currency_code'))) base.currency = prop(raw, 'deal_currency_code').toUpperCase();
    const close = Date.parse(prop(raw, 'closedate'));
    if (Number.isFinite(close)) base.closeDate = new Date(close).toISOString();
  } else {
    base.name = [prop(raw, 'firstname'), prop(raw, 'lastname')].filter(Boolean).join(' ') || prop(raw, 'email') || id;
    if (prop(raw, 'email')) base.email = prop(raw, 'email');
    if (prop(raw, 'company')) base.company = prop(raw, 'company');
    if (/^\d{1,20}$/.test(prop(raw, 'associatedcompanyid'))) base.companyId = prop(raw, 'associatedcompanyid');
    if (lifecycle) base.lifecycle = LIFECYCLE[lifecycle] ?? lifecycle;
  }
  return base;
}

async function fetchRecord(conn: Conn, type: HubspotType, id: string): Promise<HubspotRecord> {
  if (!/^\d{1,20}$/.test(id)) throw new HubspotError('invalid_input');
  const raw = await hs(conn, 'GET', `/crm/v3/objects/${PLURAL[type]}/${id}?properties=${PROPS[type].join(',')}`);
  return toRecord(conn, type, raw as RawObject);
}

/** Busca empresas, negocios o contactos por nombre (búsqueda de HubSpot CRM v3). */
export async function searchHubspot(ws: string, type: HubspotType, q: string): Promise<HubspotRecord[]> {
  const conn = await requireConn(ws);
  const query = String(q ?? '').trim().slice(0, 100);
  if (query.length < 2) return [];
  const r = await hs(conn, 'POST', `/crm/v3/objects/${PLURAL[type]}/search`, { query, limit: 8, properties: PROPS[type] });
  await markUsed(ws).catch(() => null);
  const out: HubspotRecord[] = [];
  for (const raw of (Array.isArray(r.results) ? r.results : []) as RawObject[]) out.push(await toRecord(conn, type, raw));
  return out;
}

/**
 * Para quien tiene los teléfonos ocultos (lib/groups-access.ts): tampoco ve
 * el email del contacto. El teléfono nunca sale de este módulo.
 */
export function redactHubspot<T extends HubspotRecord | null>(mask: boolean, rec: T): T {
  if (!mask || !rec || rec.type !== 'contact' || !rec.email) return rec;
  const { email, ...rest } = rec;
  return { ...rest, name: rec.name === email ? `#${rec.id}` : rec.name } as T;
}

// ======================================================================
// Vínculos
// ======================================================================

interface LinkRow {
  chat_id: string;
  user_id: string;
  object_type: HubspotType;
  object_id: string;
  name: string;
  props: string;
  fetched_at: string | null;
  missing: number;
}

function parseProps(raw: string): Partial<HubspotRecord> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<HubspotRecord>) : {};
  } catch {
    return {};
  }
}

function rowToRecord(conn: Pick<Conn, 'uiDomain' | 'portalId'>, r: LinkRow): HubspotRecord {
  return {
    ...parseProps(r.props),
    type: r.object_type,
    id: r.object_id,
    name: r.name || r.object_id,
    url: recordUrl(conn, r.object_type, r.object_id),
    ...(r.missing ? { missing: true } : {}),
  };
}

async function linkRows(ws: string, chatId: string): Promise<LinkRow[]> {
  const rows = (await getDb().prepare('SELECT * FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ?').all(chatId, ws)) as LinkRow[];
  const order: HubspotType[] = ['company', 'deal', 'contact'];
  return rows.sort((a, b) => order.indexOf(a.object_type) - order.indexOf(b.object_type));
}

/** Lo que se guarda de un registro además del id y el nombre (el link se arma al leer). */
function storedProps(rec: HubspotRecord): string {
  const props: Partial<HubspotRecord> = { ...rec };
  for (const k of ['type', 'id', 'name', 'url', 'missing'] as const) delete props[k];
  return JSON.stringify(props);
}

async function saveLink(ws: string, chatId: string, rec: HubspotRecord, linkedBy: string | null): Promise<void> {
  const { type, id, name } = rec;
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, fetched_at, missing, linked_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(chat_id, object_type) DO UPDATE SET object_id = excluded.object_id, name = excluded.name, props = excluded.props,
         fetched_at = excluded.fetched_at, missing = 0, linked_by = excluded.linked_by`,
    )
    .run(chatId, ws, type, id, name.slice(0, 300), storedProps(rec), now, linkedBy, now);
}

async function chatOf(ws: string, chatId: string): Promise<{ id: string; kind: 'dm' | 'group'; phone: string; name: string; number_id: string } | null> {
  return (
    ((await getDb().prepare('SELECT id, kind, phone, name, number_id FROM groups_chats WHERE id = ? AND user_id = ?').get(chatId, ws)) as
      | { id: string; kind: 'dm' | 'group'; phone: string; name: string; number_id: string }
      | undefined) ?? null
  );
}

/**
 * Vincula el chat a un registro de HubSpot (reemplaza el del mismo tipo).
 * El registro se lee de HubSpot antes de guardar: un id de otra cuenta no
 * entra. Con `withCompany`, un contacto trae también su empresa principal
 * si el chat no tiene una. El que llama ya chequeó el acceso al chat.
 */
export async function linkHubspot(
  ws: string,
  actor: string | null,
  chatId: string,
  type: HubspotType,
  objectId: string,
  opts: { withCompany?: boolean } = {},
): Promise<HubspotRecord[]> {
  const conn = await requireConn(ws);
  if (!(HUBSPOT_TYPES as readonly string[]).includes(type) || !/^\d{1,20}$/.test(String(objectId))) throw new HubspotError('invalid_input');
  if (!(await chatOf(ws, chatId))) throw new HubspotError('not_found', 404);
  const rec = await fetchRecord(conn, type, String(objectId));
  await saveLink(ws, chatId, rec, actor);
  // Una empresa trae todas sus propiedades (si falla, las importa el cron).
  const importCompany = async (id: string) => {
    const { importHubspotCompanies } = await import('./groups-hubspot-sync');
    await importHubspotCompanies(ws, [id], 'link').catch(() => null);
  };
  let companyChanged = type === 'company';
  if (type === 'company') await importCompany(rec.id);
  if (type === 'contact' && opts.withCompany && rec.companyId) {
    const has = (await linkRows(ws, chatId)).some((l) => l.object_type === 'company');
    if (!has) {
      try {
        await saveLink(ws, chatId, await fetchRecord(conn, 'company', rec.companyId), actor);
        companyChanged = true;
        await importCompany(rec.companyId);
      } catch (err) {
        // La empresa principal no se pudo leer: queda solo el contacto.
        if (!(err instanceof HubspotError)) throw err;
      }
    }
  }
  // Un grupo tiene una sola empresa aunque esté en varias líneas: pasa a todas (lib/groups-identity.ts).
  if (companyChanged) await propagateGroupCompany(ws, chatId, actor);
  await markUsed(ws).catch(() => null);
  return (await linkRows(ws, chatId)).map((r) => rowToRecord(conn, r));
}

export async function unlinkHubspot(ws: string, chatId: string, type: HubspotType): Promise<boolean> {
  if (!(HUBSPOT_TYPES as readonly string[]).includes(type)) throw new HubspotError('invalid_input');
  const db = getDb();
  // La empresa de un grupo es la de todas sus líneas: se quita de todas.
  const hadCompany =
    type === 'company' && Boolean(await db.prepare("SELECT 1 AS x FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ? AND object_type = 'company'").get(chatId, ws));
  if (hadCompany) await clearGroupCompany(ws, chatId);
  const res = await db.prepare('DELETE FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ? AND object_type = ?').run(chatId, ws, type);
  if (hadCompany) return true;
  // Quitar el contacto a mano es decir "este no es": no se vuelve a proponer ni a vincular solo.
  if (res.changes > 0 && type === 'contact') await dismissHubspotSuggestion(ws, chatId);
  return res.changes > 0;
}

/** Vínculos del chat. Con `refresh`, trae de HubSpot los que tienen más de 10 minutos. */
async function listLinks(conn: Conn, chatId: string, refresh: boolean): Promise<HubspotRecord[]> {
  const db = getDb();
  const rows = await linkRows(conn.ws, chatId);
  if (refresh) {
    const stale = Date.now() - REFRESH_MS;
    for (const r of rows) {
      if (r.fetched_at && Date.parse(r.fetched_at) > stale) continue;
      try {
        const rec = await fetchRecord(conn, r.object_type, r.object_id);
        const props = storedProps(rec);
        const now = new Date().toISOString();
        await db
          .prepare('UPDATE groups_hubspot_links SET name = ?, props = ?, fetched_at = ?, missing = 0 WHERE chat_id = ? AND object_type = ? AND object_id = ?')
          .run(rec.name.slice(0, 300), props, now, chatId, r.object_type, r.object_id);
        Object.assign(r, { name: rec.name, props, fetched_at: now, missing: 0 });
      } catch (err) {
        if (!(err instanceof HubspotError)) throw err;
        if (err.code === 'hubspot_not_found') {
          await db
            .prepare('UPDATE groups_hubspot_links SET missing = 1, fetched_at = ? WHERE chat_id = ? AND object_type = ? AND object_id = ?')
            .run(new Date().toISOString(), chatId, r.object_type, r.object_id);
          r.missing = 1;
        }
        // Otro error (sin red, límite): se muestra la copia guardada.
      }
    }
  }
  return rows.map((r) => rowToRecord(conn, r));
}

// ======================================================================
// Coincidencia por teléfono
// ======================================================================

export interface HubspotSuggestion {
  contact: HubspotRecord;
  company: HubspotRecord | null;
}

const digitsOf = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** ¿El mismo teléfono? Compara dígitos: iguales, uno termina en el otro, o los últimos 10 iguales. */
export function samePhone(a: string, b: string): boolean {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x === y || x.endsWith(y) || y.endsWith(x)) return true;
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

/** Contactos de HubSpot con este teléfono (máximo 3), cada uno con su empresa principal. */
async function findPhoneMatches(conn: Conn, phone: string): Promise<HubspotSuggestion[]> {
  const d = digitsOf(phone);
  if (d.length < 8) return [];
  const tail = `*${d.slice(-8)}`;
  // HubSpot guarda el teléfono como lo escribieron; las propiedades hs_searchable_calculated_* lo tienen solo con dígitos.
  const filterGroups = ['phone', 'mobilephone', 'hs_whatsapp_phone_number', 'hs_searchable_calculated_phone_number', 'hs_searchable_calculated_mobile_number'].map((propertyName) => ({
    filters: [{ propertyName, operator: 'CONTAINS_TOKEN', value: tail }],
  }));
  const r = await hs(conn, 'POST', '/crm/v3/objects/contacts/search', { filterGroups, limit: 10, properties: PROPS.contact });
  const hits = ((Array.isArray(r.results) ? r.results : []) as RawObject[]).filter((raw) =>
    ['phone', 'mobilephone', 'hs_whatsapp_phone_number'].some((k) => samePhone(prop(raw, k), d)),
  );
  const out: HubspotSuggestion[] = [];
  for (const raw of hits.slice(0, 3)) {
    const contact = await toRecord(conn, 'contact', raw);
    let company: HubspotRecord | null = null;
    if (contact.companyId) {
      try {
        company = await fetchRecord(conn, 'company', contact.companyId);
      } catch (err) {
        if (!(err instanceof HubspotError)) throw err;
      }
    }
    out.push({ contact, company });
  }
  return out;
}

/**
 * Contactos de Lines (lib/groups-contacts.ts): los de HubSpot con este
 * teléfono, cada uno con su empresa. Se busca siempre antes de crear uno.
 */
export async function hubspotContactsByPhone(ws: string, phone: string): Promise<HubspotSuggestion[]> {
  const conn = await requireConn(ws);
  const out = await findPhoneMatches(conn, phone);
  await markUsed(ws).catch(() => null);
  return out;
}

/** Un registro leído de HubSpot (un id de otra cuenta no existe: 404). */
export async function readHubspotRecord(ws: string, type: HubspotType, id: string): Promise<HubspotRecord> {
  return fetchRecord(await requireConn(ws), type, id);
}

/**
 * Crea un contacto en HubSpot con el nombre y el teléfono de WhatsApp. Antes
 * busca por teléfono: si ya hay uno, no crea nada y devuelve los que hay
 * (`existing`) para vincular ese. Con `companyId` (la empresa de los grupos
 * donde está), lo asocia a esa empresa: nunca crea una empresa.
 */
export async function createHubspotContact(
  ws: string,
  input: { name: string; phone: string; companyId?: string },
): Promise<{ created: HubspotRecord | null; existing: HubspotSuggestion[] }> {
  const conn = await requireConn(ws);
  if (!conn.scopes.includes('crm.objects.contacts.write')) throw new HubspotError('hubspot_missing_scopes:crm.objects.contacts.write');
  const phone = digitsOf(input.phone);
  if (phone.length < 8 || phone.length > 15) throw new HubspotError('invalid_phone');
  const existing = await findPhoneMatches(conn, phone);
  if (existing.length) return { created: null, existing };
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const [first, ...rest] = name ? name.split(' ') : [''];
  const companyId = input.companyId && /^\d{1,20}$/.test(input.companyId) ? input.companyId : '';
  const raw = await hs(conn, 'POST', '/crm/v3/objects/contacts', {
    properties: { ...(first ? { firstname: first } : {}), ...(rest.length ? { lastname: rest.join(' ') } : {}), phone: `+${phone}`, hs_whatsapp_phone_number: `+${phone}` },
    // 279: contacto → empresa (la asociación por defecto de HubSpot).
    ...(companyId ? { associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 }] }] } : {}),
  });
  await markUsed(ws).catch(() => null);
  const id = String((raw as RawObject).id ?? '');
  if (!/^\d{1,20}$/.test(id)) throw new HubspotError('hubspot_error', 502);
  return { created: await fetchRecord(conn, 'contact', id), existing: [] };
}

interface MatchRow {
  chat_id: string;
  phone: string;
  matches: string;
  dismissed: number;
  checked_at: string;
}

function parseMatches(raw: string): HubspotSuggestion[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as HubspotSuggestion[]).filter((s) => s && typeof s === 'object' && s.contact && typeof s.contact.id === 'string') : [];
  } catch {
    return [];
  }
}

async function storeMatches(ws: string, chatId: string, phone: string, matches: HubspotSuggestion[]): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO groups_hubspot_matches (chat_id, user_id, phone, matches, dismissed, checked_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(chat_id) DO UPDATE SET phone = excluded.phone, matches = excluded.matches, checked_at = excluded.checked_at,
         dismissed = CASE WHEN groups_hubspot_matches.phone = excluded.phone THEN groups_hubspot_matches.dismissed ELSE 0 END`,
    )
    .run(chatId, ws, phone, JSON.stringify(matches), new Date().toISOString());
}

/** "No es este": no se vuelve a proponer para este chat (mientras no cambie el teléfono). */
export async function dismissHubspotSuggestion(ws: string, chatId: string): Promise<void> {
  const chat = await chatOf(ws, chatId);
  if (!chat) return;
  await getDb()
    .prepare(
      `INSERT INTO groups_hubspot_matches (chat_id, user_id, phone, matches, dismissed, checked_at) VALUES (?, ?, ?, '[]', 1, ?)
       ON CONFLICT(chat_id) DO UPDATE SET dismissed = 1, phone = excluded.phone`,
    )
    .run(chatId, ws, digitsOf(chat.phone), new Date().toISOString());
}

/**
 * Contactos de HubSpot que coinciden con el teléfono de un chat 1 a 1 sin
 * contacto vinculado. Se guarda una hora para no buscar en cada apertura.
 */
async function suggestionsFor(conn: Conn, chat: { id: string; kind: string; phone: string }, linked: HubspotRecord[], force = false): Promise<HubspotSuggestion[]> {
  if (chat.kind !== 'dm' || linked.some((l) => l.type === 'contact')) return [];
  const phone = digitsOf(chat.phone);
  if (phone.length < 8) return [];
  const row = (await getDb().prepare('SELECT * FROM groups_hubspot_matches WHERE chat_id = ?').get(chat.id)) as MatchRow | undefined;
  if (row && row.phone === phone) {
    if (row.dismissed) return [];
    if (!force && Date.parse(row.checked_at) > Date.now() - MATCH_TTL_MS) return parseMatches(row.matches).map((s) => withUrls(conn, s));
  }
  const matches = await findPhoneMatches(conn, phone);
  await storeMatches(conn.ws, chat.id, phone, matches);
  return matches;
}

function withUrls(conn: Conn, s: HubspotSuggestion): HubspotSuggestion {
  return {
    contact: { ...s.contact, url: recordUrl(conn, 'contact', s.contact.id) },
    company: s.company ? { ...s.company, url: recordUrl(conn, 'company', s.company.id) } : null,
  };
}

/** Con el ajuste prendido y una única coincidencia, vincula el contacto y su empresa. */
async function autoLink(conn: Conn, chatId: string, suggestions: HubspotSuggestion[]): Promise<boolean> {
  if (!conn.autoLink || suggestions.length !== 1) return false;
  const s = suggestions[0];
  const existing = await linkRows(conn.ws, chatId);
  if (existing.some((l) => l.object_type === 'contact')) return false;
  await saveLink(conn.ws, chatId, s.contact, null);
  if (s.company && !existing.some((l) => l.object_type === 'company')) await saveLink(conn.ws, chatId, s.company, null);
  return true;
}

export interface ChatHubspotDto {
  connected: boolean;
  links: HubspotRecord[];
  suggestions: HubspotSuggestion[];
  /** El token puede escribir notas (acción "Registrar la conversación"). */
  canLog: boolean;
  /** El registro automático está prendido. */
  logNotes: boolean;
  /** Chat 1 a 1 (se puede crear su contacto en HubSpot). */
  dm?: boolean;
  /** El token puede crear contactos. */
  canCreateContact?: boolean;
  /** Última vez que se dejó una nota de este chat. */
  lastLoggedAt: string | null;
  /** La empresa vinculada con sus propiedades fijadas (lib/groups-hubspot-sync.ts). */
  company?: import('./groups-hubspot-sync').ChatCompanySummary | null;
  /** El contacto y el negocio vinculados con las propiedades elegidas (lib/hubspot-objects.ts); null si no se pudieron leer. */
  objects?: {
    contact?: { id: string; pinned: import('./groups-hubspot-sync').PinnedValue[] } | null;
    deal?: { id: string; pinned: import('./groups-hubspot-sync').PinnedValue[]; currency?: string } | null;
  };
}

/**
 * Lo que muestra el panel del chat. El que llama ya chequeó el acceso al chat.
 * `viewer`: las propiedades de la empresa son las que eligió esa persona.
 */
export async function chatHubspot(ws: string, chatId: string, viewer?: string, mask = false): Promise<ChatHubspotDto> {
  const conn = await getConn(ws);
  if (!conn) return { connected: false, links: [], suggestions: [], canLog: false, logNotes: false, lastLoggedAt: null };
  const chat = await chatOf(ws, chatId);
  if (!chat) throw new HubspotError('not_found', 404);
  let links = await listLinks(conn, chatId, true);
  let suggestions: HubspotSuggestion[] = [];
  try {
    suggestions = await suggestionsFor(conn, chat, links);
    if (await autoLink(conn, chatId, suggestions)) {
      links = await listLinks(conn, chatId, false);
      suggestions = [];
    }
  } catch (err) {
    // Sin sugerencia (sin red, límite): el panel muestra igual los vínculos.
    if (!(err instanceof HubspotError)) throw err;
  }
  const last = (await getDb().prepare("SELECT MAX(synced_at) AS at FROM groups_hubspot_notes WHERE chat_id = ? AND note_id != ''").get(chatId)) as { at: string | null } | undefined;
  const { chatCompanySummary } = await import('./groups-hubspot-sync');
  const company = await chatCompanySummary(ws, chatId, viewer).catch(() => null);
  const { hubspotObjectSummary } = await import('./hubspot-objects');
  const objects: NonNullable<ChatHubspotDto['objects']> = {};
  for (const l of links) {
    if ((l.type === 'contact' || l.type === 'deal') && !l.missing) objects[l.type] = await hubspotObjectSummary(ws, l.type, l.id, viewer, mask).catch(() => null);
  }
  return {
    connected: true,
    links,
    suggestions,
    canLog: conn.scopes.includes(NOTE_SCOPE),
    logNotes: conn.logNotes,
    lastLoggedAt: last?.at ?? null,
    company,
    objects,
    dm: chat.kind === 'dm',
    canCreateContact: conn.scopes.includes(HUBSPOT_CONTACT_WRITE_SCOPE),
  };
}

/**
 * Cron: con "vincular con una única coincidencia" prendido, busca el contacto
 * de los chats 1 a 1 que todavía no se miraron. Reclama cada chat con su fila
 * en groups_hubspot_matches.
 */
export async function sweepHubspotAutoLink(limit = 10): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT c.id, c.user_id, c.kind, c.phone FROM groups_hubspot h CROSS JOIN groups_chats c ON c.user_id = h.user_id
       WHERE h.token != '' AND h.auto_link = 1 AND c.kind = 'dm' AND c.phone != '' AND c.hidden_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM groups_hubspot_links l WHERE l.chat_id = c.id AND l.object_type = 'contact')
         AND NOT EXISTS (SELECT 1 FROM groups_hubspot_matches m WHERE m.chat_id = c.id)
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?`,
    )
    .all(limit)) as Array<{ id: string; user_id: string; kind: string; phone: string }>;
  let linked = 0;
  const conns = new Map<string, Conn | null>();
  for (const chat of rows) {
    const phone = digitsOf(chat.phone);
    // Claim: la fila de coincidencias la inserta uno solo.
    const claim = await db
      .prepare("INSERT OR IGNORE INTO groups_hubspot_matches (chat_id, user_id, phone, matches, dismissed, checked_at) VALUES (?, ?, ?, '[]', 0, ?)")
      .run(chat.id, chat.user_id, phone, new Date().toISOString());
    if (claim.changes === 0) continue;
    if (!conns.has(chat.user_id)) conns.set(chat.user_id, await getConn(chat.user_id));
    const conn = conns.get(chat.user_id);
    if (!conn) continue;
    try {
      const matches = await findPhoneMatches(conn, phone);
      await storeMatches(conn.ws, chat.id, phone, matches);
      if (await autoLink(conn, chat.id, matches)) linked++;
    } catch (err) {
      if (!(err instanceof HubspotError)) throw err;
      // Se reintenta en otra corrida: se suelta el claim.
      await db.prepare("DELETE FROM groups_hubspot_matches WHERE chat_id = ? AND matches = '[]' AND dismissed = 0").run(chat.id);
      if (err.code === 'hubspot_rate_limited' || err.code === 'hubspot_invalid_token') break;
    }
  }
  return linked;
}

// ======================================================================
// Registro de la conversación como notas
// ======================================================================

type DigestLocale = 'en' | 'es' | 'pt';
const DIGEST: Record<DigestLocale, { title: string; count: (n: number) => string; more: (n: number) => string; open: string; team: string; media: Record<string, string> }> = {
  en: {
    title: 'WhatsApp conversation',
    count: (n) => (n === 1 ? '1 message' : `${n} messages`),
    more: (n) => `${n} more in the chat`,
    open: 'Open the chat in Lines',
    team: 'Team',
    media: { image: 'Image', audio: 'Audio', video: 'Video', file: 'File' },
  },
  es: {
    title: 'Conversación de WhatsApp',
    count: (n) => (n === 1 ? '1 mensaje' : `${n} mensajes`),
    more: (n) => `${n} más en el chat`,
    open: 'Abrir el chat en Lines',
    team: 'Equipo',
    media: { image: 'Imagen', audio: 'Audio', video: 'Video', file: 'Archivo' },
  },
  pt: {
    title: 'Conversa de WhatsApp',
    count: (n) => (n === 1 ? '1 mensagem' : `${n} mensagens`),
    more: (n) => `mais ${n} na conversa`,
    open: 'Abrir a conversa no Lines',
    team: 'Equipe',
    media: { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', file: 'Arquivo' },
  },
};

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface DigestMessage {
  direction: string;
  sender_phone: string;
  sender_name: string;
  author_id: string | null;
  body: string;
  media_type: string;
  media_name: string;
  created_at: string;
}

/** Hora UTC "HH:MM" de un created_at (ISO o "YYYY-MM-DD HH:MM:SS"). */
const hhmm = (createdAt: string) => createdAt.slice(11, 16);

/** HTML de la nota del día (hs_note_body). */
export function digestHtml(input: {
  chatName: string;
  day: string;
  messages: DigestMessage[];
  total: number;
  people: Map<string, string>;
  locale: DigestLocale;
  chatUrl: string;
}): string {
  const L = DIGEST[input.locale] ?? DIGEST.en;
  const head = `<p><strong>${esc(L.title)}: ${esc(input.chatName)}</strong><br>${esc(input.day)} (UTC) · ${esc(L.count(input.total))}</p>`;
  const foot = `<p><a href="${esc(input.chatUrl)}">${esc(L.open)}</a></p>`;
  const lines: string[] = [];
  let size = head.length + foot.length + 200;
  for (const m of input.messages) {
    const who = m.direction === 'out' ? (m.author_id && input.people.get(m.author_id)) || m.sender_name || L.team : m.sender_name || (m.sender_phone ? `+${m.sender_phone}` : input.chatName);
    const media = m.media_type ? `[${m.media_name || L.media[mediaKind(m.media_type)]}]` : '';
    const text = [media, m.body.trim()].filter(Boolean).join(' ').slice(0, 2000);
    const line = `${hhmm(m.created_at)} <strong>${esc(who)}</strong>: ${esc(text).replace(/\n/g, '<br>')}`;
    if (size + line.length > NOTE_MAX_CHARS) break;
    size += line.length + 4;
    lines.push(line);
  }
  const left = input.total - lines.length;
  return `${head}<p>${lines.join('<br>')}</p>${left > 0 ? `<p>${esc(L.more(left))}</p>` : ''}${foot}`;
}

interface NoteRow {
  chat_id: string;
  day: string;
  note_id: string;
  targets: string;
  message_count: number;
  last_message_at: string;
  synced_at: string | null;
  locked_until: string | null;
}

/** Lo que queda anotado de una nota que falló: el código, y si faltaba un permiso, cuál. */
function noteErrorCode(conn: Conn, err: unknown): string {
  if (!(err instanceof HubspotError)) return 'error';
  if (err.code !== 'hubspot_missing_scopes') return err.code;
  const scope = hubspotScopeForRequest('POST', '/crm/v3/objects/notes', conn.scopes);
  return scope ? `${err.code}:${scope}` : err.code;
}

const targetKey = (l: { object_type: HubspotType; object_id: string }) => `${l.object_type}:${l.object_id}`;

const MESSAGE_FILTER = "m.direction IN ('in', 'out') AND m.deleted_at IS NULL";

/**
 * Crea o actualiza la nota de un chat en un día. Idempotente: una fila por
 * (chat, día) guarda el id de la nota; si nada cambió no llama a HubSpot, y
 * dos corridas a la vez no crean dos notas (claim con locked_until).
 * Devuelve true si escribió en HubSpot.
 */
async function syncNote(conn: Conn, chatId: string, day: string, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const db = getDb();
  const chat = await chatOf(conn.ws, chatId);
  if (!chat) return false;
  const links = (await linkRows(conn.ws, chatId)).filter((l) => !l.missing);
  if (links.length === 0) return false;
  const stats = (await db
    .prepare(`SELECT COUNT(*) AS n, MAX(m.created_at) AS last FROM groups_messages m WHERE m.chat_id = ? AND m.user_id = ? AND substr(m.created_at, 1, 10) = ? AND ${MESSAGE_FILTER}`)
    .get(chatId, conn.ws, day)) as { n: number; last: string | null };
  const total = Number(stats.n);
  if (total === 0 || !stats.last) return false;
  const wanted = links.map(targetKey);
  let row = (await db.prepare('SELECT * FROM groups_hubspot_notes WHERE chat_id = ? AND day = ?').get(chatId, day)) as NoteRow | undefined;
  if (row) {
    const have = parseList(row.targets);
    if (row.note_id && row.message_count === total && row.last_message_at === stats.last && wanted.every((k) => have.includes(k))) return false;
    // Ni una nota ni un error se reintentan más de una vez cada 10 minutos (salvo a mano).
    if (!opts.force && row.synced_at && Date.parse(row.synced_at) > Date.now() - NOTE_MIN_GAP_MS) return false;
  }
  // Claim.
  const nowIso = new Date().toISOString();
  const lock = new Date(Date.now() + 120_000).toISOString();
  if (!row) {
    const ins = await db
      .prepare("INSERT OR IGNORE INTO groups_hubspot_notes (chat_id, user_id, day, note_id, locked_until) VALUES (?, ?, ?, '', ?)")
      .run(chatId, conn.ws, day, lock);
    if (ins.changes === 0) return false;
    row = { chat_id: chatId, day, note_id: '', targets: '[]', message_count: 0, last_message_at: '', synced_at: null, locked_until: lock };
  } else {
    const upd = await db
      .prepare('UPDATE groups_hubspot_notes SET locked_until = ? WHERE chat_id = ? AND day = ? AND (locked_until IS NULL OR locked_until < ?)')
      .run(lock, chatId, day, nowIso);
    if (upd.changes === 0) return false;
  }
  try {
    const messages = (await db
      .prepare(
        `SELECT m.direction, m.sender_phone, m.sender_name, m.author_id, m.body, m.media_type, m.media_name, m.created_at, m.meta, m.number_id FROM groups_messages m
         WHERE m.chat_id = ? AND m.user_id = ? AND substr(m.created_at, 1, 10) = ? AND ${MESSAGE_FILTER} ORDER BY m.created_at, m.rowid LIMIT ?`,
      )
      .all(chatId, conn.ws, day, NOTE_MAX_MESSAGES)) as Array<DigestMessage & { meta?: string | null; number_id?: string | null }>;
    // "@<dígitos>" → "@Nombre" también en la nota (sale del producto: un lid del que solo se sabe el teléfono va como "alguien").
    const { linesRowTexts } = await import('./groups-wa-names');
    const named = await linesRowTexts(conn.ws, messages, { shared: true });
    messages.forEach((m, i) => (m.body = named[i]));
    const { getSettings, groupsBaseUrl, listPeople } = await import('./groups');
    const people = new Map((await listPeople(conn.ws)).map((p) => [p.id, p.name || p.email]));
    const locale = (await getSettings(conn.ws)).locale;
    const body = digestHtml({
      chatName: chat.name || (chat.phone ? `+${chat.phone}` : 'WhatsApp'),
      day,
      messages,
      total,
      people,
      locale,
      chatUrl: `${groupsBaseUrl()}/app/lines/inbox/${chatId}`,
    });
    const last = Date.parse(stats.last.includes('T') ? stats.last : `${stats.last.replace(' ', 'T')}Z`);
    const properties = { hs_note_body: body, hs_timestamp: new Date(Number.isFinite(last) ? last : Date.now()).toISOString() };
    let noteId = row.note_id;
    let have = parseList(row.targets);
    if (noteId) {
      try {
        await hs(conn, 'PATCH', `/crm/v3/objects/notes/${noteId}`, { properties });
      } catch (err) {
        // La borraron en HubSpot: se crea de nuevo.
        if (!(err instanceof HubspotError) || err.code !== 'hubspot_not_found') throw err;
        noteId = '';
        have = [];
      }
    }
    if (!noteId) {
      const created = await hs(conn, 'POST', '/crm/v3/objects/notes', {
        properties,
        associations: links.map((l) => ({ to: { id: l.object_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_ASSOC[l.object_type] }] })),
      });
      noteId = String(created.id ?? '');
      if (!/^\d{1,20}$/.test(noteId)) throw new HubspotError('hubspot_error', 502);
      have = [...wanted];
      // El id se guarda apenas existe: si algo falla después, no se crea otra.
      await db.prepare('UPDATE groups_hubspot_notes SET note_id = ?, targets = ? WHERE chat_id = ? AND day = ?').run(noteId, JSON.stringify(have), chatId, day);
    } else {
      // Registros vinculados después de crear la nota: se asocian.
      for (const l of links) {
        if (have.includes(targetKey(l))) continue;
        await hs(conn, 'PUT', `/crm/v4/objects/notes/${noteId}/associations/default/${PLURAL[l.object_type]}/${l.object_id}`);
        have.push(targetKey(l));
      }
    }
    await db
      .prepare("UPDATE groups_hubspot_notes SET note_id = ?, targets = ?, message_count = ?, last_message_at = ?, synced_at = ?, last_error = '' WHERE chat_id = ? AND day = ?")
      .run(noteId, JSON.stringify(have), total, stats.last, new Date().toISOString(), chatId, day);
    await markUsed(conn.ws).catch(() => null);
    return true;
  } catch (err) {
    await db
      .prepare('UPDATE groups_hubspot_notes SET last_error = ?, synced_at = ? WHERE chat_id = ? AND day = ?')
      .run(noteErrorCode(conn, err), new Date().toISOString(), chatId, day);
    throw err;
  } finally {
    await db.prepare('UPDATE groups_hubspot_notes SET locked_until = NULL WHERE chat_id = ? AND day = ? AND locked_until = ?').run(chatId, day, lock);
  }
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Acción manual: deja en HubSpot la conversación de los últimos 7 días (una
 * nota por día con mensajes). El que llama ya chequeó el acceso al chat.
 */
export async function logChatToHubspot(ws: string, chatId: string, now = new Date()): Promise<{ notes: number; days: number }> {
  const conn = await requireConn(ws);
  if (!conn.scopes.includes(NOTE_SCOPE)) throw new HubspotError(`hubspot_missing_scopes:${NOTE_SCOPE}`);
  if (!(await chatOf(ws, chatId))) throw new HubspotError('not_found', 404);
  if (!(await linkRows(ws, chatId)).some((l) => !l.missing)) throw new HubspotError('hubspot_not_linked');
  const since = dayOf(new Date(now.getTime() - (MANUAL_DAYS - 1) * 86_400_000));
  const days = (await getDb()
    .prepare(`SELECT DISTINCT substr(m.created_at, 1, 10) AS day FROM groups_messages m WHERE m.chat_id = ? AND m.user_id = ? AND m.created_at >= ? AND ${MESSAGE_FILTER} ORDER BY day`)
    .all(chatId, ws, since)) as Array<{ day: string }>;
  if (days.length === 0) throw new HubspotError('hubspot_no_messages');
  let notes = 0;
  try {
    for (const d of days) if (await syncNote(conn, chatId, d.day, { force: true })) notes++;
  } catch (err) {
    // Sin permiso para escribir: se dice cuál falta.
    const code = noteErrorCode(conn, err);
    if (err instanceof HubspotError && code !== err.code) throw new HubspotError(code, err.status);
    throw err;
  }
  return { notes, days: days.length };
}

/**
 * Cron: con el registro prendido, actualiza la nota de hoy (y cierra la de
 * ayer) de los chats vinculados que tuvieron mensajes. Solo líneas visibles
 * para todo el workspace. Cada nota se reclama en syncNote.
 */
export async function syncHubspotNotes(opts: { limit?: number; budgetMs?: number; now?: Date; scan?: number; workspaceId?: string } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const started = Date.now();
  const since = dayOf(new Date(now.getTime() - 86_400_000));
  const staleIso = new Date(Date.now() - NOTE_MIN_GAP_MS).toISOString();
  // Ya quedan afuera, en la consulta y no después del LIMIT, las que están al día y las que se tocaron hace menos de 10
  // minutos: si no, con cientos de chats vinculados las primeras (ya sincronizadas) ocupan todo el cupo y las nuevas no entran nunca.
  const rows = (await db
    .prepare(
      `SELECT g.user_id, g.chat_id, g.day FROM (
         SELECT m.user_id, m.chat_id, substr(m.created_at, 1, 10) AS day, COUNT(*) AS n, MAX(m.created_at) AS last
         FROM groups_hubspot h
         CROSS JOIN groups_messages m ON m.user_id = h.user_id
         JOIN groups_chats c ON c.id = m.chat_id
         JOIN groups_numbers nb ON nb.id = c.number_id AND nb.visibility = 'all'
         WHERE h.token != '' AND h.log_notes = 1 AND m.created_at >= ? AND ${MESSAGE_FILTER} AND (? = '' OR h.user_id = ?)
           AND EXISTS (SELECT 1 FROM groups_hubspot_links l WHERE l.chat_id = m.chat_id AND l.missing = 0)
         GROUP BY m.user_id, m.chat_id, substr(m.created_at, 1, 10)
       ) g
       WHERE NOT EXISTS (
         SELECT 1 FROM groups_hubspot_notes x WHERE x.chat_id = g.chat_id AND x.day = g.day
           AND ((x.synced_at IS NOT NULL AND x.synced_at > ?) OR (x.note_id != '' AND x.message_count = g.n AND x.last_message_at = g.last))
       )
       ORDER BY g.last LIMIT ?`,
    )
    .all(since, opts.workspaceId ?? '', opts.workspaceId ?? '', staleIso, opts.scan ?? 500)) as Array<{ user_id: string; chat_id: string; day: string }>;
  rows.splice(opts.limit ?? 20);
  let written = 0;
  const conns = new Map<string, Conn | null>();
  const blocked = new Set<string>();
  for (const r of rows) {
    if (Date.now() - started > (opts.budgetMs ?? 15_000)) break;
    if (blocked.has(r.user_id)) continue;
    if (!conns.has(r.user_id)) conns.set(r.user_id, await getConn(r.user_id));
    const conn = conns.get(r.user_id);
    if (!conn || !conn.scopes.includes(NOTE_SCOPE)) continue;
    try {
      if (await syncNote(conn, r.chat_id, r.day)) written++;
    } catch (err) {
      // Token vencido, sin permisos o con límite: este workspace espera a la próxima corrida.
      if (err instanceof HubspotError && err.code !== 'hubspot_not_found') blocked.add(r.user_id);
    }
  }
  return written;
}
