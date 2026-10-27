/**
 * Chat — una conversación nueva que responde a un mensaje saliente: el
 * mensaje del equipo queda primero en el hilo (como lo vio el visitante,
 * marcado como leído), la conversación guarda de qué mensaje salió y suma
 * una respuesta al contador. Solo mensajes activos del mismo widget y de
 * tipo chat. Server-only.
 */
import { getDb } from './db';
import type { ChatConversationRow, ChatWidgetRow } from './db';
import { createChatMessage, getChatConversation, listChatAgents } from './chat-data';
import { getActiveOutbound, recordOutboundReply } from './chat-outbound';

export async function startFromOutbound(
  widget: ChatWidgetRow,
  conversation: ChatConversationRow,
  outboundId: string,
): Promise<ChatConversationRow | null> {
  const message = await getActiveOutbound(widget.id, outboundId);
  if (!message || message.kind !== 'chat' || !message.body) return null;
  const agents = await listChatAgents(widget.user_id, widget.team_id);
  const author = message.created_by && agents.some((a) => a.id === message.created_by) ? message.created_by : null;
  const row = await createChatMessage(conversation.id, author ? 'user' : 'bot', { body: message.body, userId: author ?? undefined });
  const db = getDb();
  const earlier = new Date(Date.parse(row.created_at) - 1000).toISOString();
  await db.prepare('UPDATE chat_messages SET created_at = ?, read_at = ? WHERE id = ?').run(earlier, row.created_at, row.id);
  await db.prepare('UPDATE chat_conversations SET outbound_id = ? WHERE id = ?').run(message.id, conversation.id);
  await recordOutboundReply(message.id);
  return (await getChatConversation(conversation.id)) ?? null;
}
