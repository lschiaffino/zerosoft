/**
 * Inbox: Gmail por OAuth (el mismo cliente de Google de la suite). Sincroniza
 * la bandeja por hilos con la API de Gmail, manda respuestas en el mismo hilo
 * y refleja en Gmail lo que se hace acá: Hecho saca el hilo de la bandeja
 * (etiqueta INBOX) y leído / no leído mueve UNREAD.
 *
 * Los tokens van cifrados en inbox_accounts.config. Sin SDK: fetch directo
 * (los tests lo mockean). En tests y demo (INBOX_FAKE=1) una cuenta falsa con
 * hilos de ejemplo y envíos en memoria.
 */
import { buildMime, gmailSend, parseAddressList, parseGmailMessage, type ParsedGmailMessage } from '../gmail';
import { googleAuthUrl, gmailRedirectUri } from '../integrations';
import { getDb } from '../db';
import { seal } from '../secret-box';
import {
  addMessage,
  createAccount,
  findThread,
  listAccounts,
  nowIso,
  readAccountConfig,
  setAccountState,
  upsertThread,
  writeAccountConfig,
  type AccountRow,
  type ThreadRow,
} from './core';
import { InboxError } from './types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const INBOX_GMAIL_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
/** Prefijo del state: el callback de Gmail de la suite lo reconoce y lo pasa a Inbox. */
export const INBOX_STATE_PREFIX = 'inbox.';
export const INBOX_STATE_COOKIE = 'zs-inbox-gmail-state';

export function inboxFakeAllowed(): boolean {
  if (process.env.INBOX_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

export function gmailAvailable(): boolean {
  return inboxFakeAllowed() || Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function inboxGmailAuthUrl(state: string): string {
  return googleAuthUrl({ redirectUri: gmailRedirectUri(), scope: INBOX_GMAIL_SCOPES, state });
}

type GmailConfig = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }).catch(() => null);
  if (!res) return { error: 'network_error' };
  return (await res.json().catch(() => ({ error: 'bad_response' }))) as TokenResponse;
}

async function accessToken(account: AccountRow): Promise<string> {
  const cfg = readAccountConfig<GmailConfig>(account);
  if (cfg.accessToken && (cfg.expiresAt ?? 0) > Date.now() + 60_000) return cfg.accessToken;
  if (!cfg.refreshToken) throw new InboxError('gmail_reconnect', 409);
  const tok = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  });
  if (!tok.access_token) {
    await setAccountState(account.id, { status: 'error', error: 'gmail_reconnect' });
    throw new InboxError('gmail_reconnect', 409);
  }
  const next = { ...cfg, accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 };
  await writeAccountConfig(account.id, next);
  account.config = seal(JSON.stringify(next));
  return tok.access_token;
}

class GmailHttpError extends Error {
  constructor(public status: number) {
    super(`gmail_${status}`);
  }
}

async function gmail<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }).catch(() => null);
  if (!res) throw new GmailHttpError(0);
  if (!res.ok) throw new GmailHttpError(res.status);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * Callback de OAuth (lo llama /api/integrations/gmail/callback cuando el state
 * empieza con "inbox."): cambia el code por tokens y crea o actualiza la
 * cuenta de Gmail de la persona.
 */
export async function completeGmailConnect(owner: string, code: string): Promise<AccountRow> {
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: gmailRedirectUri(),
  });
  if (!tok.access_token) throw new InboxError('gmail_denied', 400);
  const scopes = (tok.scope ?? '').split(/\s+/);
  if (!scopes.includes('https://www.googleapis.com/auth/gmail.modify')) throw new InboxError('gmail_scope', 400);
  const profile = await gmail<{ emailAddress?: string }>(tok.access_token, '/profile').catch(() => ({ emailAddress: '' }));
  const email = String(profile.emailAddress ?? '').toLowerCase();
  if (!email) throw new InboxError('gmail_denied', 400);
  const existing = (await listAccounts(owner)).find((a) => a.kind === 'gmail' && a.address === email);
  const account = existing ?? (await createAccount(owner, { kind: 'gmail', provider: 'google', label: email, address: email }));
  const prev = readAccountConfig<GmailConfig>(account);
  await writeAccountConfig(account.id, {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || prev.refreshToken || '',
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
    scope: tok.scope ?? '',
  });
  await setAccountState(account.id, { status: 'connected', error: '', provider: 'google' });
  return account;
}

/** Cuenta de Gmail falsa (tests y demo): queda conectada con hilos de ejemplo. */
export async function connectFakeGmail(owner: string): Promise<AccountRow> {
  if (!inboxFakeAllowed()) throw new InboxError('gmail_unavailable', 503);
  const email = 'me@example.test';
  const existing = (await listAccounts(owner)).find((a) => a.kind === 'gmail' && a.address === email);
  const account = existing ?? (await createAccount(owner, { kind: 'gmail', provider: 'fake', label: email, address: email }));
  await setAccountState(account.id, { status: 'connected', error: '', provider: 'fake' });
  return account;
}

/** Revoca el token en Google (si se puede) y deja la cuenta sin credenciales. */
export async function disconnectGmail(account: AccountRow): Promise<void> {
  const cfg = readAccountConfig<GmailConfig>(account);
  const token = cfg.refreshToken || cfg.accessToken;
  if (token && account.provider === 'google') {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null);
  }
  await writeAccountConfig(account.id, {});
  await setAccountState(account.id, { status: 'disconnected', error: '', sync_cursor: '' });
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** "Ana Pérez <ana@x.com>" → { name: "Ana Pérez", email: "ana@x.com" }. */
export function splitAddress(header: string): { name: string; email: string } {
  const email = parseAddressList(header)[0] ?? '';
  const name = header
    .replace(/<[^>]*>/, '')
    .replace(/["']/g, '')
    .trim();
  return { name: name && name !== email ? name : email, email };
}

/** Texto plano de un correo: el text/plain, o el HTML sin etiquetas. */
export function emailText(m: Pick<ParsedGmailMessage, 'text' | 'html' | 'snippet'>): string {
  if (m.text.trim()) return m.text.replace(/\r\n/g, '\n').trim();
  if (m.html.trim()) {
    return m.html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return m.snippet;
}

interface GmailThreadRes {
  id: string;
  messages?: Array<Parameters<typeof parseGmailMessage>[0]>;
}

/** Guarda un hilo de Gmail (mensajes nuevos, etiquetas de bandeja y no leído). */
export async function applyGmailThread(account: AccountRow, threadId: string, messages: ParsedGmailMessage[], opts: { initial?: boolean } = {}): Promise<ThreadRow | null> {
  if (!messages.length) return null;
  const me = account.address.toLowerCase();
  const sorted = [...messages].sort((a, b) => a.internalDate.localeCompare(b.internalDate));
  const isMine = (m: ParsedGmailMessage) => m.labelIds.includes('SENT') || splitAddress(m.from).email === me;
  // El hilo lleva el nombre de la otra persona: el último que escribió, o a quien le escribí.
  const lastOther = [...sorted].reverse().find((m) => !isMine(m));
  const counterpart = lastOther ? splitAddress(lastOther.from) : splitAddress(sorted[sorted.length - 1].to);
  const existed = await findThread(account.id, threadId);
  const thread = await upsertThread(account, { externalId: threadId, kind: 'email', title: counterpart.name, handle: counterpart.email });
  for (const m of sorted) {
    const mine = isMine(m);
    const from = splitAddress(m.from);
    await addMessage(thread, {
      externalId: m.id,
      fromMe: mine,
      senderName: mine ? '' : from.name,
      senderHandle: mine ? '' : from.email,
      subject: m.subject,
      body: emailText(m),
      emailTo: m.to,
      emailCc: m.cc,
      emailMessageId: m.messageId,
      sentAt: m.internalDate,
      history: opts.initial || !existed,
      read: !m.labelIds.includes('UNREAD'),
    });
  }
  // Gmail manda: si en Gmail ya no está en la bandeja, acá queda en Hecho; leído igual.
  const inInbox = sorted.some((m) => m.labelIds.includes('INBOX'));
  const unread = sorted.filter((m) => m.labelIds.includes('UNREAD')).length;
  await getDb()
    .prepare(
      `UPDATE inbox_threads SET done_at = CASE WHEN ? = 1 THEN NULL WHEN done_at IS NULL THEN ? ELSE done_at END, unread = ? WHERE id = ?`,
    )
    .run(inInbox ? 1 : 0, nowIso(), unread, thread.id);
  return thread;
}

const FAKE_THREADS = [
  { id: 'fake-t1', from: 'Ana Pérez <ana@example.test>', subject: 'Contrato de alquiler', text: 'Hola, te mando el contrato para que lo revises. Avisame si está todo bien.' },
  { id: 'fake-t2', from: 'Banco <avisos@banco.example.test>', subject: 'Tu resumen de cuenta', text: 'Ya está disponible tu resumen del mes.' },
  { id: 'fake-t3', from: 'Martín <martin@example.test>', subject: 'Asado el sábado', text: '¿Venís el sábado? Confirmame así compro.' },
];

/** Hilos falsos de la cuenta de prueba (una vez). */
async function syncFake(account: AccountRow): Promise<number> {
  if (account.sync_cursor) return 0;
  let n = 0;
  for (const [i, t] of FAKE_THREADS.entries()) {
    const at = new Date(Date.now() - (i + 1) * 3600_000).toISOString();
    await applyGmailThread(account, t.id, [
      { id: `${t.id}-m1`, threadId: t.id, labelIds: ['INBOX', 'UNREAD'], subject: t.subject, from: t.from, to: account.address, cc: '', messageId: `<${t.id}@example.test>`, inReplyTo: '', references: '', snippet: t.text, text: t.text, html: '', internalDate: at },
    ]);
    n++;
  }
  await setAccountState(account.id, { sync_cursor: 'fake', last_sync_at: nowIso() });
  return n;
}

/**
 * Sincroniza una cuenta: la primera vez trae los hilos de la bandeja (últimos
 * 60 días, hasta 80); después, solo lo que cambió desde el último historyId.
 * Devuelve cuántos hilos tocó.
 */
export async function syncGmail(account: AccountRow, opts: { maxThreads?: number } = {}): Promise<number> {
  if (account.kind !== 'gmail' || account.status === 'disconnected') return 0;
  if (account.provider === 'fake') return syncFake(account);
  const token = await accessToken(account);
  const max = opts.maxThreads ?? 80;
  let ids: string[] = [];
  let historyId = '';
  try {
    if (account.sync_cursor) {
      const params = new URLSearchParams({ startHistoryId: account.sync_cursor, maxResults: '200' });
      for (const t of ['messageAdded', 'labelAdded', 'labelRemoved']) params.append('historyTypes', t);
      const h = await gmail<{ history?: Array<{ messages?: Array<{ threadId: string }> }>; historyId?: string }>(token, `/history?${params.toString()}`);
      ids = [...new Set((h.history ?? []).flatMap((x) => (x.messages ?? []).map((m) => m.threadId)))];
      historyId = String(h.historyId ?? account.sync_cursor);
    }
  } catch (err) {
    // historyId vencido (404): se rehace la carga inicial.
    if (!(err instanceof GmailHttpError && err.status === 404)) throw err;
    account.sync_cursor = '';
  }
  if (!account.sync_cursor) {
    const profile = await gmail<{ historyId?: string }>(token, '/profile');
    historyId = String(profile.historyId ?? '');
    const list = await gmail<{ threads?: Array<{ id: string }> }>(token, `/threads?${new URLSearchParams({ q: 'in:inbox newer_than:60d', maxResults: String(max) }).toString()}`);
    ids = (list.threads ?? []).map((t) => t.id);
  }
  let n = 0;
  for (const id of ids.slice(0, max)) {
    try {
      const t = await gmail<GmailThreadRes>(token, `/threads/${encodeURIComponent(id)}?format=full`);
      await applyGmailThread(account, id, (t.messages ?? []).map(parseGmailMessage), { initial: !account.sync_cursor });
      n++;
    } catch {
      // Un hilo borrado entre el listado y la lectura: se sigue.
    }
  }
  await setAccountState(account.id, { sync_cursor: historyId, last_sync_at: nowIso(), status: 'connected', error: '' });
  account.sync_cursor = historyId;
  return n;
}

/** Refleja en Gmail una acción de Inbox (mejor esfuerzo: si falla, queda el cambio local). */
export async function pushGmailLabels(account: AccountRow, threadExternalId: string, change: { add?: string[]; remove?: string[] }): Promise<void> {
  if (account.provider !== 'google' || account.status !== 'connected') return;
  const token = await accessToken(account);
  await gmail(token, `/threads/${encodeURIComponent(threadExternalId)}/modify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ addLabelIds: change.add ?? [], removeLabelIds: change.remove ?? [] }),
  }).catch(() => null);
}

const fakeSent: Array<{ to: string; subject: string; text: string }> = ((globalThis as unknown as { __inboxGmailFake?: typeof fakeSent }).__inboxGmailFake ??= []);

/** Envíos de la cuenta falsa (tests). */
export function fakeGmailSent(): ReadonlyArray<{ to: string; subject: string; text: string }> {
  return fakeSent;
}

/** Responde en el hilo (a quien escribió último; si el último fui yo, a los mismos destinatarios). */
export async function sendGmailReply(account: AccountRow, thread: ThreadRow, text: string): Promise<string> {
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  const last = (await getDb()
    .prepare('SELECT from_me, sender_handle, subject, email_to, email_message_id FROM inbox_messages WHERE thread_id = ? ORDER BY sent_at DESC LIMIT 1')
    .get(thread.id)) as { from_me: number; sender_handle: string; subject: string; email_to: string; email_message_id: string } | undefined;
  const to = last ? (last.from_me ? last.email_to : last.sender_handle) : thread.handle;
  if (!to) throw new InboxError('invalid_input', 400);
  const subject = last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : '';
  return sendGmail(account, { to, subject, text, threadId: thread.external_id, inReplyTo: last?.email_message_id ?? '' }, thread);
}

/** Correo nuevo: crea el hilo con lo que devuelve Gmail. */
export async function composeGmail(account: AccountRow, input: { to: string; subject: string; text: string }): Promise<ThreadRow> {
  const to = parseAddressList(input.to);
  if (!to.length) throw new InboxError('invalid_email', 400);
  const id = `pending-${Date.now()}`;
  const threadExternal = await sendGmail(account, { to: to.join(', '), subject: input.subject.slice(0, 300), text: input.text, threadId: '', inReplyTo: '' }, null, id);
  return (await findThread(account.id, threadExternal))!;
}

async function sendGmail(
  account: AccountRow,
  input: { to: string; subject: string; text: string; threadId: string; inReplyTo: string },
  thread: ThreadRow | null,
  localId?: string,
): Promise<string> {
  const mime = buildMime({
    from: account.address,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: input.inReplyTo } : {}),
  });
  let sent: { id: string; threadId: string };
  if (account.provider === 'fake') {
    fakeSent.push({ to: input.to, subject: input.subject, text: input.text });
    sent = { id: `fake-sent-${Date.now()}-${fakeSent.length}`, threadId: input.threadId || `fake-thread-${localId ?? Date.now()}` };
  } else {
    const token = await accessToken(account);
    try {
      sent = await gmailSend(token, mime, input.threadId || null);
    } catch {
      throw new InboxError('send_failed', 502);
    }
  }
  const t =
    thread ??
    (await upsertThread(account, { externalId: sent.threadId, kind: 'email', title: splitAddress(input.to).name, handle: splitAddress(input.to).email }));
  await addMessage(t, { externalId: sent.id, fromMe: true, subject: input.subject, body: input.text, emailTo: input.to, status: 'sent' });
  return sent.threadId;
}

export async function gmailAccounts(owner: string): Promise<AccountRow[]> {
  return (await listAccounts(owner)).filter((a) => a.kind === 'gmail');
}
