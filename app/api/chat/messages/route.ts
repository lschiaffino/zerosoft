import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  applyAssignmentRules,
  createChatConversation,
  createChatMessage,
  getChatWidget,
  getOfficeHoursState,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  listChatAgents,
  updateChatConversation,
} from '@/lib/chat-data';
import { createNotification } from '@/lib/notifications';
import { dispatchChatBot } from '@/lib/chat-bot-ai';
import { emitEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limited = await limitByIp(req, 'chat-poll', 240, 60);
  if (limited) return limited;
  const { searchParams } = new URL(req.url);
  const widgetId = searchParams.get('widgetId');
  const visitorId = searchParams.get('visitorId');
  if (!widgetId || !visitorId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await getVisitorConversationWithMessages(widgetId, visitorId);
  const office = getOfficeHoursState(widget);
  if (!result) {
    return NextResponse.json({ visitor: null, conversation: null, messages: [], csat: null, office });
  }

  return NextResponse.json({ ...result, office });
}

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-msg', 30, 60);
  if (limited) return limited;
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
  let isNewConversation = false;
  if (!conversation) {
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
    conversation = await createChatConversation(widgetId, visitor.id, subject ?? undefined);
    isNewConversation = true;
  }

  if (!messageBody && (!body.fields || typeof body.fields !== 'object')) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Un mensaje del visitante despierta una conversación snoozed.
  if (conversation.status === 'snoozed') {
    conversation = (await updateChatConversation(conversation.id, { status: 'open' })) ?? conversation;
  }

  const finalBody = messageBody || JSON.stringify(body.fields);
  const message = await createChatMessage(conversation.id, 'visitor', { body: finalBody });
  {
    const conv = conversation;
    const eventBase = {
      conversation: { id: conv.id, subject: conv.subject, status: conv.status },
      visitor: { id: visitor.id, name: visitor.name, email: visitor.email },
      widget: { id: widget.id, name: widget.name },
    };
    after(async () => {
      if (isNewConversation) await emitEvent(widget.user_id, 'conversation.created', eventBase);
      await emitEvent(widget.user_id, 'message.received', {
        ...eventBase,
        message: { id: message.id, body: message.body, createdAt: message.created_at },
      });
    });
  }

  // Auto-assign via assignment rules before notifying.
  const agents = await listChatAgents(widget.user_id, widget.team_id);
  const assignedTo = await applyAssignmentRules(widget.id, conversation.id, finalBody, agents);
  if (assignedTo) {
    conversation = { ...conversation, assigned_to: assignedTo };
  }

  // Bot: keywords responde al instante (una vez); el bot AI responde en
  // segundo plano (after) y el widget recibe la respuesta en su polling.
  const botMessage = await dispatchChatBot(widget, conversation, { id: message.id, body: finalBody }, after);

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

  return NextResponse.json({ message, conversation, visitor, bot: botMessage }, { status: 201 });
}
