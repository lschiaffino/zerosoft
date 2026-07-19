import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getChatConversation, getChatWidget, listTyping, setTyping } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function canAccessConversation(
  conversationId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const conversation = await getChatConversation(conversationId);
  if (!conversation) return { ok: false };
  const widget = await getChatWidget(conversation.widget_id);
  if (!widget) return { ok: false };
  if (widget.user_id !== user.id && widget.team_id !== user.team?.id) {
    return { ok: false };
  }
  return { ok: true, conversation };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const typing = await listTyping(params.id);
  return NextResponse.json({ typing });
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await setTyping(params.id, 'user', user.id, 5);
  const typing = await listTyping(params.id);
  return NextResponse.json({ typing });
}
