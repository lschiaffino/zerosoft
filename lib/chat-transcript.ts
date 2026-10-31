/**
 * Chat — transcript de una conversación. Lo descarga el equipo desde el
 * inbox (texto o JSON) y se le manda por email al visitante. Lo que ve el
 * visitante nunca lleva notas internas, mensajes borrados ni mensajes de
 * sistema (son internos, como la derivación del bot). La descarga del equipo
 * tampoco lleva borrados; las notas solo si se piden.
 */
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { pickWidgetLocale, type WidgetLocale } from './chat-widget-i18n';
import { readVisitorPage } from './chat-visitor-context';
import type { ChatConversationWithVisitor, ChatMessageWithUser } from './chat-data';
import en from '@/messages/en/chat.json';
import es from '@/messages/es/chat.json';
import pt from '@/messages/pt/chat.json';

type TranscriptStrings = typeof en.transcript;

const STRINGS: Record<'en' | 'es' | 'pt', TranscriptStrings> & Partial<Record<WidgetLocale, TranscriptStrings>> = {
  en: en.transcript,
  es: { ...en.transcript, ...es.transcript },
  pt: { ...en.transcript, ...pt.transcript },
};

export function transcriptStrings(locale: string): TranscriptStrings {
  return STRINGS[locale as WidgetLocale] ?? STRINGS.en;
}

export type TranscriptAudience = 'visitor' | 'team';

export interface TranscriptEntry {
  id: string;
  at: string;
  sender: 'visitor' | 'user' | 'bot' | 'system';
  note: boolean;
  name: string;
  body: string;
  attachments: Array<{ name: string; url: string }>;
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

function attachmentList(raw: string): Array<{ name: string; url: string }> {
  try {
    const list = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((a) =>
      a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string'
        ? [{ name: (a as { name: string }).name, url: typeof (a as { url?: unknown }).url === 'string' ? (a as { url: string }).url : '' }]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Mensajes que entran al transcript, en orden, con el nombre de quien habla.
 * Visitante: sin notas, borrados ni sistema. Equipo: sin borrados; notas
 * solo con includeNotes.
 */
export function transcriptEntries(
  messages: ChatMessageWithUser[],
  opts: {
    audience: TranscriptAudience;
    includeNotes?: boolean;
    visitorName: string;
    /** Nombre de los mensajes del equipo sin autor conocido (el del widget). */
    teamName: string;
    strings: TranscriptStrings;
  },
): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const m of messages) {
    if (m.deleted_at) continue;
    if (m.is_note && (opts.audience === 'visitor' || !opts.includeNotes)) continue;
    if (m.sender_type === 'system' && opts.audience === 'visitor') continue;
    const name =
      m.sender_type === 'visitor'
        ? opts.visitorName
        : m.sender_type === 'bot'
          ? opts.strings.bot
          : m.sender_type === 'system'
            ? opts.strings.system
            : m.user_name || (opts.audience === 'team' ? m.user_email : null) || opts.teamName;
    out.push({
      id: m.id,
      at: m.created_at,
      sender: m.sender_type,
      note: m.is_note === 1,
      name,
      body: m.body.trim(),
      attachments: attachmentList(m.attachments),
    });
  }
  return out;
}

/** "20 oct 2026, 14:03 UTC": sin la zona del visitante, en UTC explícito. */
export function formatTranscriptTime(iso: string, locale: string): string {
  const ts = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (!Number.isFinite(ts)) return iso;
  try {
    return `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(ts)} UTC`;
  } catch {
    return new Date(ts).toISOString();
  }
}

export interface TranscriptHeader {
  widgetName: string;
  visitorName: string;
  startedAt: string;
}

/** Transcript en texto plano (descarga .txt y cuerpo del email). */
export function transcriptText(header: TranscriptHeader, entries: TranscriptEntry[], locale: string): string {
  const s = transcriptStrings(locale);
  const lines = [
    fill(s.title, { widget: header.widgetName }),
    fill(s.started, { when: formatTranscriptTime(header.startedAt, locale) }),
    fill(s.with, { name: header.visitorName }),
    '',
  ];
  if (entries.length === 0) lines.push(s.empty);
  for (const e of entries) {
    const who = e.note ? `${e.name} (${s.note})` : e.name;
    lines.push(`[${formatTranscriptTime(e.at, locale)}] ${who}`);
    if (e.body) lines.push(e.body);
    for (const a of e.attachments) lines.push(fill(s.attachment, { file: a.name }));
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Transcript en JSON (descarga del equipo). */
export function transcriptJson(
  conversation: Pick<ChatConversationWithVisitor, 'id' | 'status' | 'subject' | 'created_at' | 'widget_name'> & {
    visitor: Pick<ChatConversationWithVisitor['visitor'], 'name' | 'email'>;
  },
  entries: TranscriptEntry[],
): string {
  return JSON.stringify(
    {
      conversation: {
        id: conversation.id,
        widget: conversation.widget_name,
        status: conversation.status,
        subject: conversation.subject,
        createdAt: conversation.created_at,
        visitor: { name: conversation.visitor.name, email: conversation.visitor.email },
      },
      messages: entries.map((e) => ({
        at: e.at,
        sender: e.sender,
        name: e.name,
        note: e.note,
        body: e.body,
        attachments: e.attachments,
      })),
    },
    null,
    2,
  );
}

/** Nombre de archivo de la descarga: transcript-<widget>-<fecha>.<ext>. */
export function transcriptFilename(widgetName: string, createdAt: string, ext: 'txt' | 'json'): string {
  const slug =
    widgetName
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat';
  return `transcript-${slug}-${createdAt.slice(0, 10)}.${ext}`;
}

/** Idioma del email: el fijo del widget, o el de la página del visitante. */
export function transcriptEmailLocale(conversation: Pick<ChatConversationWithVisitor, 'visitor'>, widgetLocale: string | null | undefined): WidgetLocale {
  const page = readVisitorPage(conversation.visitor.metadata);
  return pickWidgetLocale(null, widgetLocale ?? 'auto', null, page?.language ?? null) as WidgetLocale;
}

/** Asunto, texto y HTML del email con el transcript (siempre la versión del visitante). */
export function buildTranscriptEmail(
  conversation: Pick<ChatConversationWithVisitor, 'created_at' | 'widget_name' | 'widget_color' | 'visitor'>,
  entries: TranscriptEntry[],
  locale: WidgetLocale,
): { subject: string; text: string; html: string } {
  const s = transcriptStrings(locale);
  const visitorName = conversation.visitor.name || s.you;
  const header = { widgetName: conversation.widget_name, visitorName, startedAt: conversation.created_at };
  const greeting = conversation.visitor.name ? fill(s.hi, { name: conversation.visitor.name }) : s.hiAnonymous;
  const intro = fill(s.emailIntro, { widget: conversation.widget_name });
  const subject = fill(s.emailSubject, { widget: conversation.widget_name });
  const text = [greeting, '', intro, '', transcriptText(header, entries, locale), s.emailFooter].join('\n');
  const block = (e: TranscriptEntry) => {
    const files = e.attachments.map((a) => escapeHtml(fill(s.attachment, { file: a.name })));
    return [
      `<span style="display:block;color:#888888;font-size:12px;">${escapeHtml(e.name)} · ${escapeHtml(formatTranscriptTime(e.at, locale))}</span>`,
      `<span style="display:block;border-left:2px solid #e5e5e5;padding:2px 0 2px 12px;white-space:pre-wrap;">${[
        escapeHtml(e.body),
        ...files,
      ]
        .filter(Boolean)
        .join('<br>')}</span>`,
    ].join('');
  };
  const html = renderBrandedHtml({
    heading: s.emailHeading,
    eyebrow: conversation.widget_name,
    brandColor: conversation.widget_color,
    paragraphs: [
      escapeHtml(greeting),
      escapeHtml(intro),
      ...(entries.length === 0 ? [escapeHtml(s.empty)] : entries.map(block)),
      `<span style="color:#888888;font-size:12px;">${escapeHtml(s.emailFooter)}</span>`,
    ],
  });
  return { subject, text, html };
}

/** Manda el transcript al email del visitante. */
export async function emailTranscriptToVisitor(
  conversation: ChatConversationWithVisitor,
  messages: ChatMessageWithUser[],
  widgetLocale: string | null | undefined,
): Promise<{ ok: true; to: string } | { ok: false; error: 'no_visitor_email' | 'send_failed' }> {
  const to = conversation.visitor.email?.trim();
  if (!to) return { ok: false, error: 'no_visitor_email' };
  const locale = transcriptEmailLocale(conversation, widgetLocale);
  const s = transcriptStrings(locale);
  const entries = transcriptEntries(messages, {
    audience: 'visitor',
    visitorName: conversation.visitor.name || s.you,
    teamName: conversation.widget_name,
    strings: s,
  });
  const email = buildTranscriptEmail(conversation, entries, locale);
  const res = await sendEmail({ to, subject: email.subject, text: email.text, html: email.html }).catch(() => ({ ok: false }));
  return res.ok ? { ok: true, to } : { ok: false, error: 'send_failed' };
}
