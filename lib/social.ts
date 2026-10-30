/**
 * Social (Hootsuite): cuentas conectadas, publicaciones, aprobaciones,
 * cola, bandeja y biblioteca. Server-only.
 *
 * Acceso:
 * - La app: team_members.apps (la API ya responde 401 sin la app; acá se
 *   vuelve a mirar por las dudas).
 * - Rol en Social: owner y admins del workspace son "admin" (conectan
 *   cuentas, dan acceso, aprueban). Un member es "publisher" (publica solo)
 *   o "drafter" (sus publicaciones esperan aprobación).
 * - Por cuenta: un member solo ve y publica en las cuentas que un admin le
 *   dio (social_account_members). Ve las publicaciones propias y las que van
 *   a esas cuentas; la bandeja y las métricas, solo de esas cuentas.
 *
 * Los tokens se guardan cifrados (secret-box) y no salen nunca de este
 * archivo y de lib/social-cron.ts: los DTO no los traen.
 */
import { getDb } from './db';
import { open, seal } from './secret-box';
import { roleAtLeast, type TeamRole } from './teams';
import { canUseApp } from './workspace';
import { personAppAccess } from './api-auth';
import { createNotification } from './notifications';
import {
  isSocialNetwork,
  NETWORK_SPECS,
  networkConfigured,
  socialFake,
  validateForNetwork,
  textFor,
  type MediaItem,
  type SocialNetwork,
  type ValidationIssue,
} from './social-networks';
import { nextSlots, type Slot } from './social-schedule';
import { blueskySession, pkcePair, REAL_PROVIDERS, SocialApiError, type AccountCreds, type DiscoveredAccount, type SocialProvider } from './social-providers';
import { FAKE_PROVIDER, fakeBlueskySession } from './social-fake';

// ---------- Tipos ----------

export interface SocialActor {
  /** Owner del workspace: clave de los datos. */
  workspaceId: string;
  /** Persona real. */
  personId: string;
  /** Rol en el workspace. */
  role: TeamRole;
  /** Apps del workspace ('*' o lista); undefined = todas (owner, cron). */
  apps?: '*' | string[];
}

export type SocialRole = 'admin' | 'publisher' | 'drafter';
export type PostStatus = 'draft' | 'pending_approval' | 'rejected' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
export type TargetStatus = 'pending' | 'publishing' | 'processing' | 'retry' | 'published' | 'failed';

export class SocialError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

export function socialActor(user: { id: string; actingUser?: { id: string } | null; role?: TeamRole | null; apps?: '*' | string[] | null }): SocialActor {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role ?? 'owner', apps: user.apps ?? '*' };
}

const db = () => getDb();
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const json = <T>(raw: unknown, fallback: T): T => {
  try {
    return raw ? (JSON.parse(String(raw)) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function providerFor(network: SocialNetwork): SocialProvider {
  return socialFake() ? FAKE_PROVIDER : REAL_PROVIDERS[network];
}

// ---------- Roles ----------

export async function socialRoleOf(actor: SocialActor): Promise<SocialRole> {
  if (roleAtLeast(actor.role, 'admin')) return 'admin';
  const row = (await db().prepare('SELECT role FROM social_roles WHERE workspace_id = ? AND person_id = ?').get(actor.workspaceId, actor.personId)) as { role: string } | undefined;
  return row?.role === 'drafter' ? 'drafter' : 'publisher';
}

export function isSocialAdmin(actor: SocialActor): boolean {
  return roleAtLeast(actor.role, 'admin');
}

function requireAdmin(actor: SocialActor) {
  if (!isSocialAdmin(actor)) throw new SocialError(403, 'admin_only');
}

export interface SocialPerson {
  id: string;
  name: string;
  email: string;
  workspaceRole: TeamRole;
  socialRole: SocialRole;
  accountIds: string[];
}

/** Personas del workspace que tienen Social, con su rol y sus cuentas. */
export async function listSocialPeople(actor: SocialActor): Promise<SocialPerson[]> {
  const rows = (await db()
    .prepare(
      `SELECT u.id, u.name, u.email,
         CASE WHEN u.id = ? THEN 'owner' ELSE (SELECT CASE WHEN SUM(m.role = 'admin') > 0 THEN 'admin' ELSE 'member' END
           FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = u.id AND m.role != 'guest') END AS role,
         (SELECT group_concat(m.apps, '|') FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = u.id AND m.role != 'guest') AS apps
       FROM users u
       WHERE u.id = ? OR EXISTS (SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = u.id AND m.role != 'guest')
       ORDER BY u.id = ? DESC, COALESCE(u.name, u.email) COLLATE NOCASE`,
    )
    .all(actor.workspaceId, actor.workspaceId, actor.workspaceId, actor.workspaceId, actor.workspaceId, actor.workspaceId)) as Array<{
    id: string;
    name: string | null;
    email: string;
    role: TeamRole;
    apps: string | null;
  }>;
  const roles = (await db().prepare('SELECT person_id, role FROM social_roles WHERE workspace_id = ?').all(actor.workspaceId)) as Array<{ person_id: string; role: string }>;
  const grants = (await db()
    .prepare('SELECT m.person_id, m.account_id FROM social_account_members m JOIN social_accounts a ON a.id = m.account_id WHERE a.workspace_id = ?')
    .all(actor.workspaceId)) as Array<{ person_id: string; account_id: string }>;
  const out: SocialPerson[] = [];
  for (const r of rows) {
    // Owner, o alguna de sus membresías del workspace le da Social ('*' o la lista con social).
    const canUse = r.id === actor.workspaceId || (r.apps ?? '').split('|').some((a) => canUseApp({ role: r.role, apps: a || '*' }, 'social'));
    if (!canUse) continue;
    const admin = roleAtLeast(r.role, 'admin');
    out.push({
      id: r.id,
      name: r.name || r.email,
      email: r.email,
      workspaceRole: r.role,
      socialRole: admin ? 'admin' : roles.find((x) => x.person_id === r.id)?.role === 'drafter' ? 'drafter' : 'publisher',
      accountIds: grants.filter((g) => g.person_id === r.id).map((g) => g.account_id),
    });
  }
  return out;
}

/** ¿La persona (no la sesión) puede usar Social en el workspace? */
async function personHasSocial(workspaceId: string, personId: string): Promise<{ role: TeamRole } | null> {
  const access = await personAppAccess(workspaceId, personId);
  if (!access) return null;
  return canUseApp({ role: access.role, apps: access.apps === '*' ? '*' : JSON.stringify(access.apps) }, 'social') ? { role: access.role } : null;
}

/** ¿La persona sigue teniendo Social en el workspace? (owner siempre). */
export async function personHasSocialApp(workspaceId: string, personId: string): Promise<boolean> {
  return personId === workspaceId || Boolean(await personHasSocial(workspaceId, personId));
}

export async function setSocialRole(actor: SocialActor, personId: string, role: 'publisher' | 'drafter'): Promise<void> {
  requireAdmin(actor);
  const access = await personHasSocial(actor.workspaceId, personId);
  if (!access) throw new SocialError(404, 'person_not_found');
  if (roleAtLeast(access.role, 'admin')) throw new SocialError(400, 'admins_always_publish');
  await db()
    .prepare(
      `INSERT INTO social_roles (workspace_id, person_id, role, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, person_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
    )
    .run(actor.workspaceId, personId, role, now());
}

// ---------- Cuentas ----------

interface AccountRow {
  id: string;
  workspace_id: string;
  network: string;
  kind: string;
  external_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  refresh_expires_at: string | null;
  meta: string;
  status: string;
  status_error: string | null;
  connected_by: string | null;
  followers: number | null;
  created_at: string;
  updated_at: string;
}

export interface AccountDto {
  id: string;
  network: SocialNetwork;
  networkName: string;
  kind: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  status: 'connected' | 'expired' | 'error';
  statusError: string | null;
  followers: number | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  /** Solo para admins: quiénes publican en la cuenta (además de los admins). */
  memberIds?: string[];
}

function accountDto(r: AccountRow, memberIds?: string[]): AccountDto {
  const network = r.network as SocialNetwork;
  return {
    id: r.id,
    network,
    networkName: NETWORK_SPECS[network]?.name ?? r.network,
    kind: r.kind,
    name: r.name,
    handle: r.handle,
    avatarUrl: r.avatar_url,
    profileUrl: r.profile_url,
    status: r.status === 'expired' ? 'expired' : r.status === 'error' ? 'error' : 'connected',
    statusError: r.status_error,
    followers: r.followers,
    tokenExpiresAt: r.token_expires_at,
    createdAt: r.created_at,
    ...(memberIds ? { memberIds } : {}),
  };
}

/** Cuentas que la persona ve: todas si es admin; si no, las que se le dieron. */
export async function visibleAccountRows(actor: SocialActor): Promise<AccountRow[]> {
  if (isSocialAdmin(actor)) {
    return (await db().prepare('SELECT * FROM social_accounts WHERE workspace_id = ? ORDER BY network, name COLLATE NOCASE').all(actor.workspaceId)) as AccountRow[];
  }
  return (await db()
    .prepare(
      `SELECT a.* FROM social_accounts a JOIN social_account_members m ON m.account_id = a.id
       WHERE a.workspace_id = ? AND m.person_id = ? ORDER BY a.network, a.name COLLATE NOCASE`,
    )
    .all(actor.workspaceId, actor.personId)) as AccountRow[];
}

export async function visibleAccountIds(actor: SocialActor): Promise<string[]> {
  return (await visibleAccountRows(actor)).map((a) => a.id);
}

export async function listAccounts(actor: SocialActor): Promise<AccountDto[]> {
  const rows = await visibleAccountRows(actor);
  if (!isSocialAdmin(actor)) return rows.map((r) => accountDto(r));
  const grants = (await db()
    .prepare('SELECT m.account_id, m.person_id FROM social_account_members m JOIN social_accounts a ON a.id = m.account_id WHERE a.workspace_id = ?')
    .all(actor.workspaceId)) as Array<{ account_id: string; person_id: string }>;
  return rows.map((r) => accountDto(r, grants.filter((g) => g.account_id === r.id).map((g) => g.person_id)));
}

async function accountRow(actor: SocialActor, id: string): Promise<AccountRow> {
  const row = (await db().prepare('SELECT * FROM social_accounts WHERE id = ? AND workspace_id = ?').get(id, actor.workspaceId)) as AccountRow | undefined;
  if (!row) throw new SocialError(404, 'not_found');
  if (!isSocialAdmin(actor)) {
    const ok = await db().prepare('SELECT 1 AS x FROM social_account_members WHERE account_id = ? AND person_id = ?').get(id, actor.personId);
    if (!ok) throw new SocialError(404, 'not_found');
  }
  return row;
}

export async function getAccount(actor: SocialActor, id: string): Promise<AccountDto> {
  return accountDto(await accountRow(actor, id));
}

/** Tokens descifrados para llamar a la API. Solo para el cron y las acciones del servidor. */
export function credsOf(r: Pick<AccountRow, 'id' | 'network' | 'kind' | 'external_id' | 'handle' | 'access_token' | 'refresh_token' | 'meta'>): AccountCreds {
  return {
    id: r.id,
    network: r.network as SocialNetwork,
    kind: r.kind,
    externalId: r.external_id,
    handle: r.handle,
    accessToken: open(r.access_token),
    refreshToken: open(r.refresh_token),
    meta: json<Record<string, unknown>>(r.meta, {}),
  };
}

export async function renameAccount(actor: SocialActor, id: string, name: string): Promise<AccountDto> {
  requireAdmin(actor);
  await accountRow(actor, id);
  await db().prepare('UPDATE social_accounts SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(name.trim().slice(0, 120), now(), id, actor.workspaceId);
  return getAccount(actor, id);
}

export async function setAccountMembers(actor: SocialActor, id: string, personIds: string[]): Promise<AccountDto> {
  requireAdmin(actor);
  await accountRow(actor, id);
  const valid: string[] = [];
  for (const p of [...new Set(personIds)].slice(0, 200)) if (await personHasSocial(actor.workspaceId, p)) valid.push(p);
  const before = ((await db().prepare('SELECT person_id FROM social_account_members WHERE account_id = ?').all(id)) as Array<{ person_id: string }>).map((r) => r.person_id);
  await db().prepare('DELETE FROM social_account_members WHERE account_id = ?').run(id);
  for (const p of valid) await db().prepare('INSERT OR IGNORE INTO social_account_members (account_id, person_id, created_at) VALUES (?, ?, ?)').run(id, p, now());
  // Quien pierde la cuenta no publica más en ella: lo suyo programado vuelve a aprobación.
  for (const p of before.filter((x) => !valid.includes(x))) await pauseAuthorPosts(actor.workspaceId, p, { accountId: id, reason: 'account_access' });
  return (await listAccounts(actor)).find((a) => a.id === id)!;
}

/** Desconecta: borra la cuenta y sus tokens. Lo publicado queda en el historial; lo pendiente falla. */
export async function disconnectAccount(actor: SocialActor, id: string): Promise<void> {
  requireAdmin(actor);
  await accountRow(actor, id);
  await db()
    .prepare(
      `UPDATE social_post_targets SET status = 'failed', error_code = 'account_disconnected', error_message = NULL, claimed_until = NULL, updated_at = ?
       WHERE account_id = ? AND status IN ('pending', 'retry', 'processing')`,
    )
    .run(now(), id);
  const posts = (await db().prepare('SELECT DISTINCT post_id FROM social_post_targets WHERE account_id = ?').all(id)) as Array<{ post_id: string }>;
  await db().prepare('DELETE FROM social_accounts WHERE id = ? AND workspace_id = ?').run(id, actor.workspaceId);
  for (const p of posts) await recomputePostStatus(p.post_id);
}

/** Guarda (o actualiza) las cuentas que devolvió la red, con los tokens cifrados. */
export async function saveDiscoveredAccounts(workspaceId: string, personId: string, accounts: DiscoveredAccount[]): Promise<string[]> {
  const ids: string[] = [];
  for (const a of accounts) {
    const t = now();
    const existing = (await db().prepare('SELECT id FROM social_accounts WHERE workspace_id = ? AND network = ? AND external_id = ?').get(workspaceId, a.network, a.externalId)) as
      | { id: string }
      | undefined;
    const id = existing?.id ?? uid();
    if (existing) {
      await db()
        .prepare(
          `UPDATE social_accounts SET kind = ?, name = ?, handle = ?, avatar_url = ?, profile_url = ?, access_token = ?, refresh_token = ?,
             token_expires_at = ?, refresh_expires_at = ?, meta = ?, status = 'connected', status_error = NULL, followers = COALESCE(?, followers),
             inbox_due_at = NULL, metrics_due_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(
          a.kind,
          a.name.slice(0, 120),
          a.handle ?? null,
          a.avatarUrl ?? null,
          a.profileUrl ?? null,
          seal(a.tokens.accessToken),
          a.tokens.refreshToken ? seal(a.tokens.refreshToken) : null,
          a.tokens.expiresAt ?? null,
          a.tokens.refreshExpiresAt ?? null,
          JSON.stringify(a.meta ?? {}),
          a.followers ?? null,
          t,
          id,
        );
    } else {
      await db()
        .prepare(
          `INSERT INTO social_accounts (id, workspace_id, network, kind, external_id, name, handle, avatar_url, profile_url, access_token, refresh_token,
             token_expires_at, refresh_expires_at, meta, status, connected_by, followers, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?)`,
        )
        .run(
          id,
          workspaceId,
          a.network,
          a.kind,
          a.externalId,
          a.name.slice(0, 120),
          a.handle ?? null,
          a.avatarUrl ?? null,
          a.profileUrl ?? null,
          seal(a.tokens.accessToken),
          a.tokens.refreshToken ? seal(a.tokens.refreshToken) : null,
          a.tokens.expiresAt ?? null,
          a.tokens.refreshExpiresAt ?? null,
          JSON.stringify(a.meta ?? {}),
          personId,
          a.followers ?? null,
          t,
          t,
        );
    }
    ids.push(id);
  }
  return ids;
}

// ---------- OAuth ----------

export interface NetworkStatus {
  network: SocialNetwork;
  name: string;
  configured: boolean;
  /** Cómo se conecta: OAuth con la app del admin, o contraseña de app (Bluesky). */
  method: 'oauth' | 'app_password';
  env: string[];
}

export function networkStatuses(): NetworkStatus[] {
  return (Object.keys(NETWORK_SPECS) as SocialNetwork[]).map((n) => ({
    network: n,
    name: NETWORK_SPECS[n].name,
    configured: networkConfigured(n),
    method: NETWORK_SPECS[n].env ? 'oauth' : 'app_password',
    env: NETWORK_SPECS[n].env ?? [],
  }));
}

/** URL exacta registrada en cada app de desarrollador (una sola para todas las redes). */
export function oauthRedirectUri(): string {
  return `${(process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '')}/api/social/oauth/callback`;
}

const STATE_TTL_MS = 10 * 60_000;

/** Arranca el OAuth: guarda state (y el verifier PKCE cifrado) y devuelve la URL de la red. */
export async function startOAuth(actor: SocialActor, network: SocialNetwork): Promise<string> {
  requireAdmin(actor);
  if (!networkConfigured(network)) throw new SocialError(400, 'not_configured');
  const provider = providerFor(network);
  if (network === 'bluesky') throw new SocialError(400, 'app_password');
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const pkce = provider.usesPkce ? pkcePair() : null;
  const t = Date.now();
  await db().prepare('DELETE FROM social_oauth_states WHERE expires_at < ?').run(new Date(t).toISOString());
  await db()
    .prepare('INSERT INTO social_oauth_states (state, workspace_id, person_id, network, verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(state, actor.workspaceId, actor.personId, network, pkce ? seal(pkce.verifier) : null, new Date(t).toISOString(), new Date(t + STATE_TTL_MS).toISOString());
  return provider.authorizeUrl({ network, state, redirectUri: oauthRedirectUri(), challenge: pkce?.challenge ?? null });
}

/**
 * Vuelta del OAuth: el state tiene que existir, no estar vencido y ser de la
 * misma persona y workspace (se consume una sola vez). Devuelve la red y
 * cuántas cuentas se conectaron.
 */
export async function finishOAuth(actor: SocialActor, state: string, code: string): Promise<{ network: SocialNetwork; count: number }> {
  if (!/^[a-f0-9]{64}$/.test(state)) throw new SocialError(400, 'invalid_state');
  const row = (await db().prepare('SELECT * FROM social_oauth_states WHERE state = ?').get(state)) as
    | { workspace_id: string; person_id: string; network: string; verifier: string | null; expires_at: string }
    | undefined;
  // Un state ajeno no se consume (si no, otra persona podría arruinarle la conexión a quien la empezó).
  if (!row || row.workspace_id !== actor.workspaceId || row.person_id !== actor.personId || !isSocialNetwork(row.network)) throw new SocialError(400, 'invalid_state');
  const del = await db().prepare('DELETE FROM social_oauth_states WHERE state = ? AND workspace_id = ? AND person_id = ?').run(state, actor.workspaceId, actor.personId);
  if (del.changes !== 1) throw new SocialError(400, 'invalid_state');
  if (row.expires_at < now()) throw new SocialError(400, 'state_expired');
  requireAdmin(actor);
  const network = row.network;
  let accounts: DiscoveredAccount[];
  try {
    accounts = await providerFor(network).exchange({ network, code, redirectUri: oauthRedirectUri(), verifier: row.verifier ? open(row.verifier) : null });
  } catch (err) {
    if (err instanceof SocialApiError) throw new SocialError(502, 'oauth_failed', { message: err.message });
    throw err;
  }
  if (!accounts.length) throw new SocialError(400, 'no_accounts_found');
  await saveDiscoveredAccounts(actor.workspaceId, actor.personId, accounts);
  return { network, count: accounts.length };
}

/** La persona canceló en la red: el state se descarta (solo el propio). */
export async function discardOAuthState(actor: SocialActor, state: string): Promise<void> {
  await db().prepare('DELETE FROM social_oauth_states WHERE state = ? AND workspace_id = ? AND person_id = ?').run(state, actor.workspaceId, actor.personId);
}

/** Bluesky: identificador + contraseña de app (la contraseña no se guarda, solo los tokens de la sesión). */
export async function connectBluesky(actor: SocialActor, identifier: string, password: string): Promise<AccountDto[]> {
  requireAdmin(actor);
  let account: DiscoveredAccount;
  try {
    account = socialFake() ? await fakeBlueskySession(identifier, password) : await blueskySession(identifier, password);
  } catch (err) {
    if (err instanceof SocialApiError) throw new SocialError(400, 'bluesky_login_failed', { message: err.message });
    throw err;
  }
  const [id] = await saveDiscoveredAccounts(actor.workspaceId, actor.personId, [account]);
  return [await getAccount(actor, id)];
}

// ---------- Publicaciones ----------

interface PostRow {
  id: string;
  workspace_id: string;
  created_by: string;
  text: string;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  first_comment: string | null;
  media: string;
  link_url: string | null;
  short_url: string | null;
  approval_by: string | null;
  approval_at: string | null;
  approval_comment: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TargetRow {
  id: string;
  post_id: string;
  account_id: string;
  text_override: string | null;
  status: TargetStatus;
  attempts: number;
  next_attempt_at: string | null;
  external_id: string | null;
  external_url: string | null;
  error_code: string | null;
  error_message: string | null;
  published_at: string | null;
  comment_status: string | null;
  impressions: number | null;
  reach: number | null;
  engagement: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  views: number | null;
  metrics_at: string | null;
}

export interface TargetDto {
  id: string;
  accountId: string;
  account: Pick<AccountDto, 'id' | 'name' | 'network' | 'networkName' | 'handle' | 'status'> | null;
  textOverride: string | null;
  status: TargetStatus;
  attempts: number;
  nextAttemptAt: string | null;
  externalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  commentStatus: string | null;
  metrics: { impressions: number | null; reach: number | null; engagement: number | null; likes: number | null; comments: number | null; shares: number | null; clicks: number | null; views: number | null; at: string | null };
}

export interface PostDto {
  id: string;
  text: string;
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  firstComment: string | null;
  media: MediaItem[];
  linkUrl: string | null;
  shortUrl: string | null;
  createdBy: string;
  createdByName: string | null;
  approval: { by: string | null; byName: string | null; at: string | null; comment: string | null } | null;
  targets: TargetDto[];
  createdAt: string;
  updatedAt: string;
  /** La persona puede editarla (autora o admin, y todas las cuentas a su alcance). */
  canEdit: boolean;
  canApprove: boolean;
}

export interface PostEvent {
  id: string;
  kind: string;
  body: string | null;
  personName: string | null;
  createdAt: string;
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = (await db().prepare(`SELECT id, COALESCE(name, email) AS name FROM users WHERE id IN (${unique.map(() => '?').join(',')})`).all(...unique)) as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function postDtos(actor: SocialActor, posts: PostRow[]): Promise<PostDto[]> {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const targets = (await db().prepare(`SELECT * FROM social_post_targets WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).all(...ids)) as TargetRow[];
  const accounts = (await db().prepare('SELECT * FROM social_accounts WHERE workspace_id = ?').all(actor.workspaceId)) as AccountRow[];
  const accMap = new Map(accounts.map((a) => [a.id, accountDto(a)]));
  const visible = new Set(await visibleAccountIds(actor));
  const admin = isSocialAdmin(actor);
  const people = await names(posts.flatMap((p) => [p.created_by, p.approval_by ?? '']));
  return posts.map((p) => {
    const ts = targets.filter((t) => t.post_id === p.id);
    const canEdit =
      (admin || p.created_by === actor.personId) && ts.every((t) => visible.has(t.account_id)) && !['publishing', 'published', 'partial'].includes(p.status);
    return {
      id: p.id,
      text: p.text,
      status: p.status,
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      firstComment: p.first_comment,
      media: json<MediaItem[]>(p.media, []),
      linkUrl: p.link_url,
      shortUrl: p.short_url,
      createdBy: p.created_by,
      createdByName: people.get(p.created_by) ?? null,
      approval: p.approval_by || p.approval_comment ? { by: p.approval_by, byName: p.approval_by ? (people.get(p.approval_by) ?? null) : null, at: p.approval_at, comment: p.approval_comment } : null,
      targets: ts.map((t) => {
        const a = accMap.get(t.account_id);
        return {
          id: t.id,
          accountId: t.account_id,
          account: a ? { id: a.id, name: a.name, network: a.network, networkName: a.networkName, handle: a.handle, status: a.status } : null,
          textOverride: t.text_override,
          status: t.status,
          attempts: t.attempts,
          nextAttemptAt: t.next_attempt_at,
          externalUrl: t.external_url,
          errorCode: t.error_code,
          errorMessage: t.error_message,
          publishedAt: t.published_at,
          commentStatus: t.comment_status,
          metrics: { impressions: t.impressions, reach: t.reach, engagement: t.engagement, likes: t.likes, comments: t.comments, shares: t.shares, clicks: t.clicks, views: t.views, at: t.metrics_at },
        };
      }),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      canEdit,
      canApprove: admin && p.status === 'pending_approval',
    };
  });
}

/** Condición SQL de las publicaciones que ve la persona (propias o a sus cuentas). */
function postScope(actor: SocialActor, alias = 'p'): { sql: string; args: string[] } {
  if (isSocialAdmin(actor)) return { sql: `${alias}.workspace_id = ?`, args: [actor.workspaceId] };
  return {
    sql: `${alias}.workspace_id = ? AND (${alias}.created_by = ? OR EXISTS (
      SELECT 1 FROM social_post_targets st JOIN social_account_members sm ON sm.account_id = st.account_id
      WHERE st.post_id = ${alias}.id AND sm.person_id = ?))`,
    args: [actor.workspaceId, actor.personId, actor.personId],
  };
}

export interface ListPostsOptions {
  from?: string;
  to?: string;
  status?: PostStatus | 'scheduled_any' | 'needs_approval';
  accountId?: string;
  q?: string;
  limit?: number;
}

export async function listPosts(actor: SocialActor, opts: ListPostsOptions = {}): Promise<PostDto[]> {
  const scope = postScope(actor);
  const where = [scope.sql];
  const args: Array<string | number> = [...scope.args];
  // Fecha de calendario: la de publicación si salió, si no la programada (o la de creación de un borrador sin fecha).
  const when = 'COALESCE(p.published_at, p.scheduled_at, p.created_at)';
  if (opts.from) {
    where.push(`${when} >= ?`);
    args.push(opts.from);
  }
  if (opts.to) {
    where.push(`${when} < ?`);
    args.push(opts.to);
  }
  if (opts.status === 'needs_approval') where.push("p.status = 'pending_approval'");
  else if (opts.status === 'scheduled_any') where.push("p.status IN ('scheduled', 'publishing')");
  else if (opts.status) {
    where.push('p.status = ?');
    args.push(opts.status);
  }
  if (opts.accountId) {
    where.push('EXISTS (SELECT 1 FROM social_post_targets x WHERE x.post_id = p.id AND x.account_id = ?)');
    args.push(opts.accountId);
  }
  if (opts.q?.trim()) {
    where.push("p.text LIKE ? ESCAPE '\\'");
    args.push(`%${opts.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  const rows = (await db()
    .prepare(`SELECT p.* FROM social_posts p WHERE ${where.join(' AND ')} ORDER BY ${when} DESC LIMIT ?`)
    .all(...args, Math.min(Math.max(opts.limit ?? 200, 1), 500))) as PostRow[];
  return postDtos(actor, rows);
}

async function postRow(actor: SocialActor, id: string): Promise<PostRow> {
  const scope = postScope(actor);
  const row = (await db().prepare(`SELECT p.* FROM social_posts p WHERE p.id = ? AND ${scope.sql}`).get(id, ...scope.args)) as PostRow | undefined;
  if (!row) throw new SocialError(404, 'not_found');
  return row;
}

export async function getPost(actor: SocialActor, id: string): Promise<PostDto> {
  const [dto] = await postDtos(actor, [await postRow(actor, id)]);
  return dto;
}

export async function listPostEvents(actor: SocialActor, id: string): Promise<PostEvent[]> {
  await postRow(actor, id);
  const rows = (await db()
    .prepare(
      `SELECT e.id, e.kind, e.body, e.created_at, COALESCE(u.name, u.email) AS person_name FROM social_post_events e
       LEFT JOIN users u ON u.id = e.person_id WHERE e.post_id = ? ORDER BY e.created_at`,
    )
    .all(id)) as Array<{ id: string; kind: string; body: string | null; created_at: string; person_name: string | null }>;
  return rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, personName: r.person_name, createdAt: r.created_at }));
}

async function addEvent(postId: string, personId: string | null, kind: string, body: string | null = null) {
  await db().prepare('INSERT INTO social_post_events (id, post_id, person_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid(), postId, personId, kind, body, now());
}

export interface PostInput {
  text: string;
  accountIds: string[];
  overrides?: Record<string, string | null>;
  media?: MediaItem[];
  firstComment?: string | null;
  linkUrl?: string | null;
  shortUrl?: string | null;
  /** draft = guardar; schedule = en scheduledAt; now = ya; queue = próximo horario libre de la cola. */
  action: 'draft' | 'schedule' | 'now' | 'queue';
  scheduledAt?: string | null;
}

export interface TargetIssues {
  accountId: string;
  network: SocialNetwork;
  issues: ValidationIssue[];
}

/** Lo que impide publicar en cada cuenta (vacío = se puede). */
export function validatePost(accounts: Array<{ id: string; network: SocialNetwork }>, input: Pick<PostInput, 'text' | 'overrides' | 'media'>): TargetIssues[] {
  return accounts
    .map((a) => ({ accountId: a.id, network: a.network, issues: validateForNetwork(a.network, textFor(input.text, input.overrides?.[a.id]), input.media ?? []) }))
    .filter((t) => t.issues.length);
}

/** El próximo horario libre de la cola entre las cuentas elegidas. */
export async function nextQueueTime(workspaceId: string, accountIds: string[], from = new Date()): Promise<Date | null> {
  if (!accountIds.length) return null;
  const marks = accountIds.map(() => '?').join(',');
  const slots = (await db().prepare(`SELECT account_id, weekday, minute, tz FROM social_slots WHERE workspace_id = ? AND account_id IN (${marks})`).all(workspaceId, ...accountIds)) as Array<
    Slot & { account_id: string }
  >;
  const taken = (await db()
    .prepare(
      `SELECT t.account_id, p.scheduled_at FROM social_post_targets t JOIN social_posts p ON p.id = t.post_id
       WHERE t.account_id IN (${marks}) AND p.status IN ('scheduled', 'pending_approval', 'publishing') AND p.scheduled_at >= ?`,
    )
    .all(...accountIds, from.toISOString())) as Array<{ account_id: string; scheduled_at: string }>;
  let best: Date | null = null;
  for (const accountId of accountIds) {
    const own = slots.filter((s) => s.account_id === accountId);
    const [next] = nextSlots(own, from, taken.filter((t) => t.account_id === accountId).map((t) => new Date(t.scheduled_at).getTime()), 1);
    if (next && (!best || next < best)) best = next;
  }
  return best;
}

async function checkAccounts(actor: SocialActor, accountIds: string[]): Promise<AccountRow[]> {
  const ids = [...new Set(accountIds)].slice(0, 50);
  const visible = await visibleAccountRows(actor);
  const rows = ids.map((id) => visible.find((a) => a.id === id));
  if (rows.some((r) => !r)) throw new SocialError(403, 'account_not_allowed');
  return rows as AccountRow[];
}

function cleanMedia(media: MediaItem[] | undefined): MediaItem[] {
  return (media ?? []).slice(0, 20).map((m) => ({
    url: String(m.url).slice(0, 1000),
    type: m.type === 'video' ? 'video' : 'image',
    mime: String(m.mime ?? '').slice(0, 80),
    size: Math.max(0, Number(m.size) || 0),
    name: m.name ? String(m.name).slice(0, 200) : undefined,
    width: m.width ? Number(m.width) : null,
    height: m.height ? Number(m.height) : null,
    duration: m.duration ? Number(m.duration) : null,
  }));
}

/**
 * Media de una publicación: solo archivos que este workspace subió por
 * Social (social_media guarda cada subida). Nada de URLs de afuera que
 * después bajaría el servidor, ni archivos de otro workspace.
 */
async function assertOwnMedia(workspaceId: string, media: MediaItem[]) {
  for (const m of media) {
    const row = await db().prepare('SELECT 1 AS x FROM social_media WHERE url = ? AND workspace_id = ?').get(m.url, workspaceId);
    if (!row) throw new SocialError(400, 'invalid_media');
  }
}

/** Registra una subida de Social (la ruta de subida la llama después de guardar el archivo). */
export async function registerMedia(actor: SocialActor, item: MediaItem): Promise<void> {
  await db()
    .prepare('INSERT OR IGNORE INTO social_media (id, workspace_id, url, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), actor.workspaceId, item.url, item.mime, item.size, actor.personId, now());
}

/** ¿El archivo es una subida de Social? (readMedia no baja nada que no esté acá). */
export async function isRegisteredMedia(url: string): Promise<boolean> {
  return Boolean(await db().prepare('SELECT 1 AS x FROM social_media WHERE url = ?').get(url));
}

async function approvers(workspaceId: string): Promise<string[]> {
  const rows = (await db()
    .prepare(
      `SELECT DISTINCT m.user_id AS id FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.role IN ('admin', 'owner')`,
    )
    .all(workspaceId)) as Array<{ id: string }>;
  return [workspaceId, ...rows.map((r) => r.id).filter((id) => id !== workspaceId)];
}

function snippet(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57)}...` : one || '(media)';
}

async function notifyPost(userId: string, type: 'social_approval' | 'social_approved' | 'social_rejected' | 'social_failed', post: { id: string; text: string }, meta: Record<string, unknown> = {}) {
  await createNotification({
    userId,
    type,
    title: snippet(post.text),
    href: `/app/social/posts/${post.id}`,
    sourceType: 'social_post',
    sourceId: post.id,
    meta: { postText: snippet(post.text), ...meta },
  }).catch(() => undefined);
}

/** Guarda una publicación nueva o editada y la deja en borrador, pendiente de aprobación o programada. */
async function savePost(actor: SocialActor, input: PostInput, existing: PostRow | null): Promise<PostDto> {
  const text = String(input.text ?? '').slice(0, 70_000);
  const accounts = await checkAccounts(actor, input.accountIds);
  const media = cleanMedia(input.media);
  await assertOwnMedia(actor.workspaceId, media);
  const overrides: Record<string, string | null> = {};
  for (const a of accounts) {
    const o = input.overrides?.[a.id];
    overrides[a.id] = o != null && o !== '' ? String(o).slice(0, 70_000) : null;
  }
  const role = await socialRoleOf(actor);
  let status: PostStatus = 'draft';
  let scheduledAt: string | null = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null;
  if (input.scheduledAt && Number.isNaN(new Date(input.scheduledAt).getTime())) throw new SocialError(400, 'invalid_date');
  if (input.action !== 'draft') {
    if (!accounts.length) throw new SocialError(400, 'no_accounts');
    const issues = validatePost(
      accounts.map((a) => ({ id: a.id, network: a.network as SocialNetwork })),
      { text, overrides, media },
    );
    if (issues.length) throw new SocialError(400, 'validation', issues);
    const broken = accounts.find((a) => a.status !== 'connected');
    if (broken) throw new SocialError(400, 'account_needs_reconnect', { accountId: broken.id });
    if (input.action === 'now') scheduledAt = now();
    else if (input.action === 'queue') {
      const next = await nextQueueTime(actor.workspaceId, accounts.map((a) => a.id));
      if (!next) throw new SocialError(400, 'no_queue_slots');
      scheduledAt = next.toISOString();
    } else if (!scheduledAt) throw new SocialError(400, 'invalid_date');
    else if (new Date(scheduledAt).getTime() < Date.now() - 60_000) throw new SocialError(400, 'date_in_past');
    status = role === 'drafter' ? 'pending_approval' : 'scheduled';
  }
  const t = now();
  const id = existing?.id ?? uid();
  const firstComment = input.firstComment?.trim() ? input.firstComment.trim().slice(0, 8000) : null;
  if (existing) {
    await db()
      .prepare(
        `UPDATE social_posts SET text = ?, status = ?, scheduled_at = ?, first_comment = ?, media = ?, link_url = ?, short_url = ?,
           submitted_at = CASE WHEN ? = 'pending_approval' THEN ? ELSE submitted_at END,
           approval_by = CASE WHEN ? = 'pending_approval' THEN NULL ELSE approval_by END,
           approval_at = CASE WHEN ? = 'pending_approval' THEN NULL ELSE approval_at END,
           approval_comment = CASE WHEN ? = 'pending_approval' THEN NULL ELSE approval_comment END,
           updated_at = ? WHERE id = ?`,
      )
      .run(text, status, scheduledAt, firstComment, JSON.stringify(media), input.linkUrl ?? null, input.shortUrl ?? null, status, t, status, status, status, t, id);
    await db()
      .prepare(`DELETE FROM social_post_targets WHERE post_id = ? AND account_id NOT IN (${accounts.map(() => '?').join(',') || "''"})`)
      .run(id, ...accounts.map((a) => a.id));
  } else {
    await db()
      .prepare(
        `INSERT INTO social_posts (id, workspace_id, created_by, text, status, scheduled_at, first_comment, media, link_url, short_url, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, actor.workspaceId, actor.personId, text, status, scheduledAt, firstComment, JSON.stringify(media), input.linkUrl ?? null, input.shortUrl ?? null, status === 'pending_approval' ? t : null, t, t);
    await addEvent(id, actor.personId, 'created');
  }
  for (const a of accounts) {
    await db()
      .prepare(
        `INSERT INTO social_post_targets (id, post_id, account_id, workspace_id, text_override, status, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
         ON CONFLICT(post_id, account_id) DO UPDATE SET text_override = excluded.text_override, status = 'pending', attempts = 0,
           next_attempt_at = excluded.next_attempt_at, error_code = NULL, error_message = NULL, claimed_until = NULL, publish_ref = NULL, updated_at = excluded.updated_at`,
      )
      .run(uid(), id, a.id, actor.workspaceId, overrides[a.id], scheduledAt, t, t);
  }
  if (status === 'pending_approval') {
    await addEvent(id, actor.personId, 'submitted');
    for (const approver of await approvers(actor.workspaceId)) {
      if (approver !== actor.personId) await notifyPost(approver, 'social_approval', { id, text });
    }
  } else if (status === 'scheduled') {
    await addEvent(id, actor.personId, input.action === 'now' ? 'publish_now' : 'scheduled', scheduledAt);
  }
  return getPost(actor, id);
}

export async function createPost(actor: SocialActor, input: PostInput): Promise<PostDto> {
  return savePost(actor, input, null);
}

async function editableRow(actor: SocialActor, id: string): Promise<PostRow> {
  const row = await postRow(actor, id);
  const [dto] = await postDtos(actor, [row]);
  if (!dto.canEdit) throw new SocialError(403, ['publishing', 'published', 'partial'].includes(row.status) ? 'already_published' : 'not_allowed');
  return row;
}

export async function updatePost(actor: SocialActor, id: string, input: PostInput): Promise<PostDto> {
  const row = await editableRow(actor, id);
  return savePost(actor, input, row);
}

/** Arrastrar en el calendario: cambia la fecha sin tocar el resto. */
export async function reschedulePost(actor: SocialActor, id: string, scheduledAt: string): Promise<PostDto> {
  const row = await editableRow(actor, id);
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) throw new SocialError(400, 'invalid_date');
  if (row.status !== 'draft' && at.getTime() < Date.now() - 60_000) throw new SocialError(400, 'date_in_past');
  const iso = at.toISOString();
  const t = now();
  await db().prepare('UPDATE social_posts SET scheduled_at = ?, updated_at = ? WHERE id = ?').run(iso, t, id);
  await db().prepare("UPDATE social_post_targets SET next_attempt_at = ?, updated_at = ? WHERE post_id = ? AND status IN ('pending', 'retry')").run(iso, t, id);
  await addEvent(id, actor.personId, 'rescheduled', iso);
  // Lo aprobado se aprobó con esa fecha: si quien necesita aprobación la cambia, vuelve a revisión.
  if (row.status === 'scheduled' && (await socialRoleOf(actor)) === 'drafter') await sendBackToApproval(row.id, actor.personId, 'rescheduled');
  return getPost(actor, id);
}

/** Borra la publicación de zerosoft (lo ya publicado en la red queda allá). */
export async function deletePost(actor: SocialActor, id: string): Promise<void> {
  const row = await postRow(actor, id);
  if (!isSocialAdmin(actor) && row.created_by !== actor.personId) throw new SocialError(403, 'not_allowed');
  if (row.status === 'publishing') throw new SocialError(409, 'publishing');
  await db().prepare('DELETE FROM social_posts WHERE id = ? AND workspace_id = ?').run(id, actor.workspaceId);
}

export async function approvePost(actor: SocialActor, id: string, comment?: string | null): Promise<PostDto> {
  requireAdmin(actor);
  const row = await postRow(actor, id);
  if (row.status !== 'pending_approval') throw new SocialError(409, 'not_pending');
  const t = now();
  const due = !row.scheduled_at || new Date(row.scheduled_at).getTime() < Date.now() ? t : row.scheduled_at;
  const res = await db()
    .prepare("UPDATE social_posts SET status = 'scheduled', scheduled_at = ?, approval_by = ?, approval_at = ?, approval_comment = ?, updated_at = ? WHERE id = ? AND status = 'pending_approval'")
    .run(due, actor.personId, t, comment?.trim() ? comment.trim().slice(0, 2000) : null, t, id);
  if (res.changes !== 1) throw new SocialError(409, 'not_pending');
  await db().prepare("UPDATE social_post_targets SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE post_id = ?").run(due, t, id);
  await addEvent(id, actor.personId, 'approved', comment?.trim() || null);
  if (row.created_by !== actor.personId) await notifyPost(row.created_by, 'social_approved', row, { comment: comment?.trim() || null });
  return getPost(actor, id);
}

export async function rejectPost(actor: SocialActor, id: string, comment: string): Promise<PostDto> {
  requireAdmin(actor);
  const text = comment.trim().slice(0, 2000);
  if (!text) throw new SocialError(400, 'comment_required');
  const row = await postRow(actor, id);
  if (row.status !== 'pending_approval') throw new SocialError(409, 'not_pending');
  const t = now();
  const res = await db()
    .prepare("UPDATE social_posts SET status = 'rejected', approval_by = ?, approval_at = ?, approval_comment = ?, updated_at = ? WHERE id = ? AND status = 'pending_approval'")
    .run(actor.personId, t, text, t, id);
  if (res.changes !== 1) throw new SocialError(409, 'not_pending');
  await addEvent(id, actor.personId, 'rejected', text);
  if (row.created_by !== actor.personId) await notifyPost(row.created_by, 'social_rejected', row, { comment: text });
  return getPost(actor, id);
}

/** Reintenta un destino que falló (por ejemplo después de reconectar la cuenta). */
export async function retryTarget(actor: SocialActor, postId: string, targetId: string): Promise<PostDto> {
  const row = await postRow(actor, postId);
  if (!isSocialAdmin(actor) && row.created_by !== actor.personId) throw new SocialError(403, 'not_allowed');
  const target = (await db().prepare('SELECT account_id FROM social_post_targets WHERE id = ? AND post_id = ?').get(targetId, postId)) as { account_id: string } | undefined;
  if (!target || !(await visibleAccountIds(actor)).includes(target.account_id)) throw new SocialError(403, 'account_not_allowed');
  const t = now();
  const res = await db()
    .prepare(
      `UPDATE social_post_targets SET status = 'pending', attempts = 0, next_attempt_at = ?, error_code = NULL, error_message = NULL, claimed_until = NULL, updated_at = ?
       WHERE id = ? AND post_id = ? AND status = 'failed' AND account_id IN (SELECT id FROM social_accounts WHERE workspace_id = ?)`,
    )
    .run(t, t, targetId, postId, actor.workspaceId);
  if (res.changes !== 1) throw new SocialError(409, 'not_failed');
  await db().prepare("UPDATE social_posts SET status = 'publishing', updated_at = ? WHERE id = ?").run(t, postId);
  await addEvent(postId, actor.personId, 'retry');
  return getPost(actor, postId);
}

/**
 * Vuelve a aprobación una publicación programada: limpia la aprobación
 * anterior, deja el evento y avisa a los admins. Compare-and-set sobre el
 * estado: si ya se está publicando, no la toca.
 */
export async function sendBackToApproval(postId: string, personId: string | null, reason: string): Promise<boolean> {
  const t = now();
  const res = await db()
    .prepare(
      `UPDATE social_posts SET status = 'pending_approval', submitted_at = ?, approval_by = NULL, approval_at = NULL, approval_comment = NULL, updated_at = ?
       WHERE id = ? AND status = 'scheduled'`,
    )
    .run(t, t, postId);
  if (res.changes !== 1) return false;
  const post = (await db().prepare('SELECT id, text, workspace_id FROM social_posts WHERE id = ?').get(postId)) as { id: string; text: string; workspace_id: string };
  await addEvent(postId, personId, 'back_to_approval', reason);
  for (const approver of await approvers(post.workspace_id)) {
    if (approver !== personId) await notifyPost(approver, 'social_approval', post, { reason });
  }
  return true;
}

/**
 * La persona ya no puede publicar (salió del workspace, perdió Social o una
 * cuenta): lo que dejó programado y todavía no salió vuelve a aprobación.
 * Con `accountId`, solo lo que va a esa cuenta.
 */
export async function pauseAuthorPosts(workspaceId: string, personId: string, opts: { accountId?: string; reason: string }): Promise<number> {
  if (personId === workspaceId) return 0;
  const rows = (await db()
    .prepare(
      `SELECT p.id FROM social_posts p WHERE p.workspace_id = ? AND p.created_by = ? AND p.status = 'scheduled'
         AND EXISTS (SELECT 1 FROM social_post_targets t WHERE t.post_id = p.id AND t.status IN ('pending', 'retry')${opts.accountId ? ' AND t.account_id = ?' : ''})`,
    )
    .all(...[workspaceId, personId, ...(opts.accountId ? [opts.accountId] : [])])) as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) if (await sendBackToApproval(r.id, null, opts.reason)) n++;
  return n;
}

/**
 * ¿Esta persona puede publicar hoy en esta cuenta? Owner siempre; si no,
 * tiene que seguir en el workspace con Social y, si no es admin, tener la
 * cuenta. Lo usa el cron antes de publicar (la persona que responde por la
 * publicación es quien la aprobó, o quien la creó si no pasó por aprobación).
 */
export async function personMayPublish(workspaceId: string, personId: string, accountId: string): Promise<boolean> {
  if (personId === workspaceId) return true;
  const access = await personHasSocial(workspaceId, personId);
  if (!access) return false;
  if (roleAtLeast(access.role, 'admin')) return true;
  return Boolean(await db().prepare('SELECT 1 AS x FROM social_account_members WHERE account_id = ? AND person_id = ?').get(accountId, personId));
}

/** Estado de la publicación a partir de sus destinos. */
export async function recomputePostStatus(postId: string): Promise<void> {
  const post = (await db().prepare('SELECT status, created_by, text, workspace_id FROM social_posts WHERE id = ?').get(postId)) as
    | { status: PostStatus; created_by: string; text: string; workspace_id: string }
    | undefined;
  if (!post || !['scheduled', 'publishing', 'published', 'partial', 'failed'].includes(post.status)) return;
  const ts = (await db().prepare('SELECT status, published_at FROM social_post_targets WHERE post_id = ?').all(postId)) as Array<{ status: TargetStatus; published_at: string | null }>;
  if (!ts.length) return;
  const open = ts.some((t) => ['pending', 'publishing', 'processing', 'retry'].includes(t.status));
  const published = ts.filter((t) => t.status === 'published');
  const failed = ts.filter((t) => t.status === 'failed');
  let next: PostStatus = post.status;
  if (open) next = post.status === 'scheduled' && !ts.some((t) => t.status !== 'pending') ? 'scheduled' : 'publishing';
  else if (failed.length === 0) next = 'published';
  else if (published.length === 0) next = 'failed';
  else next = 'partial';
  const publishedAt = published.map((t) => t.published_at ?? '').sort().pop() || null;
  if (next !== post.status) {
    await db().prepare('UPDATE social_posts SET status = ?, published_at = COALESCE(?, published_at), updated_at = ? WHERE id = ?').run(next, publishedAt, now(), postId);
    if ((next === 'failed' || next === 'partial') && post.status !== next) {
      await addEvent(postId, null, next === 'failed' ? 'failed' : 'partial');
      await notifyPost(post.created_by, 'social_failed', { id: postId, text: post.text }, { partial: next === 'partial' });
    }
    if (next === 'published') await addEvent(postId, null, 'published');
  }
}

// ---------- Cola ----------

export async function listSlots(actor: SocialActor, accountId: string): Promise<Slot[]> {
  await accountRow(actor, accountId);
  return (await db().prepare('SELECT weekday, minute, tz FROM social_slots WHERE account_id = ? ORDER BY weekday, minute').all(accountId)) as Slot[];
}

export async function setSlots(actor: SocialActor, accountId: string, slots: Slot[]): Promise<Slot[]> {
  await accountRow(actor, accountId);
  const clean = slots
    .filter((s) => Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && Number.isInteger(s.minute) && s.minute >= 0 && s.minute < 1440)
    .slice(0, 100);
  await db().prepare('DELETE FROM social_slots WHERE account_id = ?').run(accountId);
  for (const s of clean) {
    await db()
      .prepare('INSERT OR IGNORE INTO social_slots (id, account_id, workspace_id, weekday, minute, tz, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), accountId, actor.workspaceId, s.weekday, s.minute, String(s.tz || 'UTC').slice(0, 64), now());
  }
  return listSlots(actor, accountId);
}

// ---------- Biblioteca ----------

export type LibraryKind = 'snippet' | 'hashtags' | 'asset';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  body: string;
  media: MediaItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const libDto = (r: { id: string; kind: string; name: string; body: string; media: string; created_by: string; created_at: string; updated_at: string }): LibraryItem => ({
  id: r.id,
  kind: (['snippet', 'hashtags', 'asset'].includes(r.kind) ? r.kind : 'snippet') as LibraryKind,
  name: r.name,
  body: r.body,
  media: json<MediaItem[]>(r.media, []),
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listLibrary(actor: SocialActor, kind?: LibraryKind, q?: string): Promise<LibraryItem[]> {
  const where = ['workspace_id = ?'];
  const args: string[] = [actor.workspaceId];
  if (kind) {
    where.push('kind = ?');
    args.push(kind);
  }
  if (q?.trim()) {
    where.push("(name LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    const like = `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like);
  }
  const rows = (await db().prepare(`SELECT * FROM social_library WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`).all(...args)) as Parameters<typeof libDto>[0][];
  return rows.map(libDto);
}

export async function getLibraryItem(actor: SocialActor, id: string): Promise<LibraryItem> {
  const r = (await db().prepare('SELECT * FROM social_library WHERE id = ? AND workspace_id = ?').get(id, actor.workspaceId)) as Parameters<typeof libDto>[0] | undefined;
  if (!r) throw new SocialError(404, 'not_found');
  return libDto(r);
}

export async function createLibraryItem(actor: SocialActor, input: { kind: LibraryKind; name: string; body?: string; media?: MediaItem[] }): Promise<LibraryItem> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new SocialError(400, 'name_required');
  const media = cleanMedia(input.media);
  await assertOwnMedia(actor.workspaceId, media);
  const id = uid();
  const t = now();
  await db()
    .prepare('INSERT INTO social_library (id, workspace_id, kind, name, body, media, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, input.kind, name, String(input.body ?? '').slice(0, 10_000), JSON.stringify(media), actor.personId, t, t);
  return getLibraryItem(actor, id);
}

export async function updateLibraryItem(actor: SocialActor, id: string, input: { name?: string; body?: string; media?: MediaItem[] }): Promise<LibraryItem> {
  const item = await getLibraryItem(actor, id);
  if (!isSocialAdmin(actor) && item.createdBy !== actor.personId) throw new SocialError(403, 'not_allowed');
  const name = input.name !== undefined ? input.name.trim().slice(0, 120) : item.name;
  if (!name) throw new SocialError(400, 'name_required');
  const media = input.media !== undefined ? cleanMedia(input.media) : item.media;
  await assertOwnMedia(actor.workspaceId, media);
  await db()
    .prepare('UPDATE social_library SET name = ?, body = ?, media = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(name, input.body !== undefined ? String(input.body).slice(0, 10_000) : item.body, JSON.stringify(media), now(), id, actor.workspaceId);
  return getLibraryItem(actor, id);
}

export async function deleteLibraryItem(actor: SocialActor, id: string): Promise<void> {
  const item = await getLibraryItem(actor, id);
  if (!isSocialAdmin(actor) && item.createdBy !== actor.personId) throw new SocialError(403, 'not_allowed');
  await db().prepare('DELETE FROM social_library WHERE id = ? AND workspace_id = ?').run(id, actor.workspaceId);
}

// ---------- Contadores para el sidebar y el inicio ----------

export async function socialCounts(actor: SocialActor): Promise<{ approvals: number; inbox: number; failed: number }> {
  const scope = postScope(actor);
  const ids = await visibleAccountIds(actor);
  const approvals = isSocialAdmin(actor)
    ? Number(((await db().prepare("SELECT COUNT(*) AS n FROM social_posts p WHERE p.workspace_id = ? AND p.status = 'pending_approval'").get(actor.workspaceId)) as { n: number }).n)
    : 0;
  const failed = Number(((await db().prepare(`SELECT COUNT(*) AS n FROM social_posts p WHERE ${scope.sql} AND p.status IN ('failed', 'partial')`).get(...scope.args)) as { n: number }).n);
  const inbox = ids.length
    ? Number(
        ((await db().prepare(`SELECT COUNT(*) AS n FROM social_inbox WHERE workspace_id = ? AND status = 'open' AND account_id IN (${ids.map(() => '?').join(',')})`).get(actor.workspaceId, ...ids)) as {
          n: number;
        }).n,
      )
    : 0;
  return { approvals, inbox, failed };
}
