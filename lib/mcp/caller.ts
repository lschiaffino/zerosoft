/**
 * Quién llama al MCP: un token OAuth (conexión de una persona) o una API key.
 * El caller guarda la identidad y el tope de permisos; lo que la persona puede
 * hacer lo sigue decidiendo el handler real de cada ruta.
 */
import { extractBearer, personAppAccess, sha256, validateApiKeyAuth } from '../api-auth';
import { hasScope, keyHasMcpAccess, parseScopes, type ApiScope } from '../api-scopes';
import { getDb, type TeamRow, type UserRow } from '../db';
import { rateLimit, clientIp } from '../rate-limit';
import { resolveWorkspace, type TeamRole } from '../teams';
import { userCanUseApp, type AppAccess } from '../workspace';
import { canonicalResource, grantForAccessToken, hasWriteScope, mcpResourceUrl, type GrantRow } from '../oauth/store';
import type { DelegatedIdentity } from './identity';
import type { Operation } from './catalog';

export interface McpCaller {
  kind: 'oauth' | 'api_key';
  personId: string;
  /** Workspace fijado en la conexión; null = el propio de la persona. */
  teamId: string | null;
  canWrite: boolean;
  clientId: string | null;
  clientName: string;
  grantId: string | null;
  apiKeyId: string | null;
  /** Scopes de la key; undefined en OAuth. */
  apiScopes?: ApiScope[];
  rateKey: string;
}

export type AuthFailure =
  | { status: 401; error: 'invalid_token' | 'missing_token'; description: string }
  | { status: 403; error: 'no_mcp_access'; description: string }
  | { status: 429; retryAfter: number };

const NO_MCP_ACCESS: AuthFailure = {
  status: 403,
  error: 'no_mcp_access',
  description: 'This API key works with the REST API only. In Settings, API and webhooks, create a key with MCP access, or sign in with OAuth.',
};

async function failedAttempt(req: Request): Promise<AuthFailure | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const byIp = await rateLimit(`mcp-invalid:${clientIp(req)}`, 30, 60);
  if (!byIp.ok) return { status: 429, retryAfter: Math.max(1, Math.ceil((byIp.resetAt - Date.now()) / 1000)) };
  return null;
}

export async function authenticate(req: Request): Promise<McpCaller | AuthFailure> {
  const raw = extractBearer(req);
  if (!raw) return { status: 401, error: 'missing_token', description: 'Sign in with OAuth, or use an API key as Bearer.' };
  const caller = raw.startsWith('zs_') ? await fromApiKey(raw) : await fromOAuth(raw);
  if (caller === 'no_mcp_access') return NO_MCP_ACCESS;
  if (caller) return caller;
  return (await failedAttempt(req)) ?? { status: 401, error: 'invalid_token', description: 'The token is invalid, expired, revoked or for another resource.' };
}

async function fromOAuth(raw: string): Promise<McpCaller | null> {
  const grant = await grantForAccessToken(raw);
  if (!grant) return null;
  // Audiencia (RFC 8707): solo tokens emitidos para este recurso.
  if (canonicalResource(grant.resource) !== canonicalResource(mcpResourceUrl())) return null;
  return callerFromGrant(grant);
}

async function callerFromGrant(grant: GrantRow): Promise<McpCaller> {
  const client = (await getDb().prepare('SELECT name FROM oauth_clients WHERE client_id = ?').get(grant.client_id)) as { name: string } | undefined;
  return {
    kind: 'oauth',
    personId: grant.user_id,
    teamId: grant.team_id,
    canWrite: hasWriteScope(grant.scope),
    clientId: grant.client_id,
    clientName: client?.name ?? 'Unnamed client',
    grantId: grant.id,
    apiKeyId: null,
    rateKey: `mcp:${grant.id}`,
  };
}

async function fromApiKey(raw: string): Promise<McpCaller | 'no_mcp_access' | null> {
  const auth = await validateApiKeyAuth(raw);
  if (!auth) return null;
  const key = (await getDb().prepare('SELECT id, name, scopes FROM api_keys WHERE key_hash = ?').get(sha256(raw))) as { id: string; name: string; scopes: string | null } | undefined;
  // Una key no gana sola la API de sesión: tiene que haberse creado con acceso al MCP.
  if (!keyHasMcpAccess(key?.scopes)) return 'no_mcp_access';
  // La key vale en el workspace de su dueño; si la creó un miembro, en el equipo donde está.
  let teamId: string | null = null;
  if (auth.personId !== auth.user.id) {
    const team = (await getDb()
      .prepare(
        `SELECT t.id FROM teams t JOIN team_members m ON m.team_id = t.id
         WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest' LIMIT 1`,
      )
      .get(auth.user.id, auth.personId)) as { id: string } | undefined;
    if (!team) return null;
    teamId = team.id;
  }
  const scopes = parseScopes(key?.scopes);
  return {
    kind: 'api_key',
    personId: auth.personId,
    teamId,
    canWrite: scopes.some((s) => s.endsWith(':write') || s.endsWith(':run')),
    clientId: null,
    clientName: key?.name ? `API key: ${key.name}` : 'API key',
    grantId: null,
    apiKeyId: key?.id ?? null,
    apiScopes: scopes,
    rateKey: `mcp:key:${key?.id ?? sha256(raw)}`,
  };
}

/** Scope de la API v1 que corresponde a una app (las keys con scopes solo llegan a esas). */
const APP_SCOPE: Record<string, string> = {
  crm: 'crm', link: 'links', cal: 'cal', chat: 'chat', groups: 'groups', voice: 'voice', track: 'track', docs: 'docs',
  talk: 'talk', board: 'boards', design: 'design', shop: 'shop', hiring: 'hiring', sign: 'sign', analytics: 'analytics',
  social: 'social', people: 'people', books: 'books', forms: 'forms', notes: 'notes',
};

const ALL_API_SCOPES = parseScopes('*');

/**
 * Tope de la credencial para una operación: lectura o escritura de OAuth, y
 * los scopes de la key. Una key sin el scope de la app no llega; una app sin
 * scope propio (Flow, Rec, Agents, Robots, Workspace) pide una key con todos.
 */
export function credentialAllows(caller: McpCaller, op: Pick<Operation, 'app' | 'access'>): boolean {
  const isRead = op.access === 'read';
  if (caller.kind === 'oauth') return isRead || caller.canWrite;
  const scopes = caller.apiScopes ?? [];
  const resource = APP_SCOPE[op.app];
  if (!resource) return ALL_API_SCOPES.every((s) => scopes.includes(s));
  const scope = `${resource}:${isRead ? 'read' : 'write'}` as ApiScope;
  if (!(ALL_API_SCOPES as string[]).includes(scope)) return ALL_API_SCOPES.every((s) => scopes.includes(s));
  return hasScope(scopes, scope);
}

export interface ResolvedPerson {
  person: UserRow;
  owner: UserRow;
  workspace: TeamRow;
  role: TeamRole;
  apps: AppAccess;
  identity: (apiPath: string) => DelegatedIdentity;
}

/** La persona y su workspace ahora mismo, de la base. null si ya no existe o salió del workspace fijado. */
export async function resolvePerson(caller: McpCaller): Promise<ResolvedPerson | null> {
  const row = (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(caller.personId)) as UserRow | undefined;
  if (!row) return null;
  const real: UserRow = { ...row, active_team_id: caller.teamId };
  const { owner, workspace, role, apps } = await resolveWorkspace(real);
  if (caller.teamId && workspace.id !== caller.teamId) return null;
  // Una key de un miembro además tiene que seguir siendo del equipo (no guest).
  if (caller.kind === 'api_key' && owner.id !== real.id && !(await personAppAccess(owner.id, real.id))) return null;
  return {
    person: row,
    owner,
    workspace,
    role,
    apps,
    identity: (apiPath) => ({ real, pinnedTeamId: caller.teamId, apiPath, ...(caller.apiScopes ? { apiScopes: caller.apiScopes } : {}) }),
  };
}

/** ¿La persona tiene esa app? Las operaciones de workspace no son de una app: las decide cada handler. */
export function personCanUseApp(person: Pick<ResolvedPerson, 'role' | 'apps'>, app: Operation['app']): boolean {
  if (app === 'workspace') return true;
  return userCanUseApp({ role: person.role, apps: person.apps }, app);
}
