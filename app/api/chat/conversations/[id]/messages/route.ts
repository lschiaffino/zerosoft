import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  createChatMessage,
  listChatMessagesWithUsers,
  recordFirstResponse,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';


export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const messages = await listChatMessagesWithUsers(params.id);
  return NextResponse.json({ messages });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!messageBody) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const message = await createChatMessage(params.id, 'user', {
    body: messageBody,
    userId: user.id,
    attachments: Array.isArray(body.attachments)
      ? (body.attachments as Parameters<typeof createChatMessage>[2]['attachments'])
      : undefined,
  });

  await recordFirstResponse(params.id);

  return NextResponse.json(message, { status: 201 });
}
