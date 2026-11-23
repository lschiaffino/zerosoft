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
  cleanInsights,
  fakeInsights,
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
export async function inboxInsightMessages(owner: string, threadId: string, range: InsightRange): Promise<{ name: string; group: boolean; messages: InsightMessage[] }> {
  const t = await getThreadRow(owner, threadId);
  if (t.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  const page = await listMessages(owner, threadId, { limit: INSIGHT_MAX_MESSAGES });
  const since = rangeSince(range);
  const all = page.messages
    .filter((m) => !m.revoked && m.mediaType !== 'system' && (!since || m.sentAt >= since))
    .map((m): InsightMessage => {
      const body = (m.body ?? '').replace(MENTION_RE, (whole, pre: string, d: string) => {
        const n = m.mentionNames?.[d]?.name;
        return n ? `${pre}@${n}` : whole;
      });
      return {
        at: m.sentAt,
        fromMe: m.fromMe,
        who: m.fromMe ? 'Us' : m.senderName || (m.senderHandle ? `+${m.senderHandle.replace(/\D/g, '')}` : ''),
        text: body || (m.hasMedia || m.mediaType ? `[${m.mediaType || 'file'}]` : ''),
      };
    })
    .filter((m) => m.text);
  return { name: t.title || t.handle, group: t.kind === 'group', messages: range.kind === 'unread' ? sliceUnread(all, range.unread) : all };
}

/** La pestaña AI de un chat de Inbox: resumen, preguntas, compromisos, respuestas sugeridas y ánimo. */
export async function inboxChatInsights(owner: string, threadId: string, range: InsightRange, locale = 'en'): Promise<ChatInsights> {
  const { name, group, messages } = await inboxInsightMessages(owner, threadId, range);
  if (!messages.length) throw new InboxError('no_messages', 400);
  const state = await inboxAiTabState();
  if (state === 'off') throw new InboxError('ai_disabled', 503);
  if (state === 'not_configured') throw new InboxError('ai_not_configured', 503);
  let out: InsightsOutput;
  if (inboxFakeAllowed()) {
    try {
      await assertAiQuota(owner);
    } catch (err) {
      throw mapError(err);
    }
    out = fakeInsights(messages);
  } else {
    out = await askModels(owner, insightsInstructions(locale), insightsPrompt(name, group, messages, range));
  }
  return { ...cleanInsights(out), messages: messages.length, range };
}

/** Prueba los modelos de Inbox en orden (si el primero falla, el siguiente). Cuota, rate limit y ai_usage como siempre. */
async function askModels(owner: string, instructions: string, prompt: string): Promise<InsightsOutput> {
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
      const r = await generateText({ model: m.model, instructions, prompt, output: Output.object({ schema: insightsSchema }), maxOutputTokens: 1500, temperature: 0.2, timeout: 45_000, maxRetries: 1 });
      await recordAiUsage({ workspaceId: owner, feature: 'inbox_insights', model: m.modelId, inputTokens: r.totalUsage?.inputTokens ?? 0, outputTokens: r.totalUsage?.outputTokens ?? 0 }).catch(() => {});
      return r.output as InsightsOutput;
    } catch (err) {
      // Solo el tipo de error y el estado: ni la conversación ni la respuesta van al log.
      logFailure(m.via, m.modelId, err);
      last = err;
    }
  }
  throw mapError(last);
}
