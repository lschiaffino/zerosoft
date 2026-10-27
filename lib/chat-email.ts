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
 * solo con metadatos: el texto se pide a GET /emails/receiving/{id}. Cada
 * email se procesa una vez (chat_inbound_emails). Con CHAT_INBOUND_FAKE=1
 * (tests, nunca en producción) se acepta sin firma y con el texto en el
 * payload. Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import type { ChatConversationRow, ChatWidgetRow } from './db';
import {
  createChatConversation,
  createChatMessage,
  getChatConversation,
  getChatVisitor,
  getChatWidget,
  getOrCreateChatVisitor,
  updateChatConversation,
} from './chat-data';
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

export interface InboundEmail {
  emailId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
}

/** Texto del email recibido (la API de Resend; el webhook no lo trae). */
export async function fetchReceivedEmail(emailId: string): Promise<{ text: string; html: string } | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !/^[A-Za-z0-9-]{8,64}$/.test(emailId)) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string | null; html?: string | null };
    return { text: data.text ?? '', html: data.html ?? '' };
  } catch {
    return null;
  }
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

export async function processInboundEmail(email: InboundEmail, schedule: ScheduleTask): Promise<InboundResult> {
  const target = parseInboundAddress(email.to);
  if (!target) return { status: 'ignored', reason: 'unknown_address' };
  const from = parseFrom(email.from);
  if (!from.email) return { status: 'ignored', reason: 'invalid_sender' };
  const text = stripQuotedReply(email.text);
  if (!text) return { status: 'ignored', reason: 'empty' };
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
    widget = await getChatWidget(conversation.widget_id);
    if (!widget) return { status: 'ignored', reason: 'not_found' };
  } else {
    widget = await getChatWidget(target.id);
    if (!widget) return { status: 'ignored', reason: 'not_found' };
    const visitorRow = await getOrCreateChatVisitor(widget.id, `email:${from.email}`, { email: from.email, name: from.name });
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
  const visitor = (await getChatVisitor(conversation.visitor_id))!;
  const message = await createChatMessage(conversation.id, 'visitor', { body: text });
  await attachToClaim(email.emailId, conversation.id);
  await afterVisitorMessage({
    widget,
    conversation,
    visitor,
    message,
    isNewConversation: created,
    text,
    schedule,
    // Por email no contesta el bot: su respuesta no saldría por email.
    skipBot: true,
  });
  return { status: 'added', conversationId: conversation.id, created };
}
