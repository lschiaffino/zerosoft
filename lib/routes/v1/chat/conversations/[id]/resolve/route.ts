import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { updateChatConversation } from '@/lib/chat-data';
import { attributesBlockingResolve } from '@/lib/chat-attributes-db';
import { getWorkspaceConversation, toApiConversation } from '@/lib/chat-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resuelve la conversación (pide los atributos obligatorios del widget, como el inbox). */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'chat:write');
  if ('res' in auth) return auth.res;
  const conversation = await getWorkspaceConversation(auth.user.id, id);
  if (!conversation) return apiError(404, 'not_found', 'Conversation not found.');
  if (conversation.status !== 'resolved') {
    const missing = await attributesBlockingResolve(conversation);
    if (missing.length) {
      return NextResponse.json(
        { error: { code: 'missing_attributes', message: `Fill in the required attributes first: ${missing.join(', ')}.`, missing } },
        { status: 400 },
      );
    }
    await updateChatConversation(id, { status: 'resolved' });
  }
  const after = await getWorkspaceConversation(auth.user.id, id);
  return NextResponse.json(toApiConversation(after!));
}
