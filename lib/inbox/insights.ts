/**
 * Inbox: la pestaña AI del panel de un chat de WhatsApp (lib/wa-insights.ts). Solo chats de la persona
 * (getThreadRow tira si no es suyo) y solo lo que ve en la conversación: los mensajes de ese chat y, si está en
 * varias cuentas, de las otras (como la conversación), sin borrados ni avisos del sistema. Nada se guarda. Mismo
 * proveedor que los borradores de Inbox (OpenRouter y después el Gateway, lib/inbox/ai.ts); INBOX_FAKE=1 (e2e)
 * responde con el modelo falso y la cookie inbox_ai_fake=off se comporta como sin IA. Server-only.
 */
import { generateText, Output } from 'ai';
import { assertAiQuota, recordAiUsage } from '../ai';
import { getThreadRow, listMessages } from './core';
import { inboxFakeAllowed } from './gmail';
import { inboxAiModels, inboxAiState, logFailure, mapError } from './ai';
import { InboxError } from './types';
import {
  INSIGHT_MAX_MESSAGES,
  answerSchema,
  askInstructions,
  askPrompt,
  cleanAnswer,
  cleanQuestion,
  fakeAnswer,
  type ChatAnswer,
  type ProposalKind,
  cleanInsights,
  fakeInsights,
  fitMessages,
  insightsInstructions,
  insightsPrompt,
  insightsSchema,
  rangeSince,
  sliceUnread,
  type ChatInsights,
  type InsightMessage,
  type InsightRange,
  type InsightsOutput,
} from '../wa-insights';

export type InboxAiTabState = 'ready' | 'off' | 'not_configured';

/** Con el modelo falso de e2e, la cookie inbox_ai_fake=off hace que el pedido se comporte como sin IA. */
async function fakeOff(): Promise<boolean> {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('inbox_ai_fake')?.value === 'off';
  } catch {
    return false;
  }
}

/** ¿Hay IA para la pestaña? (sin llamar a ningún modelo). */
export async function inboxAiTabState(): Promise<InboxAiTabState> {
  if (inboxFakeAllowed()) return (await fakeOff()) ? 'off' : 'ready';
  const s = inboxAiState();
  return s === 'disabled' ? 'off' : s;
}

const MENTION_RE = /(^|[^\w@])@(\d{5,20})(?!\d)/g;

/** Los mensajes del rango, del más viejo al más nuevo, como los ve la persona. */
/** En Inbox un seguimiento propuesto es siempre una tarea (CRM › Tareas, a nombre de la persona). */
export const INBOX_PROPOSAL_KINDS: readonly ProposalKind[] = ['task'];

/** `range` null: los últimos mensajes, sin rango (preguntarle a la IA sobre el chat). */
export async function inboxInsightMessages(owner: string, threadId: string, range: InsightRange | null): Promise<{ name: string; group: boolean; messages: InsightMessage[] }> {
  const t = await getThreadRow(owner, threadId);
  if (t.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  const page = await listMessages(owner, threadId, { limit: INSIGHT_MAX_MESSAGES });
  const since = range ? rangeSince(range) : null;
  const all = page.messages
    .filter((m) => !m.revoked && m.mediaType !== 'system' && (!since || m.sentAt >= since))
    .map((m): InsightMessage => {
      const body = (m.body ?? '').replace(MENTION_RE, (whole, pre: string, d: string) => {
        const n = m.mentionNames?.[d]?.name;
        return n ? `${pre}@${n}` : whole;
      });
      return {
        id: m.id,
        at: m.sentAt,
        fromMe: m.fromMe,
        who: m.fromMe ? 'Us' : m.senderName || (m.senderHandle ? `+${m.senderHandle.replace(/\D/g, '')}` : ''),
        text: body || (m.hasMedia || m.mediaType ? `[${m.mediaType || 'file'}]` : ''),
      };
    })
    .filter((m) => m.text);
  return { name: t.title || t.handle, group: t.kind === 'group', messages: range?.kind === 'unread' ? sliceUnread(all, range.unread, range.from) : all };
}

/** La pestaña AI de un chat de Inbox: resumen, preguntas, compromisos, respuestas sugeridas y ánimo. */
export async function inboxChatInsights(owner: string, threadId: string, range: InsightRange, locale = 'en'): Promise<ChatInsights> {
  // La IA primero: apagada, no se lee nada (el chat igual tiene que ser de la persona).
  const state = await inboxAiTabState();
  if (state !== 'ready') await getThreadRow(owner, threadId);
  if (state === 'off') throw new InboxError('ai_disabled', 503);
  if (state === 'not_configured') throw new InboxError('ai_not_configured', 503);
  const read = await inboxInsightMessages(owner, threadId, range);
  const { name, group } = read;
  const messages = fitMessages(read.messages);
  if (!messages.length) throw new InboxError('no_messages', 400);
  let out: InsightsOutput;
  if (inboxFakeAllowed()) {
    try {
      await assertAiQuota(owner);
    } catch (err) {
      throw mapError(err);
    }
    out = fakeInsights(messages, INBOX_PROPOSAL_KINDS);
  } else {
    out = await askModels(owner, 'inbox_insights', insightsInstructions(locale, INBOX_PROPOSAL_KINDS), insightsPrompt(name, group, messages, range), insightsSchema);
  }
  return { ...cleanInsights(out, INBOX_PROPOSAL_KINDS), messages: messages.length, range };
}

/** Preguntarle a la IA sobre el chat: solo con los últimos mensajes de ese chat de la persona. */
export async function inboxChatAsk(owner: string, threadId: string, question: string, locale = 'en'): Promise<ChatAnswer> {
  const q = cleanQuestion(question);
  if (!q) throw new InboxError('empty_question', 400);
  const state = await inboxAiTabState();
  if (state !== 'ready') await getThreadRow(owner, threadId);
  if (state === 'off') throw new InboxError('ai_disabled', 503);
  if (state === 'not_configured') throw new InboxError('ai_not_configured', 503);
  const read = await inboxInsightMessages(owner, threadId, null);
  const messages = fitMessages(read.messages);
  if (!messages.length) throw new InboxError('no_messages', 400);
  let out: { answer: string };
  if (inboxFakeAllowed()) {
    try {
      await assertAiQuota(owner);
    } catch (err) {
      throw mapError(err);
    }
    out = fakeAnswer(messages, q);
  } else {
    out = await askModels(owner, 'inbox_chat_ask', askInstructions(locale), askPrompt(read.name, read.group, messages, q), answerSchema);
  }
  const answer = cleanAnswer(out.answer);
  if (!answer) throw new InboxError('empty_result', 502);
  return { answer, messages: messages.length };
}

/** ¿La persona puede crear tareas del CRM en su workspace activo? (sin el CRM, la pestaña lo dice y no ofrece crear). */
export async function inboxCanCreateTasks(): Promise<boolean> {
  const [{ getCurrentUser }, { inboxCrmOn }] = await Promise.all([import('../session'), import('./crm')]);
  const user = await getCurrentUser();
  return !!user && inboxCrmOn(user);
}

/**
 * Crea en CRM › Tareas el seguimiento que la persona aprobó (título y notas como los dejó), a su nombre. El chat
 * tiene que ser suyo; sin el CRM, `crm_off`. No se crea nada sin este pedido (el clic en "Crear").
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
  const [{ getCurrentUser, realUserId }, { inboxCrmOn }] = await Promise.all([import('../session'), import('./crm')]);
  const user = await getCurrentUser();
  if (!user || realUserId(user) !== owner) throw new InboxError('unauthorized', 401);
  if (!inboxCrmOn(user)) throw new InboxError('crm_off', 403);
  const { cleanPriority } = await import('../tasks-shared');
  const { createActivity } = await import('../crm');
  const task = await createActivity(user.id, { type: 'task', subject: title, body: notes, ownerId: owner, priority: cleanPriority(input.priority) });
  return { id: task.id, title: task.subject, href: `/app/crm/tasks/${task.id}` };
}

/** Prueba los modelos de Inbox en orden (si el primero falla, el siguiente). Cuota, rate limit y ai_usage como siempre. */
async function askModels<T>(owner: string, feature: string, instructions: string, prompt: string, schema: import('zod').ZodType<T>): Promise<T> {
  const models = inboxAiModels();
  if (!models.length) throw new InboxError('ai_not_configured', 503);
  try {
    await assertAiQuota(owner);
  } catch (err) {
    throw mapError(err);
  }
  let last: unknown = null;
  for (const m of models) {
    try {
      const r = await generateText({ model: m.model, instructions, prompt, output: Output.object({ schema }), maxOutputTokens: 1500, temperature: 0.2, timeout: 45_000, maxRetries: 1 });
      await recordAiUsage({ workspaceId: owner, feature, model: m.modelId, inputTokens: r.totalUsage?.inputTokens ?? 0, outputTokens: r.totalUsage?.outputTokens ?? 0 }).catch(() => {});
      return r.output as T;
    } catch (err) {
      // Solo el tipo de error y el estado: ni la conversación ni la respuesta van al log.
      logFailure(m.via, m.modelId, err);
      last = err;
    }
  }
  throw mapError(last);
}
