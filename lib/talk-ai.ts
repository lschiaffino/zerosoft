/**
 * Talk: IA como la de Slack. Resumen de un canal (lo no leído, el día o la
 * semana), resumen de un hilo, recap del día de los canales elegidos,
 * preguntas a Talk con fuentes (búsqueda con IA) y traducción de un mensaje.
 *
 * Regla: la IA solo ve lo que quien pregunta puede leer. Todo entra por
 * readableChannel / readableMessage / searchMessages con el actor de la
 * sesión (un invitado no ve los públicos donde no está; un privado o un DM
 * ajeno no aparece). Pasa por lib/ai.ts (cuota, rate limit, ai_usage).
 *
 * e2e: TALK_AI_FAKE=1 (nunca en producción) usa el modelo falso de
 * lib/crm-ai-fake.ts; la cookie talk_ai_fake=off se comporta como sin IA
 * (error ai_disabled). Server-only.
 */
import { generateText, type LanguageModel } from 'ai';
import { AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel } from './crm-ai-fake';
import { getDb } from './db';
import { HUDDLE_STARTED_BODY, talkPlainText } from './talk-markdown';
import {
  TalkError,
  getThread,
  nowIso,
  plainNames,
  readableChannel,
  readableMessage,
  type TalkActor,
  type TalkChannelKind,
  type TalkMessageRow,
} from './talk';
import { getPrefs, searchMessages } from './talk-extras';

export type SummaryRange = 'unread' | 'day' | 'week';
const MAX_MESSAGES = 300;
const MAX_CHARS = 60_000;

const LANG: Record<string, string> = { en: 'English', es: 'Spanish (Rioplatense, voseo)', pt: 'Brazilian Portuguese' };

async function fakeState(): Promise<'on' | 'off' | null> {
  if (process.env.TALK_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return null;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('talk_ai_fake')?.value === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** Respuesta del modelo falso: arma algo legible con lo que recibió (para e2e). */
function fakeText(feature: string, prompt: string): string {
  const lines = prompt.split('\n').filter((l) => /^\[\d+\]|^\[\d\d:\d\d\]/.test(l));
  const first = lines[0]?.replace(/^\[[^\]]+\]\s*/, '').slice(0, 80) ?? '';
  if (feature === 'talk_translate') return `[fake] ${prompt.split('\n').slice(-1)[0]?.slice(0, 200) ?? ''}`;
  if (feature === 'talk_ask') return lines.length ? `${first} [1]` : 'NO_ANSWER';
  return `- ${lines.length} messages\n- ${first}`;
}

async function generate(actor: TalkActor, feature: string, instructions: string, prompt: string, maxOutputTokens = 900): Promise<string> {
  const state = await fakeState();
  let model: LanguageModel;
  let modelId: string;
  if (state === 'on') {
    await assertAiQuota(actor.workspaceId);
    model = fakeModel(() => ({ text: fakeText(feature, prompt) }));
    modelId = 'talk-fake';
  } else if (state === 'off') {
    throw new AiError('ai_disabled');
  } else {
    await assertAiAvailable(actor.workspaceId);
    ({ model, modelId } = resolveAiModel());
  }
  const result = await generateText({ model, instructions, prompt, maxOutputTokens, temperature: 0.2, timeout: 45_000, maxRetries: 1 });
  await recordAiUsage({
    workspaceId: actor.workspaceId,
    feature,
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => undefined);
  return result.text.trim();
}

async function langOf(actor: TalkActor): Promise<string> {
  const row = (await getDb().prepare('SELECT locale FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId)) as { locale: string | null } | undefined;
  return LANG[row?.locale ?? 'en'] ?? LANG.en;
}

type Names = Awaited<ReturnType<typeof plainNames>>;

function line(r: TalkMessageRow, names: Names): string {
  const who = r.bot_name || (r.user_id ? (names.user(r.user_id) ?? 'Someone') : 'App');
  const when = r.created_at.slice(11, 16);
  const text = r.body === HUDDLE_STARTED_BODY ? '(started a huddle)' : talkPlainText(r.body, names).replace(/\s+/g, ' ').trim();
  return `[${when}] ${who}${r.parent_id ? ' (thread reply)' : ''}: ${text || '(file)'}`;
}

function transcript(rows: TalkMessageRow[], names: Names): string {
  const out: string[] = [];
  let size = 0;
  // Lo más nuevo pesa más: si no entra todo, se recorta lo viejo.
  for (const r of [...rows].reverse()) {
    const l = line(r, names);
    if (size + l.length > MAX_CHARS) break;
    out.unshift(l);
    size += l.length + 1;
  }
  return out.join('\n');
}

export interface TalkSummary {
  id: string;
  kind: 'channel' | 'thread' | 'recap';
  ref: string;
  text: string;
  count: number;
  createdAt: string;
  sources: Array<{ channelId: string; name: string; count: number }>;
}

async function store(actor: TalkActor, kind: TalkSummary['kind'], ref: string, text: string, count: number, sources: TalkSummary['sources']): Promise<TalkSummary> {
  const id = crypto.randomUUID();
  const now = nowIso();
  const db = getDb();
  // Se guarda el último de cada cosa (para volver a verlo sin pagar otra llamada).
  await db.prepare('DELETE FROM talk_ai_summaries WHERE workspace_id = ? AND user_id = ? AND kind = ? AND ref = ?').run(actor.workspaceId, actor.personId, kind, ref);
  await db
    .prepare('INSERT INTO talk_ai_summaries (id, workspace_id, user_id, kind, ref, text, sources, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, actor.personId, kind, ref, text, JSON.stringify({ count, sources }), now);
  return { id, kind, ref, text, count, createdAt: now, sources };
}

const SUMMARY_RULES = (lang: string) =>
  `You summarize team chat for one reader. Write in ${lang}. Use short bullet points ("- "): main topics, decisions, open questions, and action items with who owns them. ` +
  'Only use what is in the messages; do not invent facts, people or dates. If there is nothing meaningful, say so in one line. No preamble.';

/** Resumen de un canal o DM que la persona puede leer. */
export async function summarizeChannel(actor: TalkActor, channelId: string, range: SummaryRange = 'unread'): Promise<TalkSummary> {
  const access = await readableChannel(actor, channelId);
  if (!access) throw new TalkError('not_found', 404);
  const since =
    range === 'unread'
      ? (access.member?.last_read_at ?? new Date(Date.now() - 86_400_000).toISOString())
      : new Date(Date.now() - (range === 'week' ? 7 : 1) * 86_400_000).toISOString();
  const rows = (await getDb()
    .prepare('SELECT * FROM talk_messages WHERE channel_id = ? AND deleted_at IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT ?')
    .all(channelId, since, MAX_MESSAGES)) as TalkMessageRow[];
  rows.reverse();
  if (!rows.length) throw new TalkError('nothing_to_summarize', 409);
  const names = await plainNames(actor.workspaceId);
  const where = access.channel.kind === 'public' || access.channel.kind === 'private' ? `#${access.channel.name}` : 'a direct message';
  const text = await generate(actor, 'talk_summary', SUMMARY_RULES(await langOf(actor)), `Conversation in ${where}:\n${transcript(rows, names)}`);
  return store(actor, 'channel', channelId, text, rows.length, [{ channelId, name: access.channel.name, count: rows.length }]);
}

/** Resumen de un hilo. */
export async function summarizeThread(actor: TalkActor, rootId: string): Promise<TalkSummary> {
  const thread = await getThread(actor, rootId);
  const found = await readableMessage(actor, rootId);
  if (!found) throw new TalkError('not_found', 404);
  const ids = [thread.root.id, ...thread.replies.map((r) => r.id)];
  const rows = (await getDb()
    .prepare(`SELECT * FROM talk_messages WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL ORDER BY created_at`)
    .all(...ids)) as TalkMessageRow[];
  if (rows.length < 2) throw new TalkError('nothing_to_summarize', 409);
  const names = await plainNames(actor.workspaceId);
  const text = await generate(actor, 'talk_summary', SUMMARY_RULES(await langOf(actor)), `Thread:\n${transcript(rows, names)}`);
  return store(actor, 'thread', rootId, text, rows.length, [{ channelId: found.message.channel_id, name: found.access.channel.name, count: rows.length }]);
}

/** El último resumen guardado de algo (sin llamar a la IA). */
export async function lastSummary(actor: TalkActor, kind: TalkSummary['kind'], ref: string): Promise<TalkSummary | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM talk_ai_summaries WHERE workspace_id = ? AND user_id = ? AND kind = ? AND ref = ? ORDER BY created_at DESC LIMIT 1')
    .get(actor.workspaceId, actor.personId, kind, ref)) as { id: string; kind: TalkSummary['kind']; ref: string; text: string; sources: string; created_at: string } | undefined;
  if (!row) return null;
  // Si ya no puede leer lo resumido, no se muestra (y se borra).
  if (kind === 'channel' && !(await readableChannel(actor, ref))) {
    await getDb().prepare('DELETE FROM talk_ai_summaries WHERE id = ?').run(row.id);
    return null;
  }
  if (kind === 'thread' && !(await readableMessage(actor, ref))) {
    await getDb().prepare('DELETE FROM talk_ai_summaries WHERE id = ?').run(row.id);
    return null;
  }
  let meta: { count: number; sources: TalkSummary['sources'] } = { count: 0, sources: [] };
  try {
    meta = JSON.parse(row.sources);
  } catch {
    /* viejo */
  }
  if (kind === 'recap') {
    // Cada canal del recap se revalida: si perdió acceso a alguno, el recap viejo no se muestra.
    for (const s of meta.sources ?? []) {
      if (!(await readableChannel(actor, s.channelId))) {
        await getDb().prepare('DELETE FROM talk_ai_summaries WHERE id = ?').run(row.id);
        return null;
      }
    }
  }
  return { id: row.id, kind: row.kind, ref: row.ref, text: row.text, count: meta.count ?? 0, createdAt: row.created_at, sources: meta.sources ?? [] };
}

/** Recap del día: lo de las últimas 24 h en los canales elegidos (o todos los míos). */
export async function dailyRecap(actor: TalkActor): Promise<TalkSummary> {
  const prefs = await getPrefs(actor.workspaceId, actor.personId);
  const db = getDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const mine = (await db
    .prepare(
      `SELECT c.id, c.name, c.kind FROM talk_channels c JOIN talk_members m ON m.channel_id = c.id AND m.user_id = ?
       WHERE c.workspace_id = ? AND c.archived_at IS NULL AND c.kind IN ('public', 'private') AND c.last_message_at > ? ORDER BY c.last_message_at DESC LIMIT 30`,
    )
    .all(actor.personId, actor.workspaceId, since)) as Array<{ id: string; name: string; kind: TalkChannelKind }>;
  const picked = prefs.recapChannels.length ? mine.filter((c) => prefs.recapChannels.includes(c.id)) : mine.slice(0, 10);
  const names = await plainNames(actor.workspaceId);
  const parts: string[] = [];
  const sources: TalkSummary['sources'] = [];
  let total = 0;
  for (const c of picked.slice(0, 10)) {
    if (!(await readableChannel(actor, c.id))) continue;
    const rows = (await db
      .prepare('SELECT * FROM talk_messages WHERE channel_id = ? AND deleted_at IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 60')
      .all(c.id, since)) as TalkMessageRow[];
    if (!rows.length) continue;
    rows.reverse();
    parts.push(`## #${c.name}\n${transcript(rows, names).slice(0, 6000)}`);
    sources.push({ channelId: c.id, name: c.name, count: rows.length });
    total += rows.length;
  }
  if (!parts.length) throw new TalkError('nothing_to_summarize', 409);
  const lang = await langOf(actor);
  const text = await generate(
    actor,
    'talk_recap',
    `${SUMMARY_RULES(lang)} Group the bullets under one heading per channel ("#name"), at most 4 bullets each.`,
    parts.join('\n\n'),
    1400,
  );
  return store(actor, 'recap', 'daily', text, total, sources);
}

export interface TalkAnswer {
  text: string;
  answered: boolean;
  sources: Array<{ n: number; messageId: string; channelId: string; channelName: string; channelKind: TalkChannelKind; parentId: string | null; excerpt: string; userId: string | null; createdAt: string }>;
}

const STOP = new Set(['the', 'and', 'what', 'when', 'who', 'how', 'que', 'qué', 'cuando', 'cuándo', 'quien', 'quién', 'como', 'cómo', 'para', 'por', 'con', 'una', 'los', 'las', 'del', 'el', 'la', 'de', 'en', 'is', 'are', 'did', 'does', 'was', 'about', 'sobre', 'um', 'uma', 'o', 'os', 'as', 'do', 'da']);

/** Pregunta a Talk: busca en lo que la persona puede leer y responde con fuentes numeradas. */
export async function askTalk(actor: TalkActor, question: string): Promise<TalkAnswer> {
  const q = question.trim().slice(0, 500);
  if (!q) throw new TalkError('invalid_input');
  const seen = new Map<string, Awaited<ReturnType<typeof searchMessages>>['results'][number]>();
  const add = (rs: Awaited<ReturnType<typeof searchMessages>>['results']) => {
    for (const r of rs) if (!seen.has(r.message.id) && seen.size < 25) seen.set(r.message.id, r);
  };
  add((await searchMessages(actor, q.replace(/[?¿!¡"]/g, ' '), 25)).results);
  if (seen.size < 8) {
    const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length > 2 && !STOP.has(w)))].sort((a, b) => b.length - a.length).slice(0, 4);
    for (const w of words) add((await searchMessages(actor, w, 10)).results);
  }
  const names = await plainNames(actor.workspaceId);
  const results = [...seen.values()];
  const sources: TalkAnswer['sources'] = results.map((r, i) => ({
    n: i + 1,
    messageId: r.message.id,
    channelId: r.channel.id,
    channelName: r.channel.name,
    channelKind: r.channel.kind,
    parentId: r.message.parentId,
    excerpt: talkPlainText(r.message.body, names).replace(/\s+/g, ' ').slice(0, 200),
    userId: r.message.userId,
    createdAt: r.message.createdAt,
  }));
  if (!sources.length) return { text: '', answered: false, sources: [] };
  const lang = await langOf(actor);
  const context = sources
    .map((s) => `[${s.n}] ${s.createdAt.slice(0, 10)} ${s.channelKind === 'public' || s.channelKind === 'private' ? `#${s.channelName}` : 'DM'} ${s.userId ? (names.user(s.userId) ?? '') : ''}: ${s.excerpt}`)
    .join('\n');
  const text = await generate(
    actor,
    'talk_ask',
    `Answer the question in ${lang} using only the numbered messages. Cite sources inline like [1] or [2][3]. Be brief (at most 6 sentences). ` +
      'If the messages do not answer it, reply exactly NO_ANSWER.',
    `Question: ${q}\n\nMessages:\n${context}`,
    700,
  );
  if (!text || text.trim() === 'NO_ANSWER') return { text: '', answered: false, sources };
  return { text, answered: true, sources };
}

export const TRANSLATE_TO: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', zh: 'Chinese' };

export async function translateMessage(actor: TalkActor, messageId: string, lang: string): Promise<{ text: string; lang: string }> {
  const target = TRANSLATE_TO[lang];
  if (!target) throw new TalkError('invalid_input');
  const found = await readableMessage(actor, messageId);
  if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
  const names = await plainNames(actor.workspaceId);
  const plain = talkPlainText(found.message.body, names).slice(0, 6000);
  if (!plain.trim()) throw new TalkError('nothing_to_summarize', 409);
  const text = await generate(actor, 'talk_translate', `Translate the user's message into ${target}. Keep names, links, code and emoji as they are. Output only the translation.`, plain, 1200);
  return { text, lang };
}
