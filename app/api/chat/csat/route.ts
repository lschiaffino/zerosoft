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

  const conversation = await getConversationForCsat(widgetId, visitorId, conversationId);
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (conversation.status !== 'resolved') {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const updated = await submitConversationCsat(conversationId, score, comment);
  return NextResponse.json({ ok: true, conversation: updated }, { status: 201 });
}
