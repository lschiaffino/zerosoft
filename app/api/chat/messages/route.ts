import { after, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  cleanVisitorIdentity,
  createChatConversation,
  createChatMessage,
  formatVisitorFormAnswers,
  getChatWidget,
  getOfficeHoursState,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  toPublicMessage,
  toPublicVisitor,
  updateChatConversation,
  updateChatVisitor,
  visitorFormAnswers,
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

  return NextResponse.json({
    ...result,
    messages: result.messages.map(toPublicMessage),
    visitor: toPublicVisitor(result.visitor),
    office,
  });
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

  // Formulario pre-chat: las respuestas se guardan con las etiquetas del widget.
  const answers = visitorFormAnswers(widget, body.fields);
  const answersText = formatVisitorFormAnswers(answers);
  if (!messageBody && !answersText) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const identity = cleanVisitorIdentity(body.email, body.name);
  if (!identity.email && answers.email) identity.email = answers.email;
  let visitor = await getOrCreateChatVisitor(widgetId, visitorExternalId, identity);
  if (answers.entries.length > 0) {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(visitor.metadata || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
    } catch {
      // metadata inválida: se reemplaza.
    }
    const form = Object.fromEntries(answers.entries.map((e) => [e.label, e.value]));
    visitor = (await updateChatVisitor(visitor.id, { metadata: { ...metadata, form } })) ?? visitor;
  }

  let conversation = (await getVisitorConversationWithMessages(widgetId, visitorExternalId))?.conversation ?? null;
  let isNewConversation = false;
  if (!conversation) {
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;
    conversation = await createChatConversation(widgetId, visitor.id, subject ?? undefined);
    isNewConversation = true;
  }

  // Un mensaje del visitante despierta una conversación snoozed o pendiente
  // (esperando al cliente): vuelve a Abiertas para que alguien la atienda.
  if (conversation.status === 'snoozed' || conversation.status === 'pending') {
    conversation = (await updateChatConversation(conversation.id, { status: 'open' })) ?? conversation;
  }

  const finalBody = [messageBody, answersText].filter(Boolean).join('\n\n');
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
    {
      message: toPublicMessage(message),
      conversation: result.conversation,
      visitor: toPublicVisitor(visitor),
      bot: result.botMessage ? toPublicMessage(result.botMessage) : null,
    },
    { status: 201 },
  );
}
