import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { viewerOf } from '@/lib/link-folders';
import { listLinkEvents, parseEventsCursor } from '@/lib/link-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stream de eventos (clicks, escaneos, leads y ventas). Sin ?click=&conv=:
 * los últimos 50 y el cursor; con el cursor, solo lo nuevo. La página lo
 * pide cada pocos segundos mientras está visible.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const link = sp.get('link');
  const page = await listLinkEvents(user.id, {
    viewer: viewerOf(user),
    linkId: link && link.length <= 64 ? link : undefined,
    after: parseEventsCursor(sp.get('click'), sp.get('conv')),
    before: parseEventsCursor(sp.get('beforeClick'), sp.get('beforeConv')),
    limit: 50,
  });
  return NextResponse.json(page, { headers: { 'cache-control': 'no-store' } });
}
