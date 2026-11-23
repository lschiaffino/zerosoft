/**
 * Inbox: la pestaña IA del panel de un chat de WhatsApp. Preguntarle a la IA
 * sobre el chat y leer el sentimiento con las tareas que propone (reglas en
 * lib/groups-ai-rules.ts). Lee solo los mensajes de ese chat de la persona
 * (owner), sin los ocultos ni los avisos del sistema.
 *
 * Nada se crea solo: una tarea propuesta se crea en CRM › Tareas, a nombre de
 * la persona, cuando la aprueba (createInsightTask), y solo si usa el CRM en
 * su workspace. Server-only.
 */
import { generateText, Output } from 'ai';
import { assertAiQuota, recordAiUsage } from '../ai';
import { getDb } from '../db';
import {
  answerSchema,
  askPrompt,
  cleanAnswer,
  cleanInsights,
  cleanQuestion,
  fakeAnswer,
  fakeInsights,
  insightsPrompt,
  insightsSchema,
  type ChatAnswer,
  type ChatInsights,
  type ChatTranscript,
  type ProposalKind,
} from '../groups-ai-rules';
import { inboxAiModels, logFailure, mapError, nameMentions } from './ai';
import { getThreadRow } from './core';
import { inboxFakeAllowed } from './gmail';
import { InboxError } from './types';

/** En Inbox una propuesta es siempre una tarea (no hay tickets). */
export const INBOX_PROPOSAL_KINDS: readonly ProposalKind[] = ['task'];

const MAX_MESSAGES = 150;

export async function inboxTranscript(owner: string, threadId: string): Promise<ChatTranscript> {
  const t = await getThreadRow(owner, threadId);
  if (t.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  const rows = ((await getDb()
    .prepare(
      "SELECT from_me, sender_name, body, media_type, sent_at, meta FROM inbox_messages WHERE thread_id = ? AND owner_id = ? AND hidden_at IS NULL AND media_type <> 'system' ORDER BY sent_at DESC LIMIT ?",
    )
    .all(threadId, owner, MAX_MESSAGES)) as unknown as Array<{ from_me: number; sender_name: string; body: string; media_type: string; sent_at: string; meta?: string | null }>).reverse();
  if (!rows.length) throw new InboxError('no_messages', 400);
  // Habla de personas: "@<dígitos>" → "@Nombre".
  await nameMentions(owner, t.account_id, rows);
  const title = t.title || t.handle;
  const lines = rows.map((r) => {
    const who = r.from_me ? 'Me' : r.sender_name || title;
    const text = (r.body || (r.media_type ? `[${r.media_type}]` : '')).replace(/\s+/g, ' ').trim().slice(0, 1000);
    return `[${r.sent_at.slice(0, 16).replace('T', ' ')}] ${who}: ${text}`;
  });
  return { header: `${t.kind === 'group' ? 'WhatsApp group' : 'WhatsApp chat with'} "${title}".`, lines, us: 'Me' };
}

/**
 * Una llamada al modelo con salida estructurada, probando OpenRouter y después el Gateway (como los borradores
 * de lib/inbox/ai.ts). Con INBOX_FAKE responde `fake` sin llamar a nadie.
 */
async function inboxObject<T>(owner: string, feature: string, built: { instructions: string; prompt: string }, schema: import('zod').ZodType<T>, fake: () => T, maxOutputTokens: number): Promise<T> {
  if (inboxFakeAllowed()) return fake();
  const models = inboxAiModels();
  if (!models.length) throw new InboxError('ai_not_configured', 503);
  try {
    await assertAiQuota(owner);
  } catch (err) {
    throw mapError(err);
  }
  let lastErr: unknown = null;
  for (const m of models) {
    try {
      const r = await generateText({
        model: m.model,
        instructions: built.instructions,
        prompt: built.prompt,
        output: Output.object({ schema }),
        temperature: 0.2,
        maxOutputTokens,
        timeout: 45_000,
        maxRetries: 1,
      });
      await recordAiUsage({ workspaceId: owner, feature, model: m.modelId, inputTokens: r.totalUsage?.inputTokens ?? 0, outputTokens: r.totalUsage?.outputTokens ?? 0 }).catch(() => {});
      return r.output as T;
    } catch (err) {
      logFailure(m.via, m.modelId, err);
      lastErr = err;
    }
  }
  throw mapError(lastErr);
}

export async function askInboxChat(owner: string, threadId: string, question: string, locale = 'en'): Promise<ChatAnswer> {
  const q = cleanQuestion(question);
  if (!q) throw new InboxError('empty_question', 400);
  const t = await inboxTranscript(owner, threadId);
  const res = await inboxObject(owner, 'inbox_chat_ask', askPrompt(t, q, locale), answerSchema, () => fakeAnswer(t, q), 800);
  const answer = cleanAnswer(res.answer);
  if (!answer) throw new InboxError('empty_result', 502);
  return { answer, messages: t.lines.length };
}

export async function inboxChatInsights(owner: string, threadId: string, locale = 'en'): Promise<ChatInsights> {
  const t = await inboxTranscript(owner, threadId);
  const raw = await inboxObject(owner, 'inbox_chat_insights', insightsPrompt(t, locale, INBOX_PROPOSAL_KINDS), insightsSchema, () => fakeInsights(t, INBOX_PROPOSAL_KINDS), 1200);
  return cleanInsights(raw, t.lines.length, INBOX_PROPOSAL_KINDS);
}

/** ¿La persona puede crear tareas del CRM en su workspace activo? */
export async function inboxCanCreateTasks(): Promise<boolean> {
  const { getCurrentUser } = await import('../session');
  const { canUse } = await import('../permissions');
  const user = await getCurrentUser();
  return !!user && canUse(user, 'crm');
}

/**
 * Crea en CRM › Tareas la tarea que la persona aprobó (título y notas como los dejó), a su nombre. El chat
 * tiene que ser suyo; sin el CRM, `crm_off`.
 */
export async function createInsightTask(
  owner: string,
  threadId: string,
  input: { title?: unknown; notes?: unknown; priority?: unknown },
): Promise<{ id: string; title: string; href: string }> {
  await getThreadRow(owner, threadId);
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!title) throw new InboxError('invalid_title', 400);
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 4000) : '';
  const { getCurrentUser, realUserId } = await import('../session');
  const { canUse } = await import('../permissions');
  const user = await getCurrentUser();
  if (!user || realUserId(user) !== owner) throw new InboxError('unauthorized', 401);
  if (!canUse(user, 'crm')) throw new InboxError('crm_off', 403);
  const { cleanPriority } = await import('../tasks-shared');
  const { createActivity } = await import('../crm');
  const task = await createActivity(user.id, { type: 'task', subject: title, body: notes, ownerId: owner, priority: cleanPriority(input.priority) });
  return { id: task.id, title: task.subject, href: `/app/crm/tasks/${task.id}` };
}
