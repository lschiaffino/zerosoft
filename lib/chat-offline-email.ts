/**
 * Chat — aviso por email de respuestas del equipo que el visitante no vio.
 * Si el visitante dejó su email y una respuesta del agente sigue sin leer
 * pasados los minutos que configura el widget (offline_email_minutes, 0 =
 * apagado), se le manda por email con un link de vuelta a la página donde
 * escribió (con #zs-chat el widget se abre solo). Corre desde
 * /api/cron/minute (y el tick horario para self-host). Cada mensaje se
 * reclama con un compare-and-set de offline_email_at: dos crons a la vez no
 * mandan el mismo aviso dos veces.
 *
 * Con el canal email configurado (CHAT_INBOUND_DOMAIN, lib/chat-email.ts) el
 * email lleva Reply-To a la conversación y responderlo vuelve al inbox. Las
 * conversaciones que entraron por email reciben cada respuesta por email en
 * la próxima corrida, sin esperar los minutos del widget: las del equipo y
 * las de un agente que contesta emails (Agents > Canales).
 */
import { getDb } from './db';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { pickWidgetLocale, type WidgetLocale } from './chat-widget-i18n';
import { readVisitorPage } from './chat-visitor-context';
import { inboundAddress, threadHeaders } from './chat-email';
import { isReservedVisitorKey } from './chat-visitor-key';
import en from '@/messages/en/chat.json';
import es from '@/messages/es/chat.json';
import pt from '@/messages/pt/chat.json';

type EmailStrings = typeof en.offlineEmail;

const STRINGS: Record<'en' | 'es' | 'pt', EmailStrings> & Partial<Record<WidgetLocale, EmailStrings>> = {
  en: en.offlineEmail,
  es: { ...en.offlineEmail, ...es.offlineEmail },
  pt: { ...en.offlineEmail, ...pt.offlineEmail },
};

/** Solo respuestas de las últimas 24 h: un widget que se prende no manda el historial. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface OfflineReplyCandidate {
  id: string;
  conversation_id: string;
  body: string;
  attachments: string;
  created_at: string;
  agent_name: string | null;
  visitor_email: string;
  visitor_name: string | null;
  visitor_metadata: string;
  widget_name: string;
  widget_color: string;
  widget_locale: string | null;
  offline_email_minutes: number;
  /** 'email' si la conversación entró por email: se responde por email enseguida. */
  channel?: string | null;
  subject?: string | null;
  /** 1 si el email del visitante está verificado (firma del sitio). */
  visitor_email_verified?: number | null;
  visitor_external_id?: string | null;
}

export interface OfflineReplyGroup {
  conversationId: string;
  messages: OfflineReplyCandidate[];
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/**
 * Agrupa por conversación y deja solo las que ya esperaron lo suficiente:
 * se cuenta desde la respuesta más nueva, así un agente que manda tres
 * mensajes seguidos genera un solo email con los tres.
 */
export function dueOfflineGroups(rows: OfflineReplyCandidate[], now = new Date()): OfflineReplyGroup[] {
  const groups = new Map<string, OfflineReplyCandidate[]>();
  for (const row of rows) {
    const list = groups.get(row.conversation_id) ?? [];
    list.push(row);
    groups.set(row.conversation_id, list);
  }
  const due: OfflineReplyGroup[] = [];
  for (const [conversationId, list] of groups) {
    const isEmail = list[0].channel === 'email';
    const minutes = isEmail ? 0 : Number(list[0].offline_email_minutes);
    if (!isEmail && !(minutes > 0)) continue;
    const newest = Math.max(...list.map((m) => Date.parse(m.created_at)));
    if (!Number.isFinite(newest) || now.getTime() - newest < minutes * 60_000) continue;
    due.push({ conversationId, messages: [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)) });
  }
  return due;
}

/** Link de vuelta: la página donde escribió, con #zs-chat (abre el widget). */
export function chatReturnLink(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = 'zs-chat';
    return u.toString();
  } catch {
    return null;
  }
}

function attachmentNames(raw: string): string[] {
  try {
    const list = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(list)
      ? list.flatMap((a) => (a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string' ? [(a as { name: string }).name] : []))
      : [];
  } catch {
    return [];
  }
}

/** Asunto, texto y HTML del aviso, en el idioma del widget o del visitante. */
export function buildOfflineReplyEmail(group: OfflineReplyGroup): {
  locale: WidgetLocale;
  subject: string;
  text: string;
  html: string;
  replyTo: string | null;
} {
  const first = group.messages[0];
  const page = readVisitorPage(first.visitor_metadata);
  const locale = pickWidgetLocale(null, first.widget_locale ?? 'auto', null, page?.language ?? null) as WidgetLocale;
  const s = STRINGS[locale] ?? STRINGS.en;
  const agent = group.messages.find((m) => m.agent_name)?.agent_name ?? null;
  const vars = { widget: first.widget_name, agent: agent ?? first.widget_name, name: first.visitor_name ?? '' };
  // Reply-To a la conversación solo con un email confiable: verificado o de una conversación que entró por email.
  const trusted = Number(first.visitor_email_verified) === 1 || isReservedVisitorKey(first.visitor_external_id ?? '');
  const replyTo = trusted ? inboundAddress('reply', group.conversationId) : null;
  const isEmail = first.channel === 'email';
  const subject = isEmail && first.subject ? `Re: ${first.subject}` : fill(agent ? s.subjectAgent : s.subject, vars);
  const footer = replyTo ? s.canReply : s.noReply;
  const greeting = first.visitor_name ? fill(s.hi, vars) : s.hiAnonymous;
  const link = chatReturnLink(page?.url);

  const blocks = group.messages.map((m) => {
    const files = attachmentNames(m.attachments);
    return [m.body.trim(), ...files.map((f) => fill(s.attachment, { file: f }))].filter(Boolean).join('\n');
  });

  const text = [
    greeting,
    '',
    fill(isEmail ? s.introEmail : s.intro, vars),
    '',
    ...blocks.flatMap((b) => [b, '']),
    ...(isEmail ? [] : [link ? `${s.cta}: ${link}` : replyTo ? '' : s.noLink, '']),
    footer,
    isEmail ? '' : s.why,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const quote = (b: string) =>
    `<span style="display:block;border-left:2px solid #e5e5e5;padding:2px 0 2px 12px;white-space:pre-wrap;">${escapeHtml(b)}</span>`;
  const html = renderBrandedHtml({
    heading: s.heading,
    eyebrow: first.widget_name,
    brandColor: first.widget_color,
    paragraphs: [
      escapeHtml(greeting),
      escapeHtml(fill(isEmail ? s.introEmail : s.intro, vars)),
      ...blocks.map(quote),
      ...(isEmail ? [] : [link ? `<a href="${escapeHtml(link)}">${escapeHtml(s.cta)}</a>` : escapeHtml(replyTo ? '' : s.noLink)]),
      `<span style="color:#888888;font-size:12px;">${escapeHtml(footer)}${isEmail ? '' : ` ${escapeHtml(s.why)}`}</span>`,
    ].filter(Boolean),
  });
  return { locale, subject, text: `${text}\n`, html, replyTo };
}

async function loadCandidates(now: Date, limit: number): Promise<OfflineReplyCandidate[]> {
  return (await getDb()
    .prepare(
      `SELECT m.id, m.conversation_id, m.body, m.attachments, m.created_at,
              u.name AS agent_name,
              v.email AS visitor_email, v.name AS visitor_name, v.metadata AS visitor_metadata,
              w.name AS widget_name, w.color AS widget_color, w.locale AS widget_locale,
              w.offline_email_minutes AS offline_email_minutes,
              c.channel AS channel, c.subject AS subject,
              v.email_verified AS visitor_email_verified, v.external_id AS visitor_external_id
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       JOIN chat_visitors v ON v.id = c.visitor_id
       JOIN chat_widgets w ON w.id = c.widget_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE (m.sender_type = 'user' OR (m.sender_type = 'bot' AND c.channel = 'email')) AND m.is_note = 0 AND m.deleted_at IS NULL
         AND m.read_at IS NULL AND m.offline_email_at IS NULL
         AND v.email IS NOT NULL AND v.email != '' AND (w.offline_email_minutes > 0 OR c.channel = 'email')
         AND m.created_at >= ?
       ORDER BY m.created_at ASC
       LIMIT ?`,
    )
    .all(new Date(now.getTime() - LOOKBACK_MS).toISOString(), limit)) as OfflineReplyCandidate[];
}

/**
 * Manda los avisos vencidos. Reclama cada mensaje antes de enviar (si otro
 * cron lo tomó o el visitante lo leyó justo, se saltea) y libera el claim si
 * el envío falla, para reintentar en la próxima corrida.
 */
export async function sendOfflineReplyEmails(
  opts: { now?: Date; limit?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const groups = dueOfflineGroups(await loadCandidates(now, opts.limit ?? 200), now);
  let sent = 0;
  let failed = 0;
  for (const group of groups) {
    const claimed: OfflineReplyCandidate[] = [];
    const claimAt = now.toISOString();
    for (const m of group.messages) {
      const res = await db
        .prepare(
          'UPDATE chat_messages SET offline_email_at = ? WHERE id = ? AND offline_email_at IS NULL AND read_at IS NULL AND deleted_at IS NULL',
        )
        .run(claimAt, m.id);
      if (res.changes > 0) claimed.push(m);
    }
    if (claimed.length === 0) continue;
    const email = buildOfflineReplyEmail({ conversationId: group.conversationId, messages: claimed });
    const result = await sendEmail({
      to: claimed[0].visitor_email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      // Sale con el nombre del widget y en el mismo hilo que el email del visitante.
      from: namedSender(claimed[0].widget_name, email.locale === 'es' ? 'vía' : 'via'),
      headers: await threadHeaders(group.conversationId),
    }).catch(
      () => ({ ok: false }),
    );
    if (result.ok) {
      sent++;
    } else {
      failed++;
      for (const m of claimed) {
        await db.prepare('UPDATE chat_messages SET offline_email_at = NULL WHERE id = ? AND offline_email_at = ?').run(m.id, claimAt);
      }
    }
  }
  return { sent, failed };
}
