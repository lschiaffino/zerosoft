import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getChatWidget } from '@/lib/chat-data';
import { issueVisitorToken } from '@/lib/chat-visitor-key';

export const dynamic = 'force-dynamic';

/**
 * Pública (widget, cross-origin): emite la clave de un visitante nuevo,
 * aleatoria y firmada por el servidor (lib/chat-visitor-key.ts). { widgetId }.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-visitor', 30, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { widgetId?: unknown } | null;
  const widgetId = typeof body?.widgetId === 'string' ? body.widgetId.slice(0, 64) : '';
  if (!widgetId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (!(await getChatWidget(widgetId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ visitorId: issueVisitorToken(widgetId) }, { status: 201, headers: { 'cache-control': 'no-store' } });
}
