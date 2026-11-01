/**
 * Servidor OAuth 2.1 del MCP unificado (docs/mcp.md). Clientes públicos con
 * PKCE S256 obligatorio, tokens atados a la audiencia (RFC 8707) y solo su
 * hash en la base. El refresh token rota en cada uso; usar uno ya gastado
 * revoca la conexión entera (detección de reuso).
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db';

export const ACCESS_TTL_SEC = 60 * 60;
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 60;
const CODE_TTL_SEC = 5 * 60;
const AUTH_REQUEST_TTL_SEC = 15 * 60;
const DEVICE_TTL_SEC = 10 * 60;
export const DEVICE_INTERVAL_SEC = 5;

export const SCOPES = ['read', 'write'] as const;
export type OAuthScope = (typeof SCOPES)[number];

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const ALLOWED_GRANTS = ['authorization_code', 'refresh_token', DEVICE_GRANT];

export const ACCESS_PREFIX = 'zsat_';
export const REFRESH_PREFIX = 'zsrt_';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const isoIn = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
const expired = (iso: string) => new Date(iso).getTime() <= Date.now();

/** Origen público del servidor. Sale de la configuración, nunca del header Host. */
export function issuerUrl(): string {
  const raw = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** URI canónica del recurso protegido (la audiencia de los tokens). */
export function mcpResourceUrl(): string {
  return `${issuerUrl()}/api/mcp`;
}

/** Comparación de la audiencia: esquema y host sin distinguir mayúsculas, sin barra final. */
export function canonicalResource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

export function parseScope(raw: string | null | undefined): OAuthScope[] | null {
  const parts = (raw ?? '').split(/\s+/).filter(Boolean);
  if (!parts.length) return ['read', 'write'];
  const known = parts.filter((p): p is OAuthScope => (SCOPES as readonly string[]).includes(p));
  if (known.length !== parts.length) return null;
  return SCOPES.filter((s) => known.includes(s));
}

export function serializeScope(scopes: readonly OAuthScope[]): string {
  return SCOPES.filter((s) => scopes.includes(s) || (s === 'read' && scopes.includes('write'))).join(' ');
}

export function hasWriteScope(scope: string): boolean {
  return scope.split(' ').includes('write');
}

// ---------- Redirect URIs ----------

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Solo https o http a loopback, sin fragmento ni credenciales. */
export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 1000) return false;
  try {
    const u = new URL(raw);
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Coincidencia exacta. Única excepción, la que piden RFC 8252 §7.3 y OAuth 2.1
 * §8.4.2 para apps nativas: en loopback el puerto lo elige el SO en cada login.
 */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  try {
    const r = new URL(requested);
    if (r.protocol !== 'http:' || !LOOPBACK.has(r.hostname)) return false;
    return registered.some((candidate) => {
      const c = new URL(candidate);
      return c.protocol === 'http:' && c.hostname === r.hostname && c.pathname === r.pathname && c.search === r.search;
    });
  } catch {
    return false;
  }
}

// ---------- Clientes ----------

export interface OAuthClient {
  client_id: string;
  name: string;
  client_uri: string | null;
  redirect_uris: string[];
  grant_types: string[];
  created_at: string;
}

type ClientRow = Omit<OAuthClient, 'redirect_uris' | 'grant_types'> & { redirect_uris: string; grant_types: string };

const toClient = (r: ClientRow): OAuthClient => ({
  ...r,
  redirect_uris: JSON.parse(r.redirect_uris) as string[],
  grant_types: JSON.parse(r.grant_types) as string[],
});

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 100) return null;
  const row = (await getDb().prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId)) as ClientRow | undefined;
  return row ? toClient(row) : null;
}

export class RegistrationError extends Error {
  constructor(
    public code: 'invalid_redirect_uri' | 'invalid_client_metadata',
    message: string,
  ) {
    super(message);
  }
}

/** Nombre mostrable: sin caracteres de control ni de dirección, con largo acotado. */
function cleanName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 80);
  return clean || 'Unnamed client';
}

/** Registro dinámico (RFC 7591). Todos son clientes públicos: no hay secreto que guardar. */
export async function registerClient(meta: Record<string, unknown>): Promise<OAuthClient> {
  const grants = Array.isArray(meta.grant_types) ? meta.grant_types.map(String) : ['authorization_code', 'refresh_token'];
  const unknownGrant = grants.find((g) => !ALLOWED_GRANTS.includes(g));
  if (unknownGrant) throw new RegistrationError('invalid_client_metadata', `Unsupported grant type: ${unknownGrant}`);
  const types = Array.isArray(meta.response_types) ? meta.response_types.map(String) : ['code'];
  if (types.some((t) => t !== 'code')) throw new RegistrationError('invalid_client_metadata', 'Only the code response type is supported.');
  const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris : [];
  if (uris.length > 10) throw new RegistrationError('invalid_redirect_uri', 'Too many redirect URIs.');
  if (!uris.every(validRedirectUri)) throw new RegistrationError('invalid_redirect_uri', 'Redirect URIs must be https or http on a loopback address, without a fragment.');
  if (grants.includes('authorization_code') && !uris.length) throw new RegistrationError('invalid_redirect_uri', 'At least one redirect URI is required.');
  const clientUri = typeof meta.client_uri === 'string' && /^https:\/\//.test(meta.client_uri) ? meta.client_uri.slice(0, 500) : null;
  const clientId = `zsc_${randomToken(18)}`;
  const name = cleanName(meta.client_name);
  await getDb()
    .prepare('INSERT INTO oauth_clients (client_id, name, client_uri, redirect_uris, grant_types) VALUES (?, ?, ?, ?, ?)')
    .run(clientId, name, clientUri, JSON.stringify(uris), JSON.stringify(grants));
  // Clientes que se registraron y nunca conectaron: limpieza acotada, sin cron.
  await getDb()
    .prepare(
      `DELETE FROM oauth_clients WHERE client_id IN (
         SELECT c.client_id FROM oauth_clients c
         WHERE c.created_at < datetime('now', '-30 days')
           AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.client_id) LIMIT 50)`,
    )
    .run();
  return { client_id: clientId, name, client_uri: clientUri, redirect_uris: uris as string[], grant_types: grants, created_at: new Date().toISOString() };
}

// ---------- Pedido de autorización y código ----------

export interface AuthRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string | null;
  code_challenge: string;
  resource: string;
  code_hash: string | null;
  grant_id: string | null;
  consumed_at: string | null;
  expires_at: string;
}

export async function createAuthRequest(input: Pick<AuthRequest, 'client_id' | 'redirect_uri' | 'scope' | 'state' | 'code_challenge' | 'resource'>): Promise<string> {
  const id = randomToken(24);
  // Limpieza acotada de pedidos vencidos, sin cron.
  await getDb().prepare(`DELETE FROM oauth_auth_requests WHERE id IN (SELECT id FROM oauth_auth_requests WHERE expires_at < ? LIMIT 50)`).run(new Date(Date.now() - 86_400_000).toISOString());
  await getDb()
    .prepare('INSERT INTO oauth_auth_requests (id, client_id, redirect_uri, scope, state, code_challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.client_id, input.redirect_uri, input.scope, input.state, input.code_challenge, input.resource, isoIn(AUTH_REQUEST_TTL_SEC));
  return id;
}

/** El pedido, si sigue abierto: sin decidir y sin vencer. */
export async function openAuthRequest(id: string): Promise<AuthRequest | null> {
  if (!id || id.length > 100) return null;
  const row = (await getDb().prepare('SELECT * FROM oauth_auth_requests WHERE id = ?').get(id)) as AuthRequest | undefined;
  if (!row || row.code_hash || row.consumed_at || expired(row.expires_at)) return null;
  return row;
}

export function authorizationRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  u.searchParams.set('iss', issuerUrl());
  return u.toString();
}

/** Crea la conexión. Una por cliente y persona: al reconectar, la anterior se revoca. */
export async function createGrant(input: { userId: string; clientId: string; teamId: string | null; scope: string; resource: string }): Promise<string> {
  const db = getDb();
  const previous = (await db
    .prepare('SELECT id FROM oauth_grants WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL')
    .all(input.userId, input.clientId)) as Array<{ id: string }>;
  for (const g of previous) await revokeGrantById(g.id);
  const id = `zsg_${randomToken(18)}`;
  await db
    .prepare('INSERT INTO oauth_grants (id, user_id, client_id, team_id, scope, resource) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.userId, input.clientId, input.teamId, input.scope, input.resource);
  return id;
}

/** La persona aprobó: nace la conexión y un código de un solo uso (compare-and-set sobre el pedido). */
export async function approveAuthRequest(req: AuthRequest, input: { userId: string; teamId: string | null; scope: string }): Promise<string | null> {
  const code = `zsac_${randomToken(32)}`;
  const claimed = await getDb()
    .prepare('UPDATE oauth_auth_requests SET code_hash = ?, expires_at = ? WHERE id = ? AND code_hash IS NULL AND consumed_at IS NULL')
    .run(hashToken(code), isoIn(CODE_TTL_SEC), req.id);
  if (!claimed.changes) return null;
  const grantId = await createGrant({ userId: input.userId, clientId: req.client_id, teamId: input.teamId, scope: input.scope, resource: req.resource });
  await getDb().prepare('UPDATE oauth_auth_requests SET grant_id = ? WHERE id = ?').run(grantId, req.id);
  return code;
}

export async function denyAuthRequest(id: string): Promise<void> {
  await getDb().prepare(`UPDATE oauth_auth_requests SET consumed_at = datetime('now') WHERE id = ? AND code_hash IS NULL`).run(id);
}

export function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class TokenError extends Error {
  constructor(
    public code: 'invalid_grant' | 'invalid_request' | 'invalid_client' | 'invalid_target' | 'unsupported_grant_type' | 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | 'invalid_scope',
    message: string,
  ) {
    super(message);
  }
}

export interface TokenSet {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(grantId: string, scope: string): Promise<TokenSet> {
  const access = `${ACCESS_PREFIX}${randomToken()}`;
  const refresh = `${REFRESH_PREFIX}${randomToken()}`;
  const db = getDb();
  await db.prepare(`INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, 'access', ?)`).run(hashToken(access), grantId, isoIn(ACCESS_TTL_SEC));
  await db.prepare(`INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, 'refresh', ?)`).run(hashToken(refresh), grantId, isoIn(REFRESH_TTL_SEC));
  // Limpieza acotada de lo vencido de esta conexión.
  await db.prepare(`DELETE FROM oauth_tokens WHERE grant_id = ? AND expires_at < ?`).run(grantId, new Date().toISOString());
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope };
}

function assertResource(requested: string | null, bound: string): void {
  if (!requested) return; // en el canje el parámetro es opcional: la audiencia ya quedó fijada al autorizar
  if (canonicalResource(requested) !== bound) throw new TokenError('invalid_target', 'The resource does not match the authorization.');
}

/** authorization_code + PKCE. Reusar un código revoca lo emitido con él (OAuth 2.1 §4.1.3). */
export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string; resource: string | null }): Promise<TokenSet> {
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM oauth_auth_requests WHERE code_hash = ?').get(hashToken(input.code))) as AuthRequest | undefined;
  if (!row) throw new TokenError('invalid_grant', 'Unknown authorization code.');
  if (row.consumed_at) {
    if (row.grant_id) await revokeGrantById(row.grant_id);
    throw new TokenError('invalid_grant', 'This authorization code was already used.');
  }
  if (expired(row.expires_at)) throw new TokenError('invalid_grant', 'The authorization code expired.');
  if (row.client_id !== input.clientId) throw new TokenError('invalid_grant', 'The code was issued to another client.');
  if (row.redirect_uri !== input.redirectUri) throw new TokenError('invalid_grant', 'The redirect URI does not match.');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier) || pkceS256(input.verifier) !== row.code_challenge) {
    throw new TokenError('invalid_grant', 'PKCE verification failed.');
  }
  assertResource(input.resource, row.resource);
  const claimed = await db.prepare(`UPDATE oauth_auth_requests SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL`).run(row.id);
  if (!claimed.changes || !row.grant_id) throw new TokenError('invalid_grant', 'This authorization code was already used.');
  const grant = await activeGrant(row.grant_id);
  if (!grant) throw new TokenError('invalid_grant', 'The connection was revoked.');
  return issueTokens(grant.id, grant.scope);
}

/** Rotación: cada refresh se usa una vez. Un refresh ya gastado revoca la conexión. */
export async function refreshTokens(input: { refreshToken: string; clientId: string; resource: string | null; scope: string | null }): Promise<TokenSet> {
  const db = getDb();
  const row = (await db.prepare(`SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'`).get(hashToken(input.refreshToken))) as
    | { token_hash: string; grant_id: string; expires_at: string; used_at: string | null }
    | undefined;
  if (!row) throw new TokenError('invalid_grant', 'Unknown refresh token.');
  const grant = await activeGrant(row.grant_id);
  if (!grant) throw new TokenError('invalid_grant', 'The connection was revoked.');
  if (grant.client_id !== input.clientId) throw new TokenError('invalid_grant', 'The token was issued to another client.');
  if (row.used_at) {
    await revokeGrantById(grant.id);
    throw new TokenError('invalid_grant', 'This refresh token was already used: the connection was revoked as a precaution.');
  }
  if (expired(row.expires_at)) throw new TokenError('invalid_grant', 'The refresh token expired.');
  assertResource(input.resource, grant.resource);
  // Un refresh no puede ampliar lo que la persona aprobó.
  if (input.scope) {
    const asked = parseScope(input.scope);
    if (!asked) throw new TokenError('invalid_scope', 'Unknown scope.');
    const granted = grant.scope.split(' ');
    if (asked.some((s) => !granted.includes(s))) throw new TokenError('invalid_scope', 'A refresh cannot widen the scope.');
  }
  const claimed = await db.prepare(`UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`).run(new Date().toISOString(), row.token_hash);
  if (!claimed.changes) {
    await revokeGrantById(grant.id);
    throw new TokenError('invalid_grant', 'This refresh token was already used: the connection was revoked as a precaution.');
  }
  return issueTokens(grant.id, grant.scope);
}

// ---------- Conexiones ----------

export interface GrantRow {
  id: string;
  user_id: string;
  client_id: string;
  team_id: string | null;
  scope: string;
  resource: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function activeGrant(id: string): Promise<GrantRow | null> {
  const row = (await getDb().prepare('SELECT * FROM oauth_grants WHERE id = ? AND revoked_at IS NULL').get(id)) as GrantRow | undefined;
  return row ?? null;
}

export async function revokeGrantById(id: string): Promise<void> {
  const db = getDb();
  await db.prepare(`UPDATE oauth_grants SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(id);
  await db.prepare('DELETE FROM oauth_tokens WHERE grant_id = ?').run(id);
}

/** Valida un access token: vigente, de una conexión viva. La audiencia la compara quien llama. */
export async function grantForAccessToken(raw: string): Promise<GrantRow | null> {
  if (!raw.startsWith(ACCESS_PREFIX)) return null;
  const db = getDb();
  const row = (await db.prepare(`SELECT grant_id, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'`).get(hashToken(raw))) as
    | { grant_id: string; expires_at: string }
    | undefined;
  if (!row || expired(row.expires_at)) return null;
  const grant = await activeGrant(row.grant_id);
  if (!grant) return null;
  // Último uso con grano de un minuto: sin una escritura por pedido.
  const last = grant.last_used_at ? new Date(`${grant.last_used_at}Z`).getTime() : 0;
  if (Date.now() - last > 60_000) await db.prepare(`UPDATE oauth_grants SET last_used_at = datetime('now') WHERE id = ?`).run(grant.id);
  return grant;
}

/** Revocación (RFC 7009): el dueño del token puede cortarlo; siempre responde bien. */
export async function revokeToken(raw: string, clientId: string | null): Promise<void> {
  const db = getDb();
  const row = (await db.prepare('SELECT grant_id, kind FROM oauth_tokens WHERE token_hash = ?').get(hashToken(raw))) as { grant_id: string; kind: string } | undefined;
  if (!row) return;
  const grant = await activeGrant(row.grant_id);
  if (!grant) return;
  if (clientId && grant.client_id !== clientId) return;
  if (row.kind === 'refresh') await revokeGrantById(grant.id);
  else await db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(hashToken(raw));
}

export interface ConnectedClient {
  id: string;
  clientName: string;
  clientUri: string | null;
  redirectHost: string | null;
  scope: string;
  teamId: string | null;
  workspaceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  writes: number;
}

/** Conexiones vivas de una persona: solo las suyas, con admin o sin admin. */
export async function listConnectedClients(userId: string): Promise<ConnectedClient[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT g.id, g.scope, g.team_id, g.created_at, g.last_used_at, c.name, c.client_uri, c.redirect_uris, t.name AS team_name,
              (SELECT COUNT(*) FROM mcp_audit_log a WHERE a.grant_id = g.id AND a.access != 'read') AS writes
       FROM oauth_grants g
       LEFT JOIN oauth_clients c ON c.client_id = g.client_id
       LEFT JOIN teams t ON t.id = g.team_id
       WHERE g.user_id = ? AND g.revoked_at IS NULL
       ORDER BY COALESCE(g.last_used_at, g.created_at) DESC`,
    )
    .all(userId)) as Array<{
    id: string;
    scope: string;
    team_id: string | null;
    created_at: string;
    last_used_at: string | null;
    name: string | null;
    client_uri: string | null;
    redirect_uris: string | null;
    team_name: string | null;
    writes: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    clientName: r.name ?? 'Unnamed client',
    clientUri: r.client_uri,
    redirectHost: redirectHost(r.redirect_uris),
    scope: r.scope,
    teamId: r.team_id,
    workspaceName: r.team_name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    writes: Number(r.writes ?? 0),
  }));
}

function redirectHost(raw: string | null): string | null {
  try {
    const first = (JSON.parse(raw ?? '[]') as string[])[0];
    return first ? new URL(first).hostname : null;
  } catch {
    return null;
  }
}

/** Revoca una conexión de esa persona. false si no es suya o ya no existe. */
export async function revokeOwnGrant(userId: string, grantId: string): Promise<boolean> {
  const grant = await activeGrant(grantId);
  if (!grant || grant.user_id !== userId) return false;
  await revokeGrantById(grant.id);
  return true;
}

// ---------- Flujo de dispositivo (RFC 8628): para la CLI sin navegador ----------

const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

function newUserCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Lo que tipea la persona, en la forma guardada. */
export function normalizeUserCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export interface DeviceRow {
  id: string;
  device_hash: string;
  user_code: string;
  client_id: string;
  scope: string;
  resource: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  grant_id: string | null;
  last_poll_at: string | null;
  expires_at: string;
}

export async function createDeviceCode(input: { clientId: string; scope: string; resource: string }): Promise<{ deviceCode: string; userCode: string; expiresIn: number }> {
  const deviceCode = `zsdc_${randomToken(32)}`;
  const userCode = newUserCode();
  await getDb().prepare(`DELETE FROM oauth_device_codes WHERE id IN (SELECT id FROM oauth_device_codes WHERE expires_at < ? LIMIT 50)`).run(new Date(Date.now() - 86_400_000).toISOString());
  await getDb()
    .prepare('INSERT INTO oauth_device_codes (id, device_hash, user_code, client_id, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomToken(16), hashToken(deviceCode), userCode, input.clientId, input.scope, input.resource, isoIn(DEVICE_TTL_SEC));
  return { deviceCode, userCode, expiresIn: DEVICE_TTL_SEC };
}

export async function pendingDeviceByUserCode(userCode: string): Promise<DeviceRow | null> {
  const row = (await getDb().prepare(`SELECT * FROM oauth_device_codes WHERE user_code = ? AND status = 'pending'`).get(normalizeUserCode(userCode))) as DeviceRow | undefined;
  if (!row || expired(row.expires_at)) return null;
  return row;
}

export async function decideDevice(row: DeviceRow, input: { approve: false } | { approve: true; userId: string; teamId: string | null; scope: string }): Promise<boolean> {
  const db = getDb();
  if (!input.approve) {
    const r = await db.prepare(`UPDATE oauth_device_codes SET status = 'denied' WHERE id = ? AND status = 'pending'`).run(row.id);
    return Boolean(r.changes);
  }
  const r = await db.prepare(`UPDATE oauth_device_codes SET status = 'approved' WHERE id = ? AND status = 'pending'`).run(row.id);
  if (!r.changes) return false;
  const grantId = await createGrant({ userId: input.userId, clientId: row.client_id, teamId: input.teamId, scope: input.scope, resource: row.resource });
  await db.prepare('UPDATE oauth_device_codes SET grant_id = ? WHERE id = ?').run(grantId, row.id);
  return true;
}

/** Polling del dispositivo: pendiente, despacio, denegado, vencido, o los tokens (una vez). */
export async function pollDevice(input: { deviceCode: string; clientId: string }): Promise<TokenSet> {
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM oauth_device_codes WHERE device_hash = ?').get(hashToken(input.deviceCode))) as DeviceRow | undefined;
  if (!row || row.client_id !== input.clientId) throw new TokenError('invalid_grant', 'Unknown device code.');
  if (expired(row.expires_at)) throw new TokenError('expired_token', 'The device code expired.');
  if (row.status === 'denied') throw new TokenError('access_denied', 'The request was denied.');
  if (row.status === 'consumed') throw new TokenError('invalid_grant', 'This device code was already used.');
  if (row.status === 'pending') {
    const last = row.last_poll_at ? new Date(row.last_poll_at).getTime() : 0;
    await db.prepare('UPDATE oauth_device_codes SET last_poll_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    if (Date.now() - last < (DEVICE_INTERVAL_SEC - 1) * 1000) throw new TokenError('slow_down', 'Polling too fast.');
    throw new TokenError('authorization_pending', 'Waiting for the person to approve.');
  }
  const claimed = await db.prepare(`UPDATE oauth_device_codes SET status = 'consumed' WHERE id = ? AND status = 'approved'`).run(row.id);
  if (!claimed.changes || !row.grant_id) throw new TokenError('invalid_grant', 'This device code was already used.');
  const grant = await activeGrant(row.grant_id);
  if (!grant) throw new TokenError('invalid_grant', 'The connection was revoked.');
  return issueTokens(grant.id, grant.scope);
}
