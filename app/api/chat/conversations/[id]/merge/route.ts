import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { getChatConversationWithVisitor } from '@/lib/chat-data';
import { conversationMergeSchema } from '@/lib/chat-schema';
import { listMergeCandidates, mergeChatConversations } from '@/lib/chat-merge';

export const dynamic = 'force-dynamic';

/** Otras conversaciones del mismo visitante que se pueden unir a esta. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ candidates: await listMergeCandidates(id) });
}

/** Une { sourceId } a esta conversación (el origen se borra). */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = conversationMergeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const [target, source] = await Promise.all([
    canAccessConversation(id, user),
    canAccessConversation(parsed.data.sourceId, user),
  ]);
  if (!target.ok || !source.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await mergeChatConversations(id, parsed.data.sourceId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 400 });
  }
  return NextResponse.json({ moved: result.moved, conversation: await getChatConversationWithVisitor(id) });
}
