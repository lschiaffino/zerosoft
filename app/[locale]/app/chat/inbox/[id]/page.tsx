import { withViewerCrmContact } from '@/lib/chat-crm-contact';
import { notFound } from 'next/navigation';
import { realUserId, requireUser } from '@/lib/session';
import {
  getChatConversationWithVisitor,
  getChatWidget,
  listChatMessagesWithUsers,
  listChatAgents,
} from '@/lib/chat-data';
import { canAccessConversation } from '@/lib/chat-access';
import { filterWidgetAudience } from '@/lib/chat-audience';
import ConversationClient from '@/components/chat/ConversationClient';
import { isFollowing, listChatTeams } from '@/lib/chat-collab';

export const dynamic = 'force-dynamic';

/** Conversación y detalles: columnas 2 y 3 de la bandeja (la lista vive en el layout). */
export default async function ChatConversationPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);

  // Workspace y lista de la bandeja restringida, antes de leer nada de la conversación.
  const access = await canAccessConversation(id, user);
  if (!access.ok) notFound();

  const found = await getChatConversationWithVisitor(id);
  if (!found) notFound();
  // El contacto del CRM vinculado, como lo ve esta persona en el CRM.
  const conversation = await withViewerCrmContact(found, user);

  const messages = await listChatMessagesWithUsers(id);
  const widget = await getChatWidget(conversation.widget_id);
  const allAgents = await listChatAgents(conversation.widget_user_id, conversation.widget_team_id);
  const agents = widget ? await filterWidgetAudience(widget, allAgents) : allAgents;
  const me = user.actingUser ?? user;
  const teams = (await listChatTeams(conversation.widget_user_id)).map((x) => ({ id: x.id, name: x.name }));
  const following = await isFollowing(id, realUserId(user));

  return (
    <ConversationClient
      key={id}
      conversationId={id}
      initialConversation={conversation}
      initialMessages={messages}
      agents={agents}
      teams={teams}
      initialFollowing={following}
      currentUser={{
        id: me.id,
        email: me.email,
        name: me.name,
        image: me.image,
      }}
    />
  );
}
