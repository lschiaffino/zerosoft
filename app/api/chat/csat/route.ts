import { cleanPublicVisitorKey } from '@/lib/chat-visitor-key';
import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getConversationForCsat, submitConversationCsat } from '@/lib/chat-data';
import { csatSubmitSchema } from '@/lib/chat-schema';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-csat', 10, 600);
  if (limited) return limited;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = csatSubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { widgetId, visitorId, conversationId, score, comment } = parsed.data;

  const visitorKey = cleanPublicVisitorKey(visitorId);
  if (!visitorKey) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const conversation = await getConversationForCsat(widgetId, visitorKey, conversationId);
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (conversation.status !== 'resolved') {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await submitConversationCsat(conversationId, score, comment);
  // Ruta pública: no devuelve la fila (agente asignado, prioridad, SLA).
  return NextResponse.json({ ok: true }, { status: 201 });
}
