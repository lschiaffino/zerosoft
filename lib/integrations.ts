import { getDb, type IntegrationRow } from './db';
import { open, seal } from './secret-box';

/**
 * Integraciones OAuth de Google (Gmail read-only para el CRM, Google Calendar
 * para Cal). Reutiliza GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET de next-auth; el
 * flujo es independiente porque necesita scopes extra + refresh token offline.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function gmailRedirectUri(): string {
  return `${appBase()}/api/integrations/gmail/callback`;
}

export function googleCalendarRedirectUri(): string {
  return `${appBase()}/api/integrations/google-calendar/callback`;
}

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(opts: { redirectUri: string; scope: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: opts.scope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function gmailAuthUrl(state: string): string {
  return googleAuthUrl({
    redirectUri: gmailRedirectUri(),
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
    state,
  });
}

/** Email de la cuenta de Google (OpenID userinfo; sirve para cualquier scope). */
export async function googleAccountEmail(token: string): Promise<string> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res?.ok) return '';
  const data = (await res.json().catch(() => null)) as { email?: string } | null;
  return data?.email ?? '';
}

export async function getIntegration(
  userId: string,
  provider: string,
): Promise<IntegrationRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM integrations WHERE user_id = ? AND provider = ?')
    .get(userId, provider)) as IntegrationRow | undefined;
  if (!row) return null;
  // Los tokens se guardan cifrados (lib/secret-box.ts); acá se devuelven en claro.
  return { ...row, access_token: open(row.access_token), refresh_token: open(row.refresh_token) };
}

export async function upsertIntegration(input: {
  userId: string;
  provider: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO integrations
         (user_id, provider, email, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, provider) DO UPDATE SET
         email = excluded.email,
         access_token = excluded.access_token,
         refresh_token = CASE WHEN excluded.refresh_token = '' THEN integrations.refresh_token
                              ELSE excluded.refresh_token END,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = datetime('now')`,
    )
    .run(
      input.userId,
      input.provider,
      input.email,
      seal(input.accessToken),
      input.refreshToken ? seal(input.refreshToken) : '',
      input.expiresAt,
      input.scope,
    );
}

export async function deleteIntegration(userId: string, provider: string): Promise<void> {
  await getDb()
    .prepare('DELETE FROM integrations WHERE user_id = ? AND provider = ?')
    .run(userId, provider);
}

export async function touchIntegrationSync(userId: string, provider: string): Promise<void> {
  await getDb()
    .prepare("UPDATE integrations SET last_sync_at = datetime('now') WHERE user_id = ? AND provider = ?")
    .run(userId, provider);
}

// ---------- Google OAuth ----------

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return (await res.json().catch(() => ({ error: 'bad_response' }))) as GoogleTokenResponse;
}

export async function exchangeCode(code: string, redirectUri = gmailRedirectUri()): Promise<GoogleTokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: redirectUri,
  });
}

/**
 * Access token válido: lo refresca si venció (o está por vencer en 60s).
 * Devuelve null si no se pudo (refresh revocado, etc.).
 */
export async function getValidAccessToken(row: IntegrationRow): Promise<string | null> {
  if (row.access_token && row.expires_at > Date.now() + 60_000) return row.access_token;
  if (!row.refresh_token) return null;
  const tok = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  });
  if (!tok.access_token) return null;
  const expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
  await getDb()
    .prepare(
      "UPDATE integrations SET access_token = ?, expires_at = ?, updated_at = datetime('now') WHERE user_id = ? AND provider = ?",
    )
    .run(seal(tok.access_token), expiresAt, row.user_id, row.provider);
  return tok.access_token;
}

// ---------- Gmail API ----------

async function gmailFetch<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export async function gmailProfileEmail(token: string): Promise<string> {
  const profile = await gmailFetch<{ emailAddress?: string }>(token, '/profile');
  return profile?.emailAddress ?? '';
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
}

/** IDs de mensajes que matchean la query (más recientes primero). */
export async function gmailListMessageIds(
  token: string,
  query: string,
  maxResults = 10,
): Promise<Array<{ id: string; threadId: string }>> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const data = await gmailFetch<GmailListResponse>(token, `/messages?${params.toString()}`);
  return data?.messages ?? [];
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  internalDate: string; // ISO
}

interface GmailMessageResponse {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

/** Metadata mínima de un mensaje (Subject/From/To/Date + snippet). */
export async function gmailGetMessageMeta(
  token: string,
  id: string,
): Promise<GmailMessageMeta | null> {
  const params = new URLSearchParams({
    format: 'metadata',
    'metadataHeaders': 'Subject',
  });
  params.append('metadataHeaders', 'From');
  params.append('metadataHeaders', 'To');
  params.append('metadataHeaders', 'Date');
  const data = await gmailFetch<GmailMessageResponse>(
    token,
    `/messages/${encodeURIComponent(id)}?${params.toString()}`,
  );
  if (!data?.id) return null;
  const headers = new Map(
    (data.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  const internalMs = Number(data.internalDate ?? 0);
  return {
    id: data.id,
    threadId: data.threadId ?? '',
    subject: headers.get('subject') ?? '',
    from: headers.get('from') ?? '',
    to: headers.get('to') ?? '',
    snippet: data.snippet ?? '',
    internalDate: internalMs ? new Date(internalMs).toISOString() : new Date().toISOString(),
  };
}
