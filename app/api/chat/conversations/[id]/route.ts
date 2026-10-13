import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import {
  getChatConversationWithVisitor,
  updateChatConversation,
} from '@/lib/chat-data';
import { conversationPatchSchema } from '@/lib/chat-schema';
import { ingestChatConversation, runAfterResponse, supportWidgetId } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';


export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(conversation);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, conversation: before } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = conversationPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const updated = await updateChatConversation(params.id, parsed.data);
  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });

  // Conversación de soporte propio resuelta → señal para el roadmap.
  if (
    updated.status === 'resolved' &&
    before?.status !== 'resolved' &&
    supportWidgetId() &&
    updated.widget_id === supportWidgetId()
  ) {
    await runAfterResponse(() => ingestChatConversation(updated.id));
  }

  const withVisitor = await getChatConversationWithVisitor(params.id);
  return NextResponse.json(withVisitor ?? updated);
}
