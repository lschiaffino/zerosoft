import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { getCannedResponse, getChatConversationWithVisitor } from '@/lib/chat-data';
import { applyCannedMacro } from '@/lib/chat-inbox';

export const dynamic = 'force-dynamic';

/** Aplica las acciones de una macro (canned response) a la conversación. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(id, user);
  if (!ok || !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { cannedId?: unknown } | null;
  const cannedId = typeof body?.cannedId === 'string' ? body.cannedId : '';
  const response = cannedId ? await getCannedResponse(cannedId) : undefined;
  // La macro tiene que ser del mismo widget que la conversación.
  if (!response || response.widget_id !== conversation.widget_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await applyCannedMacro(id, response, realUserId(user));
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ conversation: await getChatConversationWithVisitor(id), tags: result.tags });
}
