import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { listChatMessages } from '@/lib/chat-data';
import { getApiConversation } from '@/lib/chat-access';
import { toApiConversation, toApiMessage } from '@/lib/chat-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Una conversación con sus mensajes (las notas internas vienen marcadas con isNote). */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'chat:read');
  if ('res' in auth) return auth.res;
  const conversation = await getApiConversation(auth, id);
  if (!conversation) return apiError(404, 'not_found', 'Conversation not found.');
  const messages = await listChatMessages(id, { includeNotes: true });
  return NextResponse.json({ conversation: toApiConversation(conversation), messages: messages.map(toApiMessage) });
}
