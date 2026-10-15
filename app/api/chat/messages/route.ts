import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  cleanVisitorIdentity,
  createChatConversation,
  createChatMessage,
  getChatWidget,
  getOfficeHoursState,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  toPublicVisitor,
  updateChatConversation,
} from '@/lib/chat-data';
import { afterVisitorMessage } from '@/lib/chat-visitor-message';
import { visitorMessageLimitsSchema } from '@/lib/chat-schema';

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

  return NextResponse.json({ ...result, visitor: toPublicVisitor(result.visitor), office });
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
  if (!body || typeof body !== 'object' || !visitorMessageLimitsSchema.safeParse(body).success) {
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

  if (!messageBody && (!body.fields || typeof body.fields !== 'object')) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const visitor = await getOrCreateChatVisitor(widgetId, visitorExternalId, cleanVisitorIdentity(body.email, body.name));

  let conversation = (await getVisitorConversationWithMessages(widgetId, visitorExternalId))?.conversation ?? null;
  let isNewConversation = false;
  if (!conversation) {
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
    conversation = await createChatConversation(widgetId, visitor.id, subject ?? undefined);
    isNewConversation = true;
  }

  // Un mensaje del visitante despierta una conversación snoozed.
  if (conversation.status === 'snoozed') {
    conversation = (await updateChatConversation(conversation.id, { status: 'open' })) ?? conversation;
  }

  const finalBody = messageBody || JSON.stringify(body.fields);
  const message = await createChatMessage(conversation.id, 'visitor', { body: finalBody });

  const result = await afterVisitorMessage({
    widget,
    conversation,
    visitor,
    message,
    isNewConversation,
    text: finalBody,
    schedule: after,
  });

  return NextResponse.json(
    { message, conversation: result.conversation, visitor: toPublicVisitor(visitor), bot: result.botMessage },
    { status: 201 },
  );
}
