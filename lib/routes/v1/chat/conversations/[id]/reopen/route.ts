import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { updateChatConversation } from '@/lib/chat-data';
import { getApiConversation } from '@/lib/chat-access';
import { toApiConversation } from '@/lib/chat-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vuelve a abrir una conversación resuelta o pospuesta. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'chat:write');
  if ('res' in auth) return auth.res;
  const conversation = await getApiConversation(auth, id);
  if (!conversation) return apiError(404, 'not_found', 'Conversation not found.');
  if (conversation.status !== 'open') await updateChatConversation(id, { status: 'open' });
  const after = await getApiConversation(auth, id);
  return NextResponse.json(toApiConversation(after!));
}
