/**
 * Gmail API (REST) — lo que necesita el CRM: perfil + historyId, history
 * incremental, listado para el sync completo, mensaje completo parseado
 * (headers, cuerpo texto/HTML) y envío como el usuario (gmail.send).
 * Sin SDK: fetch directo, así los tests mockean `fetch` y nada sale a la red.
 * Server-only.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** El token tiene permiso de envío (conexiones viejas solo tenían lectura). */
export function scopeAllowsSend(scope: string | null | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(GMAIL_SEND_SCOPE);
}

export class GmailApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gmailRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  }).catch(() => null);
  if (!res) throw new GmailApiError(0, 'network_error');
  if (!res.ok) throw new GmailApiError(res.status, `gmail_${res.status}`);
  return (await res.json().catch(() => ({}))) as T;
}

export async function gmailProfile(token: string): Promise<{ emailAddress: string; historyId: string }> {
  const p = await gmailRequest<{ emailAddress?: string; historyId?: string }>(token, '/profile');
  return { emailAddress: p.emailAddress ?? '', historyId: String(p.historyId ?? '') };
}

export interface GmailHistoryPage {
  /** Ids de mensajes agregados, en orden, con el id del registro de history. */
  added: Array<{ id: string; threadId: string; historyId: string }>;
  nextPageToken: string | null;
  historyId: string;
}

/**
 * Cambios desde startHistoryId (solo messageAdded). Si el historyId es muy
 * viejo Gmail responde 404: quien llama hace un sync completo.
 */
export async function gmailListHistory(
  token: string,
  startHistoryId: string,
  pageToken?: string | null,
): Promise<GmailHistoryPage> {
  const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '100' });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await gmailRequest<{
    history?: Array<{ id: string; messagesAdded?: Array<{ message: { id: string; threadId: string } }> }>;
    nextPageToken?: string;
    historyId?: string;
  }>(token, `/history?${params.toString()}`);
  const added: GmailHistoryPage['added'] = [];
  for (const h of data.history ?? []) {
    for (const m of h.messagesAdded ?? []) {
      added.push({ id: m.message.id, threadId: m.message.threadId, historyId: String(h.id) });
    }
  }
  return { added, nextPageToken: data.nextPageToken ?? null, historyId: String(data.historyId ?? startHistoryId) };
}

export async function gmailListMessages(
  token: string,
  q: string,
  maxResults: number,
  pageToken?: string | null,
): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken: string | null }> {
  const params = new URLSearchParams({ q, maxResults: String(Math.min(Math.max(maxResults, 1), 500)) });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await gmailRequest<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string }>(
    token,
    `/messages?${params.toString()}`,
  );
  return { messages: data.messages ?? [], nextPageToken: data.nextPageToken ?? null };
}

// ---------- Parseo de mensajes ----------

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface ParsedGmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  subject: string;
  from: string;
  to: string;
  cc: string;
  messageId: string;
  inReplyTo: string;
  references: string;
  snippet: string;
  text: string;
  html: string;
  internalDate: string; // ISO
}

function b64urlDecode(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function collectBodies(part: GmailPart | undefined, out: { text: string[]; html: string[] }): void {
  if (!part) return;
  if (part.filename) return; // adjuntos: no se guardan
  const mime = (part.mimeType ?? '').toLowerCase();
  if (part.body?.data) {
    if (mime === 'text/plain') out.text.push(b64urlDecode(part.body.data));
    else if (mime === 'text/html') out.html.push(b64urlDecode(part.body.data));
  }
  for (const p of part.parts ?? []) collectBodies(p, out);
}

export function parseGmailMessage(data: GmailMessage): ParsedGmailMessage {
  const headers = new Map((data.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const bodies = { text: [] as string[], html: [] as string[] };
  collectBodies(data.payload, bodies);
  const internalMs = Number(data.internalDate ?? 0);
  return {
    id: data.id,
    threadId: data.threadId ?? '',
    labelIds: data.labelIds ?? [],
    subject: headers.get('subject') ?? '',
    from: headers.get('from') ?? '',
    to: headers.get('to') ?? '',
    cc: headers.get('cc') ?? '',
    messageId: headers.get('message-id') ?? '',
    inReplyTo: headers.get('in-reply-to') ?? '',
    references: headers.get('references') ?? '',
    snippet: data.snippet ?? '',
    text: bodies.text.join('\n'),
    html: bodies.html.join('\n'),
    internalDate: internalMs ? new Date(internalMs).toISOString() : new Date().toISOString(),
  };
}

export async function gmailGetMessage(token: string, id: string): Promise<ParsedGmailMessage> {
  const data = await gmailRequest<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=full`);
  return parseGmailMessage(data);
}

/** Emails (minúsculas) de un header From/To/Cc: "Ana <ana@x.com>, bob@y.com". */
export function parseAddressList(header: string): string[] {
  const out = new Set<string>();
  for (const m of header.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    out.add(m[0].toLowerCase());
  }
  return [...out];
}

// ---------- Envío ----------

/** Header con caracteres no ASCII → encoded-word UTF-8 (RFC 2047). */
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

export interface MimeInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
  headers?: Record<string, string>;
}

/** Mensaje RFC 822 (multipart/alternative si hay HTML), listo para base64url. */
export function buildMime(input: MimeInput): string {
  const lines: string[] = [
    `From: ${encodeHeader(input.from)}`,
    `To: ${encodeHeader(input.to)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
  ];
  if (input.messageId) lines.push(`Message-ID: ${input.messageId}`);
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);
  for (const [k, v] of Object.entries(input.headers ?? {})) lines.push(`${k}: ${encodeHeader(v)}`);
  const textPart = wrap76(Buffer.from(input.text, 'utf8').toString('base64'));
  if (!input.html) {
    lines.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', textPart);
    return lines.join('\r\n');
  }
  const boundary = `zs_${crypto.randomUUID().replace(/-/g, '')}`;
  lines.push(
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textPart,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(input.html, 'utf8').toString('base64')),
    `--${boundary}--`,
  );
  return lines.join('\r\n');
}

export async function gmailSend(
  token: string,
  mime: string,
  threadId?: string | null,
): Promise<{ id: string; threadId: string }> {
  const raw = Buffer.from(mime, 'utf8').toString('base64url');
  const data = await gmailRequest<{ id?: string; threadId?: string }>(token, '/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
  return { id: data.id ?? '', threadId: data.threadId ?? '' };
}

/** Message-ID del mensaje enviado (Gmail lo genera): se lee con format=metadata. */
export async function gmailMessageIdHeader(token: string, id: string): Promise<string> {
  const params = new URLSearchParams({ format: 'metadata', metadataHeaders: 'Message-ID' });
  const data = await gmailRequest<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?${params.toString()}`).catch(
    () => null,
  );
  const h = data?.payload?.headers?.find((x) => x.name.toLowerCase() === 'message-id');
  return h?.value ?? '';
}
