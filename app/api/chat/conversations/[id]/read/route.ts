import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  getChatConversation,
  getChatWidget,
  listChatMessagesWithUsers,
  markMessagesRead,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function canAccessConversation(
  conversationId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const conversation = await getChatConversation(conversationId);
  if (!conversation) return false;
  const widget = await getChatWidget(conversation.widget_id);
  if (!widget) return false;
  if (widget.user_id !== user.id && widget.team_id !== user.team?.id) {
    return false;
  }
  return true;
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ok = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await markMessagesRead(params.id, 'user');
  const messages = await listChatMessagesWithUsers(params.id);
  return NextResponse.json({ messages });
}
