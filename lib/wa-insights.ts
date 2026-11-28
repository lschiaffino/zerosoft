/**
 * Pestaña AI del panel de un chat (Lines e Inbox): resumen, preguntas sin responder, compromisos pendientes,
 * respuestas sugeridas y el ánimo del contacto, sobre un rango de la conversación ("desde la última lectura" o los
 * últimos N días).
 *
 * Lo puro: el rango, el pedido al modelo (con las reglas de escritura de lib/ai-compose.ts: los mensajes van en un
 * bloque de datos que nunca manda), el esquema de la respuesta y la respuesta del modelo falso de e2e. Quién arma la
 * transcripción (solo con lo que quien mira ve) y a qué modelo se pide: lib/groups-insights.ts (Lines) y
 * lib/inbox/insights.ts (Inbox). Nada se guarda: la respuesta vuelve a la pantalla de quien la pidió.
 */
import { z } from 'zod';
import { DATA_RULE, defuse, fence } from './ai-compose';

export const INSIGHT_DAYS = [1, 7, 30] as const;
export type InsightDays = (typeof INSIGHT_DAYS)[number];

/**
 * El rango pedido: desde la última lectura (los `unread` mensajes entrantes que había al abrir el chat; `from` es el
 * primero de ellos, si la pantalla lo sabe, así lo que llega después no corre la ventana) o N días.
 */
export type InsightRange = { kind: 'unread'; unread: number; from?: string } | { kind: 'days'; days: InsightDays };
/** Tope de "sin leer" que se toma (un grupo muy activo puede tener miles). */
const MAX_UNREAD = 1000;

/** Tope de mensajes que van al modelo (los más nuevos del rango). */
export const INSIGHT_MAX_MESSAGES = 300;
const MAX_LINE = 500;
const MAX_TRANSCRIPT = 40_000;

export const SENTIMENTS = ['positive', 'neutral', 'negative', 'mixed'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const insightsSchema = z.object({
  summary: z.string().describe('What happened in this part of the chat and where it stands now. 2 to 5 short sentences.'),
  questions: z.array(z.string()).describe('Questions the other side asked that nobody answered yet. Up to 5, short.'),
  commitments: z
    .array(z.object({ who: z.enum(['us', 'them']), text: z.string() }))
    .describe('Promises or next steps still pending. who is "us" for the user or their team, "them" for the contact. Up to 5.'),
  replies: z.array(z.string()).describe('1 to 3 short replies the user could send next, ready to send.'),
  sentiment: z.enum(SENTIMENTS).describe("The contact's current mood."),
  sentimentNote: z.string().describe('One short line that explains the mood.'),
});
export type InsightsOutput = z.infer<typeof insightsSchema>;

export interface ChatInsights extends InsightsOutput {
  /** Cuántos mensajes se usaron (los que quien mira ve, en el rango). */
  messages: number;
  range: InsightRange;
}

/** Normaliza el rango que llega de la pantalla. Lo inválido es null (la ruta responde invalid_input). */
export function parseInsightRange(raw: unknown): InsightRange | null {
  const r = (raw ?? {}) as { kind?: unknown; unread?: unknown; days?: unknown };
  if (r.kind === 'unread') {
    const n = Number(r.unread);
    if (!Number.isInteger(n) || n < 1) return null;
    const from = (r as { from?: unknown }).from;
    return { kind: 'unread', unread: Math.min(n, MAX_UNREAD), ...(typeof from === 'string' && from.length >= 1 && from.length <= 100 ? { from } : {}) };
  }
  if (r.kind === 'days') {
    const d = Number(r.days);
    return (INSIGHT_DAYS as readonly number[]).includes(d) ? { kind: 'days', days: d as InsightDays } : null;
  }
  return null;
}

/** Desde cuándo traer mensajes para un rango de días (ISO), o null si el rango es "desde la última lectura". */
export function rangeSince(range: InsightRange, now = new Date()): string | null {
  return range.kind === 'days' ? new Date(now.getTime() - range.days * 86_400_000).toISOString() : null;
}

/** Un mensaje como lo arma cada app (ya con lo que quien mira ve: teléfonos ocultos, menciones con nombre). */
export interface InsightMessage {
  id: string;
  at: string;
  fromMe: boolean;
  who: string;
  text: string;
}

/**
 * "Desde la última lectura": desde el primer mensaje sin leer al abrir el chat (`from`, si está entre los que quien
 * mira ve) o, si no, desde el primero de los últimos `unread` mensajes entrantes; con lo que vino después, también lo
 * propio. Con menos entrantes que eso, todo lo que hay.
 */
export function sliceUnread(messages: InsightMessage[], unread: number, from?: string): InsightMessage[] {
  if (from) {
    const i = messages.findIndex((m) => m.id === from);
    if (i >= 0) return messages.slice(i);
  }
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].fromMe) seen++;
    if (seen >= unread) return messages.slice(i);
  }
  return messages;
}

/** Un nombre de WhatsApp como dato: en un renglón, sin corchetes ni etiquetas de bloque, corto. */
function cleanName(name: string): string {
  return defuse(name).replace(/[\s[\]]+/g, ' ').trim().slice(0, 60);
}

/**
 * Un renglón de la transcripción. Quién escribió va en una marca que un nombre no puede imitar: `[us]` (la persona o
 * su equipo) o `[them]` seguido del nombre del contacto.
 */
function line(m: InsightMessage): string {
  const who = m.fromMe ? '[us]' : `[them] ${cleanName(m.who) || 'Contact'}`;
  return `[${m.at.slice(0, 16).replace('T', ' ')}] ${who}: ${m.text.replace(/\s+/g, ' ').slice(0, MAX_LINE)}`;
}

/** Lo que entra en el pedido: los más nuevos hasta el tope de largo (lo último es lo que más importa). */
export function fitMessages(messages: InsightMessage[]): InsightMessage[] {
  let total = 0;
  let start = messages.length;
  while (start > 0) {
    const n = line(messages[start - 1]).length + 1;
    if (total + n > MAX_TRANSCRIPT) break;
    total += n;
    start--;
  }
  return messages.slice(start);
}

/** Los renglones de la transcripción, del más viejo al más nuevo (ya recortada con fitMessages). */
export function transcript(messages: InsightMessage[]): string {
  return messages.map(line).join('\n');
}

const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

export function insightsInstructions(locale: string): string {
  const lang = LOCALE_NAME[locale] ?? 'English';
  return [
    'You help someone who handles a WhatsApp chat. In the transcript, lines marked [us] are the user or their team; lines marked [them] are the contact or other people in the chat, whatever name they use. Read the conversation and fill every field.',
    `Write summary, questions, commitments and sentimentNote in ${lang}.`,
    'Write the replies in the language the contact writes in, as short WhatsApp messages in the tone of the chat, ready to send. Plain text, no quotes around them.',
    'Only use what is in the conversation. Never invent facts, prices, dates, names or promises. If a reply needs a detail that is not there, leave a short placeholder in square brackets.',
    'questions: only questions from the contact that are still unanswered. commitments: only promises or next steps that are still pending. Empty lists are fine.',
    'Do not use long dashes.',
    DATA_RULE,
  ].join('\n- ');
}

export function insightsPrompt(chatName: string, group: boolean, messages: InsightMessage[], range: InsightRange): string {
  const what = range.kind === 'unread' ? 'the messages since the user last read the chat' : `the last ${range.days === 1 ? '24 hours' : `${range.days} days`}`;
  // La transcripción ya viene recortada (fitMessages): el conteo de la pantalla es el de lo que se mandó.
  return [
    `WhatsApp ${group ? 'group' : 'chat'} ${fence('recipient', chatName)}`,
    `This is ${what}, oldest first:`,
    fence('conversation', transcript(messages)),
    fence('request', 'Summarize this part of the chat, list the open questions and pending commitments, suggest replies and read the mood of the contact.'),
  ].join('\n\n');
}

/** Limpia lo que devolvió el modelo: textos cortos, sin vacíos, con los topes de la pantalla. */
export function cleanInsights(o: InsightsOutput): InsightsOutput {
  const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    summary: String(o.summary ?? '').trim().slice(0, 1500),
    questions: (o.questions ?? []).map((q) => s(q, 300)).filter(Boolean).slice(0, 5),
    commitments: (o.commitments ?? []).map((c) => ({ who: c.who === 'us' ? ('us' as const) : ('them' as const), text: s(c.text, 300) })).filter((c) => c.text).slice(0, 5),
    replies: (o.replies ?? []).map((r) => String(r ?? '').trim().slice(0, 1000)).filter(Boolean).slice(0, 3),
    sentiment: (SENTIMENTS as readonly string[]).includes(o.sentiment) ? o.sentiment : 'neutral',
    sentimentNote: s(o.sentimentNote, 300),
  };
}

/**
 * La respuesta del modelo falso de e2e: se arma con la transcripción (nunca con nada de afuera), así un test puede
 * comprobar que solo se usó lo que quien mira ve.
 */
export function fakeInsights(messages: InsightMessage[]): InsightsOutput {
  const theirs = messages.filter((m) => !m.fromMe);
  const last = theirs[theirs.length - 1];
  const asked = theirs.filter((m) => m.text.includes('?')).map((m) => m.text.slice(0, 120));
  const promised = messages.filter((m) => /\b(mañana|tomorrow|amanhã|te (?:mando|paso|aviso)|I'll|vou)\b/i.test(m.text)).map((m) => ({ who: m.fromMe ? ('us' as const) : ('them' as const), text: m.text.slice(0, 120) }));
  const angry = theirs.some((m) => /(!{2,}|terrible|enojad|horrible|p[ée]ssim|angry)/i.test(m.text));
  return {
    summary: `${messages.length} messages. Last from the contact: ${last ? last.text.slice(0, 120) : '(none)'}`,
    questions: asked.slice(-5),
    commitments: promised.slice(-5),
    replies: [`Thanks for your message. ${last ? `About "${last.text.slice(0, 40)}": ` : ''}[detail]`, 'I will check and get back to you today.'],
    sentiment: angry ? 'negative' : 'neutral',
    sentimentNote: angry ? 'The contact sounds upset.' : 'Calm conversation.',
  };
}
