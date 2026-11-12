import { NextResponse } from 'next/server';
import { groupsSession, sessionViewer } from '@/lib/groups-http';
import { chatFilterFor, type GroupsViewer } from '@/lib/groups-access';
import { livePoll, liveStream, liveStreamAllowed, wantsLiveStream, type LiveViewer } from '@/lib/wa-live';
import { liveSessionValid, linesViewerNow } from '@/lib/wa-live-auth';
import { requestCursor } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// La conexión SSE queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 250;

const NO_STORE = { 'cache-control': 'private, no-store' };

/** Quién mira: sin restricciones ve todo; si no, cada lote se filtra con el acceso al chat (líneas, etiquetas, invitados). */
const liveViewer = (ws: string, v: GroupsViewer): LiveViewer => ({ app: 'lines', ws, visible: chatFilterFor(v) });

/**
 * Aviso en vivo de Lines: qué chats del workspace cambiaron, solo de los que
 * la persona puede abrir (solo ids y si mueve la lista; la lista y el chat se
 * releen con su acceso). Con `Accept: text/event-stream` (EventSource) y el
 * stream habilitado para el workspace (WA_LIVE_WORKSPACES) es un stream SSE
 * desde ?cursor= o Last-Event-ID; si no, lo mismo por pedido:
 * { events, cursor, stream } (por índice: sin cambios no lee filas del feed;
 * `stream` dice si la pantalla puede abrir el stream).
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const cursor = requestCursor(req);
  const want = wantsLiveStream(req, [s.ws]);
  if (want === 'off') return new NextResponse(null, { status: 204, headers: NO_STORE });
  const viewer = liveViewer(s.ws, await sessionViewer(s));
  if (want === 'poll') {
    const res = await livePoll(viewer, cursor);
    return NextResponse.json({ ...res, stream: liveStreamAllowed(req, [s.ws]) }, { headers: NO_STORE });
  }
  // Lo que hace falta para revalidar se toma ahora: más tarde no se leen cookies ni headers (lib/wa-live-auth.ts).
  const session = { userId: s.me, sid: s.user.sid ?? null };
  const role = s.user.role;
  const res = liveStream({
    key: `lines:${s.me}`,
    tab: new URL(req.url).searchParams.get('tab')?.slice(0, 40) || undefined,
    cursor,
    signal: req.signal,
    viewer,
    // Cada minuto: la sesión sigue valiendo, sigue en el workspace, y con el acceso de hoy.
    check: async () => {
      if (!(await liveSessionValid(session))) return null;
      const now = await linesViewerNow(s.ws, s.me, role);
      return now ? liveViewer(s.ws, now) : null;
    },
  });
  return res ?? NextResponse.json({ error: 'too_many_streams' }, { status: 429, headers: NO_STORE });
}
