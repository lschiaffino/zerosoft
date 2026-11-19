/**
 * CRM ↔ HubSpot (sync de dos vías) — la conexión del workspace. Server-only.
 *
 * Una conexión por workspace, en su propia tabla (crm_hubspot_sync) y no en la
 * de Lines (groups_hubspot): cada función pide otros permisos, se desconecta
 * por separado y Lines borra sus vínculos al cambiar de cuenta. Si el
 * workspace ya conectó HubSpot en Lines, un admin puede usar esa misma clave
 * sin volver a pegarla: se valida con los permisos del sync y se copia cifrada
 * (nunca sale del servidor). Desde ahí las dos conexiones son independientes.
 *
 * La clave (una service key o el token de una private app heredada) se guarda
 * cifrada con lib/secret-box y solo se abre para llamar a HubSpot. No vuelve
 * por ninguna respuesta ni va a un log; los errores llevan un código y, si
 * faltan permisos, sus nombres.
 *
 * Permisos: los de lectura hacen falta ya (sin ellos no se conecta). Los de
 * escritura recién los usa el bloque que escribe en HubSpot: si faltan se
 * conecta igual y se avisa.
 *
 * El host de HubSpot es fijo (lib/hubspot/client.ts): ningún dato de quien
 * llama decide a dónde va un pedido.
 */
import { getDb } from '../db';
import { fakeImportAllowed } from '../crm-import-fake';
import { HubspotApiError, createHubspotClient, hubspotBudget, type HubspotClient } from '../hubspot/client';
import { fakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '../hubspot/fake-portal';
import {
  inspectHubspotToken,
  looksLikeHubspotToken,
  missingHubspotScopes,
  openHubspotToken,
  sealHubspotToken,
  type HubspotTokenInfo,
  type HubspotTokenKind,
} from '../hubspot/token';

/** Lo que el sync lee: sin estos no se conecta. */
export const SYNC_READ_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
] as const;

/** Lo que va a hacer falta para escribir en HubSpot (todavía no se usa). */
export const SYNC_WRITE_SCOPES = ['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write'] as const;

export const SYNC_DIRECTIONS = ['hubspot_to_zerosoft', 'zerosoft_to_hubspot', 'both'] as const;
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

export interface SyncSettings {
  /** El sync corre. Apagado por defecto; en este bloque nada lo prende. */
  enabled: boolean;
  direction: SyncDirection;
  /** Freno de emergencia: con esto prendido el sync no lee ni escribe aunque esté habilitado. */
  paused: boolean;
}

export type SyncKeySource = 'pasted' | 'lines';

export interface HubspotSyncStatus {
  connected: boolean;
  portalId: string;
  uiDomain: string;
  tokenKind: HubspotTokenKind;
  keySource: SyncKeySource | '';
  scopes: string[];
  /** Permisos de escritura que le faltan a la clave: no frenan nada todavía. */
  missingWrite: string[];
  checkedAt: string | null;
  /** Código del último problema al revisar la clave ('' si anduvo). */
  lastError: string;
  settings: SyncSettings;
  /** Hay una clave conectada en Lines que se puede usar acá sin pegarla de nuevo. */
  linesKeyAvailable: boolean;
  requiredScopes: { read: string[]; write: string[] };
}

interface ConnRow {
  user_id: string;
  token: string;
  token_kind: string;
  key_source: string;
  portal_id: string;
  ui_domain: string;
  scopes: string;
  checked_at: string | null;
  last_error: string;
  connected_by: string;
}

export type ConnectErrorCode = 'invalid_token' | 'missing_scope' | 'provider_error' | 'hubspot_busy' | 'lines_not_connected' | 'not_connected';
export type ConnectResult = { ok: true; status: HubspotSyncStatus } | { ok: false; code: ConnectErrorCode; missing?: string[] };

function parseList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ---------- HubSpot (real o falso) ----------

/**
 * La cuenta falsa del sync (tests y e2e): solo con CRM_IMPORT_FAKE=1 y además
 * NODE_ENV=test o DEMO_MODE. Con el falso prendido ningún pedido sale a
 * internet: una clave que no es de prueba recibe su 401 ahí.
 */
export function syncFakePortal(): FakeHubspotPortal | null {
  return fakeImportAllowed() ? fakeHubspotPortal('crm', seedSyncPortal) : null;
}

export interface SyncClientOptions {
  portalId?: string;
  /** Cuánto se espera como mucho por un lugar en el presupuesto antes de cortar con rate_limited. */
  maxWaitMs?: number;
}

/** El cliente de HubSpot del sync, con el presupuesto compartido de la clave y su cuenta. */
export function syncHubspotClient(token: string, opts: SyncClientOptions = {}): HubspotClient {
  const fake = syncFakePortal();
  // Con el falso no hay presupuesto: con esperas instantáneas el limitador real giraría sin parar.
  if (fake) return createHubspotClient({ token, fetch: fake.fetch, sleep: async () => {}, budget: null });
  return createHubspotClient({ token, timeoutMs: 20_000, budget: hubspotBudget({ token, portalId: opts.portalId, maxWaitMs: opts.maxWaitMs }) });
}

function errorCode(err: unknown): ConnectErrorCode {
  if (!(err instanceof HubspotApiError)) return 'provider_error';
  if (err.code === 'auth') return 'invalid_token';
  if (err.code === 'rate_limited' || err.code === 'locked') return 'hubspot_busy';
  return 'provider_error';
}

/**
 * Valida la clave con los permisos del sync. Si HubSpot informa la lista de
 * permisos y no nombra alguno de lectura, ese se prueba contra su endpoint
 * (una clave vieja puede leer algo que su lista no nombra). Los de escritura
 * solo se prueban cuando HubSpot no informa la lista (una service key): la
 * prueba es un PATCH sin propiedades sobre el id 0, que no cambia nada.
 */
async function inspect(token: string): Promise<HubspotTokenInfo> {
  const client = syncHubspotClient(token, { maxWaitMs: 5_000 });
  const info = await inspectHubspotToken(token, { client, probe: [...SYNC_READ_SCOPES, ...SYNC_WRITE_SCOPES] });
  if (info.scopesFrom === 'token_info' && missingHubspotScopes(info.scopes, SYNC_READ_SCOPES).length) {
    const again = await inspectHubspotToken(token, { client, probe: SYNC_READ_SCOPES, verifyMissing: true });
    return { ...info, scopes: [...new Set([...info.scopes, ...again.scopes])] };
  }
  return info;
}

// ---------- Estado ----------

async function connRow(ws: string): Promise<ConnRow | null> {
  return ((await getDb().prepare('SELECT * FROM crm_hubspot_sync WHERE user_id = ?').get(ws)) as ConnRow | undefined) ?? null;
}

export async function getSyncSettings(ws: string): Promise<SyncSettings> {
  const row = (await getDb().prepare('SELECT enabled, direction, paused FROM crm_hubspot_sync_settings WHERE user_id = ?').get(ws)) as
    | { enabled: number; direction: string; paused: number }
    | undefined;
  const direction = (SYNC_DIRECTIONS as readonly string[]).includes(row?.direction ?? '') ? (row!.direction as SyncDirection) : 'hubspot_to_zerosoft';
  return { enabled: row?.enabled === 1, direction, paused: row?.paused === 1 };
}

/**
 * ¿Puede correr el sync de este workspace? Lo van a consultar los bloques que
 * leen y escriben. Además del freno del workspace hay uno global
 * (CRM_HUBSPOT_SYNC_DISABLED=1) para cortar todo sin tocar la base.
 */
export async function syncGate(ws: string): Promise<{ run: boolean; reason: '' | 'off' | 'paused' | 'disabled_globally' | 'not_connected' }> {
  if (process.env.CRM_HUBSPOT_SYNC_DISABLED === '1') return { run: false, reason: 'disabled_globally' };
  const settings = await getSyncSettings(ws);
  if (!settings.enabled) return { run: false, reason: 'off' };
  if (settings.paused) return { run: false, reason: 'paused' };
  const row = await connRow(ws);
  if (!row?.token) return { run: false, reason: 'not_connected' };
  return { run: true, reason: '' };
}

/** La clave conectada en Lines, abierta. Solo para validarla y copiarla acá: nunca se devuelve. */
async function linesToken(ws: string): Promise<string> {
  const row = (await getDb().prepare("SELECT token FROM groups_hubspot WHERE user_id = ? AND token != ''").get(ws)) as { token: string } | undefined;
  return row ? openHubspotToken(row.token) : '';
}

export async function getSyncStatus(ws: string): Promise<HubspotSyncStatus> {
  const [row, settings, lines] = await Promise.all([connRow(ws), getSyncSettings(ws), linesToken(ws)]);
  const connected = Boolean(row?.token);
  const scopes = connected ? parseList(row!.scopes) : [];
  const kind = row?.token_kind === 'service_key' || row?.token_kind === 'private_app' ? row.token_kind : 'unknown';
  return {
    connected,
    portalId: connected ? row!.portal_id : '',
    uiDomain: connected ? row!.ui_domain || 'app.hubspot.com' : '',
    tokenKind: connected ? kind : 'unknown',
    keySource: connected ? (row!.key_source === 'lines' ? 'lines' : 'pasted') : '',
    scopes,
    missingWrite: connected ? missingHubspotScopes(scopes, SYNC_WRITE_SCOPES) : [],
    checkedAt: connected ? row!.checked_at : null,
    lastError: connected ? row!.last_error : '',
    settings,
    linesKeyAvailable: Boolean(lines),
    requiredScopes: { read: [...SYNC_READ_SCOPES], write: [...SYNC_WRITE_SCOPES] },
  };
}

/** La conexión con la clave abierta. Solo para llamar a HubSpot desde el servidor. */
export async function openSyncConnection(ws: string): Promise<{ token: string; portalId: string; scopes: string[] } | null> {
  const row = await connRow(ws);
  const token = row?.token ? openHubspotToken(row.token) : '';
  if (!row || !token) return null;
  return { token, portalId: row.portal_id, scopes: parseList(row.scopes) };
}

// ---------- Conectar y desconectar ----------

async function store(ws: string, actor: string, token: string, info: HubspotTokenInfo, source: SyncKeySource): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const prev = await connRow(ws);
  await db
    .prepare(
      `INSERT INTO crm_hubspot_sync (user_id, token, token_kind, key_source, portal_id, ui_domain, scopes, checked_at, last_error, connected_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, token_kind = excluded.token_kind, key_source = excluded.key_source,
         portal_id = excluded.portal_id, ui_domain = excluded.ui_domain, scopes = excluded.scopes, checked_at = excluded.checked_at,
         last_error = '', connected_by = excluded.connected_by, updated_at = excluded.updated_at`,
    )
    .run(ws, sealHubspotToken(token), info.kind, source, info.portalId, info.uiDomain, JSON.stringify(info.scopes), now, actor, now, now);
  // Otra cuenta de HubSpot: la vista previa de la anterior ya no dice nada de esta.
  if (prev && prev.portal_id !== info.portalId) await dropPreview(ws);
}

async function dropPreview(ws: string): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM crm_hubspot_preview_rows WHERE preview_id IN (SELECT id FROM crm_hubspot_previews WHERE user_id = ?)').run(ws);
  await db.prepare('DELETE FROM crm_hubspot_previews WHERE user_id = ?').run(ws);
}

async function connectWith(ws: string, actor: string, token: string, source: SyncKeySource): Promise<ConnectResult> {
  if (!looksLikeHubspotToken(token)) return { ok: false, code: 'invalid_token' };
  let info: HubspotTokenInfo;
  try {
    info = await inspect(token);
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
  const missing = missingHubspotScopes(info.scopes, SYNC_READ_SCOPES);
  if (missing.length) return { ok: false, code: 'missing_scope', missing };
  await store(ws, actor, token, info, source);
  return { ok: true, status: await getSyncStatus(ws) };
}

/** Conecta (o cambia la clave). Valida la clave y sus permisos antes de guardar nada. */
export async function connectSync(ws: string, actor: string, rawToken: string): Promise<ConnectResult> {
  return connectWith(ws, actor, String(rawToken ?? '').trim(), 'pasted');
}

/** Conecta con la clave que el workspace ya tiene en Lines, sin que pase por el navegador. */
export async function connectSyncFromLines(ws: string, actor: string): Promise<ConnectResult> {
  const token = await linesToken(ws);
  if (!token) return { ok: false, code: 'lines_not_connected' };
  return connectWith(ws, actor, token, 'lines');
}

/** Vuelve a validar la clave guardada: permisos al día y fecha de la última revisión. */
export async function recheckSync(ws: string): Promise<ConnectResult> {
  const conn = await openSyncConnection(ws);
  if (!conn) return { ok: false, code: 'not_connected' };
  const db = getDb();
  const now = new Date().toISOString();
  try {
    const info = await inspect(conn.token);
    // La clave ahora entra a otra cuenta: no se sigue como si fuera la misma.
    const error = info.portalId !== conn.portalId ? 'portal_changed' : missingHubspotScopes(info.scopes, SYNC_READ_SCOPES).length ? 'missing_scope' : '';
    await db
      .prepare('UPDATE crm_hubspot_sync SET scopes = ?, token_kind = ?, checked_at = ?, last_error = ?, updated_at = ? WHERE user_id = ?')
      .run(JSON.stringify(info.scopes), info.kind, now, error, now, ws);
  } catch (err) {
    await db.prepare('UPDATE crm_hubspot_sync SET checked_at = ?, last_error = ?, updated_at = ? WHERE user_id = ?').run(now, errorCode(err), now, ws);
  }
  return { ok: true, status: await getSyncStatus(ws) };
}

/**
 * Desconecta: borra la fila con la clave, apaga el sync y descarta la vista
 * previa. Los vínculos (crm_hubspot_links) quedan por si se vuelve a conectar
 * la misma cuenta.
 */
export async function disconnectSync(ws: string, actor = ''): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM crm_hubspot_sync WHERE user_id = ?').run(ws);
  await db
    .prepare('UPDATE crm_hubspot_sync_settings SET enabled = 0, updated_by = ?, updated_at = ? WHERE user_id = ?')
    .run(actor, new Date().toISOString(), ws);
  await dropPreview(ws);
  return res.changes > 0;
}
