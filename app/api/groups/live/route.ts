import { NextResponse } from 'next/server';
import { groupsSession, sessionViewer } from '@/lib/groups-http';
import { visibleNumberIds } from '@/lib/groups-access';
import { livePoll } from '@/lib/wa-live';
import { requestCursor } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aviso en vivo de la bandeja de Lines: qué chats del workspace cambiaron desde
 * ?cursor=, de las líneas que la persona ve (solo ids; la lista se relee con su
 * acceso), { events, cursor }. Por índice: sin cambios no lee filas del feed.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  // Las líneas visibles se leen solo si hay avisos que filtrar.
  const res = await livePoll({ app: 'lines', ws: s.ws, numbers: null }, requestCursor(req), async () => visibleNumberIds(await sessionViewer(s)));
  return NextResponse.json(res, { headers: { 'cache-control': 'private, no-store' } });
}
