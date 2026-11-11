import { NextResponse } from 'next/server';
import { groupsError, groupsSession, sessionViewer, type GroupsSession } from '@/lib/groups-http';
import { visibleNumberIds } from '@/lib/groups-access';
import { liveStream, livePoll, type LiveViewer } from '@/lib/wa-live';
import { requestCursor } from '@/lib/realtime';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: la conexión queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 250;

async function viewerFor(s: GroupsSession): Promise<LiveViewer> {
  return { app: 'lines', ws: s.ws, numbers: await visibleNumberIds(await sessionViewer(s)) };
}

/**
 * Aviso en vivo de la bandeja de Lines: qué chats del workspace cambiaron, de
 * las líneas que la persona ve (solo ids; la lista se relee con su acceso).
 * SSE; con ?poll=1, lo mismo por polling ({ events, cursor }).
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const limited = await limitByIp(req, 'lines-live', 120, 60);
  if (limited) return limited;
  const viewer = await viewerFor(s);
  const cursor = requestCursor(req);
  if (new URL(req.url).searchParams.get('poll') === '1') {
    return NextResponse.json(await livePoll(viewer, cursor), { headers: { 'cache-control': 'private, no-store' } });
  }
  const res = liveStream({
    key: `lines:${s.me}`,
    cursor,
    signal: req.signal,
    viewer,
    check: async () => {
      const again = await groupsSession();
      if (again instanceof NextResponse || again.ws !== s.ws || again.me !== s.me) return null;
      return viewerFor(again);
    },
  });
  return res ?? groupsError(429, 'too_many_streams');
}
