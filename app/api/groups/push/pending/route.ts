import { NextResponse } from 'next/server';
import { takePending } from '@/lib/groups-push';
import { groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo pide el service worker al recibir un push: los avisos sin entregar de la persona (cada uno una vez). */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ notifications: await takePending(s.ws, s.me) }, { headers: { 'cache-control': 'no-store' } });
}
