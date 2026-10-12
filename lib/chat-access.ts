import { getChatConversation, getChatWidget } from './chat-data';
import type { ChatConversationRow, ChatWidgetRow } from './db';
import type { SessionUser } from './session';

/** Un widget es del usuario (workspace personal) o del team activo. */
export function canAccessWidget(widget: ChatWidgetRow | null | undefined, user: SessionUser): boolean {
  if (!widget) return false;
  if (widget.user_id === user.id) return true;
  return Boolean(widget.team_id && user.team?.id === widget.team_id);
}

/** Conversación accesible para el agente logueado (vía su widget). */
export async function canAccessConversation(
  conversationId: string,
  user: SessionUser,
): Promise<{ ok: boolean; conversation: ChatConversationRow | null }> {
  const conversation = await getChatConversation(conversationId);
  if (!conversation) return { ok: false, conversation: null };
  const widget = await getChatWidget(conversation.widget_id);
  if (!canAccessWidget(widget, user)) return { ok: false, conversation: null };
  return { ok: true, conversation };
}
