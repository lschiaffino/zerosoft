import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getChatConversation, getChatWidget, updateChatConversation } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function canAccessConversation(
  conversationId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const conversation = await getChatConversation(conversationId);
  if (!conversation) return { ok: false, conversation: null };
  const widget = await getChatWidget(conversation.widget_id);
  if (!widget) return { ok: false, conversation: null };
  if (widget.user_id !== user.id && widget.team_id !== user.team?.id) {
    return { ok: false, conversation: null };
  }
  return { ok: true, conversation };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(conversation);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

  const updated = await updateChatConversation(params.id, {
    status:
      body.status === 'open' || body.status === 'closed' || body.status === 'snoozed'
        ? body.status
        : undefined,
    assignedTo:
      body.assignedTo === null
        ? null
        : typeof body.assignedTo === 'string'
          ? body.assignedTo
          : undefined,
    priority:
      body.priority === 'low' ||
      body.priority === 'normal' ||
      body.priority === 'high' ||
      body.priority === 'urgent'
        ? body.priority
        : undefined,
    subject: typeof body.subject === 'string' ? body.subject : undefined,
  });

  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });
  return NextResponse.json(updated);
}
