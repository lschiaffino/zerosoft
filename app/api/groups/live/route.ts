import { NextResponse } from 'next/server';
import { groupsError, groupsSession, sessionViewer, type GroupsSession } from '@/lib/groups-http';
import { visibleNumberIds } from '@/lib/groups-access';
import { livePoll, liveStream, wantsLiveStream, type LiveViewer } from '@/lib/wa-live';
import { requestCursor } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// La conexión SSE queda abierta unos minutos y el navegador se reconecta. El mismo valor que el webhook
// (app/api/groups/webhook): con la misma configuración pueden compartir instancia y el aviso sale en el acto.
export const maxDuration = 250;

async function viewerFor(s: GroupsSession): Promise<LiveViewer> {
  return { app: 'lines', ws: s.ws, numbers: await visibleNumberIds(await sessionViewer(s)) };
}

/**
 * Aviso en vivo de Lines: qué chats del workspace cambiaron, de las líneas que
 * la persona ve (solo ids; la lista y el chat se releen con su acceso).
 * Con `Accept: text/event-stream` (EventSource) es un stream SSE desde
 * ?cursor= o Last-Event-ID; si no, lo mismo por pedido: { events, cursor }
 * (por índice: sin cambios no lee filas del feed).
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const cursor = requestCursor(req);
  const want = wantsLiveStream(req);
  if (want === 'off') return new NextResponse(null, { status: 204 });
  if (want === 'poll') {
    // Las líneas visibles se leen solo si hay avisos que filtrar.
    const res = await livePoll({ app: 'lines', ws: s.ws, numbers: null }, cursor, async () => visibleNumberIds(await sessionViewer(s)));
    return NextResponse.json(res, { headers: { 'cache-control': 'private, no-store' } });
  }
  const res = liveStream({
    key: `lines:${s.me}`,
    cursor,
    signal: req.signal,
    viewer: await viewerFor(s),
    // Cada minuto: sigue con sesión, en el mismo workspace, y con las líneas que ve hoy.
    check: async () => {
      const again = await groupsSession();
      if (again instanceof NextResponse || again.ws !== s.ws || again.me !== s.me) return null;
      return viewerFor(again);
    },
  });
  return res ?? groupsError(429, 'too_many_streams');
}
