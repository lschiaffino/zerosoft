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
import { getDb } from './db';
import { createNotification } from './notifications';
import { emitEvent } from './events';
import { emitChatEvent } from './chat-api';
import { listFollowers } from './chat-collab';
import { notifyPersonLink } from './groups-push';

const CHAT_PUSH_TITLE: Record<string, (name: string) => string> = {
  en: (name) => `New message from ${name}`,
  es: (name) => `Mensaje nuevo de ${name}`,
  pt: (name) => `Nova mensagem de ${name}`,
};

export async function afterVisitorMessage(input: {
  widget: ChatWidgetRow;
  conversation: ChatConversationRow;
  visitor: ChatVisitorRow;
  message: ChatMessageRow;
  isNewConversation: boolean;
  /** Texto para reglas por keyword y para el bot (el body o el nombre del archivo). */
  text: string;
  schedule: ScheduleTask;
  /** Sin bot (el canal email: la respuesta del bot no saldría por email). */
  skipBot?: boolean;
}): Promise<{ conversation: ChatConversationRow; botMessage: ChatMessageRow | null }> {
  const { widget, visitor, message, isNewConversation, text, schedule } = input;
  let conversation = input.conversation;

  {
    const conv = conversation;
    const eventBase = {
      conversation: { id: conv.id, subject: conv.subject, status: conv.status },
      visitor: { id: visitor.id, name: visitor.name, email: visitor.email, emailVerified: visitor.email_verified === 1 },
      widget: { id: widget.id, name: widget.name },
    };
    schedule(async () => {
      if (isNewConversation) {
        await emitEvent(widget.user_id, 'conversation.created', eventBase);
        await emitChatEvent(conv.id, 'chat.conversation.created');
      }
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
  const botMessage = input.skipBot ? null : await dispatchChatBot(widget, conversation, { id: message.id, body: text }, schedule);

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
  // Quienes siguen la conversación sin estar asignados (como en Intercom).
  for (const id of await listFollowers(conversation.id)) {
    if (agents.some((a) => a.id === id)) recipients.add(id);
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
      meta: { actorName: senderName, visitorName: visitor.name, visitorEmail: visitor.email },
    });
  }
  // Push al celular o al navegador (PWA de la suite): en segundo plano.
  schedule(async () => {
    for (const userId of recipients) {
      // El push sale tal cual: va en el idioma que eligió cada persona.
      const row = (await getDb().prepare('SELECT locale FROM users WHERE id = ?').get(userId)) as { locale: string | null } | undefined;
      const pushTitle = CHAT_PUSH_TITLE[row?.locale ?? 'en']?.(senderName) ?? title;
      await notifyPersonLink(widget.user_id, userId, { title: pushTitle, body: (message.body || text).slice(0, 140), url: href });
    }
  });

  return { conversation, botMessage };
}
