import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  getChatConversation,
  getChatVisitorByExternalId,
  getChatWidget,
  listTyping,
  setTyping,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function validateVisitorAndConversation(
  widgetId: string,
  visitorExternalId: string,
  conversationId: string,
) {
  const widget = await getChatWidget(widgetId);
  if (!widget) return { ok: false };
  const visitor = await getChatVisitorByExternalId(widgetId, visitorExternalId);
  if (!visitor) return { ok: false };
  const conversation = await getChatConversation(conversationId);
  if (!conversation || conversation.widget_id !== widgetId || conversation.visitor_id !== visitor.id) {
    return { ok: false };
  }
  return { ok: true, visitor, conversation };
}

export async function GET(req: Request) {
  const limited = await limitByIp(req, 'chat-typing', 240, 60);
  if (limited) return limited;
  const { searchParams } = new URL(req.url);
  const widgetId = searchParams.get('widgetId') ?? '';
  const visitorExternalId = searchParams.get('visitorId') ?? '';
  const conversationId = searchParams.get('conversationId') ?? '';

  if (!widgetId || !visitorExternalId || !conversationId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { ok } = await validateVisitorAndConversation(widgetId, visitorExternalId, conversationId);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const typing = await listTyping(conversationId);
  return NextResponse.json({ typing });
}

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-typing', 120, 60);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widgetId = typeof body.widgetId === 'string' ? body.widgetId : '';
  const visitorExternalId = typeof body.visitorId === 'string' ? body.visitorId : '';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';

  if (!widgetId || !visitorExternalId || !conversationId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { ok } = await validateVisitorAndConversation(widgetId, visitorExternalId, conversationId);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await setTyping(conversationId, 'visitor', null, 5);
  const typing = await listTyping(conversationId);
  return NextResponse.json({ typing });
}
