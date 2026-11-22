import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { getChatConversationWithVisitor, listChatMessages } from '@/lib/chat-data';
import { logChatToCrm } from '@/lib/crm-integrations';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Crea (o encuentra) el contacto del visitante en el CRM del dueño del widget
 * y guarda la conversación en su timeline.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessConversation(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const conversation = await getChatConversationWithVisitor(params.id);
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // { confirm: true }: el agente confirmó que el visitante es el dueño del
  // email sin verificar que coincide con un contacto existente.
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  const result = await logChatToCrm(conversation.widget_user_id, {
    conversationId: conversation.id,
    subject: conversation.subject,
    visitor: conversation.visitor,
    messages: await listChatMessages(conversation.id),
    actorId: realUserId(user),
    confirmed: body?.confirm === true,
    // Con el alcance del CRM de quien guarda: un contacto que no ve no se toca ni se nombra.
    scope: conversation.widget_user_id === user.id ? await sessionScope(user) : [],
  });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'missing_email' ? 400 : 409 });
  }
  return NextResponse.json({ contactId: result.contact.id, created: result.created });
}
