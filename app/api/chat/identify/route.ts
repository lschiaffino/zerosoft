import { cleanPublicVisitorKey } from '@/lib/chat-visitor-key';
import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getChatVisitorByExternalId, getChatWidget, toPublicVisitor } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limited = await limitByIp(req, 'chat-identify', 30, 60);
  if (limited) return limited;
  const { searchParams } = new URL(req.url);
  const widgetId = searchParams.get('widgetId');
  const externalId = cleanPublicVisitorKey(searchParams.get('externalId'));
  if (!widgetId || !externalId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const widget = await getChatWidget(widgetId);
  if (!widget) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const visitor = await getChatVisitorByExternalId(widgetId, externalId);
  if (!visitor) return NextResponse.json({ visitor: null });
  return NextResponse.json({ visitor: toPublicVisitor(visitor) });
}
