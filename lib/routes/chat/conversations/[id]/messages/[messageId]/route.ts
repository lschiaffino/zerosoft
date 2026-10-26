import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { deleteChatMessage, editChatMessage, type ChatMessageEditError } from '@/lib/chat-data';
import { CHAT_MESSAGE_MAX } from '@/lib/chat-schema';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; messageId: string }> };

const STATUS: Record<ChatMessageEditError, number> = {
  not_found: 404,
  forbidden: 403,
  deleted: 409,
  invalid_input: 400,
};

async function guard(props: Ctx) {
  const { id, messageId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const { ok } = await canAccessConversation(id, user);
  if (!ok) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  return { id, messageId, userId: realUserId(user) };
}

/** Editar un mensaje o nota propio (queda la marca "editado"). */
export async function PATCH(req: Request, props: Ctx) {
  const g = await guard(props);
  if (g.error) return g.error;
  const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
  const text = typeof body?.body === 'string' ? body.body.trim() : null;
  if (text === null || text.length > CHAT_MESSAGE_MAX) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const result = await editChatMessage(g.id, g.messageId, g.userId, text);
  if (result.error) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  return NextResponse.json(result.message);
}

/** Borrar un mensaje o nota propio: el visitante deja de verlo. */
export async function DELETE(_req: Request, props: Ctx) {
  const g = await guard(props);
  if (g.error) return g.error;
  const result = await deleteChatMessage(g.id, g.messageId, g.userId);
  if (result.error) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  return NextResponse.json(result.message);
}
