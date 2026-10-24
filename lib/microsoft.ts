/**
 * Microsoft 365 / Outlook para el CRM: OAuth 2.0 (identity platform v2) y
 * Microsoft Graph REST. Lo que usa el CRM: perfil, delta de Bandeja de entrada
 * y Enviados, delta del calendario (reuniones al timeline) y envío como el
 * usuario (borrador + send, para tener id y conversationId del mensaje).
 *
 * Sin SDK: fetch directo, así los unit tests mockean `fetch`. Con
 * MS_GRAPH_FAKE=1 (y NODE_ENV=test o DEMO_MODE=true) todo va contra el
 * proveedor falso en memoria (lib/microsoft-fake.ts): nada sale a la red.
 *
 * Config: MS_CLIENT_ID, MS_CLIENT_SECRET y opcional MS_TENANT_ID (default
 * "common": cuentas de trabajo y personales). Redirect URI a registrar en
 * Entra ID: <NEXTAUTH_URL>/api/integrations/outlook/callback. Server-only.
 */
import { fakeGraphFetch, fakeMicrosoftAllowed, fakeTokenResponse } from './microsoft-fake';
import type { ParsedGmailMessage } from './gmail';

export const OUTLOOK_PROVIDER = 'outlook';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Lectura y borradores (Mail.ReadWrite), envío, calendario y refresh token. */
export const OUTLOOK_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'User.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
];

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function tenant(): string {
  return (process.env.MS_TENANT_ID || 'common').replace(/[^A-Za-z0-9.-]/g, '') || 'common';
}

export function outlookRedirectUri(): string {
  return `${appBase()}/api/integrations/outlook/callback`;
}

export function microsoftConfigured(): boolean {
  return fakeMicrosoftAllowed() || Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function outlookAuthUrl(state: string): string {
  if (fakeMicrosoftAllowed()) {
    return `${outlookRedirectUri()}?${new URLSearchParams({ code: 'fake-code', state }).toString()}`;
  }
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: outlookRedirectUri(),
    response_mode: 'query',
    scope: OUTLOOK_SCOPES.join(' '),
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export interface MsTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<MsTokenResponse> {
  if (fakeMicrosoftAllowed()) return fakeTokenResponse(params);
  const res = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID ?? '',
      client_secret: process.env.MS_CLIENT_SECRET ?? '',
      ...params,
    }),
  }).catch(() => null);
  if (!res) return { error: 'network_error' };
  return (await res.json().catch(() => ({ error: 'bad_response' }))) as MsTokenResponse;
}

export function exchangeOutlookCode(code: string): Promise<MsTokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: outlookRedirectUri(),
    scope: OUTLOOK_SCOPES.join(' '),
  });
}

/** Microsoft rota el refresh token: quien llama guarda el nuevo si viene. */
export function refreshOutlookToken(refreshToken: string): Promise<MsTokenResponse> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: OUTLOOK_SCOPES.join(' ') });
}

/** El token incluye envío (Mail.Send). */
export function outlookScopeAllowsSend(scope: string | null | undefined): boolean {
  return (scope ?? '').toLowerCase().split(/\s+/).some((s) => s === 'mail.send' || s.endsWith('/mail.send'));
}

// ---------- Graph ----------

export class GraphApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function graphRequest<T>(token: string, pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  // Solo se siguen links de Graph (nextLink/deltaLink): nunca otra URL con el token.
  if (!url.startsWith(`${GRAPH}/`)) throw new GraphApiError(0, 'invalid_url');
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    // Ids inmutables: el id de un mensaje no cambia al moverse a Enviados.
    prefer: 'IdType="ImmutableId", odata.maxpagesize=50, outlook.timezone="UTC"',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const doFetch = fakeMicrosoftAllowed() ? fakeGraphFetch : fetch;
  const res = await doFetch(url, { ...init, headers }).catch(() => null);
  if (!res) throw new GraphApiError(0, 'network_error');
  if (!res.ok) throw new GraphApiError(res.status, `graph_${res.status}`);
  if (res.status === 202 || res.status === 204) return {} as T;
  return (await res.json().catch(() => ({}))) as T;
}

export async function graphMe(token: string): Promise<{ email: string; name: string }> {
  const me = await graphRequest<{ mail?: string | null; userPrincipalName?: string; displayName?: string }>(
    token,
    '/me?$select=mail,userPrincipalName,displayName',
  );
  return { email: (me.mail || me.userPrincipalName || '').toLowerCase(), name: me.displayName ?? '' };
}

interface GraphAddress {
  emailAddress?: { address?: string; name?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string | null;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphAddress;
  sender?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isDraft?: boolean;
  '@removed'?: { reason: string };
}

export interface DeltaPage<T> {
  items: T[];
  nextLink: string | null;
  deltaLink: string | null;
}

const MESSAGE_SELECT =
  'id,conversationId,internetMessageId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft';

export type MailFolder = 'inbox' | 'sentitems';

/**
 * Primera página del delta de una carpeta (últimos `days` días) o la
 * siguiente desde un nextLink/deltaLink guardado.
 */
export async function graphMessagesDelta(
  token: string,
  folder: MailFolder,
  link: string | null,
  days = 30,
): Promise<DeltaPage<GraphMessage>> {
  let url = link;
  if (!url) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const params = new URLSearchParams({ $select: MESSAGE_SELECT, $filter: `receivedDateTime ge ${since}` });
    url = `/me/mailFolders/${folder}/messages/delta?${params.toString()}`;
  }
  const data = await graphRequest<{ value?: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(
    token,
    url,
  );
  return { items: data.value ?? [], nextLink: data['@odata.nextLink'] ?? null, deltaLink: data['@odata.deltaLink'] ?? null };
}

function addr(a: GraphAddress | undefined): string {
  const e = a?.emailAddress;
  if (!e?.address) return '';
  return e.name && e.name !== e.address ? `${e.name} <${e.address}>` : e.address;
}

/**
 * Mensaje de Graph → la forma que guarda el sync de Gmail (crm_emails), así
 * comparten el guardado. Los enviados llevan la etiqueta SENT y los borradores DRAFT.
 */
export function graphToParsed(m: GraphMessage, folder: MailFolder): ParsedGmailMessage {
  const html = m.body?.contentType?.toLowerCase() === 'html' ? (m.body.content ?? '') : '';
  const text = m.body?.contentType?.toLowerCase() === 'text' ? (m.body.content ?? '') : '';
  const labels: string[] = [];
  if (folder === 'sentitems') labels.push('SENT');
  if (m.isDraft) labels.push('DRAFT');
  return {
    id: m.id,
    threadId: m.conversationId ?? '',
    labelIds: labels,
    subject: m.subject ?? '',
    from: addr(m.from ?? m.sender),
    to: (m.toRecipients ?? []).map(addr).filter(Boolean).join(', '),
    cc: (m.ccRecipients ?? []).map(addr).filter(Boolean).join(', '),
    messageId: m.internetMessageId ?? '',
    inReplyTo: '',
    references: '',
    snippet: (m.bodyPreview ?? '').slice(0, 500),
    text,
    html,
    internalDate: new Date(m.receivedDateTime || m.sentDateTime || Date.now()).toISOString(),
  };
}

export interface GraphEvent {
  id: string;
  iCalUId?: string;
  subject?: string | null;
  bodyPreview?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  location?: { displayName?: string };
  organizer?: GraphAddress;
  attendees?: Array<GraphAddress & { type?: string }>;
  '@removed'?: { reason: string };
}

/** Delta de calendarView: ventana fija (-days..+ahead) definida en la primera página. */
export async function graphCalendarDelta(
  token: string,
  link: string | null,
  opts: { days?: number; ahead?: number; now?: Date } = {},
): Promise<DeltaPage<GraphEvent>> {
  let url = link;
  if (!url) {
    const now = opts.now ?? new Date();
    const start = new Date(now.getTime() - (opts.days ?? 30) * 86_400_000).toISOString();
    const end = new Date(now.getTime() + (opts.ahead ?? 60) * 86_400_000).toISOString();
    url = `/me/calendarView/delta?${new URLSearchParams({ startDateTime: start, endDateTime: end }).toString()}`;
  }
  const data = await graphRequest<{ value?: GraphEvent[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(
    token,
    url,
  );
  return { items: data.value ?? [], nextLink: data['@odata.nextLink'] ?? null, deltaLink: data['@odata.deltaLink'] ?? null };
}

/** dateTime de Graph (UTC por el header Prefer, sin "Z") → Date. */
export function graphDate(d: { dateTime?: string; timeZone?: string } | undefined): Date | null {
  if (!d?.dateTime) return null;
  const raw = d.dateTime;
  const iso = /[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t;
}

export interface GraphSendInput {
  to: string;
  subject: string;
  html: string;
  /** Responder: id (Graph) del último mensaje del thread. */
  replyToId?: string | null;
}

/**
 * Envía como el usuario: crea el borrador (o la respuesta), lo envía y
 * devuelve id, conversationId e internetMessageId (con ids inmutables el id
 * sigue valiendo en Enviados).
 */
export async function graphSendMail(
  token: string,
  input: GraphSendInput,
): Promise<{ id: string; conversationId: string; internetMessageId: string }> {
  const toRecipients = input.to
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
  const body = { contentType: 'HTML', content: input.html };
  let draft: GraphMessage;
  if (input.replyToId) {
    draft = await graphRequest<GraphMessage>(token, `/me/messages/${encodeURIComponent(input.replyToId)}/createReply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    draft = {
      ...draft,
      ...(await graphRequest<GraphMessage>(token, `/me/messages/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, toRecipients }),
      })),
    };
  } else {
    draft = await graphRequest<GraphMessage>(token, '/me/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: input.subject, body, toRecipients }),
    });
  }
  if (!draft.id) throw new GraphApiError(0, 'draft_failed');
  await graphRequest(token, `/me/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST' });
  return { id: draft.id, conversationId: draft.conversationId ?? '', internetMessageId: draft.internetMessageId ?? '' };
}
