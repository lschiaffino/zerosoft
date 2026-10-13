import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  createChatMessage,
  getChatWidget,
  listChatAgents,
  listChatMessagesWithUsers,
  recordFirstResponse,
} from '@/lib/chat-data';
import { createChatNoteMentionNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';


export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const messages = await listChatMessagesWithUsers(params.id);
  return NextResponse.json({ messages });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(params.id, user);
  if (!ok || !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!messageBody) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const isNote = body.note === true;

  const message = await createChatMessage(params.id, 'user', {
    body: messageBody,
    userId: realUserId(user),
    isNote,
    attachments: Array.isArray(body.attachments)
      ? (body.attachments as Parameters<typeof createChatMessage>[2]['attachments'])
      : undefined,
  });

  if (isNote) {
    // @menciones: solo agentes del workspace del widget reciben la notificación.
    const mentions = Array.isArray(body.mentions)
      ? [...new Set(body.mentions.filter((m): m is string => typeof m === 'string'))].slice(0, 20)
      : [];
    if (mentions.length > 0) {
      const widget = await getChatWidget(conversation.widget_id);
      const agents = widget ? await listChatAgents(widget.user_id, widget.team_id) : [];
      const actor = user.actingUser ?? user;
      for (const agent of agents.filter((a) => mentions.includes(a.id))) {
        await createChatNoteMentionNotification({
          conversationId: params.id,
          actor: { id: actor.id, email: actor.email, name: actor.name },
          mentionedUserId: agent.id,
          body: messageBody,
        });
      }
    }
  } else {
    // Una nota interna no es una respuesta al visitante (no corre el SLA).
    await recordFirstResponse(params.id);
  }

  return NextResponse.json(message, { status: 201 });
}
