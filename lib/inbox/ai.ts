/**
 * Inbox: IA para escribir, como "Ayudame a escribir" de Gmail. Tres pedidos:
 * - draft: borrador de respuesta con el contexto del chat (últimos mensajes y
 *   notas). Con `instruction` ("Describí tu mensaje") escribe eso.
 * - new: un mensaje nuevo, sin chat todavía (WhatsApp o un correo; el correo
 *   sin asunto escrito vuelve con "Subject: ..." en la primera línea).
 * - rewrite: reescribe un texto (más corto, más largo, más formal, más casual,
 *   más cálido, corregir, o una instrucción propia). Con `threadId` también
 *   sirve para refinar un borrador de la IA con el contexto del chat.
 * El modelo ve ejemplos de cómo escribe la persona (sus mensajes enviados en
 * ese chat, y en otros si hay pocos) para copiar el tono, y sabe por qué canal
 * va: un WhatsApp es corto; un correo lleva saludo y despedida.
 * Lo que viene de afuera (mensajes, notas, ejemplos, el texto a reescribir)
 * va en bloques etiquetados que se leen como datos (lib/ai-compose.ts).
 * Nunca manda nada: el texto vuelve al campo para revisarlo.
 *
 * Proveedor: OpenRouter si hay OPENROUTER_API_KEY (el mismo del asistente ⌘J),
 * si no el Gateway de lib/ai.ts. Sin ninguno, error `ai_not_configured`.
 * INBOX_FAKE=1 (e2e) responde con texto fijo sin llamar a nadie. Server-only.
 */
import { streamText, type LanguageModel } from 'ai';
import { AiError, aiEnabled, assertAiQuota, recordAiUsage, resolveAiModel } from '../ai';
import { CHANGE_RULE, CHANNEL_RULE, DATA_RULE, LANGUAGE_RULE, fence, type ComposeChannel } from '../ai-compose';
import { DEFAULT_ASSISTANT_MODEL, openRouterChatModel } from '../assistant/config';
import { getDb } from '../db';
import { getThreadRow, type ThreadRow } from './core';
import { inboxFakeAllowed } from './gmail';
import { InboxError } from './types';

export const REWRITE_MODES = ['polish', 'shorter', 'longer', 'friendlier', 'formal', 'casual', 'fix', 'custom'] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];
export type InboxChannel = 'whatsapp' | 'gmail';

export type InboxAiRequest =
  | { action: 'draft'; threadId: string; instruction?: string }
  | { action: 'new'; channel: InboxChannel; instruction: string; to?: string; subject?: string }
  | { action: 'rewrite'; text: string; mode: RewriteMode; instruction?: string; threadId?: string; channel?: InboxChannel };

/** Marca de error al final de un stream que ya empezó (el cliente la corta y muestra el error). */
export const STREAM_ERROR_MARK = '\u0000error:';

const RULES = [
  'Write like the user writes, never like a bot. Keep the user\'s voice: if they use "vos", use "vos".',
  'Match the tone, length, punctuation, capitalization and emoji use of <style_examples>, when there are examples.',
  'Never invent facts, dates, amounts or commitments that are not in the conversation, the notes or the request. If one is missing, leave a short placeholder in square brackets.',
  'Do not use long dashes.',
  DATA_RULE,
  'Return only the message text, without quotes or explanations.',
];

interface Line {
  from_me: number;
  sender_name: string;
  subject: string;
  body: string;
}

/**
 * "@<dígitos>" → "@Nombre" en los mensajes de WhatsApp que lee el asistente
 * (borradores, resumen): así habla de personas y no de números.
 */
export async function nameMentions(owner: string, accountId: string, rows: Array<{ body: string; meta?: string | null }>): Promise<void> {
  if (!rows.some((r) => r.body && r.body.includes('@'))) return;
  const { resolveTextMentions, someoneWord } = await import('../wa-contacts');
  const mentionsOf = (meta: string | null | undefined): unknown => {
    if (!meta || !meta.includes('"mentions"')) return undefined;
    try {
      return (JSON.parse(meta) as { mentions?: unknown }).mentions;
    } catch {
      return undefined;
    }
  };
  const named = await resolveTextMentions(
    'inbox',
    rows.map((r) => ({ accountId: r.body && r.body.includes('@') ? accountId : '', text: r.body ?? '', mentions: mentionsOf(r.meta) })),
    { someone: () => someoneWord(owner) },
  ).catch(() => rows.map((r) => r.body));
  rows.forEach((r, i) => (r.body = named[i]));
}

export function transcriptLines(rows: Line[], chatTitle: string, channel: string): string[] {
  return rows.map((r) => {
    const who = r.from_me ? 'Me' : r.sender_name || chatTitle;
    const text = (channel === 'gmail' ? stripQuoted(r.body) : r.body).replace(/\s+/g, ' ').trim().slice(0, 1500);
    return `${who}: ${text || '[attachment]'}`;
  });
}

/** Saca la parte citada de un correo ("> ..." y "El ... escribió:"). */
export function stripQuoted(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^(On|El|Em) .{4,200}(wrote|escribió|escreveu):\s*$/.test(l.trim())) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

/**
 * Ejemplos de cómo escribe la persona: sus mensajes enviados en este chat y,
 * si hay menos de 8, los más recientes de otros chats del mismo canal. Sin
 * repetidos, sin vacíos y cortados a 300 caracteres.
 */
export function pickStyleSamples(own: string[], others: string[], max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const clean = stripQuoted(raw).replace(/\s+/g, ' ').trim();
    if (clean.length < 2 || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    out.push(clean.slice(0, 300));
  };
  for (const s of own) if (out.length < max) add(s);
  if (out.length < 8) for (const s of others) if (out.length < max) add(s);
  return out;
}

async function styleSamples(owner: string, channel: string, threadId: string | null): Promise<string[]> {
  const db = getDb();
  const own = threadId
    ? ((await db
        .prepare("SELECT body FROM inbox_messages WHERE thread_id = ? AND owner_id = ? AND from_me = 1 AND body <> '' ORDER BY sent_at DESC LIMIT 25")
        .all(threadId, owner)) as Array<{ body: string }>)
    : [];
  let others: Array<{ body: string }> = [];
  if (own.length < 8) {
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    others = (await db
      .prepare(
        "SELECT m.body FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE m.owner_id = ? AND m.from_me = 1 AND m.body <> '' AND m.thread_id <> ? AND t.channel = ? AND m.sent_at >= ? ORDER BY m.sent_at DESC LIMIT 40",
      )
      .all(owner, threadId ?? '', channel, since)) as Array<{ body: string }>;
  }
  return pickStyleSamples(
    own.map((r) => r.body),
    others.map((r) => r.body),
  );
}

/** Lo que el modelo sabe de la conversación. Sin chat (mensaje nuevo) solo el canal, a quién va y el tono. */
export interface InboxAiContext {
  channel: InboxChannel;
  /** Con quién es la conversación (nombre o dirección). */
  title: string;
  group: boolean;
  /** "Quién: texto", del más viejo al más nuevo. Vacío en un mensaje nuevo. */
  lines: string[];
  notes: string;
  samples: string[];
}

async function threadContext(owner: string, t: ThreadRow): Promise<InboxAiContext> {
  const rows = ((await getDb()
    .prepare('SELECT from_me, sender_name, subject, body, meta FROM inbox_messages WHERE thread_id = ? AND owner_id = ? ORDER BY sent_at DESC LIMIT 30')
    .all(t.id, owner)) as unknown as Array<Line & { meta?: string | null }>).reverse();
  if (t.channel === 'whatsapp') await nameMentions(owner, t.account_id, rows);
  return {
    channel: t.channel === 'gmail' ? 'gmail' : 'whatsapp',
    title: t.title || t.handle,
    group: t.kind === 'group',
    lines: transcriptLines(rows, t.title || t.handle, t.channel),
    notes: t.notes.trim().slice(0, 4000),
    samples: await styleSamples(owner, t.channel, t.id),
  };
}

function contextBlocks(ctx: InboxAiContext | null): string[] {
  if (!ctx) return [];
  const where = `${ctx.channel === 'gmail' ? 'Email thread' : 'WhatsApp chat'} with: ${ctx.title}${ctx.group ? ' (group)' : ''}. Oldest first. "Me" is the user.`;
  return [
    fence('conversation', [where, ...(ctx.lines.length ? ctx.lines : ['(no messages yet)'])].join('\n')),
    ctx.notes ? fence('notes', ctx.notes) : '',
    ctx.samples.length ? fence('style_examples', ctx.samples.map((s) => `- ${s}`).join('\n')) : '',
  ].filter(Boolean);
}

const MODE_TEXT: Record<Exclude<RewriteMode, 'custom'>, string> = {
  ...CHANGE_RULE,
  friendlier: 'Make it warmer and friendlier, without getting longer.',
};

interface Built {
  feature: string;
  instructions: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  fake: string;
}

function channelOf(req: InboxAiRequest, ctx: InboxAiContext | null): ComposeChannel {
  const channel = req.action === 'new' ? req.channel : (ctx?.channel ?? (req.action === 'rewrite' ? req.channel : undefined) ?? 'whatsapp');
  if (channel !== 'gmail') return 'whatsapp';
  if (req.action === 'new') return req.subject?.trim() ? 'email_new_subject' : 'email_new';
  return 'email';
}

const system = (lines: string[]) => lines.filter(Boolean).join('\n- ');

/**
 * Instrucciones y prompt de un pedido, sin tocar la base (el contexto llega
 * armado). Las reglas van en las instrucciones; los datos, en bloques.
 */
export function inboxAiPrompt(req: InboxAiRequest, ctx: InboxAiContext | null): Built {
  const channel = channelOf(req, ctx);
  if (req.action === 'rewrite') {
    const clean = req.text.trim().slice(0, 6000);
    if (!clean) throw new InboxError('invalid_input', 400);
    const extra = (req.instruction ?? '').trim().slice(0, 1000);
    if (req.mode === 'custom' && !extra) throw new InboxError('invalid_input', 400);
    return {
      feature: 'inbox_rewrite',
      instructions: system([
        `You rewrite the message in <text>, which the user is about to send. ${req.mode === 'custom' ? 'Apply the change described in <request>.' : MODE_TEXT[req.mode]} Keep its meaning, and keep its language unless the change asks for another one.`,
        channel === 'whatsapp'
          ? CHANNEL_RULE.whatsapp
          : 'This is an email: keep the greeting, the paragraphs and the sign-off. Plain text. If <text> starts with a "Subject:" line, keep that line (you may improve the subject) and the empty line after it; otherwise do not add a subject line.',
        ...RULES,
      ]),
      prompt: [...contextBlocks(ctx), fence('text', clean), req.mode === 'custom' ? fence('request', extra) : ''].filter(Boolean).join('\n\n'),
      temperature: 0.3,
      maxOutputTokens: 800,
      fake: req.mode === 'shorter' ? clean.split(/(?<=[.!?])\s/)[0] : `${clean} (${req.mode === 'custom' ? extra : req.mode})`,
    };
  }
  const what = (req.instruction ?? '').trim().slice(0, 2000);
  if (req.action === 'new') {
    if (!what) throw new InboxError('invalid_input', 400);
    const to = (req.to ?? '').trim().slice(0, 300);
    const subject = (req.subject ?? '').trim().slice(0, 300);
    return {
      feature: 'inbox_draft',
      instructions: system([
        'You write a new message on behalf of the user. <request> says what the user wants to say: say that, in good wording, without adding other topics.',
        CHANNEL_RULE[channel],
        'Write in the language of the request, unless the request names another one.',
        ...RULES,
      ]),
      prompt: [
        to || subject ? fence('recipient', [to ? `To: ${to}` : '', subject ? `Subject: ${subject}` : ''].filter(Boolean).join('\n')) : '',
        ctx?.samples.length ? fence('style_examples', ctx.samples.map((s) => `- ${s}`).join('\n')) : '',
        fence('request', what),
      ]
        .filter(Boolean)
        .join('\n\n'),
      temperature: 0.5,
      maxOutputTokens: 700,
      fake: channel === 'email_new' ? `Subject: ${what.slice(0, 60)}\n\nBorrador: ${what}` : `Borrador: ${what}`,
    };
  }
  return {
    feature: 'inbox_draft',
    instructions: system([
      what
        ? 'You write the next message of this conversation on behalf of the user. <request> says what the user wants to say: say that, in good wording, without adding other topics.'
        : "You write the user's reply to the last message of this conversation.",
      CHANNEL_RULE[channel],
      LANGUAGE_RULE,
      ...RULES,
    ]),
    prompt: [...contextBlocks(ctx), what ? fence('request', what) : ''].filter(Boolean).join('\n\n'),
    temperature: 0.5,
    maxOutputTokens: channel === 'whatsapp' ? 600 : 900,
    fake: what ? `Borrador: ${what}` : `Gracias, ${ctx?.title || 'hola'}. Lo veo y te respondo hoy.`,
  };
}

/** Arma el pedido con el contexto de la persona: solo lee chats de `owner`. */
async function build(owner: string, req: InboxAiRequest): Promise<Built> {
  if (req.action === 'new') {
    const samples = await styleSamples(owner, req.channel, null);
    return inboxAiPrompt(req, { channel: req.channel, title: '', group: false, lines: [], notes: '', samples });
  }
  const ctx = req.threadId ? await threadContext(owner, await getThreadRow(owner, req.threadId)) : null;
  return inboxAiPrompt(req, ctx);
}

export type InboxAiState = 'ready' | 'not_configured' | 'disabled';

/** ¿Hay IA para Inbox? (la pantalla lo muestra antes de pedir nada). */
export function inboxAiState(): InboxAiState {
  if (inboxFakeAllowed()) return 'ready';
  if (process.env.AI_ENABLED === 'false') return 'disabled';
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'ready';
  return aiEnabled() ? 'ready' : 'not_configured';
}

function inboxAiModel(): { model: LanguageModel; modelId: string; via: 'openrouter' | 'gateway' } | null {
  const state = inboxAiState();
  if (state === 'disabled') throw new InboxError('ai_disabled', 503);
  if (state !== 'ready') return null;
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const id = process.env.INBOX_AI_MODEL?.trim() || process.env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
    return { model: openRouterChatModel(id, 'zerosoft inbox'), modelId: `openrouter:${id}`, via: 'openrouter' };
  }
  const r = resolveAiModel(process.env.INBOX_AI_MODEL);
  return { ...r, via: 'gateway' };
}

function mapError(err: unknown): InboxError {
  if (err instanceof InboxError) return err;
  if (err instanceof AiError) return new InboxError(err.code, err.code === 'ai_disabled' ? 503 : 429);
  return new InboxError('ai_failed', 502);
}

/** Lo que se loguea de un fallo del proveedor: nombre, estado y el mensaje corto (nunca el pedido). */
function logFailure(via: string, modelId: string, err: unknown) {
  const e = err as { name?: string; statusCode?: number; message?: string };
  console.error(`[inbox-ai] ${via} ${modelId} failed: ${e?.name ?? 'Error'} ${e?.statusCode ?? ''} ${String(e?.message ?? '').slice(0, 200)}`);
}

function textStream(chunks: AsyncIterable<string> | Iterable<string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const c of chunks) controller.enqueue(enc.encode(c));
      } catch (err) {
        controller.enqueue(enc.encode(`${STREAM_ERROR_MARK}${mapError(err).code}`));
      }
      controller.close();
    },
  });
}

/** Texto falso en pedazos, como si llegara del modelo (e2e). */
async function* fakeChunks(text: string): AsyncGenerator<string> {
  const parts = text.match(/\S+\s*/g) ?? [text];
  for (const p of parts) {
    await new Promise((r) => setTimeout(r, 15));
    yield p;
  }
}

/**
 * Stream del texto. Espera el primer pedazo antes de devolver: si el proveedor
 * falla de entrada, tira InboxError (la ruta responde con el código y el
 * estado). Si falla a mitad, el stream termina con STREAM_ERROR_MARK + código.
 */
export async function inboxAiStream(owner: string, req: InboxAiRequest): Promise<ReadableStream<Uint8Array>> {
  const b = await build(owner, req);
  if (inboxFakeAllowed()) return textStream(fakeChunks(b.fake));
  const m = inboxAiModel();
  if (!m) throw new InboxError('ai_not_configured', 503);
  try {
    await assertAiQuota(owner);
  } catch (err) {
    throw mapError(err);
  }
  const result = streamText({
    model: m.model,
    instructions: b.instructions,
    prompt: b.prompt,
    temperature: b.temperature,
    maxOutputTokens: b.maxOutputTokens,
    timeout: 45_000,
    maxRetries: 1,
    onEnd: async ({ totalUsage }) => {
      await recordAiUsage({
        workspaceId: owner,
        feature: b.feature,
        model: m.modelId,
        inputTokens: totalUsage?.inputTokens ?? 0,
        outputTokens: totalUsage?.outputTokens ?? 0,
      }).catch(() => {});
    },
  });
  const it = result.fullStream[Symbol.asyncIterator]();
  // Hasta el primer texto (o el error o el final).
  let first = '';
  for (;;) {
    const n = await it.next().catch((err: unknown) => ({ done: false as const, value: { type: 'error' as const, error: err } }));
    if (n.done) break;
    const part = n.value;
    if (part.type === 'text-delta' && part.text) {
      first = part.text;
      break;
    }
    if (part.type === 'error') {
      logFailure(m.via, m.modelId, part.error);
      throw mapError(part.error);
    }
  }
  if (!first) {
    logFailure(m.via, m.modelId, new Error('empty response'));
    throw new InboxError('ai_failed', 502);
  }
  async function* rest(): AsyncGenerator<string> {
    yield first;
    for (;;) {
      const n = await it.next();
      if (n.done) return;
      const part = n.value;
      if (part.type === 'text-delta' && part.text) yield part.text;
      else if (part.type === 'error') {
        logFailure(m!.via, m!.modelId, part.error);
        throw part.error;
      }
    }
  }
  return textStream(rest());
}

/** Lee un stream de inboxAiStream entero (pedido sin stream). */
export async function inboxAiText(owner: string, req: InboxAiRequest): Promise<string> {
  const stream = await inboxAiStream(owner, req);
  const text = await new Response(stream).text();
  const at = text.indexOf(STREAM_ERROR_MARK);
  if (at >= 0) throw new InboxError(text.slice(at + STREAM_ERROR_MARK.length) || 'ai_failed', 502);
  return text.trim();
}
