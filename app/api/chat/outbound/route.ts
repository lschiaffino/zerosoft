import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getChatWidget } from '@/lib/chat-data';
import { getActiveOutbound, listPublicOutbound, recordOutboundSeen, submitOutboundSurvey } from '@/lib/chat-outbound';

export const dynamic = 'force-dynamic';

/** Pública (widget): los mensajes salientes activos del widget. */
export async function GET(req: Request) {
  const limited = await limitByIp(req, 'chat-outbound', 120, 60);
  if (limited) return limited;
  const widgetId = new URL(req.url).searchParams.get('widgetId')?.slice(0, 64) ?? '';
  if (!widgetId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ messages: await listPublicOutbound(widgetId) });
}

/**
 * Pública (widget): { widgetId, visitorId, outboundId, event: 'seen' | 'survey', score?, comment? }.
 * Una vista y una respuesta por visitante; el mensaje tiene que estar activo en ese widget.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-outbound-event', 30, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const widgetId = typeof body?.widgetId === 'string' ? body.widgetId.slice(0, 64) : '';
  const visitorId = typeof body?.visitorId === 'string' ? body.visitorId.slice(0, 128) : '';
  const outboundId = typeof body?.outboundId === 'string' ? body.outboundId.slice(0, 64) : '';
  if (!body || !widgetId || !visitorId || !outboundId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const message = await getActiveOutbound(widgetId, outboundId);
  if (!message) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (body.event === 'seen') {
    await recordOutboundSeen(message.id, visitorId);
    return NextResponse.json({ ok: true });
  }
  if (body.event === 'survey') {
    const score = Number(body.score);
    if (message.kind !== 'survey' || !Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    const comment = typeof body.comment === 'string' ? body.comment : undefined;
    await recordOutboundSeen(message.id, visitorId);
    const saved = await submitOutboundSurvey(message.id, visitorId, score, comment);
    return NextResponse.json({ ok: true, saved }, { status: saved ? 201 : 200 });
  }
  return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
}
