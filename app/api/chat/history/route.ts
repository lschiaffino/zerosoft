import { cleanPublicVisitorKey } from '@/lib/chat-visitor-key';
import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getChatWidget } from '@/lib/chat-data';
import { getVisitorHistoryConversation, historyVisitorIds, listVisitorHistory } from '@/lib/chat-visitor-history';

export const dynamic = 'force-dynamic';

/**
 * Pública (widget, cross-origin): conversaciones anteriores del visitante.
 * { widgetId, visitorId, email?, userHash?, conversationId? }. Con
 * conversationId devuelve esa conversación y sus mensajes, solo si es suya.
 * POST para que la firma de identidad no quede en logs de URLs.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-history', 60, 60);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const widgetId = typeof body?.widgetId === 'string' ? body.widgetId.slice(0, 64) : '';
  const visitorId = cleanPublicVisitorKey(body?.visitorId) ?? '';
  if (!widgetId || !visitorId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ids = await historyVisitorIds(widgetId, visitorId, { email: body.email, userHash: body.userHash });
  if (typeof body.conversationId === 'string' && body.conversationId) {
    const found = await getVisitorHistoryConversation(widgetId, ids, body.conversationId.slice(0, 64));
    if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(found);
  }
  return NextResponse.json({ conversations: await listVisitorHistory(widgetId, ids) });
}
