import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  listChatMessagesWithUsers,
  markMessagesRead,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';


export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await markMessagesRead(params.id, 'user');
  const messages = await listChatMessagesWithUsers(params.id);
  return NextResponse.json({ messages });
}
