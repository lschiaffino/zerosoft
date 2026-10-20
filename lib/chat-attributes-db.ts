/**
 * Chat — atributos de conversación en la base (las definiciones y la
 * validación están en lib/chat-attributes.ts). Server-only.
 */
import { getDb } from './db';
import type { ChatConversationRow, ChatWidgetRow } from './db';
import { missingRequiredAttributes, parseAttributeDefs, parseAttributeValues, type ChatAttributeValues } from './chat-attributes';

/** Guarda los valores (ya validados) de la conversación. */
export async function saveConversationAttributes(conversationId: string, values: ChatAttributeValues): Promise<void> {
  await getDb()
    .prepare('UPDATE chat_conversations SET attributes = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(values), new Date().toISOString(), conversationId);
}

/**
 * Nombres de los atributos obligatorios que le faltan a la conversación para
 * poder resolverla (vacío = se puede). Lee las definiciones del widget.
 */
export async function attributesBlockingResolve(
  conversation: Pick<ChatConversationRow, 'widget_id' | 'attributes'>,
  widget?: Pick<ChatWidgetRow, 'conversation_attributes'> | null,
): Promise<string[]> {
  const w =
    widget ??
    ((await getDb().prepare('SELECT conversation_attributes FROM chat_widgets WHERE id = ?').get(conversation.widget_id)) as
      | Pick<ChatWidgetRow, 'conversation_attributes'>
      | undefined);
  const defs = parseAttributeDefs(w?.conversation_attributes);
  if (defs.length === 0) return [];
  return missingRequiredAttributes(defs, parseAttributeValues(conversation.attributes)).map((d) => d.name);
}
