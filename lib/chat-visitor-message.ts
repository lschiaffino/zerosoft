/**
 * Chat — lo que pasa después de que un visitante manda un mensaje (texto o
 * adjunto): eventos/webhooks, reglas de asignación, bot y notificaciones.
 * Compartido por POST /api/chat/messages y POST /api/chat/messages/upload para
 * que una conversación que arranca con un archivo no quede sin asignar ni
 * sin avisar.
 */
import type { ChatConversationRow, ChatMessageRow, ChatVisitorRow, ChatWidgetRow } from './db';
import { applyAssignmentRules, listChatAgents } from './chat-data';
import { dispatchChatBot, type ScheduleTask } from './chat-bot-ai';
import { createNotification } from './notifications';
import { emitEvent } from './events';

export async function afterVisitorMessage(input: {
  widget: ChatWidgetRow;
  conversation: ChatConversationRow;
  visitor: ChatVisitorRow;
  message: ChatMessageRow;
  isNewConversation: boolean;
  /** Texto para reglas por keyword y para el bot (el body o el nombre del archivo). */
  text: string;
  schedule: ScheduleTask;
}): Promise<{ conversation: ChatConversationRow; botMessage: ChatMessageRow | null }> {
  const { widget, visitor, message, isNewConversation, text, schedule } = input;
  let conversation = input.conversation;

  {
    const conv = conversation;
    const eventBase = {
      conversation: { id: conv.id, subject: conv.subject, status: conv.status },
      visitor: { id: visitor.id, name: visitor.name, email: visitor.email },
      widget: { id: widget.id, name: widget.name },
    };
    schedule(async () => {
      if (isNewConversation) await emitEvent(widget.user_id, 'conversation.created', eventBase);
      await emitEvent(widget.user_id, 'message.received', {
        ...eventBase,
        message: { id: message.id, body: message.body, createdAt: message.created_at },
      });
    });
  }

  // Auto-assign via assignment rules before notifying.
  const agents = await listChatAgents(widget.user_id, widget.team_id);
  const assignedTo = await applyAssignmentRules(widget.id, conversation.id, text, agents);
  if (assignedTo) {
    conversation = { ...conversation, assigned_to: assignedTo };
  }

  // Bot: keywords responde al instante (una vez); el bot AI responde en
  // segundo plano (after) y el widget recibe la respuesta en su polling.
  const botMessage = await dispatchChatBot(widget, conversation, { id: message.id, body: text }, schedule);

  // Notify widget owner and assigned agent.
  const recipients = new Set<string>();
  recipients.add(widget.user_id);
  // Solo si sigue siendo agente del widget (no a quien salió del team).
  if (
    conversation.assigned_to &&
    conversation.assigned_to !== widget.user_id &&
    agents.some((a) => a.id === conversation.assigned_to)
  ) {
    recipients.add(conversation.assigned_to);
  }

  const senderName = visitor.name || visitor.email || visitor.external_id;
  const title = `New message from ${senderName}`;
  const href = `/app/chat/inbox/${conversation.id}`;

  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'chat_message',
      title,
      body: (message.body || text).slice(0, 140),
      href,
      sourceType: 'chat_conversation',
      sourceId: conversation.id,
      meta: { visitorName: visitor.name, visitorEmail: visitor.email },
    });
  }

  return { conversation, botMessage };
}
