/**
 * Track ↔ Linear en vivo, para mudarse de Linear sin cortar: un import
 * completo (el importador de lib/track-linear-import.ts, reanudable) y
 * después los cambios en los dos sentidos.
 *
 * Conexión: una por workspace en track_integrations (provider 'linear'), con
 * el token cifrado (lib/secret-box): OAuth ("Login with Linear", scopes
 * read,write) o una API key personal. La config elige teams, sentido
 * (two_way, import = solo Linear → Track, push = solo Track → Linear) y pausa.
 * Lo que cambia el cron (fase, cursor, claim) vive en track_linear_sync_state.
 *
 * Linear → Track: webhooks firmados (POST /api/integrations/linear/webhook)
 * que encolan "traer este issue o comentario" y una reconciliación cada 5
 * minutos (issues y comentarios con updatedAt posterior al último pase) por si
 * se perdió un webhook o no se pudo crear. Lo nuevo entra con el mismo writer
 * del import; lo que ya existe se actualiza campo por campo con updateIssue
 * bajo via 'linear' (queda en la actividad y el audit, y no vuelve a salir).
 *
 * Track → Linear: lib/track-events avisa cada cambio; si no vino de Linear,
 * se marca la hora del cambio por campo y se encola "mandar este issue" en
 * track_integration_outbox (reintentos con backoff y claim por fila). Al
 * mandarlo se lee el issue en Linear y se decide campo por campo
 * (lib/track-linear-sync-map: gana el lado que cambió; si cambiaron los dos,
 * el último). Los ids nuevos en Linear se eligen antes de crearlos (id en
 * issueCreate y commentCreate), así el webhook de lo que acabamos de crear ya
 * encuentra su par y no se duplica.
 *
 * Id map: import_external_ids (source 'linear'), el mismo del import:
 * issue_uuid, issue (ENG-12), comment, project (team), plan (project de
 * Linear), plan_milestone, cycle. Nada cruza workspaces: cada búsqueda va con
 * el workspace de la conexión.
 */
import { randomBytes } from 'crypto';
import { getDb } from './db';
import { open } from './secret-box';
import {
  deleteIntegration,
  enqueueOutbox,
  getIntegrationRow,
  IntegrationSkip,
  logIntegrationEvent,
  saveIntegration,
  touchIntegration,
  workspacePersonByEmail,
  type IntegrationEvent,
  type IntegrationRow,
  listIntegrationEvents,
} from './track-integrations';
import { getExternalId, setExternalId, sourceBase, type ImportJob, type StagedItem } from './import-jobs';
import { linearAuth, linearIssueToItem, linearTeamExtId, type LinearTeamRef } from './track-linear-import';
import { fakeLinearGraphql, isLinearFakeToken, linearFakeAllowed } from './track-linear-fake';
import {
  canonFromLinear,
  canonFromTrack,
  fieldHash,
  linearCycleKey,
  linearStateFor,
  priorityFromLinear,
  priorityToLinear,
  PUSH_FIELDS,
  resolveField,
  SYNC_FIELDS,
  verifyLinearSignature,
  webhookIsFresh,
  type Canon,
  type CanonContext,
  type LinearDirection,
  type LinearLabelRef,
  type LinearStateRef,
  type SyncField,
  type TrackSide,
} from './track-linear-sync-map';
import type { TrackEventContext, TrackEventInput } from './track-events';
import type { TrackIssueWithStatus } from './track-data';
import { linearStateCategory, safeImportColor } from './track-import-map';

export type { LinearDirection } from './track-linear-sync-map';

const SOURCE = 'linear';
const API = 'https://api.linear.app';
const RECONCILE_EVERY_MS = 5 * 60_000;
const WEBHOOK_RESOURCES = ['Issue', 'Comment', 'Attachment', 'IssueRelation'];

// ---------- Conexión ----------

export interface LinearSyncConfig {
  authType: 'oauth' | 'api_key';
  orgId: string;
  orgName: string;
  orgUrlKey: string;
  viewerName: string;
  viewerEmail: string;
  teams: LinearTeamRef[];
  direction: LinearDirection;
  paused: boolean;
  webhook: { mode: 'app' | 'own' | 'none'; id?: string | null; error?: string | null };
  tokenExpiresAt?: string | null;
  /** Quien conectó: escribe los cambios que llegan de Linear y es el dueño de los imports. */
  connectedBy: string;
  /** Para crear el import como lo crea la pestaña Importar (workspace + team del request). */
  jobWorkspaceId: string;
  jobTeamId: string | null;
  locale: string;
}

interface LinearSecrets {
  refreshToken?: string;
  webhookSecret?: string;
}

export interface LinearConnection {
  workspaceId: string;
  row: IntegrationRow;
  config: LinearSyncConfig;
  token: string;
  secrets: LinearSecrets;
}

function parseConfig(raw: string): LinearSyncConfig | null {
  try {
    const c = JSON.parse(raw) as LinearSyncConfig;
    return c && typeof c === 'object' && typeof c.orgId === 'string' ? c : null;
  } catch {
    return null;
  }
}

function toConnection(row: IntegrationRow): LinearConnection | null {
  const config = parseConfig(row.config);
  const token = row.token ? open(row.token) : '';
  if (!config || !token) return null;
  let secrets: LinearSecrets = {};
  try {
    secrets = row.secret ? (JSON.parse(open(row.secret) || '{}') as LinearSecrets) : {};
  } catch {
    secrets = {};
  }
  return { workspaceId: row.workspace_id, row, config, token, secrets };
}

export async function getLinearConnection(workspaceId: string): Promise<LinearConnection | null> {
  const row = await getIntegrationRow(workspaceId, 'linear');
  return row ? toConnection(row) : null;
}

/** Guarda la config (entera). `token`/`secrets` en undefined no se tocan. */
async function saveConnection(workspaceId: string, config: LinearSyncConfig, opts: { token?: string; secrets?: LinearSecrets; createdBy: string }): Promise<void> {
  await saveIntegration(workspaceId, 'linear', {
    config: config as unknown as Record<string, unknown>,
    token: opts.token,
    // El secreto (refresh token y secreto del webhook) se guarda como JSON cifrado.
    secret: opts.secrets === undefined ? undefined : JSON.stringify(opts.secrets),
    createdBy: opts.createdBy,
  });
}

export async function updateLinearConfig(workspaceId: string, patch: Partial<Pick<LinearSyncConfig, 'teams' | 'direction' | 'paused'>>): Promise<LinearConnection | null> {
  const conn = await getLinearConnection(workspaceId);
  if (!conn) return null;
  const config = { ...conn.config, ...patch };
  await saveConnection(workspaceId, config, { createdBy: conn.config.connectedBy });
  contextCache.delete(workspaceId);
  // Al reanudar: lo que se cambió en Track mientras estaba en pausa sale ahora.
  if (conn.config.paused && patch.paused === false && config.direction !== 'import') {
    const rows = (await getDb()
      .prepare('SELECT DISTINCT issue_id FROM track_linear_sync_fields WHERE workspace_id = ? AND local_at IS NOT NULL LIMIT 500')
      .all(workspaceId)) as Array<{ issue_id: string }>;
    for (const r of rows) await enqueuePush(workspaceId, 'push.issue', { issueId: r.issue_id });
  }
  return getLinearConnection(workspaceId);
}

// ---------- Estado (cron) ----------

export type LinearPhase = 'setup' | 'importing' | 'live' | 'error';

export interface LinearSyncState {
  workspace_id: string;
  phase: LinearPhase;
  import_job_id: string | null;
  since: string | null;
  reconcile_cursor: string | null;
  next_reconcile_at: string | null;
  locked_until: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  rate_limited_until: string | null;
}

export async function getSyncState(workspaceId: string): Promise<LinearSyncState | null> {
  return ((await getDb().prepare('SELECT * FROM track_linear_sync_state WHERE workspace_id = ?').get(workspaceId)) as LinearSyncState | undefined) ?? null;
}

async function setSyncState(workspaceId: string, patch: Partial<Omit<LinearSyncState, 'workspace_id'>>): Promise<void> {
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO track_linear_sync_state (workspace_id) VALUES (?)').run(workspaceId);
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  await db
    .prepare(`UPDATE track_linear_sync_state SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE workspace_id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | null), workspaceId);
}

// ---------- API de Linear ----------

export type LinearErrorCode = 'unauthorized' | 'rate_limited' | 'not_found' | 'source_error' | 'unreachable';

export class LinearApiError extends Error {
  constructor(
    public code: LinearErrorCode,
    public retryAt: string | null = null,
  ) {
    super(code);
  }
}

type GqlBody<T> = { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null;

function bodyOrThrow<T>(status: number, raw: unknown, headers?: Headers): T {
  const body = raw as GqlBody<T>;
  const err = body?.errors?.[0];
  const code = err?.extensions?.code;
  if (status === 401 || status === 403 || code === 'AUTHENTICATION_ERROR' || /not authenticated/i.test(err?.message ?? '')) throw new LinearApiError('unauthorized');
  if (status === 429 || code === 'RATELIMITED') {
    const reset = Number(headers?.get('x-ratelimit-requests-reset') ?? headers?.get('x-ratelimit-complexity-reset') ?? 0);
    throw new LinearApiError('rate_limited', new Date(reset > Date.now() ? reset : Date.now() + 60_000).toISOString());
  }
  if (err && /not found/i.test(err.message ?? '')) throw new LinearApiError('not_found');
  if (status < 200 || status >= 300 || !body?.data || err) throw new LinearApiError('source_error');
  return body.data;
}

/** Valor del header Authorization (la API key va sola; el token OAuth con Bearer). */
function authHeader(conn: Pick<LinearConnection, 'token' | 'config'>): string {
  return conn.config.authType === 'oauth' ? `Bearer ${conn.token}` : linearAuth(conn.token);
}

/** Pedido con un token suelto (conectar con una API key, antes de guardar nada). */
export async function linearRequest<T>(authorization: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (linearFakeAllowed() && isLinearFakeToken(authorization)) {
    const res = fakeLinearGraphql(authorization, query, variables);
    return bodyOrThrow<T>(res.status, res.body);
  }
  let res: Response;
  try {
    res = await fetch(`${sourceBase('linear', API)}/graphql`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
  } catch {
    throw new LinearApiError('unreachable');
  }
  return bodyOrThrow<T>(res.status, await res.json().catch(() => null), res.headers);
}

/** Pedido de la conexión: refresca el token OAuth si venció y frena si Linear pidió esperar. */
async function linearCall<T>(conn: LinearConnection, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const state = await getSyncState(conn.workspaceId);
  if (state?.rate_limited_until && state.rate_limited_until > new Date().toISOString()) throw new LinearApiError('rate_limited', state.rate_limited_until);
  if (conn.config.authType === 'oauth' && conn.config.tokenExpiresAt && Date.parse(conn.config.tokenExpiresAt) < Date.now() + 60_000) {
    await refreshOAuthToken(conn);
  }
  try {
    return await linearRequest<T>(authHeader(conn), query, variables);
  } catch (err) {
    if (err instanceof LinearApiError && err.code === 'rate_limited') await setSyncState(conn.workspaceId, { rate_limited_until: err.retryAt });
    if (err instanceof LinearApiError && err.code === 'unauthorized') await setSyncState(conn.workspaceId, { last_error: 'unauthorized' });
    throw err;
  }
}

// ---------- OAuth ----------

export function linearOAuthConfigured(): boolean {
  return Boolean(process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET);
}

export function linearRedirectUri(): string {
  return `${(process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '')}/api/integrations/linear/callback`;
}

/** "Login with Linear": actor=app, así lo que manda Track en Linear aparece como la app. */
export function linearAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID ?? '',
    redirect_uri: linearRedirectUri(),
    response_type: 'code',
    scope: 'read,write',
    state,
    prompt: 'consent',
    actor: 'app',
  });
  return `https://linear.app/oauth/authorize?${q.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: process.env.LINEAR_CLIENT_ID ?? '', client_secret: process.env.LINEAR_CLIENT_SECRET ?? '' }).toString(),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) throw new LinearApiError('unauthorized');
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!json.access_token) throw new LinearApiError('unauthorized');
  return json;
}

export async function exchangeLinearCode(code: string): Promise<{ token: string; refreshToken: string | null; expiresAt: string | null }> {
  const t = await tokenRequest({ code, redirect_uri: linearRedirectUri(), grant_type: 'authorization_code' });
  return {
    token: t.access_token!,
    refreshToken: t.refresh_token ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  };
}

async function refreshOAuthToken(conn: LinearConnection): Promise<void> {
  // Otra corrida ya lo refrescó: se usa ese token (dos refrescos a la vez invalidan el refresh token).
  const latest = await getLinearConnection(conn.workspaceId);
  if (latest?.config.tokenExpiresAt && Date.parse(latest.config.tokenExpiresAt) > Date.now() + 60_000) {
    conn.token = latest.token;
    conn.secrets = latest.secrets;
    conn.config = latest.config;
    return;
  }
  // Claim por fila: una sola corrida refresca a la vez; las demás reintentan en un rato.
  const db = getDb();
  await db.prepare('INSERT OR IGNORE INTO track_linear_sync_state (workspace_id) VALUES (?)').run(conn.workspaceId);
  const until = new Date(Date.now() + 30_000).toISOString();
  const claim = await db
    .prepare("UPDATE track_linear_sync_state SET rate_limited_until = ? WHERE workspace_id = ? AND (rate_limited_until IS NULL OR rate_limited_until < ?)")
    .run(until, conn.workspaceId, new Date().toISOString());
  if (!claim.changes) throw new LinearApiError('rate_limited', until);
  try {
    await doRefresh(conn);
  } finally {
    await db.prepare('UPDATE track_linear_sync_state SET rate_limited_until = NULL WHERE workspace_id = ? AND rate_limited_until = ?').run(conn.workspaceId, until);
  }
}

async function doRefresh(conn: LinearConnection): Promise<void> {
  if (!conn.secrets.refreshToken) return;
  const t = await tokenRequest({ refresh_token: conn.secrets.refreshToken, grant_type: 'refresh_token' });
  conn.token = t.access_token!;
  conn.secrets = { ...conn.secrets, refreshToken: t.refresh_token ?? conn.secrets.refreshToken };
  conn.config = { ...conn.config, tokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null };
  await saveConnection(conn.workspaceId, conn.config, { token: conn.token, secrets: conn.secrets, createdBy: conn.config.connectedBy });
}

// ---------- Conectar y desconectar ----------

const VIEWER_QUERY = `query SyncViewer { viewer { id name email } organization { id name urlKey } }`;
const TEAMS_QUERY = `query SyncTeams($after: String) {
  teams(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { id key name private states(first: 100) { nodes { id name type color position } } } }
}`;
const USERS_QUERY = `query SyncUsers($after: String) {
  users(first: 250, after: $after, includeDisabled: true) { pageInfo { hasNextPage endCursor } nodes { id email name } }
}`;
const LABELS_QUERY = `query SyncLabels($after: String) {
  issueLabels(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id name color team { id } } }
}`;
const ISSUE_FIELDS = `id identifier title description priority estimate createdAt updatedAt dueDate archivedAt
      state { id name type color position }
      team { id key name }
      project { id name }
      projectMilestone { id name }
      cycle { id number name startsAt endsAt }
      assignee { id email name displayName }
      creator { email name displayName }
      parent { id identifier }
      labels(first: 50) { nodes { id name color } }`;
const ISSUE_QUERY = `query SyncIssue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`;
const ISSUES_SINCE_QUERY = `query SyncIssues($after: String, $filter: IssueFilter) {
  issues(first: 50, after: $after, filter: $filter, includeArchived: true, orderBy: updatedAt) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE_FIELDS} } }
}`;
const COMMENTS_QUERY = `query SyncComments($after: String, $filter: CommentFilter) {
  comments(first: 100, after: $after, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes { id body createdAt updatedAt user { email name displayName } externalUser { name } issue { id identifier team { id } } parent { id } }
  }
}`;
const ATTACHMENTS_QUERY = `query SyncAttachments($after: String, $filter: AttachmentFilter) {
  attachments(first: 100, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } nodes { id title subtitle url sourceType createdAt issue { id identifier team { id } } } }
}`;
export const LINEAR_SYNC_QUERIES = { VIEWER_QUERY, TEAMS_QUERY, USERS_QUERY, LABELS_QUERY, ISSUE_QUERY, ISSUES_SINCE_QUERY, COMMENTS_QUERY, ATTACHMENTS_QUERY };

export const LINEAR_SYNC_MUTATIONS = {
  issueCreate: `mutation SyncIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier updatedAt } } }`,
  issueUpdate: `mutation SyncIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier updatedAt } } }`,
  commentCreate: `mutation SyncCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`,
  webhookCreate: `mutation SyncWebhookCreate($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { id } } }`,
  webhookDelete: `mutation SyncWebhookDelete($id: String!) { webhookDelete(id: $id) { success } }`,
};

interface ViewerData {
  viewer: { id: string; name: string | null; email: string | null };
  organization: { id: string; name: string; urlKey: string };
}

async function paged<N>(call: (after: string | null) => Promise<{ pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: N[] }>, maxPages = 10): Promise<N[]> {
  const out: N[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await call(after);
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

function webhookUrl(): string {
  return `${(process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '')}/api/integrations/linear/webhook`;
}

/** Linear solo manda webhooks a una URL pública con https (el fake, a cualquiera). */
function canRegisterWebhook(token: string): boolean {
  if (linearFakeAllowed() && isLinearFakeToken(token)) return true;
  try {
    const u = new URL(webhookUrl());
    return u.protocol === 'https:' && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname);
  } catch {
    return false;
  }
}

export interface ConnectInput {
  workspaceId: string;
  jobWorkspaceId: string;
  jobTeamId: string | null;
  personId: string;
  locale: string;
}

/**
 * Conecta (o reconecta: se conserva la config elegida). Con API key, además
 * registra un webhook propio con un secreto nuevo; si Linear no deja (hace
 * falta ser admin), quedan los pases cada 5 minutos.
 */
export async function connectLinear(input: ConnectInput, auth: { type: 'api_key'; token: string } | { type: 'oauth'; token: string; refreshToken: string | null; expiresAt: string | null }): Promise<LinearConnection> {
  const authorization = auth.type === 'oauth' ? `Bearer ${auth.token}` : linearAuth(auth.token);
  const who = await linearRequest<ViewerData>(authorization, VIEWER_QUERY);
  const previous = await getLinearConnection(input.workspaceId);
  // Otra organización de Linear: la config anterior no sirve (teams de otro lado).
  const keep = previous && previous.config.orgId === who.organization.id ? previous.config : null;
  if (previous) await removeWebhook(previous);
  const secrets: LinearSecrets = {};
  let webhook: LinearSyncConfig['webhook'] = { mode: 'none' };
  if (auth.type === 'oauth') {
    secrets.refreshToken = auth.refreshToken ?? undefined;
    webhook = process.env.LINEAR_WEBHOOK_SECRET ? { mode: 'app' } : { mode: 'none', error: 'app_webhook_not_configured' };
  } else if (canRegisterWebhook(auth.token)) {
    const secret = randomBytes(32).toString('hex');
    try {
      const res = await linearRequest<{ webhookCreate: { success: boolean; webhook: { id: string } | null } }>(authorization, LINEAR_SYNC_MUTATIONS.webhookCreate, {
        input: { url: webhookUrl(), label: 'zerosoft Track', resourceTypes: WEBHOOK_RESOURCES, allPublicTeams: true, secret },
      });
      if (res.webhookCreate.success && res.webhookCreate.webhook) {
        secrets.webhookSecret = secret;
        webhook = { mode: 'own', id: res.webhookCreate.webhook.id };
      }
    } catch (err) {
      webhook = { mode: 'none', error: err instanceof LinearApiError ? err.code : 'source_error' };
    }
  } else {
    webhook = { mode: 'none', error: 'not_public' };
  }
  const config: LinearSyncConfig = {
    authType: auth.type,
    orgId: who.organization.id,
    orgName: who.organization.name,
    orgUrlKey: who.organization.urlKey,
    viewerName: who.viewer.name ?? '',
    viewerEmail: (who.viewer.email ?? '').toLowerCase(),
    teams: keep?.teams ?? [],
    direction: keep?.direction ?? 'two_way',
    paused: keep?.paused ?? false,
    webhook,
    tokenExpiresAt: auth.type === 'oauth' ? auth.expiresAt : null,
    connectedBy: input.personId,
    jobWorkspaceId: input.jobWorkspaceId,
    jobTeamId: input.jobTeamId,
    locale: input.locale,
  };
  await saveConnection(input.workspaceId, config, { token: auth.token, secrets, createdBy: input.personId });
  contextCache.delete(input.workspaceId);
  const state = await getSyncState(input.workspaceId);
  if (!state) await setSyncState(input.workspaceId, { phase: 'setup' });
  else if (state.phase === 'error') await setSyncState(input.workspaceId, { phase: state.since ? 'live' : 'setup', last_error: null });
  else await setSyncState(input.workspaceId, { last_error: null });
  await logIntegrationEvent(input.workspaceId, 'linear', 'in', 'connected', `${config.orgName} (${auth.type === 'oauth' ? 'OAuth' : 'API key'})`);
  return (await getLinearConnection(input.workspaceId))!;
}

async function removeWebhook(conn: LinearConnection): Promise<void> {
  if (conn.config.webhook.mode !== 'own' || !conn.config.webhook.id) return;
  await linearRequest(authHeader(conn), LINEAR_SYNC_MUTATIONS.webhookDelete, { id: conn.config.webhook.id }).catch(() => undefined);
}

/**
 * Desconecta: borra el webhook propio, revoca el token OAuth y la conexión.
 * Lo importado y el id map quedan (reconectar sigue donde estaba).
 */
export async function disconnectLinear(workspaceId: string): Promise<boolean> {
  const conn = await getLinearConnection(workspaceId);
  if (conn) {
    await removeWebhook(conn);
    if (conn.config.authType === 'oauth') {
      await fetch(`${API}/oauth/revoke`, { method: 'POST', headers: { authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    }
  }
  const db = getDb();
  // Un import en curso se corta y su copia del token se borra.
  const state = await getSyncState(workspaceId);
  if (state?.import_job_id) {
    const { getImportJob } = await import('./import-jobs');
    const { cancelImportJob } = await import('./import-runner');
    const job = await getImportJob(state.import_job_id);
    if (job) await cancelImportJob(job);
  }
  await db.prepare("UPDATE track_integration_outbox SET status = 'skipped', last_error = 'disconnected' WHERE workspace_id = ? AND provider = 'linear' AND status = 'pending'").run(workspaceId);
  await db.prepare("UPDATE track_linear_sync_state SET phase = 'setup', import_job_id = NULL, locked_until = NULL, last_error = NULL WHERE workspace_id = ?").run(workspaceId);
  contextCache.delete(workspaceId);
  const removed = await deleteIntegration(workspaceId, 'linear');
  if (removed) await logIntegrationEvent(workspaceId, 'linear', 'out', 'disconnected', conn?.config.orgName ?? 'Linear');
  return removed;
}

/** Teams del workspace de Linear (para elegir cuáles sincronizar). */
export async function listLinearTeams(conn: LinearConnection): Promise<LinearTeamRef[]> {
  const ctx = await linearContext(conn, true);
  return ctx.teams.map((t) => ({ id: t.id, key: t.key, name: t.name }));
}

// ---------- Contexto de Linear (teams, estados, personas, labels) ----------

interface LinearTeamFull extends LinearTeamRef {
  states: LinearStateRef[];
}

interface LinearContext {
  at: number;
  teams: LinearTeamFull[];
  users: Array<{ id: string; email: string }>;
  labels: Array<LinearLabelRef & { teamId: string | null }>;
}

const contextCache = new Map<string, LinearContext>();

type Page<N> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: N[] };

async function linearContext(conn: LinearConnection, fresh = false): Promise<LinearContext> {
  const cached = contextCache.get(conn.workspaceId);
  if (cached && !fresh && Date.now() - cached.at < 5 * 60_000) return cached;
  type TeamNode = { id: string; key: string; name: string; states: { nodes: LinearStateRef[] } };
  const teams = await paged<TeamNode>(async (after) => (await linearCall<{ teams: Page<TeamNode> }>(conn, TEAMS_QUERY, { after })).teams);
  const users = await paged<{ id: string; email: string | null }>(async (after) => (await linearCall<{ users: Page<{ id: string; email: string | null }> }>(conn, USERS_QUERY, { after })).users);
  type LabelNode = LinearLabelRef & { team: { id: string } | null };
  const labels = await paged<LabelNode>(async (after) => (await linearCall<{ issueLabels: Page<LabelNode> }>(conn, LABELS_QUERY, { after })).issueLabels);
  const ctx: LinearContext = {
    at: Date.now(),
    teams: teams.map((t) => ({ id: t.id, key: t.key, name: t.name, states: t.states?.nodes ?? [] })),
    users: users.filter((u) => u.email).map((u) => ({ id: u.id, email: String(u.email).toLowerCase() })),
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color ?? null, teamId: l.team?.id ?? null })),
  };
  contextCache.set(conn.workspaceId, ctx);
  return ctx;
}

async function trackEmails(conn: LinearConnection): Promise<Set<string>> {
  const { listMembers } = await import('./track-import');
  const members = await listMembers({ team_id: conn.config.jobTeamId, workspace_id: conn.config.jobWorkspaceId });
  return new Set(members.map((m) => m.email.toLowerCase()));
}

function canonContext(lc: LinearContext, teamId: string, emails: Set<string>): CanonContext {
  return {
    states: lc.teams.find((t) => t.id === teamId)?.states ?? [],
    labels: lc.labels.filter((l) => !l.teamId || l.teamId === teamId),
    linearEmails: new Set(lc.users.map((u) => u.email)),
    trackEmails: emails,
  };
}

// ---------- Id map ----------

async function externalFor(ws: string, kind: string, localId: string | null | undefined): Promise<string | null> {
  if (!localId) return null;
  const row = (await getDb()
    .prepare('SELECT external_id FROM import_external_ids WHERE workspace_id = ? AND source = ? AND kind = ? AND local_id = ? ORDER BY imported_at DESC LIMIT 1')
    .get(ws, SOURCE, kind, localId)) as { external_id: string } | undefined;
  return row?.external_id ?? null;
}

/** Issue de Track (de este workspace) que corresponde a un issue de Linear. */
async function localIssueFor(ws: string, linearId: string): Promise<string | null> {
  const id = await getExternalId(ws, SOURCE, 'issue_uuid', linearId);
  if (!id) return null;
  const row = (await getDb()
    .prepare('SELECT i.id, p.team_id, p.owner_id FROM track_issues i JOIN track_projects p ON p.id = i.project_id WHERE i.id = ?')
    .get(id)) as { id: string; team_id: string | null; owner_id: string | null } | undefined;
  return row && (row.team_id ?? row.owner_id) === ws ? row.id : null;
}

/** Team de Linear (elegido en la conexión) de un team de Track. */
async function linearTeamForProject(conn: LinearConnection, projectId: string): Promise<LinearTeamRef | null> {
  const ext = await externalFor(conn.workspaceId, 'project', projectId);
  if (!ext) return null;
  return conn.config.teams.find((t) => linearTeamExtId(t.name || t.key) === ext) ?? null;
}

// ---------- Base por campo ----------

interface FieldRow {
  field: SyncField;
  base_hash: string | null;
  local_at: string | null;
}

async function fieldRows(ws: string, issueId: string): Promise<Map<SyncField, FieldRow>> {
  const rows = (await getDb()
    .prepare('SELECT field, base_hash, local_at FROM track_linear_sync_fields WHERE workspace_id = ? AND issue_id = ?')
    .all(ws, issueId)) as unknown as FieldRow[];
  return new Map(rows.map((r) => [r.field, r]));
}

/** Los dos lados coinciden en este valor: queda como base y se olvida el cambio local. */
async function agree(ws: string, issueId: string, field: SyncField, hash: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_linear_sync_fields (workspace_id, issue_id, field, base_hash, local_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT (workspace_id, issue_id, field) DO UPDATE SET base_hash = excluded.base_hash, local_at = NULL`,
    )
    .run(ws, issueId, field, hash);
}

async function markLocal(ws: string, issueId: string, fields: SyncField[], at: string): Promise<void> {
  const db = getDb();
  for (const f of fields) {
    await db
      .prepare(
        `INSERT INTO track_linear_sync_fields (workspace_id, issue_id, field, base_hash, local_at) VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT (workspace_id, issue_id, field) DO UPDATE SET local_at = excluded.local_at`,
      )
      .run(ws, issueId, f, at);
  }
}

// ---------- Track → lado canónico ----------

function labelNamesOf(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as Array<{ name?: string }>;
    return Array.isArray(v) ? v.map((l) => String(l?.name ?? '')).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function trackSide(ws: string, issue: TrackIssueWithStatus): Promise<TrackSide> {
  const { descriptionToText } = await import('./track-api');
  const cycleExt = await externalFor(ws, 'cycle', issue.cycle_id);
  return {
    title: issue.title,
    descriptionMarkdown: descriptionToText(issue.description),
    priority: issue.priority,
    estimate: issue.estimate ?? null,
    statusName: issue.status_name ?? null,
    statusCategory: issue.status_category ?? null,
    triage: issue.triage === 1,
    assigneeEmail: issue.assignee_email ?? null,
    labels: labelNamesOf(issue.labels),
    dueDate: issue.due_date ?? null,
    parentLinearId: await externalFor(ws, 'issue_uuid', issue.parent_id),
    projectLinearId: await externalFor(ws, 'plan', issue.plan_id),
    milestoneLinearId: await externalFor(ws, 'plan_milestone', issue.plan_milestone_id),
    // El id externo del cycle es "<team de Track>:<team de Linear>:<cycle>".
    cycleKey: cycleExt ? cycleExt.slice(cycleExt.indexOf(':') + 1) : null,
  };
}

// ---------- Aplicar en Track lo de Linear ----------

/* eslint-disable @typescript-eslint/no-explicit-any -- nodos de la API de Linear */
type LinearIssueNode = any;

/** Job de mentira para reusar el writer del import (lib/track-import.ts) con los datos de la conexión. */
function writerJob(conn: LinearConnection): ImportJob {
  const now = new Date().toISOString();
  return {
    id: `linear-sync-${conn.workspaceId}`,
    workspace_id: conn.config.jobWorkspaceId,
    team_id: conn.config.jobTeamId,
    user_id: conn.config.connectedBy,
    app: 'track',
    source: 'linear',
    status: 'importing',
    stage: 'issues',
    options: { target: 'new' },
    secret: authHeader(conn),
    payload: null,
    cursor: {},
    total: 0,
    processed: 0,
    preview: null,
    report: null,
    error: null,
    locale: conn.config.locale || 'en',
    locked_until: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
}

async function writeItems(conn: LinearConnection, items: Array<{ kind: string; data: unknown }>): Promise<void> {
  if (!items.length) return;
  const { emptyTrackReport, trackWriteStep } = await import('./track-import');
  const job = writerJob(conn);
  const staged = items.map((it, i) => ({ seq: i, kind: it.kind, data: it.data })) as StagedItem[];
  const report = emptyTrackReport();
  await trackWriteStep(job, 'issues', staged, report);
  await trackWriteStep(job, 'parents', staged, report);
}

async function statusIdFor(projectId: string, node: LinearIssueNode): Promise<string | null> {
  const { listStatuses, createStatus } = await import('./track-data');
  const name = String(node.state?.name ?? '').trim();
  if (!name) return null;
  const list = await listStatuses(projectId);
  const found = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const created = await createStatus(projectId, { name, category: linearStateCategory(node.state?.type) ?? 'todo', color: safeImportColor(node.state?.color) ?? undefined });
  return created.id;
}

async function cycleIdFor(ws: string, projectId: string, node: LinearIssueNode): Promise<string | null | undefined> {
  const teamName = node.team?.name || node.team?.key || '';
  const key = linearCycleKey(teamName, node.cycle);
  if (!key) return null;
  const mapped = await getExternalId(ws, SOURCE, 'cycle', `${projectId}:${key}`);
  if (mapped) return mapped;
  if (!node.cycle?.startsAt || !node.cycle?.endsAt) return undefined;
  const { createCycle } = await import('./track-data');
  const c = await createCycle(projectId, { name: node.cycle.name || `Cycle ${node.cycle.number}`, startAt: String(node.cycle.startsAt).slice(0, 10), endAt: String(node.cycle.endsAt).slice(0, 10) });
  await setExternalId(ws, SOURCE, 'cycle', `${projectId}:${key}`, c.id);
  return c.id;
}

/**
 * Un campo de Linear → el pedazo de payload de updateIssue. undefined = no se
 * puede aplicar (por ejemplo, un project de Linear que no está en Track).
 */
async function pullValue(ws: string, issue: TrackIssueWithStatus, field: SyncField, node: LinearIssueNode): Promise<Record<string, unknown> | undefined> {
  const { textToDescription } = await import('./track-api');
  switch (field) {
    case 'title':
      return String(node.title ?? '').trim() ? { title: String(node.title).trim().slice(0, 500) } : undefined;
    case 'description':
      return { description: textToDescription(String(node.description ?? '')) };
    case 'priority':
      return { priority: priorityFromLinear(node.priority) };
    case 'estimate':
      return { estimate: typeof node.estimate === 'number' ? Math.max(0, Math.round(node.estimate)) : null };
    case 'status': {
      if (node.state?.type === 'triage') return undefined;
      const id = await statusIdFor(issue.project_id, node);
      return id ? { statusId: id } : undefined;
    }
    case 'assignee': {
      const person = node.assignee?.email ? await workspacePersonByEmail(ws, node.assignee.email) : null;
      return { assigneeId: person?.id ?? null };
    }
    case 'labels':
      return { labels: ((node.labels?.nodes ?? []) as any[]).slice(0, 10).map((l) => ({ name: String(l.name).slice(0, 50), ...(safeImportColor(l.color) ? { color: safeImportColor(l.color)! } : {}) })) };
    case 'dueDate':
      return { dueDate: node.dueDate ? String(node.dueDate).slice(0, 10) : null };
    case 'parent': {
      if (!node.parent?.id) return { parentId: null };
      const id = await localIssueFor(ws, node.parent.id);
      return id ? { parentId: id } : undefined;
    }
    case 'project': {
      if (!node.project?.id) return { planId: null, planMilestoneId: null };
      const id = await getExternalId(ws, SOURCE, 'plan', node.project.id);
      return id ? { planId: id } : undefined;
    }
    case 'milestone': {
      if (!node.projectMilestone?.id) return { planMilestoneId: null };
      const id = await getExternalId(ws, SOURCE, 'plan_milestone', node.projectMilestone.id);
      return id ? { planMilestoneId: id } : undefined;
    }
    case 'cycle': {
      const id = await cycleIdFor(ws, issue.project_id, node);
      return id === undefined ? undefined : { cycleId: id };
    }
    default:
      return undefined;
  }
}

interface ApplyResult {
  created: boolean;
  pulled: SyncField[];
  pushPending: boolean;
  identifier: string | null;
}

/**
 * Issue de Linear → Track. Nuevo: lo crea el writer del import. Existente:
 * campo por campo según resolveField; lo que gana Track queda para el push.
 */
async function applyLinearIssue(conn: LinearConnection, node: LinearIssueNode, lc: LinearContext, emails: Set<string>): Promise<ApplyResult> {
  const ws = conn.workspaceId;
  const none: ApplyResult = { created: false, pulled: [], pushPending: false, identifier: node?.identifier ?? null };
  if (!node?.id || !conn.config.teams.some((t) => t.id === node.team?.id)) return none;
  const ctx = canonContext(lc, node.team.id, emails);
  const linear = canonFromLinear(node, ctx);
  let local = await localIssueFor(ws, node.id);
  const { getIssue, updateIssue } = await import('./track-data');

  if (!local) {
    if (node.archivedAt || conn.config.direction === 'push') return none;
    await writeItems(conn, [{ kind: 'issue', data: linearIssueToItem(node) }]);
    local = await localIssueFor(ws, node.id);
    if (!local) return none;
    const issue = await getIssue(local);
    if (issue) {
      const track = canonFromTrack(await trackSide(ws, issue), ctx);
      for (const f of SYNC_FIELDS) if (fieldHash(track[f]) === fieldHash(linear[f])) await agree(ws, local, f, fieldHash(linear[f]));
    }
    return { created: true, pulled: [], pushPending: false, identifier: issue?.identifier ?? null };
  }

  const issue = await getIssue(local);
  if (!issue) return none;
  const track = canonFromTrack(await trackSide(ws, issue), ctx);
  const rows = await fieldRows(ws, local);
  const payload: Record<string, unknown> = {};
  const pulled: SyncField[] = [];
  let pushPending = false;
  for (const f of SYNC_FIELDS) {
    const row = rows.get(f);
    const th = fieldHash(track[f]);
    const lh = fieldHash(linear[f]);
    if (th === lh) {
      // Iguales (también el eco de lo que acabamos de mandar): queda como base.
      if (row?.base_hash !== lh || row?.local_at) await agree(ws, local, f, lh);
      continue;
    }
    const decision = resolveField({ trackHash: th, linearHash: lh, base: row?.base_hash ?? null, localAt: row?.local_at ?? null, remoteAt: node.updatedAt ?? null, direction: conn.config.direction });
    if (decision === 'same') continue;
    if (decision === 'push') {
      if (f !== 'cycle') pushPending = true;
      continue;
    }
    const value = await pullValue(ws, issue, f, node);
    if (value === undefined) continue;
    Object.assign(payload, value);
    pulled.push(f);
  }
  if (pulled.length) {
    const { runAsTrackViewer } = await import('./track-access');
    // via 'linear': el cambio queda en la actividad y el audit, y track-events no lo devuelve a Linear.
    await runAsTrackViewer(conn.config.connectedBy, () => updateIssue(local!, payload as never, conn.config.connectedBy), 'linear');
    for (const f of pulled) await agree(ws, local, f, fieldHash(linear[f]));
  }
  return { created: false, pulled, pushPending, identifier: issue.identifier };
}

/** Comentario de Linear → Track (el writer del import: nuevo o texto editado). */
async function applyLinearComment(conn: LinearConnection, n: any): Promise<boolean> {
  const ws = conn.workspaceId;
  if (!n?.issue?.id || !String(n.body ?? '').trim()) return false;
  const local = await localIssueFor(ws, n.issue.id);
  if (!local) return false;
  // Un comentario que salió de Track: ya tiene su par (se registró antes de crearlo en Linear).
  const existing = await getExternalId(ws, SOURCE, 'comment', `${local}:${n.id}`);
  const author = n.user ? { email: n.user.email?.toLowerCase() ?? null, name: n.user.name || n.user.displayName || null } : n.externalUser?.name ? { email: null, name: n.externalUser.name } : null;
  if (existing) {
    const row = (await getDb().prepare('SELECT body FROM track_issue_comments WHERE id = ?').get(existing)) as { body: string } | undefined;
    if (!row || row.body.trim() === String(n.body).trim()) return false;
  }
  await writeItems(conn, [
    {
      kind: 'comment',
      data: {
        issueExtId: n.issue.identifier,
        comment: {
          extId: String(n.id),
          parentExtId: n.parent?.id ?? null,
          authorEmail: author?.email ?? null,
          authorName: author?.name ?? null,
          body: String(n.body).slice(0, 5000),
          createdAt: n.createdAt ?? null,
          updatedAt: n.updatedAt ?? null,
        },
      },
    },
  ]);
  return true;
}

async function applyLinearAttachment(conn: LinearConnection, n: any): Promise<boolean> {
  if (!n?.issue?.identifier || !/^https?:\/\//i.test(String(n.url ?? ''))) return false;
  if (!(await localIssueFor(conn.workspaceId, n.issue.id))) return false;
  if (await getExternalId(conn.workspaceId, SOURCE, 'attachment', String(n.id))) return false;
  await writeItems(conn, [
    {
      kind: 'attachment',
      data: { extId: String(n.id), issueExtId: n.issue.identifier, url: String(n.url).slice(0, 2000), title: String(n.title ?? '').slice(0, 300), subtitle: String(n.subtitle ?? '').slice(0, 300), sourceType: n.sourceType ?? null },
    },
  ]);
  return true;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- Mandar a Linear lo de Track ----------

async function pushIssue(conn: LinearConnection, issueId: string): Promise<void> {
  const ws = conn.workspaceId;
  const { getIssue, getProject } = await import('./track-data');
  const issue = await getIssue(issueId);
  if (!issue) throw new IntegrationSkip('issue_not_found');
  const project = await getProject(issue.project_id);
  if (!project || (project.team_id ?? project.owner_id) !== ws) throw new IntegrationSkip('issue_not_found');
  const team = await linearTeamForProject(conn, issue.project_id);
  if (!team) throw new IntegrationSkip('team_not_synced');
  const lc = await linearContext(conn);
  const emails = await trackEmails(conn);
  const ctx = canonContext(lc, team.id, emails);
  const side = await trackSide(ws, issue);
  const track = canonFromTrack(side, ctx);
  const linearId = await externalFor(ws, 'issue_uuid', issueId);

  let node: Record<string, unknown> | null = null;
  if (linearId) {
    try {
      node = (await linearCall<{ issue: Record<string, unknown> }>(conn, ISSUE_QUERY, { id: linearId })).issue;
    } catch (err) {
      if (!(err instanceof LinearApiError && err.code === 'not_found')) throw err;
    }
  }

  if (!node) {
    // Nuevo en Linear. Si ya tenía id (registrado antes de un intento que falló), se crea con ese mismo.
    if (issue.triage === 1 || issue.archived_at) throw new IntegrationSkip('not_pushed');
    const id = linearId ?? crypto.randomUUID();
    if (!linearId) await setExternalId(ws, SOURCE, 'issue_uuid', id, issueId);
    // Al crear, solo lo que tiene valor (lo vacío es el default de Linear).
    const fields = Object.entries(pushInput(PUSH_FIELDS, track, side, lc, ctx)).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length));
    const input: Record<string, unknown> = { id, teamId: team.id, ...Object.fromEntries(fields) };
    if (!input.title) input.title = issue.identifier;
    const res = await linearCall<{ issueCreate: { success: boolean; issue: { id: string; identifier: string } | null } }>(conn, LINEAR_SYNC_MUTATIONS.issueCreate, { input: stripUndefined(input) });
    if (!res.issueCreate.success || !res.issueCreate.issue) throw new Error('linear_rejected');
    await setExternalId(ws, SOURCE, 'issue', res.issueCreate.issue.identifier, issueId);
    for (const f of SYNC_FIELDS) await agree(ws, issueId, f, fieldHash(track[f]));
    await logIntegrationEvent(ws, 'linear', 'out', 'issue.created', `${issue.identifier} → ${res.issueCreate.issue.identifier} ${issue.title}`.slice(0, 300));
    return;
  }

  const linear = canonFromLinear(node, ctx);
  const rows = await fieldRows(ws, issueId);
  const pushFields: SyncField[] = [];
  let pullNeeded = false;
  for (const f of SYNC_FIELDS) {
    const row = rows.get(f);
    const th = fieldHash(track[f]);
    const lh = fieldHash(linear[f]);
    if (th === lh) {
      if (row?.local_at || row?.base_hash !== lh) await agree(ws, issueId, f, lh);
      continue;
    }
    const decision = resolveField({ trackHash: th, linearHash: lh, base: row?.base_hash ?? null, localAt: row?.local_at ?? null, remoteAt: (node.updatedAt as string) ?? null, direction: conn.config.direction });
    if (decision === 'same') continue;
    else if (decision === 'push' && f !== 'cycle') pushFields.push(f);
    else if (decision === 'pull') pullNeeded = true;
  }
  if (pushFields.length) {
    const input = stripUndefined(pushInput(pushFields, track, side, lc, ctx));
    if (Object.keys(input).length) {
      const res = await linearCall<{ issueUpdate: { success: boolean } }>(conn, LINEAR_SYNC_MUTATIONS.issueUpdate, { id: node.id, input });
      if (!res.issueUpdate.success) throw new Error('linear_rejected');
    }
    for (const f of pushFields) await agree(ws, issueId, f, fieldHash(track[f]));
    await logIntegrationEvent(ws, 'linear', 'out', 'issue.updated', `${String(node.identifier ?? issue.identifier)}: ${pushFields.join(', ')}`);
  }
  // Linear ganó algún campo (cambió después): se trae ahora.
  if (pullNeeded) {
    const res = await applyLinearIssue(conn, node, lc, emails);
    if (res.pulled.length) await logIntegrationEvent(ws, 'linear', 'in', 'issue.updated', `${issue.identifier}: ${res.pulled.join(', ')}`);
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Campos de Track → IssueCreateInput / IssueUpdateInput de Linear. */
function pushInput(fields: SyncField[], track: Canon, side: TrackSide, lc: LinearContext, ctx: CanonContext): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f) {
      case 'title':
        if (track.title) input.title = track.title;
        break;
      case 'description':
        input.description = side.descriptionMarkdown;
        break;
      case 'priority':
        input.priority = priorityToLinear(String(track.priority));
        break;
      case 'estimate':
        input.estimate = track.estimate;
        break;
      case 'status': {
        if (track.status === 'triage') break;
        const st = linearStateFor({ name: side.statusName, category: side.statusCategory }, ctx.states);
        if (st) input.stateId = st.id;
        break;
      }
      case 'assignee':
        input.assigneeId = track.assignee ? (lc.users.find((u) => u.email === track.assignee)?.id ?? null) : null;
        break;
      case 'labels': {
        const names = (track.labels as string[]) ?? [];
        input.labelIds = names.map((n) => ctx.labels.find((l) => l.name.trim().toLowerCase() === n)?.id).filter(Boolean);
        break;
      }
      case 'dueDate':
        input.dueDate = track.dueDate;
        break;
      case 'parent':
        input.parentId = track.parent;
        break;
      case 'project':
        input.projectId = track.project;
        break;
      case 'milestone':
        input.projectMilestoneId = track.milestone;
        break;
      default:
        break;
    }
  }
  return input;
}

async function pushComment(conn: LinearConnection, commentId: string): Promise<void> {
  const ws = conn.workspaceId;
  const db = getDb();
  const c = (await db
    .prepare(
      `SELECT c.id, c.issue_id, c.body, c.parent_id, u.name AS author_name, u.image AS author_image, p.team_id, p.owner_id
       FROM track_issue_comments c JOIN track_issues i ON i.id = c.issue_id JOIN track_projects p ON p.id = i.project_id
       LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    )
    .get(commentId)) as
    | { id: string; issue_id: string; body: string; parent_id: string | null; author_name: string | null; author_image: string | null; team_id: string | null; owner_id: string | null }
    | undefined;
  if (!c || (c.team_id ?? c.owner_id) !== ws) throw new IntegrationSkip('comment_not_found');
  if (await externalFor(ws, 'comment', c.id)) return;
  const linearIssue = await externalFor(ws, 'issue_uuid', c.issue_id);
  // El issue todavía no está en Linear: se manda primero y el comentario reintenta.
  if (!linearIssue) {
    await enqueuePush(ws, 'push.issue', { issueId: c.issue_id });
    throw new Error('issue_not_synced');
  }
  const id = crypto.randomUUID();
  // Registrado antes de crearlo: el webhook de este comentario ya encuentra su par.
  await setExternalId(ws, SOURCE, 'comment', `${c.issue_id}:${id}`, c.id);
  const parentExt = c.parent_id ? await externalFor(ws, 'comment', c.parent_id) : null;
  const input: Record<string, unknown> = { id, issueId: linearIssue, body: c.body };
  if (parentExt) input.parentId = parentExt.slice(parentExt.indexOf(':') + 1);
  // Con OAuth (actor app) el comentario lleva el nombre de quien lo escribió en Track.
  if (conn.config.authType === 'oauth' && c.author_name) {
    input.createAsUser = c.author_name.slice(0, 100);
    if (c.author_image && /^https:\/\//.test(c.author_image)) input.displayIconUrl = c.author_image;
  }
  try {
    const res = await linearCall<{ commentCreate: { success: boolean } }>(conn, LINEAR_SYNC_MUTATIONS.commentCreate, { input });
    if (!res.commentCreate.success) throw new Error('linear_rejected');
  } catch (err) {
    // No se creó: el próximo intento elige otro id.
    await db.prepare('DELETE FROM import_external_ids WHERE workspace_id = ? AND source = ? AND kind = ? AND external_id = ?').run(ws, SOURCE, 'comment', `${c.issue_id}:${id}`);
    throw err;
  }
  await logIntegrationEvent(ws, 'linear', 'out', 'comment.created', c.body.slice(0, 140));
}

// ---------- Cola (track_integration_outbox, provider 'linear') ----------

async function enqueuePush(ws: string, kind: string, payload: Record<string, unknown>): Promise<boolean> {
  const key = String(payload.issueId ?? payload.commentId ?? payload.id ?? '');
  // Uno pendiente sin empezar ya va a leer el estado actual: no hace falta otro.
  const dup = await getDb()
    .prepare(
      `SELECT 1 FROM track_integration_outbox WHERE workspace_id = ? AND provider = 'linear' AND kind = ? AND status = 'pending' AND attempts = 0
         AND (json_extract(payload, '$.issueId') = ? OR json_extract(payload, '$.commentId') = ? OR json_extract(payload, '$.id') = ?) LIMIT 1`,
    )
    .get(ws, kind, key, key, key);
  if (dup) return false;
  await enqueueOutbox(ws, 'linear', kind, payload);
  return true;
}

/** Handler de la cola (lo llama lib/track-integrations). Lanza para reintentar. */
export async function runLinearOutbox(workspaceId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  const conn = await getLinearConnection(workspaceId);
  if (!conn) throw new IntegrationSkip('not_connected');
  if (conn.config.paused) throw new IntegrationSkip('paused');
  const state = await getSyncState(workspaceId);
  if (state?.rate_limited_until && state.rate_limited_until > new Date().toISOString()) throw new Error('rate_limited');
  try {
    switch (kind) {
      case 'push.issue':
        if (conn.config.direction === 'import') throw new IntegrationSkip('import_only');
        await pushIssue(conn, String(payload.issueId));
        break;
      case 'push.comment':
        if (conn.config.direction === 'import') throw new IntegrationSkip('import_only');
        await pushComment(conn, String(payload.commentId));
        break;
      case 'pull.issue':
        await pullIssue(conn, String(payload.id));
        break;
      case 'pull.comment':
        await pullComment(conn, String(payload.id));
        break;
      case 'pull.attachment':
        await pullAttachment(conn, String(payload.id));
        break;
      default:
        throw new IntegrationSkip('unknown_kind');
    }
    await touchIntegration(conn.row.id);
    await setSyncState(workspaceId, { last_sync_at: new Date().toISOString() });
  } catch (err) {
    // Solo códigos conocidos: un mensaje de Linear o de la base podría traer datos.
    if (err instanceof LinearApiError) throw new Error(err.code);
    if (err instanceof IntegrationSkip) throw err;
    if (err instanceof Error && ['issue_not_synced', 'linear_rejected', 'rate_limited'].includes(err.message)) throw err;
    // eslint-disable-next-line no-console
    console.error('[linear-sync] outbox failed', kind, err instanceof Error ? err.name : 'error');
    throw new Error('internal_error');
  }
}

async function pullIssue(conn: LinearConnection, id: string): Promise<void> {
  if (conn.config.direction === 'push') throw new IntegrationSkip('push_only');
  let node;
  try {
    node = (await linearCall<{ issue: Record<string, unknown> }>(conn, ISSUE_QUERY, { id })).issue;
  } catch (err) {
    if (err instanceof LinearApiError && err.code === 'not_found') throw new IntegrationSkip('not_found');
    throw err;
  }
  const res = await applyLinearIssue(conn, node, await linearContext(conn), await trackEmails(conn));
  if (res.created) await logIntegrationEvent(conn.workspaceId, 'linear', 'in', 'issue.created', `${res.identifier ?? ''} ${String(node.title ?? '')}`.trim().slice(0, 300));
  else if (res.pulled.length) await logIntegrationEvent(conn.workspaceId, 'linear', 'in', 'issue.updated', `${res.identifier ?? ''}: ${res.pulled.join(', ')}`);
  if (res.pushPending) {
    const local = await localIssueFor(conn.workspaceId, id);
    if (local) await enqueuePush(conn.workspaceId, 'push.issue', { issueId: local });
  }
}

async function pullComment(conn: LinearConnection, id: string): Promise<void> {
  if (conn.config.direction === 'push') throw new IntegrationSkip('push_only');
  type C = { id: string; body: string; issue: { id: string; identifier: string; team: { id: string } | null } | null };
  const page = (await linearCall<{ comments: Page<C> }>(conn, COMMENTS_QUERY, { after: null, filter: { id: { eq: id } } })).comments;
  const n = page.nodes[0];
  if (!n || !conn.config.teams.some((t) => t.id === n.issue?.team?.id)) throw new IntegrationSkip('not_synced');
  if (await applyLinearComment(conn, n)) await logIntegrationEvent(conn.workspaceId, 'linear', 'in', 'comment.created', `${n.issue?.identifier ?? ''}: ${String(n.body).slice(0, 120)}`);
}

async function pullAttachment(conn: LinearConnection, id: string): Promise<void> {
  if (conn.config.direction === 'push') throw new IntegrationSkip('push_only');
  type A = { id: string; url: string; title: string; issue: { id: string; identifier: string; team: { id: string } | null } | null };
  const page = (await linearCall<{ attachments: Page<A> }>(conn, ATTACHMENTS_QUERY, { after: null, filter: { id: { eq: id } } })).attachments;
  const n = page.nodes[0];
  if (!n || !conn.config.teams.some((t) => t.id === n.issue?.team?.id)) throw new IntegrationSkip('not_synced');
  if (await applyLinearAttachment(conn, n)) await logIntegrationEvent(conn.workspaceId, 'linear', 'in', 'attachment.created', `${n.issue?.identifier ?? ''}: ${n.title || n.url}`.slice(0, 300));
}

// ---------- Eventos de Track (lib/track-events) ----------

const CHANGE_FIELDS: Array<[SyncField, (i: TrackIssueWithStatus) => unknown]> = [
  ['title', (i) => i.title],
  ['description', (i) => i.description],
  ['priority', (i) => i.priority],
  ['estimate', (i) => i.estimate],
  ['status', (i) => `${i.status_id}|${i.triage}`],
  ['assignee', (i) => i.assignee_id],
  ['labels', (i) => labelNamesOf(i.labels).map((l) => l.toLowerCase()).sort().join('|')],
  ['dueDate', (i) => i.due_date],
  ['parent', (i) => i.parent_id],
  ['project', (i) => i.plan_id],
  ['milestone', (i) => i.plan_milestone_id],
  ['cycle', (i) => i.cycle_id],
];

export function changedSyncFields(before: TrackIssueWithStatus, after: TrackIssueWithStatus): SyncField[] {
  return CHANGE_FIELDS.filter(([, get]) => (get(before) ?? null) !== (get(after) ?? null)).map(([f]) => f);
}

/**
 * Un cambio en Track: si no vino de Linear (via 'linear') ni de un import,
 * marca la hora del cambio por campo y encola el envío. Devuelve cuántas filas
 * encoló (lib/track-events las intenta en el momento).
 */
export async function linearOnTrackEvent(ws: string, event: TrackEventInput, ctx: TrackEventContext, issue: TrackIssueWithStatus): Promise<number> {
  if (ctx.via === 'linear' || ctx.via === 'import') return 0;
  if (event.type !== 'issue.created' && event.type !== 'issue.updated' && event.type !== 'comment.created') return 0;
  const conn = await getLinearConnection(ws);
  if (!conn || conn.config.direction === 'import') return 0;
  const state = await getSyncState(ws);
  if (!state || (state.phase !== 'live' && state.phase !== 'importing')) return 0;
  if (!(await linearTeamForProject(conn, issue.project_id))) return 0;
  const now = new Date().toISOString();
  if (event.type === 'issue.updated') {
    const fields = changedSyncFields(event.before, event.after);
    if (!fields.length) return 0;
    await markLocal(ws, issue.id, fields, now);
  } else if (event.type === 'issue.created') {
    await markLocal(ws, issue.id, ['title'], now);
  }
  // En pausa queda marcado: sale al reanudar.
  if (conn.config.paused) return 0;
  if (event.type === 'comment.created') return (await enqueuePush(ws, 'push.comment', { commentId: event.commentId, issueId: issue.id })) ? 1 : 0;
  return (await enqueuePush(ws, 'push.issue', { issueId: issue.id })) ? 1 : 0;
}

// ---------- Webhooks de Linear ----------

export interface WebhookOutcome {
  status: number;
  queued: Array<{ workspaceId: string; outboxId: string | null }>;
}

/**
 * Webhook de Linear: se verifica la firma con el secreto de cada conexión de
 * esa organización (el de la app OAuth o el del webhook propio) y solo las que
 * verifican encolan. Nunca se usa nada del cuerpo antes de verificar, salvo el
 * id de la organización para saber con qué secretos probar.
 */
export async function handleLinearWebhook(rawBody: string, signature: string | null, now = Date.now()): Promise<WebhookOutcome> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, queued: [] };
  }
  const orgId = typeof body.organizationId === 'string' ? body.organizationId : '';
  if (!orgId) return { status: 401, queued: [] };
  const rows = (await getDb()
    .prepare("SELECT * FROM track_integrations WHERE provider = 'linear' AND json_extract(config, '$.orgId') = ?")
    .all(orgId)) as IntegrationRow[];
  const verified: LinearConnection[] = [];
  for (const row of rows) {
    const conn = toConnection(row);
    if (!conn) continue;
    const secret = conn.config.webhook.mode === 'app' ? process.env.LINEAR_WEBHOOK_SECRET : conn.config.webhook.mode === 'own' ? conn.secrets.webhookSecret : null;
    if (conn.config.webhook.mode === 'own' && conn.config.webhook.id && body.webhookId !== conn.config.webhook.id) continue;
    if (verifyLinearSignature(rawBody, signature, secret)) verified.push(conn);
  }
  if (!verified.length) return { status: 401, queued: [] };
  // Viejo (un reenvío capturado): firmado pero no se usa.
  if (!webhookIsFresh(body.webhookTimestamp, now)) return { status: 400, queued: [] };

  const type = String(body.type ?? '');
  const action = String(body.action ?? '');
  const data = (body.data ?? {}) as Record<string, unknown>;
  const queued: WebhookOutcome['queued'] = [];
  for (const conn of verified) {
    const ws = conn.workspaceId;
    if (conn.config.paused || conn.config.direction === 'push') continue;
    const state = await getSyncState(ws);
    if (state?.phase !== 'live') continue;
    const teamId = (data.teamId as string | undefined) ?? ((data.issue as Record<string, unknown> | undefined)?.teamId as string | undefined);
    if (teamId && !conn.config.teams.some((t) => t.id === teamId)) continue;
    let kind: string | null = null;
    if (type === 'Issue' && (action === 'create' || action === 'update')) kind = 'pull.issue';
    else if (type === 'Comment' && (action === 'create' || action === 'update')) kind = 'pull.comment';
    else if (type === 'Attachment' && action === 'create') kind = 'pull.attachment';
    else if (type === 'IssueRelation' && action === 'create') {
      // Se trae el issue: la relación entra con la próxima reconciliación del import.
      kind = null;
    } else if (action === 'remove' && type === 'Issue') {
      await logIntegrationEvent(ws, 'linear', 'in', 'issue.removed', `${String(data.identifier ?? '')} ${String(data.title ?? '')}`.trim().slice(0, 300));
    }
    if (!kind || typeof data.id !== 'string') continue;
    await touchIntegration(conn.row.id);
    const before = await getDb()
      .prepare("SELECT id FROM track_integration_outbox WHERE workspace_id = ? AND provider = 'linear' AND kind = ? AND status = 'pending' AND attempts = 0 AND json_extract(payload, '$.id') = ? LIMIT 1")
      .get(ws, kind, data.id);
    if (before) continue;
    queued.push({ workspaceId: ws, outboxId: await enqueueOutbox(ws, 'linear', kind, { id: data.id }) });
  }
  return { status: 200, queued };
}

// ---------- Import inicial ----------

/** Arranca el import de los teams elegidos (con el token de la conexión; se avanza solo). */
export async function startLinearImport(workspaceId: string): Promise<string> {
  const conn = await getLinearConnection(workspaceId);
  if (!conn) throw new LinearApiError('unauthorized');
  if (!conn.config.teams.length) throw new Error('no_teams');
  const { createImportJob } = await import('./import-jobs');
  const job = await createImportJob({
    workspaceId: conn.config.jobWorkspaceId,
    teamId: conn.config.jobTeamId,
    userId: conn.config.connectedBy,
    app: 'track',
    source: 'linear',
    locale: conn.config.locale || 'en',
    secret: authHeader(conn),
    options: { target: 'new', linearTeams: conn.config.teams, autoStart: true, linearSync: true },
  });
  const state = await getSyncState(workspaceId);
  await setSyncState(workspaceId, {
    phase: 'importing',
    import_job_id: job.id,
    last_error: null,
    // Desde cuándo traer cambios al terminar: lo que cambió en Linear mientras se importaba.
    since: state?.since ?? job.created_at,
    reconcile_cursor: null,
    next_reconcile_at: null,
  });
  await logIntegrationEvent(workspaceId, 'linear', 'in', 'import.started', conn.config.teams.map((t) => t.key).join(', '));
  return job.id;
}

/** Fase según el import: terminado → en vivo; falló → error; cancelado → a elegir de nuevo. */
async function advanceImportPhase(ws: string, state: LinearSyncState): Promise<LinearSyncState> {
  if (state.phase !== 'importing' || !state.import_job_id) return state;
  const { getImportJob } = await import('./import-jobs');
  const job = await getImportJob(state.import_job_id);
  if (!job) {
    await setSyncState(ws, { phase: 'setup', import_job_id: null });
  } else if (job.status === 'done') {
    await setSyncState(ws, { phase: 'live', last_sync_at: job.finished_at ?? new Date().toISOString(), next_reconcile_at: new Date().toISOString() });
    await logIntegrationEvent(ws, 'linear', 'in', 'import.done', `${Number(job.report?.issues ?? 0)} + ${Number(job.report?.updated ?? 0)}`);
  } else if (job.status === 'failed') {
    await setSyncState(ws, { phase: 'error', last_error: job.error ?? 'import_failed' });
    await logIntegrationEvent(ws, 'linear', 'in', 'import.failed', job.error ?? 'import_failed', false);
  } else if (job.status === 'cancelled') {
    await setSyncState(ws, { phase: 'setup' });
  }
  return (await getSyncState(ws)) ?? state;
}

// ---------- Reconciliación ----------

interface ReconcileCursor {
  phase: 'issues' | 'comments' | 'attachments';
  after: string | null;
}

/** Trae de Linear lo que cambió desde el último pase (por si se perdió un webhook). Reanudable. */
export async function reconcileLinear(workspaceId: string, budgetMs = 20_000): Promise<{ done: boolean; issues: number; comments: number }> {
  const start = Date.now();
  const conn = await getLinearConnection(workspaceId);
  const state = await getSyncState(workspaceId);
  const out = { done: true, issues: 0, comments: 0 };
  if (!conn || !state || state.phase !== 'live' || conn.config.paused || conn.config.direction === 'push' || !conn.config.teams.length) return out;
  const runStart = new Date(Date.now() - 60_000).toISOString();
  const since = state.since ?? '1970-01-01T00:00:00.000Z';
  let cursor: ReconcileCursor = { phase: 'issues', after: null };
  try {
    if (state.reconcile_cursor) cursor = JSON.parse(state.reconcile_cursor) as ReconcileCursor;
  } catch {
    // Cursor roto: de nuevo desde el principio (aplicar dos veces no cambia nada).
  }
  const lc = await linearContext(conn);
  const emails = await trackEmails(conn);
  const teamIds = conn.config.teams.map((t) => t.id);
  while (Date.now() - start < budgetMs) {
    if (cursor.phase === 'issues') {
      const page = (await linearCall<{ issues: Page<Record<string, unknown>> }>(conn, ISSUES_SINCE_QUERY, {
        after: cursor.after,
        filter: { updatedAt: { gt: since }, team: { id: { in: teamIds } } },
      })).issues;
      for (const n of page.nodes) {
        const res = await applyLinearIssue(conn, n, lc, emails);
        if (res.created || res.pulled.length) {
          out.issues += 1;
          await logIntegrationEvent(workspaceId, 'linear', 'in', res.created ? 'issue.created' : 'issue.updated', `${res.identifier ?? ''}${res.pulled.length ? `: ${res.pulled.join(', ')}` : ` ${String(n.title ?? '')}`}`.slice(0, 300));
        }
        if (res.pushPending) {
          const local = await localIssueFor(workspaceId, String(n.id));
          if (local) await enqueuePush(workspaceId, 'push.issue', { issueId: local });
        }
      }
      cursor = page.pageInfo.hasNextPage && page.pageInfo.endCursor ? { phase: 'issues', after: page.pageInfo.endCursor } : { phase: 'comments', after: null };
    } else if (cursor.phase === 'comments') {
      type C = { id: string; body: string; issue: { id: string; identifier: string; team: { id: string } | null } | null };
      const page = (await linearCall<{ comments: Page<C> }>(conn, COMMENTS_QUERY, { after: cursor.after, filter: { updatedAt: { gt: since } } })).comments;
      for (const n of page.nodes) {
        if (!teamIds.includes(n.issue?.team?.id ?? '')) continue;
        if (await applyLinearComment(conn, n)) out.comments += 1;
      }
      cursor = page.pageInfo.hasNextPage && page.pageInfo.endCursor ? { phase: 'comments', after: page.pageInfo.endCursor } : { phase: 'attachments', after: null };
    } else {
      type A = { id: string; url: string; issue: { id: string; identifier: string; team: { id: string } | null } | null };
      const page = (await linearCall<{ attachments: Page<A> }>(conn, ATTACHMENTS_QUERY, { after: cursor.after, filter: { updatedAt: { gt: since } } })).attachments;
      for (const n of page.nodes) if (teamIds.includes(n.issue?.team?.id ?? '')) await applyLinearAttachment(conn, n);
      if (page.pageInfo.hasNextPage && page.pageInfo.endCursor) cursor = { phase: 'attachments', after: page.pageInfo.endCursor };
      else {
        await setSyncState(workspaceId, { since: runStart, reconcile_cursor: null, last_sync_at: new Date().toISOString(), last_error: null });
        if (out.comments) await logIntegrationEvent(workspaceId, 'linear', 'in', 'comments', String(out.comments));
        return out;
      }
    }
    await setSyncState(workspaceId, { reconcile_cursor: JSON.stringify(cursor) });
  }
  out.done = false;
  return out;
}

/**
 * Cron de cada minuto: por conexión (claim por locked_until), pasa la fase
 * del import y reconcilia cada 5 minutos.
 */
export async function runLinearSyncCron(opts: { budgetMs?: number; now?: Date } = {}): Promise<{ checked: number; reconciled: number }> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const now = (opts.now ?? new Date()).toISOString();
  const db = getDb();
  const due = (await db
    .prepare(
      `SELECT workspace_id FROM track_linear_sync_state
       WHERE phase IN ('importing', 'live') AND (locked_until IS NULL OR locked_until < ?) AND (next_reconcile_at IS NULL OR next_reconcile_at <= ? OR phase = 'importing')
       ORDER BY next_reconcile_at LIMIT 10`,
    )
    .all(now, now)) as Array<{ workspace_id: string }>;
  let reconciled = 0;
  for (const d of due) {
    const left = budget - (Date.now() - start);
    if (left < 2_000) break;
    const claimed = await db
      .prepare('UPDATE track_linear_sync_state SET locked_until = ? WHERE workspace_id = ? AND (locked_until IS NULL OR locked_until < ?)')
      .run(new Date(Date.now() + left + 60_000).toISOString(), d.workspace_id, now);
    if (!claimed.changes) continue;
    try {
      let state = await getSyncState(d.workspace_id);
      if (!state) continue;
      state = await advanceImportPhase(d.workspace_id, state);
      if (state.phase === 'live' && (!state.next_reconcile_at || state.next_reconcile_at <= now)) {
        const res = await reconcileLinear(d.workspace_id, Math.min(left - 1_000, 30_000));
        reconciled += 1;
        await setSyncState(d.workspace_id, { next_reconcile_at: new Date(Date.now() + (res.done ? RECONCILE_EVERY_MS : 0)).toISOString() });
      }
    } catch (err) {
      const code = err instanceof LinearApiError ? err.code : 'internal_error';
      await setSyncState(d.workspace_id, { last_error: code, next_reconcile_at: new Date(Date.now() + RECONCILE_EVERY_MS).toISOString() });
      await logIntegrationEvent(d.workspace_id, 'linear', 'in', 'reconcile', code, false);
    } finally {
      await db.prepare('UPDATE track_linear_sync_state SET locked_until = NULL WHERE workspace_id = ?').run(d.workspace_id);
    }
  }
  return { checked: due.length, reconciled };
}

/** "Sincronizar ahora": reconciliación inmediata (con el mismo claim que el cron). */
export async function syncLinearNow(workspaceId: string): Promise<boolean> {
  await getDb().prepare("UPDATE track_linear_sync_state SET next_reconcile_at = NULL WHERE workspace_id = ? AND phase = 'live'").run(workspaceId);
  const now = new Date().toISOString();
  const claimed = await getDb()
    .prepare('UPDATE track_linear_sync_state SET locked_until = ? WHERE workspace_id = ? AND (locked_until IS NULL OR locked_until < ?)')
    .run(new Date(Date.now() + 90_000).toISOString(), workspaceId, now);
  if (!claimed.changes) return false;
  try {
    let state = await getSyncState(workspaceId);
    if (state) state = await advanceImportPhase(workspaceId, state);
    if (state?.phase !== 'live') return true;
    const res = await reconcileLinear(workspaceId, 20_000);
    await setSyncState(workspaceId, { next_reconcile_at: new Date(Date.now() + (res.done ? RECONCILE_EVERY_MS : 0)).toISOString() });
    return true;
  } catch (err) {
    await setSyncState(workspaceId, { last_error: err instanceof LinearApiError ? err.code : 'internal_error' });
    throw err;
  } finally {
    await getDb().prepare('UPDATE track_linear_sync_state SET locked_until = NULL WHERE workspace_id = ?').run(workspaceId);
  }
}

/** Vuelve a la cola lo que falló (todo o una fila). */
export async function retryLinearFailures(workspaceId: string, id?: string): Promise<number> {
  const res = await getDb()
    .prepare(
      `UPDATE track_integration_outbox SET status = 'pending', attempts = 0, next_attempt_at = NULL, locked_until = NULL, last_error = NULL
       WHERE workspace_id = ? AND provider = 'linear' AND status = 'failed' ${id ? 'AND id = ?' : ''}`,
    )
    .run(...(id ? [workspaceId, id] : [workspaceId]));
  await setSyncState(workspaceId, { rate_limited_until: null });
  return res.changes;
}

// ---------- Vista para Ajustes ----------

export interface LinearFailure {
  id: string;
  kind: string;
  error: string | null;
  attempts: number;
  createdAt: string;
}

export interface LinearSyncView {
  oauthAvailable: boolean;
  connection: {
    authType: LinearSyncConfig['authType'];
    orgName: string;
    orgUrlKey: string;
    viewerName: string;
    teams: LinearTeamRef[];
    direction: LinearDirection;
    paused: boolean;
    webhookMode: LinearSyncConfig['webhook']['mode'];
    webhookError: string | null;
    connectedAt: string;
  } | null;
  phase: LinearPhase;
  lastSyncAt: string | null;
  lastError: string | null;
  rateLimitedUntil: string | null;
  importJobId: string | null;
  pending: number;
  failed: LinearFailure[];
  log: IntegrationEvent[];
}

export async function linearSyncView(workspaceId: string, withLog: boolean): Promise<LinearSyncView> {
  const conn = await getLinearConnection(workspaceId);
  let state = await getSyncState(workspaceId);
  if (conn && state) state = await advanceImportPhase(workspaceId, state);
  const db = getDb();
  const pending = conn
    ? Number(((await db.prepare("SELECT COUNT(*) AS n FROM track_integration_outbox WHERE workspace_id = ? AND provider = 'linear' AND status = 'pending'").get(workspaceId)) as { n: number }).n)
    : 0;
  const failed = conn && withLog
    ? ((await db
        .prepare("SELECT id, kind, last_error, attempts, created_at FROM track_integration_outbox WHERE workspace_id = ? AND provider = 'linear' AND status = 'failed' ORDER BY created_at DESC LIMIT 20")
        .all(workspaceId)) as Array<{ id: string; kind: string; last_error: string | null; attempts: number; created_at: string }>).map((r) => ({
        id: r.id,
        kind: r.kind,
        error: r.last_error,
        attempts: r.attempts,
        createdAt: r.created_at,
      }))
    : [];
  return {
    oauthAvailable: linearOAuthConfigured(),
    connection: conn
      ? {
          authType: conn.config.authType,
          orgName: conn.config.orgName,
          orgUrlKey: conn.config.orgUrlKey,
          viewerName: conn.config.viewerName,
          teams: conn.config.teams,
          direction: conn.config.direction,
          paused: conn.config.paused,
          webhookMode: conn.config.webhook.mode,
          webhookError: conn.config.webhook.error ?? null,
          connectedAt: conn.row.created_at,
        }
      : null,
    phase: conn ? (state?.phase ?? 'setup') : 'setup',
    lastSyncAt: state?.last_sync_at ?? null,
    lastError: state?.last_error ?? null,
    rateLimitedUntil: state?.rate_limited_until && state.rate_limited_until > new Date().toISOString() ? state.rate_limited_until : null,
    importJobId: state?.phase === 'importing' ? state.import_job_id : null,
    pending,
    failed,
    log: withLog && conn ? await listIntegrationEvents(workspaceId, 'linear', 30) : [],
  };
}
