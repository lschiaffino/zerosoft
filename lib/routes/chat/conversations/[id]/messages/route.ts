import { NextResponse } from 'next/server';
import { filterWidgetAudience } from '@/lib/chat-audience';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  createChatMessage,
  getCannedResponse,
  getChatWidget,
  listChatAgents,
  listChatMessagesWithUsers,
  recordFirstResponse,
  reopenIfResolved,
} from '@/lib/chat-data';
import { applyCannedMacro } from '@/lib/chat-inbox';
import { CHAT_MESSAGE_MAX } from '@/lib/chat-schema';
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
  if (!messageBody || messageBody.length > CHAT_MESSAGE_MAX) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const isNote = body.note === true;

  // Los adjuntos solo entran por /attachments (que sube el archivo y arma la
  // URL); acá se ignoran para no guardar URLs arbitrarias (javascript:, etc.).
  const message = await createChatMessage(params.id, 'user', {
    body: messageBody,
    userId: realUserId(user),
    isNote,
  });

  if (isNote) {
    // @menciones: solo agentes del workspace del widget reciben la notificación.
    const mentions = Array.isArray(body.mentions)
      ? [...new Set(body.mentions.filter((m): m is string => typeof m === 'string'))].slice(0, 20)
      : [];
    if (mentions.length > 0) {
      const widget = await getChatWidget(conversation.widget_id);
      const agents = widget ? await filterWidgetAudience(widget, await listChatAgents(widget.user_id, widget.team_id)) : [];
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
    // Responder una conversación resuelta la reabre: el widget solo muestra
    // conversaciones abiertas, y si no el visitante nunca vería la respuesta.
    await reopenIfResolved(conversation);
  }

  // Macro elegida en el composer: sus acciones se aplican al enviar (y después
  // de reabrir), así "responder y resolver" deja la conversación resuelta.
  if (typeof body.cannedId === 'string' && body.cannedId) {
    const canned = await getCannedResponse(body.cannedId);
    if (canned && canned.widget_id === conversation.widget_id) {
      await applyCannedMacro(params.id, canned, realUserId(user));
    }
  }

  return NextResponse.json(message, { status: 201 });
}
