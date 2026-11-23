/**
 * La pestaña IA del panel de un chat (Lines e Inbox): preguntarle a la IA
 * sobre el chat, el sentimiento y las tareas que propone. Acá van las reglas,
 * el formato de la respuesta y las respuestas del modelo falso (e2e); cada app
 * lee sus mensajes (solo los que la persona ve) y llama a su modelo:
 * lib/groups-ai-insights.ts y lib/inbox/wa-insights.ts.
 *
 * Nada de lo que vuelve se crea solo: las tareas propuestas se muestran y la
 * persona las aprueba una por una. Sin dependencias de servidor (los tests lo
 * importan directo).
 */
import { z } from 'zod';
import { DATA_RULE, fence } from './ai-compose';

export const CHAT_SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type ChatSentiment = (typeof CHAT_SENTIMENTS)[number];

/** Una tarea propuesta: va a CRM › Tareas (Lines e Inbox) o a Tickets de Lines. */
export const PROPOSAL_KINDS = ['task', 'ticket'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_PRIORITIES = ['low', 'medium', 'high'] as const;
export type ProposalPriority = (typeof PROPOSAL_PRIORITIES)[number];

export interface ChatProposal {
  title: string;
  notes: string;
  kind: ProposalKind;
  priority: ProposalPriority;
}

export interface ChatInsights {
  sentiment: ChatSentiment;
  /** Por qué, en una frase corta. */
  reason: string;
  proposals: ChatProposal[];
  /** Cuántos mensajes leyó. */
  messages: number;
}

export interface ChatAnswer {
  answer: string;
  messages: number;
}

/** Lo que el modelo devuelve (se limpia con cleanInsights). */
export const insightsSchema = z.object({
  sentiment: z.enum(CHAT_SENTIMENTS),
  reason: z.string(),
  proposals: z.array(
    z.object({
      title: z.string(),
      notes: z.string(),
      kind: z.enum(PROPOSAL_KINDS),
      priority: z.enum(PROPOSAL_PRIORITIES),
    }),
  ),
});
export type RawInsights = z.infer<typeof insightsSchema>;

export const answerSchema = z.object({ answer: z.string() });

export const MAX_QUESTION = 500;
export const MAX_PROPOSALS = 5;

const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

/** Pregunta del pedido → limpia; '' si no hay. */
export function cleanQuestion(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION) : '';
}

export interface ChatTranscript {
  /** "Chat with X" / "Group X", ya enmascarado si hace falta. */
  header: string;
  /** "[fecha] Quién: texto", del más viejo al más nuevo. */
  lines: string[];
  /** Quién es "nosotros" en las líneas: 'Team' (Lines) o 'Me' (Inbox). */
  us: 'Team' | 'Me';
}

const conversation = (t: ChatTranscript) => fence('conversation', [`${t.header} Oldest first. "${t.us}" is ${t.us === 'Team' ? 'us, the team' : 'the user'}.`, ...t.lines].join('\n'));

/** Preguntarle a la IA sobre el chat: responde solo con lo que está en los mensajes. */
export function askPrompt(t: ChatTranscript, question: string, locale: string): { instructions: string; prompt: string } {
  return {
    instructions: [
      `You answer a question about one WhatsApp conversation for ${t.us === 'Team' ? 'a support team member' : 'its owner'}.`,
      'Use only what is in <conversation>. If the answer is not there, say so in one short line. Never invent names, dates, amounts or commitments.',
      `Answer in the language of the question in <request>; if it is unclear, in ${LOCALE_NAME[locale] ?? 'English'}.`,
      'Plain text, short: at most 8 lines. Lists with "- " are fine. No headings, no long dashes, no emojis.',
      DATA_RULE,
    ].join('\n'),
    prompt: [conversation(t), fence('request', question)].join('\n\n'),
  };
}

/** Sentimiento del chat y tareas propuestas, en el idioma de quien mira. */
export function insightsPrompt(t: ChatTranscript, locale: string, kinds: readonly ProposalKind[]): { instructions: string; prompt: string } {
  const lang = LOCALE_NAME[locale] ?? 'English';
  return {
    instructions: [
      `You read one WhatsApp conversation for ${t.us === 'Team' ? 'a support team' : 'its owner'} and return a JSON object.`,
      `"sentiment": how the other side feels lately (the most recent messages weigh more): positive, neutral or negative. "reason": why, in one short sentence in ${lang} (at most 140 characters).`,
      `"proposals": follow-up work that the conversation clearly asks for and that is still open (a request, a promise ${t.us === 'Team' ? 'the team' : 'the user'} made, a problem to fix). At most ${MAX_PROPOSALS}; an empty list if there is none. Each one: "title" (an action in ${lang}, at most 80 characters, starting with a verb), "notes" (one or two sentences in ${lang} with the context needed, at most 300 characters), "priority" (low, medium or high), and "kind": ${
        kinds.includes('ticket') ? '"ticket" for a customer problem or request the team must resolve, "task" for an internal to-do or a follow-up' : 'always "task"'
      }.`,
      'Use only what is in <conversation>. Never invent facts, names, dates or amounts. Do not propose anything that is already done in the conversation.',
      'No long dashes, no emojis.',
      DATA_RULE,
    ].join('\n'),
    prompt: conversation(t),
  };
}

const one = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Lo del modelo, recortado y sin propuestas vacías ni repetidas; un tipo que la app no tiene pasa a tarea. */
export function cleanInsights(raw: RawInsights, messages: number, kinds: readonly ProposalKind[]): ChatInsights {
  const seen = new Set<string>();
  const proposals: ChatProposal[] = [];
  for (const p of raw.proposals ?? []) {
    const title = one(p.title, 120);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    proposals.push({
      title,
      notes: one(p.notes, 600),
      kind: kinds.includes(p.kind) ? p.kind : 'task',
      priority: (PROPOSAL_PRIORITIES as readonly string[]).includes(p.priority) ? p.priority : 'medium',
    });
    if (proposals.length >= MAX_PROPOSALS) break;
  }
  return {
    sentiment: (CHAT_SENTIMENTS as readonly string[]).includes(raw.sentiment) ? raw.sentiment : 'neutral',
    reason: one(raw.reason, 200),
    proposals,
    messages,
  };
}

/** La respuesta: texto plano, sin rayas largas. */
export function cleanAnswer(text: string): string {
  return text.replace(/[–—]/g, '-').trim().slice(0, 4000);
}

// ======================================================================
// Modelo falso (e2e y tests): se sabe de antemano qué sale.
// ======================================================================

const NEGATIVE = /\b(problem|problema|broken|no funciona|não funciona|angry|enojad|refund|reembolso|reclamo|complaint|late|tarde|atrasad|wrong|mal)\b/i;
const POSITIVE = /\b(thanks|thank you|gracias|obrigad[oa]|great|genial|perfect|perfecto|excelente)\b/i;

/** Las líneas de los otros (no "Team:"/"Me:"), sin la fecha. */
function theirLines(t: ChatTranscript): string[] {
  return t.lines.map((l) => l.replace(/^\[[^\]]*\]\s*/, '')).filter((l) => !l.startsWith(`${t.us}:`));
}

export function fakeAnswer(t: ChatTranscript, question: string): RawAnswer {
  return { answer: `${t.lines.length} messages read. Question: ${question}` };
}
type RawAnswer = z.infer<typeof answerSchema>;

export function fakeInsights(t: ChatTranscript, kinds: readonly ProposalKind[]): RawInsights {
  const theirs = theirLines(t);
  const recent = theirs.slice(-5).join(' ');
  const sentiment: ChatSentiment = NEGATIVE.test(recent) ? 'negative' : POSITIVE.test(recent) ? 'positive' : 'neutral';
  const asks = theirs.filter((l) => /\?|\b(please|por favor|necesito|need|send|mandame|enviar)\b/i.test(l)).slice(-2);
  return {
    sentiment,
    reason: `Fake: ${sentiment}`,
    proposals: asks.map((l, i) => ({
      title: `Follow up: ${l.replace(/^[^:]*:\s*/, '').slice(0, 60)}`,
      notes: 'Proposed by the fake model.',
      kind: i === 0 && kinds.includes('ticket') ? 'ticket' : 'task',
      priority: sentiment === 'negative' ? 'high' : 'medium',
    })),
  };
}
