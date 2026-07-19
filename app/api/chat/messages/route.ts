import { NextResponse } from 'next/server';
import {
  applyAssignmentRules,
  createChatConversation,
  createChatMessage,
  getChatWidget,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  listChatAgents,
} from '@/lib/chat-data';
import { createNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const widgetId = searchParams.get('widgetId');
  const visitorId = searchParams.get('visitorId');
  if (!widgetId || !visitorId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await getVisitorConversationWithMessages(widgetId, visitorId);
  if (!result) {
    return NextResponse.json({ visitor: null, conversation: null, messages: [] });
  }

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widgetId = typeof body.widgetId === 'string' ? body.widgetId : '';
  const visitorExternalId = typeof body.visitorId === 'string' ? body.visitorId : '';
  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!widgetId || !visitorExternalId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const visitor = await getOrCreateChatVisitor(widgetId, visitorExternalId, {
    email: typeof body.email === 'string' ? body.email : null,
    name: typeof body.name === 'string' ? body.name : null,
  });

  let conversation = (await getVisitorConversationWithMessages(widgetId, visitorExternalId))?.conversation ?? null;
  if (!conversation) {
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
    conversation = await createChatConversation(widgetId, visitor.id, subject ?? undefined);
  }

  if (!messageBody && (!body.fields || typeof body.fields !== 'object')) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const finalBody = messageBody || JSON.stringify(body.fields);
  const message = await createChatMessage(conversation.id, 'visitor', { body: finalBody });

  // Auto-assign via assignment rules before notifying.
  const agents = await listChatAgents(widget.user_id, widget.team_id);
  const assignedTo = await applyAssignmentRules(widget.id, conversation.id, finalBody, agents);
  if (assignedTo) {
    conversation = { ...conversation, assigned_to: assignedTo };
  }

  // Notify widget owner and assigned agent.
  const recipients = new Set<string>();
  recipients.add(widget.user_id);
  if (conversation.assigned_to && conversation.assigned_to !== widget.user_id) {
    recipients.add(conversation.assigned_to);
  }

  const senderName = visitor.name || visitor.email || visitor.external_id;
  const title = `New message from ${senderName}`;
  const href = `/app/chat/inbox/${conversation.id}`;

  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'chat_message',
      title,
      body: message.body.slice(0, 140),
      href,
      sourceType: 'chat_conversation',
      sourceId: conversation.id,
      meta: { visitorName: visitor.name, visitorEmail: visitor.email },
    });
  }

  return NextResponse.json({ message, conversation, visitor }, { status: 201 });
}
