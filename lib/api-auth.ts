import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { getDb, type ApiKeyRow, type UserRow } from './db';
import { clientIp, rateLimit } from './rate-limit';
import { API_SCOPES, hasScope, keyHasMcpAccess, MCP_KEY_SCOPE, parseScopes, serializeScopes, type ApiScope, scopesForApps, scopesWithoutApps, SCOPE_APP } from './api-scopes';
import { isComingSoon, PRODUCT_CONFIG, type ProductKey } from './products';
import { blockedAppsFor } from './workspace-apps';
import { normalizeRole, resolveWorkspace, type TeamRole } from './teams';
import { isPrincipalId, parseApps } from './workspace';
import { delegatedIdentity } from './mcp/identity';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ---------- Public v1 API auth ----------

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  // RFC 7235: el esquema no distingue mayúsculas ("bearer" llega de algunos harnesses).
  const m = /^bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  if (!m) return null;
  const key = m[1].trim();
  return key.length > 0 ? key : null;
}

/** Key válida: workspace (owner), persona que la creó, su rol y scopes. */
export interface ApiKeyAuth {
  user: UserRow;
  /** Persona que creó la key: la key actúa como ella (visibilidad del CRM). */
  personId: string;
  role: TeamRole;
  scopes: ApiScope[];
}

/** Rol de una persona en el workspace de `ownerId` ('owner' si es el dueño). */
export async function workspaceRole(ownerId: string, personId: string): Promise<TeamRole> {
  if (personId === ownerId) return 'owner';
  const row = (await getDb()
    .prepare(
      `SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END LIMIT 1`,
    )
    .get(ownerId, personId)) as { role: string } | undefined;
  return normalizeRole(row?.role);
}

/** Looks up a raw API key; on success bumps last_used_at and returns the owner + acting person. */
export async function validateApiKeyAuth(rawKey: string): Promise<ApiKeyAuth | null> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(sha256(rawKey))) as ApiKeyRow | undefined;
  if (!row) return null;
  await db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)) as UserRow | undefined;
  if (!user) return null;
  const personId = row.created_by ?? row.user_id;
  const scopes = parseScopes(row.scopes);
  if (personId === row.user_id) {
    const blocked = await blockedAppsFor({ ownerId: user.id, personId, role: 'owner', email: user.email });
    return { user, personId, role: 'owner', scopes: scopesWithoutApps(scopes, blocked) };
  }
  // La key de un miembro vale lo que hoy vale esa persona en el workspace: si
  // salió (o es guest) no sirve, y solo conserva los scopes de sus apps.
  const access = await personAppAccess(row.user_id, personId);
  if (!access) return null;
  const blocked = await blockedAppsFor({ ownerId: user.id, personId, role: access.role, email: await personEmail(personId) });
  return { user, personId, role: access.role, scopes: scopesWithoutApps(scopesForApps(scopes, access.apps), blocked) };
}

/**
 * Rol y apps actuales de una persona en el workspace del owner (unión de sus
 * equipos, sin guest). null = no es parte. Lo usan las API keys y v1/MCP.
 */
export async function personAppAccess(ownerId: string, personId: string): Promise<{ role: TeamRole; apps: '*' | string[] } | null> {
  if (personId === ownerId) return { role: 'owner', apps: '*' };
  const rows = (await getDb()
    .prepare(
      `SELECT m.role, m.apps FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest'`,
    )
    .all(ownerId, personId)) as Array<{ role: string; apps: string | null }>;
  if (!rows.length) return null;
  // El workspace exige dos pasos y la persona no los tiene: sus keys y conexiones no entran.
  const mfa = (await getDb()
    .prepare(
      `SELECT 1 AS blocked FROM teams t, users u
       WHERE t.owner_id = ? AND t.require_mfa = 1 AND u.id = ? AND u.mfa_enabled_at IS NULL LIMIT 1`,
    )
    .get(ownerId, personId)) as { blocked: number } | undefined;
  if (mfa) return null;
  // En un workspace de equipo con titular propio, el rol owner de team_members es el owner de verdad.
  if (isPrincipalId(ownerId) && rows.some((r) => r.role === 'owner')) return { role: 'owner', apps: '*' };
  const role: TeamRole = rows.some((r) => r.role === 'admin' || r.role === 'owner') ? 'admin' : 'member';
  const lists = rows.map((r) => parseApps(r.apps));
  if (lists.includes('*')) return { role, apps: '*' };
  return { role, apps: [...new Set(lists.flatMap((l) => (l === '*' ? [] : l)))] };
}

async function personEmail(personId: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(personId)) as { email: string } | undefined;
  return row?.email ?? null;
}

/** Compat: solo el dueño del workspace. */
export async function validateApiKey(rawKey: string): Promise<UserRow | null> {
  return (await validateApiKeyAuth(rawKey))?.user ?? null;
}

export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export type ApiAuth = ApiKeyAuth | { res: NextResponse };

/** 429 con Retry-After (segundos hasta que se libera la ventana). */
function withRetryAfter(res: NextResponse, resetAt: number): NextResponse {
  res.headers.set('retry-after', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
  return res;
}

/**
 * Bearer auth + rate limit + scope for /api/v1/* handlers. Cada ruta pasa el
 * scope que necesita (crm:read para GET, crm:write para escribir, …); una key
 * sin ese scope recibe 403 insufficient_scope.
 */
export async function requireApiUser(req: Request, scope: ApiScope): Promise<ApiAuth> {
  const delegated = delegatedIdentity();
  if (delegated) return delegatedApiAuth(delegated, scope);
  const raw = extractBearer(req);
  if (!raw) return { res: apiError(401, 'invalid_key', 'Missing API key. Use Authorization: Bearer zs_…') };
  // Se limita antes de validar: así tampoco se pueden probar keys a fuerza bruta.
  const limited = await rateLimit(`api:${sha256(raw)}`, 100, 60);
  if (!limited.ok) {
    return { res: withRetryAfter(apiError(429, 'rate_limited', 'Rate limit exceeded: 100 requests per minute.'), limited.resetAt) };
  }
  const auth = await validateApiKeyAuth(raw);
  if (!auth) {
    // Keys inválidas: además, tope por IP para frenar enumeración.
    const byIp = await rateLimit(`api-invalid:${clientIp(req)}`, 20, 60);
    if (!byIp.ok) return { res: withRetryAfter(apiError(429, 'rate_limited', 'Too many invalid keys.'), byIp.resetAt) };
    return { res: apiError(401, 'invalid_key', 'Invalid or revoked API key.') };
  }
  if (!hasScope(auth.scopes, scope)) {
    const app = SCOPE_APP[scope.split(':')[0]] ?? '';
    if (isComingSoon(app)) return { res: apiError(403, 'coming_soon', `${PRODUCT_CONFIG[app as ProductKey].name} is not available yet.`) };
    return { res: apiError(403, 'insufficient_scope', `This API key is missing the "${scope}" scope.`) };
  }
  return auth;
}

/** Una operación v1 invocada desde el MCP: la persona vale lo mismo que con una key suya en ese workspace. */
async function delegatedApiAuth(d: NonNullable<ReturnType<typeof delegatedIdentity>>, scope: ApiScope): Promise<ApiAuth> {
  const { owner, workspace } = await resolveWorkspace(d.real);
  const denied = (): ApiAuth => ({ res: apiError(403, 'insufficient_scope', `This connection is missing the "${scope}" scope.`) });
  if (d.pinnedTeamId && workspace.id !== d.pinnedTeamId) return denied();
  const access = await personAppAccess(owner.id, d.real.id);
  if (!access) return denied();
  const blocked = await blockedAppsFor({ ownerId: owner.id, personId: d.real.id, role: access.role, email: d.real.email });
  const allowed = scopesWithoutApps(scopesForApps(d.apiScopes ?? parseScopes('*'), access.apps), blocked);
  if (!hasScope(allowed, scope)) return denied();
  return { user: owner, personId: d.real.id, role: access.role, scopes: allowed };
}

// ---------- Key management (session API) ----------

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
  /** Scopes efectivos (todos si la key es anterior a los scopes). */
  scopes: ApiScope[];
  /** Puede usar el MCP unificado (opt-in al crearla). */
  mcp: boolean;
}

/** Generates `zs_<nanoid(32)>`, stores only its sha256. Full key is returned once. */
export async function createApiKey(
  userId: string,
  name: string,
  createdBy: string = userId,
  scopes: readonly string[] | '*' = '*',
  mcp = false,
): Promise<{ id: string; key: string; scopes: ApiScope[] }> {
  const db = getDb();
  const key = `zs_${nanoid(32)}`;
  const id = crypto.randomUUID();
  await db
  // Con MCP se guarda la lista explícita: '*' significa "solo v1" para las keys de siempre.
  const base = scopes === '*' ? '*' : serializeScopes(scopes);
  const stored = mcp ? `${base === '*' ? API_SCOPES.join(' ') : base} ${MCP_KEY_SCOPE}` : base;
  await db
    .prepare('INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_by, scopes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, key.slice(0, 10), sha256(key), createdBy, stored);
  return { id, key, scopes: parseScopes(stored) };
}

/** Keys del workspace. Con `onlyCreatedBy`, solo las que creó esa persona. */
export async function listApiKeys(userId: string, onlyCreatedBy?: string): Promise<ApiKeyDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.created_by, k.scopes, u.email AS created_by_email
       FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
       WHERE k.user_id = ? AND k.revoked = 0 AND (? IS NULL OR k.created_by = ?)
       ORDER BY k.created_at DESC`,
    )
    .all(userId, onlyCreatedBy ?? null, onlyCreatedBy ?? null)) as Array<Omit<ApiKeyDto, 'scopes'> & { scopes: string }>;
  return rows.map((r) => ({ ...r, scopes: parseScopes(r.scopes), mcp: keyHasMcpAccess(r.scopes) }));
}

export async function revokeApiKey(userId: string, id: string, onlyCreatedBy?: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ? AND (? IS NULL OR created_by = ?)')
    .run(id, userId, onlyCreatedBy ?? null, onlyCreatedBy ?? null);
  return res.changes > 0;
}
