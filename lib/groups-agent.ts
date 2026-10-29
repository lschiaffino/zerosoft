/**
 * Groups + Agents: un agente de Agents asignado a un chat contesta los
 * mensajes nuevos por el mismo número. Usa el canal 'api' de Agents (una
 * conversación por chat, guardada en agent_conversation_id): el historial,
 * las herramientas, las aprobaciones y la derivación son las del agente.
 *
 * Si la AI está apagada, el agente está pausado o derivó a una persona, no
 * contesta y el chat queda esperando respuesta como cualquier otro.
 * Server-only.
 */
import { getDb } from './db';
import { aiEnabled } from './ai';
import { getChatRow, getMessageRow, sendMessage } from './groups';

export async function replyWithAgent(ws: string, chatId: string, messageId: string): Promise<'replied' | 'skipped' | 'handoff'> {
  if (!aiEnabled()) return 'skipped';
  const chat = await getChatRow(ws, chatId);
  const msg = await getMessageRow(ws, messageId);
  if (!chat?.agent_id || !msg || msg.direction !== 'in' || !msg.body.trim()) return 'skipped';
  const { getAgentRow, sendAgentMessage } = await import('./agents');
  const agent = await getAgentRow(ws, chat.agent_id);
  if (!agent || agent.enabled !== 1) return 'skipped';
  const who = msg.sender_name || (msg.sender_phone ? `+${msg.sender_phone}` : '');
  const text = chat.kind === 'group' && who ? `${who}: ${msg.body}` : msg.body;
  let res;
  try {
    res = await sendAgentMessage({ agent, channel: 'api', text, conversationId: chat.agent_conversation_id, createdBy: null });
  } catch (err) {
    // La conversación del agente se borró: empieza una nueva la próxima vez.
    if ((err as { code?: string })?.code === 'conversation_not_found') {
      await getDb().prepare('UPDATE groups_chats SET agent_conversation_id = NULL WHERE id = ?').run(chat.id);
    }
    return 'skipped';
  }
  if (res.conversation.id !== chat.agent_conversation_id) {
    await getDb().prepare('UPDATE groups_chats SET agent_conversation_id = ? WHERE id = ?').run(res.conversation.id, chat.id);
  }
  if (res.result.handoff || !res.reply?.content?.trim()) return 'handoff';
  // WhatsApp no dibuja botones ni formularios: van como texto (responder "2" elige la opción 2).
  const { uiAsText } = await import('./agents-ui-blocks');
  const extra = uiAsText(res.result.ui ?? null);
  const body = extra ? `${res.reply.content}\n\n${extra}` : res.reply.content;
  await sendMessage(ws, null, chat.id, { body, authorKind: 'agent', replyToId: chat.kind === 'group' ? msg.id : null });
  return 'replied';
}
