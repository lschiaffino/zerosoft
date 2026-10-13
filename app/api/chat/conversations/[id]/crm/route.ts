import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { getChatConversationWithVisitor, listChatMessages } from '@/lib/chat-data';
import { logChatToCrm } from '@/lib/crm-integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Crea (o encuentra) el contacto del visitante en el CRM del dueño del widget
 * y guarda la conversación en su timeline.
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const conversation = await getChatConversationWithVisitor(params.id);
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await logChatToCrm(conversation.widget_user_id, {
    conversationId: conversation.id,
    subject: conversation.subject,
    visitor: conversation.visitor,
    messages: await listChatMessages(conversation.id),
    actorId: realUserId(user),
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ contactId: result.contact.id, created: result.created });
}
