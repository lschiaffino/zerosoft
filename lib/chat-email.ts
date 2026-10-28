/**
 * Chat — canal email (entrante por Resend Inbound).
 *
 * Dos direcciones en el dominio de recepción (CHAT_INBOUND_DOMAIN, con MX a
 * Resend o el <id>.resend.app de la cuenta):
 * - reply+<conversación>.<firma>@dominio: va como Reply-To en los emails que
 *   le mandamos al visitante. Su respuesta vuelve a la conversación (solo si
 *   la manda el mismo email del visitante).
 * - inbox+<widget>.<firma>@dominio: la dirección del widget. Se reenvía ahí
 *   el soporte@ del sitio y cada email abre (o sigue) una conversación del
 *   canal email; las respuestas del equipo salen por email.
 * La firma es un HMAC con CHAT_INBOUND_SECRET (o NEXTAUTH_SECRET): nadie puede
 * armar la dirección de otra conversación.
 *
 * Resend manda el webhook email.received firmado (Svix: svix-id,
 * svix-timestamp, svix-signature, secreto RESEND_WEBHOOK_SECRET whsec_...),
 * solo con metadatos: el texto, los headers, el veredicto SPF/DKIM/DMARC del
 * servidor receptor y los adjuntos se piden a GET /emails/receiving/{id} (y
 * /attachments). El destino se busca en `to`, `cc` y `received_for` (este
 * último trae la dirección real cuando el email llegó reenviado desde el
 * soporte@ del cliente: el `To` sigue siendo soporte@).
 *
 * Se descartan: respuestas automáticas (Auto-Submitted, Precedence bulk o
 * auto_reply), rebotes (MAILER-DAEMON, postmaster, Return-Path vacío), los
 * que vienen de nuestro propio dominio y los que fallan DMARC (o SPF y DKIM a
 * la vez) según Resend.
 *
 * Sin bloque `authentication` (emails anteriores a ese campo de Resend, o si
 * la API no lo trae) no hay veredicto: el email se acepta. Lo que sigue
 * protegiendo es (1) la dirección firmada con HMAC (nadie arma la reply+ de
 * otra conversación) y (2) que reply+ solo acepta al remitente igual al email
 * del visitante, y solo si ese email está verificado (firma del sitio) o es
 * el de una conversación que entró por email. Un From falsificado hacia
 * inbox+ abre como mucho una conversación nueva con ese remitente.
 *
 * Al visitante web con un email declarado sin verificar (formulario o
 * identify sin firma) se le avisa por email como antes, pero sin Reply-To a
 * la conversación: responder ese email no entra al inbox. El visitante del canal email tiene una clave
 * aleatoria reservada que ninguna ruta pública del widget acepta
 * (lib/chat-visitor-key.ts). Cada email se procesa una vez
 * (chat_inbound_emails). Con CHAT_INBOUND_FAKE=1 (tests, nunca en producción)
 * se acepta sin firma y con el texto en el payload. Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import type { ChatConversationRow, ChatWidgetRow } from './db';
import {
  chatAttachmentType,
  createChatConversation,
  createChatMessage,
  getChatConversation,
  getChatVisitor,
  getChatWidget,
  updateChatConversation,
  type ChatAttachment,
} from './chat-data';
import type { ChatVisitorRow } from './db';
import { emailVisitorKey, isReservedVisitorKey } from './chat-visitor-key';
import { MAX_UPLOAD_SIZE, isAllowedUpload, saveUpload } from './uploads';
import { appSender } from './email';
import { afterVisitorMessage } from './chat-visitor-message';
import type { ScheduleTask } from './chat-bot-ai';

export const INBOUND_TEXT_MAX = 5000;

export function inboundDomain(): string | null {
  const d = process.env.CHAT_INBOUND_DOMAIN?.trim().toLowerCase();
  return d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

/** Modo de prueba (sin firma): nunca en Vercel producción, y en un build de producción solo con DEMO_MODE (e2e). */
export function inboundFake(): boolean {
  if (process.env.CHAT_INBOUND_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return false;
  return process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE === 'true';
}

function signingKey(): string {
  return process.env.CHAT_INBOUND_SECRET || process.env.NEXTAUTH_SECRET || 'zerosoft-chat-inbound';
}

export function addressSignature(kind: 'reply' | 'inbox', id: string): string {
  return createHmac('sha256', signingKey()).update(`${kind}:${id}`).digest('hex').slice(0, 16);
}

/** reply+<id>.<firma>@dominio o inbox+<id>.<firma>@dominio (null sin dominio configurado). */
export function inboundAddress(kind: 'reply' | 'inbox', id: string): string | null {
  const domain = inboundDomain();
  return domain ? `${kind}+${id}.${addressSignature(kind, id)}@${domain}` : null;
}

/** De una lista de destinatarios, la primera dirección nuestra con firma válida. */
export function parseInboundAddress(recipients: string[]): { kind: 'reply' | 'inbox'; id: string } | null {
  for (const raw of recipients) {
    const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
    const m = addr.match(/^(reply|inbox)\+([a-z0-9-]{8,64})\.([0-9a-f]{16})@/);
    if (!m) continue;
    const kind = m[1] as 'reply' | 'inbox';
    const expected = Buffer.from(addressSignature(kind, m[2]));
    const given = Buffer.from(m[3]);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return { kind, id: m[2] };
  }
  return null;
}

/** "Ana Pérez <ana@x.com>" → { email, name }. */
export function parseFrom(raw: string): { email: string | null; name: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : raw).trim().toLowerCase();
  const name = m?.[1]?.trim() || null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email: email.slice(0, 254), name: name?.slice(0, 120) ?? null } : { email: null, name: null };
}

const QUOTE_STARTS = [
  /^On .+wrote:\s*$/i,
  /^El .+escribió:\s*$/i,
  /^Em .+escreveu:\s*$/i,
  /^Le .+a écrit\s*:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{2,}\s*Mensaje original\s*-{2,}/i,
  /^From:\s.+/i,
  /^De:\s.+/i,
  /^_{10,}/,
];

/** Saca el texto citado y la firma "-- " de una respuesta por email. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '--' || trimmed === '-- ') break;
    if (QUOTE_STARTS.some((re) => re.test(trimmed))) break;
    // "On Tue, ... <a@b.c>\nwrote:" partido en dos líneas.
    if (/^(On|El|Em)\s.+/.test(trimmed) && /^(wrote|escribió|escreveu):\s*$/i.test(lines[i + 1]?.trim() ?? '')) break;
    if (trimmed.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, INBOUND_TEXT_MAX);
}

/** HTML → texto plano (para emails sin parte text). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------- Firma del webhook (Svix) ----------

/** Verifica svix-signature ("v1,<base64> v1,<base64>") sobre "id.timestamp.body", con 5 min de tolerancia. */
export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const t = Number(headers.timestamp);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

// ---------- Procesar un email ----------

export interface InboundAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface InboundAuth {
  spf?: string | null;
  dkim?: string | null;
  dmarc?: string | null;
}

export interface InboundEmail {
  emailId: string;
  from: string;
  /** to + cc + received_for: el destino puede estar en cualquiera. */
  to: string[];
  subject: string;
  text: string;
  /** Message-ID del email (para agrupar las respuestas en el mismo hilo). */
  messageId?: string | null;
  /** Headers en minúscula (los que trae la API de Resend). */
  headers?: Record<string, string>;
  /** Veredicto del servidor receptor (null si Resend no lo trae). */
  authentication?: InboundAuth | null;
  attachments?: InboundAttachment[];
  /** Adjuntos que no se pudieron traer (tipo no permitido, muy grandes o sin descargar). */
  skippedAttachments?: SkipReason[];
}

export type SkipReason = 'type' | 'size' | 'download';

/** Nota de sistema (solo la ve el equipo) con los adjuntos que no se guardaron; la UI la traduce (lib/chat-email-note.ts). */

export function skippedNote(reasons: SkipReason[]): string | null {
  if (reasons.length === 0) return null;
  const counts = new Map<SkipReason, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return `Attachments not saved: ${reasons.length} (${top})`;
}

export interface ReceivedEmail {
  text: string;
  html: string;
  messageId: string | null;
  headers: Record<string, string>;
  authentication: InboundAuth | null;
  attachments: Array<{ id: string; filename: string; content_type: string; size: number }>;
}

function lowerHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k.toLowerCase()] = v.slice(0, 2000);
      else if (Array.isArray(v) && typeof v[0] === 'string') out[k.toLowerCase()] = String(v[0]).slice(0, 2000);
    }
  }
  return out;
}

/** Normaliza el bloque `authentication` de Resend ({ properties: { spf, dkim, dmarc } } o plano). */
export function readAuthentication(raw: unknown): InboundAuth | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = (raw as { properties?: unknown }).properties ?? raw;
  if (!src || typeof src !== 'object') return null;
  const pick = (v: unknown) => {
    if (typeof v === 'string') return v.toLowerCase();
    if (v && typeof v === 'object' && typeof (v as { result?: unknown }).result === 'string') return String((v as { result: string }).result).toLowerCase();
    return null;
  };
  const o = src as Record<string, unknown>;
  return { spf: pick(o.spf), dkim: pick(o.dkim), dmarc: pick(o.dmarc) };
}

async function resendGet(path: string): Promise<unknown | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Texto, headers, veredicto de autenticación y adjuntos del email recibido (el webhook no los trae). */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(emailId)) return null;
  const data = (await resendGet(`/emails/receiving/${emailId}`)) as Record<string, unknown> | null;
  if (!data) return null;
  const attachments = Array.isArray(data.attachments)
    ? (data.attachments as Array<Record<string, unknown>>).map((a) => ({
        id: String(a.id ?? ''),
        filename: String(a.filename ?? 'file'),
        content_type: String(a.content_type ?? 'application/octet-stream'),
        size: Number(a.size ?? 0),
      }))
    : [];
  return {
    text: typeof data.text === 'string' ? data.text : '',
    html: typeof data.html === 'string' ? data.html : '',
    messageId: typeof data.message_id === 'string' ? data.message_id : null,
    headers: lowerHeaders(data.headers),
    authentication: readAuthentication(data.authentication),
    attachments,
  };
}

/** Descarga los adjuntos (URLs firmadas de Resend) que entran en el límite de subida; cuenta los que no. */
export async function fetchReceivedAttachments(emailId: string, max = 10): Promise<{ files: InboundAttachment[]; skipped: SkipReason[] }> {
  const list = (await resendGet(`/emails/receiving/${emailId}/attachments?limit=${max}`)) as { data?: Array<Record<string, unknown>> } | null;
  const files: InboundAttachment[] = [];
  const skipped: SkipReason[] = [];
  for (const a of list?.data ?? []) {
    const url = typeof a.download_url === 'string' ? a.download_url : '';
    const filename = String(a.filename ?? 'file').slice(0, 200);
    const contentType = String(a.content_type ?? 'application/octet-stream');
    if (!isAllowedUpload(filename, contentType)) {
      skipped.push('type');
      continue;
    }
    if (Number(a.size ?? 0) > MAX_UPLOAD_SIZE || files.length >= 5) {
      skipped.push('size');
      continue;
    }
    try {
      if (!/^https:\/\//.test(url)) throw new Error('bad_url');
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error('download');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_UPLOAD_SIZE) {
        skipped.push('size');
        continue;
      }
      files.push({ filename, contentType, data: buf });
    } catch {
      // Un adjunto que no baja no frena el mensaje: queda en la nota para el equipo.
      skipped.push('download');
    }
  }
  return { files, skipped };
}

/** Por qué se descarta un email antes de tocar la base, o null si sigue. */
export function rejectReason(email: InboundEmail): string | null {
  const h = email.headers ?? {};
  const auto = (h['auto-submitted'] ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return 'auto_submitted';
  const precedence = (h['precedence'] ?? '').trim().toLowerCase();
  if (precedence === 'bulk' || precedence === 'auto_reply' || precedence === 'junk' || precedence === 'list') return 'auto_submitted';
  if (h['x-autoreply'] || h['x-autorespond']) return 'auto_submitted';
  const from = parseFrom(email.from).email ?? '';
  const local = from.split('@')[0];
  if (/^(mailer-daemon|postmaster|no-?reply|bounces?)$/.test(local)) return 'bounce';
  if ((h['return-path'] ?? '').replace(/\s/g, '') === '<>') return 'bounce';
  const ownDomains = [inboundDomain(), (appSender().match(/@([^>\s]+)/)?.[1] ?? '').toLowerCase()].filter(Boolean);
  const fromDomain = from.split('@')[1] ?? '';
  if (ownDomains.includes(fromDomain)) return 'own_sender';
  const a = email.authentication;
  if (a && (a.dmarc === 'fail' || (a.spf === 'fail' && a.dkim === 'fail'))) return 'auth_failed';
  return null;
}

export type InboundResult =
  | { status: 'added'; conversationId: string; created: boolean }
  | { status: 'duplicate' | 'ignored'; reason?: string };

async function claimEmail(emailId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('INSERT OR IGNORE INTO chat_inbound_emails (email_id, created_at) VALUES (?, ?)')
    .run(emailId.slice(0, 128), new Date().toISOString());
  return res.changes > 0;
}

async function attachToClaim(emailId: string, conversationId: string): Promise<void> {
  await getDb().prepare('UPDATE chat_inbound_emails SET conversation_id = ? WHERE email_id = ?').run(conversationId, emailId);
}

async function openEmailConversation(widgetId: string, visitorId: string): Promise<ChatConversationRow | undefined> {
  return (await getDb()
    .prepare(
      "SELECT * FROM chat_conversations WHERE widget_id = ? AND visitor_id = ? AND channel = 'email' AND status IN ('open', 'pending', 'snoozed') ORDER BY created_at DESC LIMIT 1",
    )
    .get(widgetId, visitorId)) as ChatConversationRow | undefined;
}

/**
 * El visitante del canal email de esta dirección (uno por widget y email),
 * con clave aleatoria reservada: el widget nunca puede usarla.
 */
export async function emailChannelVisitor(widgetId: string, email: string, name: string | null): Promise<ChatVisitorRow> {
  const db = getDb();
  const found = (await db
    .prepare("SELECT * FROM chat_visitors WHERE widget_id = ? AND external_id LIKE 'mail.%' AND lower(email) = ? ORDER BY created_at ASC LIMIT 1")
    .get(widgetId, email.toLowerCase())) as ChatVisitorRow | undefined;
  if (found) return found;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO chat_visitors (id, widget_id, external_id, email, name, email_verified, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(id, widgetId, emailVisitorKey(), email.toLowerCase(), name, new Date().toISOString());
  return (await db.prepare('SELECT * FROM chat_visitors WHERE id = ?').get(id)) as ChatVisitorRow;
}

/** Guarda el Message-ID del email en el hilo de la conversación (para In-Reply-To y References). */
async function rememberThread(conversationId: string, messageId: string | null | undefined): Promise<void> {
  const mid = (messageId ?? '').trim();
  if (!/^<[^<>\s]{3,250}>$/.test(mid)) return;
  const row = (await getDb().prepare('SELECT email_thread FROM chat_conversations WHERE id = ?').get(conversationId)) as { email_thread: string | null } | undefined;
  let list: string[] = [];
  try {
    list = JSON.parse(row?.email_thread || '[]') as string[];
  } catch {
    list = [];
  }
  if (!list.includes(mid)) list.push(mid);
  await getDb().prepare('UPDATE chat_conversations SET email_thread = ? WHERE id = ?').run(JSON.stringify(list.slice(-20)), conversationId);
}

/** Headers para que el cliente de correo agrupe la respuesta en el mismo hilo. */
export async function threadHeaders(conversationId: string): Promise<Record<string, string>> {
  const row = (await getDb().prepare('SELECT email_thread FROM chat_conversations WHERE id = ?').get(conversationId)) as { email_thread: string | null } | undefined;
  let list: string[] = [];
  try {
    list = JSON.parse(row?.email_thread || '[]') as string[];
  } catch {
    list = [];
  }
  if (list.length === 0) return {};
  return { 'In-Reply-To': list[list.length - 1], References: list.join(' ') };
}

export async function processInboundEmail(email: InboundEmail, schedule: ScheduleTask): Promise<InboundResult> {
  const target = parseInboundAddress(email.to);
  if (!target) return { status: 'ignored', reason: 'unknown_address' };
  const from = parseFrom(email.from);
  if (!from.email) return { status: 'ignored', reason: 'invalid_sender' };
  const rejected = rejectReason(email);
  if (rejected) return { status: 'ignored', reason: rejected };
  const text = stripQuotedReply(email.text);
  const files = (email.attachments ?? []).slice(0, 5);
  const skipped: SkipReason[] = [...(email.skippedAttachments ?? []), ...(email.attachments ?? []).slice(5).map(() => 'size' as const)];
  if (!text && files.length === 0 && skipped.length === 0) return { status: 'ignored', reason: 'empty' };
  if (!(await claimEmail(email.emailId))) return { status: 'duplicate' };

  let widget: ChatWidgetRow | undefined;
  let conversation: ChatConversationRow | undefined;
  let created = false;

  if (target.kind === 'reply') {
    conversation = await getChatConversation(target.id);
    if (!conversation) return { status: 'ignored', reason: 'not_found' };
    const visitor = await getChatVisitor(conversation.visitor_id);
    // Solo el visitante de la conversación: un tercero en copia no escribe en nombre de él.
    if (!visitor?.email || visitor.email.toLowerCase() !== from.email) return { status: 'ignored', reason: 'sender_mismatch' };
    // Y solo con un email confiable: verificado por el sitio o el de una conversación que entró por email.
    if (Number(visitor.email_verified) !== 1 && !isReservedVisitorKey(visitor.external_id)) return { status: 'ignored', reason: 'unverified_email' };
    widget = await getChatWidget(conversation.widget_id);
    if (!widget) return { status: 'ignored', reason: 'not_found' };
  } else {
    widget = await getChatWidget(target.id);
    if (!widget) return { status: 'ignored', reason: 'not_found' };
    const visitorRow = await emailChannelVisitor(widget.id, from.email, from.name);
    conversation = await openEmailConversation(widget.id, visitorRow.id);
    if (!conversation) {
      conversation = await createChatConversation(widget.id, visitorRow.id, email.subject.replace(/^\s*(re|fw|fwd|rv)\s*:\s*/i, '').slice(0, 200) || undefined);
      await getDb().prepare("UPDATE chat_conversations SET channel = 'email' WHERE id = ?").run(conversation.id);
      conversation = (await getChatConversation(conversation.id))!;
      created = true;
    }
  }

  if (conversation.status !== 'open') {
    conversation = (await updateChatConversation(conversation.id, { status: 'open' })) ?? conversation;
  }
  await rememberThread(conversation.id, email.messageId);
  const attachments: ChatAttachment[] = [];
  for (const f of files) {
    try {
      const url = await saveUpload('chat', f.filename, f.contentType, f.data);
      attachments.push({ name: f.filename, url, size: f.data.length, mime: f.contentType, type: chatAttachmentType(f.contentType) });
    } catch (err) {
      // Un adjunto rechazado (tipo o tamaño) no frena el mensaje: queda en la nota para el equipo.
      skipped.push((err as { code?: string })?.code === 'file_type_not_allowed' ? 'type' : 'download');
    }
  }
  const visitor = (await getChatVisitor(conversation.visitor_id))!;
  const message = await createChatMessage(conversation.id, 'visitor', { body: text || (attachments.length ? '' : email.subject.trim().slice(0, 200)), attachments });
  const note = skippedNote(skipped);
  if (note) await createChatMessage(conversation.id, 'system', { body: note });
  await attachToClaim(email.emailId, conversation.id);
  await afterVisitorMessage({
    widget,
    conversation,
    visitor,
    message,
    isNewConversation: created,
    text: text || attachments.map((a) => a.name).join(', '),
    schedule,
    // Por email no contesta el bot: su respuesta no saldría por email.
    skipBot: true,
  });
  return { status: 'added', conversationId: conversation.id, created };
}
