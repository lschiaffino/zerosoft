import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import {
  getChatConversationWithVisitor,
  listChatMessagesWithUsers,
  listChatAgents,
} from '@/lib/chat-data';
import ConversationClient from '@/components/chat/ConversationClient';

export const dynamic = 'force-dynamic';

export default async function ChatConversationPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });

  const conversation = await getChatConversationWithVisitor(id);
  if (!conversation) notFound();

  // Ensure the conversation belongs to the user's workspace.
  const isOwner = conversation.widget_user_id === user.id;
  const isTeamWidget = user.team?.id && conversation.widget_team_id === user.team.id;
  if (!isOwner && !isTeamWidget) notFound();

  const messages = await listChatMessagesWithUsers(id);
  const agents = await listChatAgents(conversation.widget_user_id, conversation.widget_team_id);
  const me = user.actingUser ?? user;

  return (
    <div className="app-page chat-conversation-page">
      <div className="page-head">
        <h1 className="app-title">{t('inbox.title')}</h1>
      </div>
      <ConversationClient
        conversationId={id}
        initialConversation={conversation}
        initialMessages={messages}
        agents={agents}
        currentUser={{
          id: me.id,
          email: me.email,
          name: me.name,
          image: me.image,
        }}
      />
    </div>
  );
}
