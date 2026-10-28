import { notFound } from 'next/navigation';
import { realUserId, requireUser } from '@/lib/session';
import {
  getChatConversationWithVisitor,
  listChatMessagesWithUsers,
  listChatAgents,
} from '@/lib/chat-data';
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

  const conversation = await getChatConversationWithVisitor(id);
  if (!conversation) notFound();

  // Ensure the conversation belongs to the user's workspace.
  const isOwner = conversation.widget_user_id === user.id;
  const isTeamWidget = user.team?.id && conversation.widget_team_id === user.team.id;
  if (!isOwner && !isTeamWidget) notFound();

  const messages = await listChatMessagesWithUsers(id);
  const agents = await listChatAgents(conversation.widget_user_id, conversation.widget_team_id);
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
