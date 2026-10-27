/**
 * Agents — canal Chat. Un widget con bot_source = 'agent' delega en el agente
 * asignado (agent_id). Igual que el bot AI de Chat: responde cada mensaje del
 * visitante mientras ningún humano haya contestado y no haya derivado; corre
 * en segundo plano (after) y el widget recibe la respuesta en su polling.
 * Ante cualquier falla cae al bot por keywords. Server-only.
 */
import type { ChatConversationRow, ChatMessageRow, ChatWidgetRow } from './db';
import { aiEnabled } from './ai';
import { createChatMessage, getChatConversation, maybeRunChatBot } from './chat-data';
import {
  clearBotTyping,
  describeMessage,
  humanHasReplied,
  markHandoff,
  recentMessages,
  setBotTyping,
  toModelMessages,
  wasHandedOff,
  type ScheduleTask,
} from './chat-bot-ai';
import { AgentError, assertAgentLimits, conversationForChat, getAgentRowById, runAgent } from './agents';
import type { AgentRow } from './db';

export type AgentChatStatus = 'replied' | 'handoff' | 'skipped' | 'fallback' | 'rate_limited';

export interface AgentChatOutcome {
  status: AgentChatStatus;
  message: ChatMessageRow | null;
}

/** Agente asignado al widget, si existe, es del mismo workspace y está activo. */
export async function widgetAgent(widget: Pick<ChatWidgetRow, 'user_id' | 'bot_source' | 'agent_id'>): Promise<AgentRow | null> {
  if (widget.bot_source !== 'agent' || !widget.agent_id) return null;
  const agent = await getAgentRowById(widget.agent_id);
  if (!agent || agent.user_id !== widget.user_id || agent.enabled !== 1) return null;
  return agent;
}

/**
 * Genera y publica la respuesta del agente. Con `triggerMessageId`, si ya
 * llegó un mensaje más nuevo del visitante no hace nada (lo contesta la
 * ejecución disparada por ese mensaje).
 */
export async function runAgentChatReply(
  widget: ChatWidgetRow,
  agent: AgentRow,
  conversationId: string,
  triggerMessageId?: string,
): Promise<AgentChatOutcome> {
  try {
    const conversation = await getChatConversation(conversationId);
    if (!conversation || conversation.widget_id !== widget.id) return { status: 'skipped', message: null };
    if ((await humanHasReplied(conversationId)) || (await wasHandedOff(conversationId))) {
      return { status: 'skipped', message: null };
    }
    const rows = await recentMessages(conversationId, 20);
    const visitorRows = rows.filter((m) => m.sender_type === 'visitor');
    const lastVisitor = visitorRows[visitorRows.length - 1];
    if (!lastVisitor) return { status: 'skipped', message: null };
    if (triggerMessageId && lastVisitor.id !== triggerMessageId) return { status: 'skipped', message: null };

    const agentConv = await conversationForChat(agent, conversationId, describeMessage(visitorRows[0]).slice(0, 80));
    try {
      await assertAgentLimits(agent.user_id, agentConv.id);
    } catch (err) {
      if (err instanceof AgentError) return { status: 'rate_limited', message: null };
      throw err;
    }

    // Visitante bloqueado desde Conversaciones: el agente no le contesta (el equipo sí puede).
    const { isChatVisitorBlocked } = await import('./agents-privacy');
    if (await isChatVisitorBlocked(agent.id, conversation.visitor_id)) return { status: 'skipped', message: null };
    // Identidad firmada por el sitio (lib/chat-identity.ts): contexto y memoria del visitante.
    const { chatVisitorIdentity, memoryRefFor, setConversationIdentity } = await import('./agents-context');
    const identity = await chatVisitorIdentity(conversationId);
    if (identity && !agentConv.visitor_ref) {
      await setConversationIdentity(agentConv.id, identity, memoryRefFor('chat', { identity }));
      agentConv.visitor_email = identity.email;
      agentConv.visitor_ref = memoryRefFor('chat', { identity });
    }

    let result;
    try {
      const messages = toModelMessages(rows);
      if (messages.length === 0) return { status: 'skipped', message: null };
      result = await runAgent({ agent, conversation: agentConv, messages, channel: 'chat', identity });
    } catch (err) {
      console.error('[agents-chat] run failed', err);
      const message = await maybeRunChatBot(widget, conversation, describeMessage(lastVisitor));
      return { status: 'fallback', message };
    }

    // Si un humano contestó mientras el agente pensaba, no se mete.
    if (await humanHasReplied(conversationId)) return { status: 'skipped', message: null };
    const message = result.text ? await createChatMessage(conversationId, 'bot', { body: result.text }) : null;
    if (result.handoff) {
      await markHandoff(widget, conversation, `the agent "${agent.name}"`);
      return { status: 'handoff', message };
    }
    return { status: 'replied', message };
  } finally {
    await clearBotTyping(conversationId).catch(() => {});
  }
}

/** Entrada desde dispatchChatBot (lib/chat-bot-ai.ts) para widgets con agente. */
export async function dispatchAgentChat(
  widget: ChatWidgetRow,
  conversation: ChatConversationRow,
  visitorMessage: Pick<ChatMessageRow, 'id' | 'body'>,
  schedule?: ScheduleTask,
): Promise<ChatMessageRow | null> {
  const agent = await widgetAgent(widget);
  if (!agent || !aiEnabled()) return maybeRunChatBot(widget, conversation, visitorMessage.body);
  if ((await humanHasReplied(conversation.id)) || (await wasHandedOff(conversation.id))) return null;

  await setBotTyping(conversation.id).catch(() => {});
  const task = async () => (await runAgentChatReply(widget, agent, conversation.id, visitorMessage.id)).message;
  if (schedule) {
    schedule(async () => {
      try {
        await task();
      } catch (err) {
        console.error('[agents-chat] reply failed', err);
      }
    });
    return null;
  }
  try {
    return await task();
  } catch (err) {
    console.error('[agents-chat] reply failed', err);
    return null;
  }
}
