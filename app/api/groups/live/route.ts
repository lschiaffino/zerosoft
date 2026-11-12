import { NextResponse } from 'next/server';
import { groupsSession, sessionViewer } from '@/lib/groups-http';
import { chatFilterFor, type GroupsViewer } from '@/lib/groups-access';
import { livePoll, liveStream, liveStreamAllowed, wantsLiveStream, type ChatFilter, type LiveViewer } from '@/lib/wa-live';
import { liveAccessNow, linesViewerNow } from '@/lib/wa-live-auth';
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
  if (want === 'poll') {
    // Quién mira (con su acceso) se lee solo si hay avisos que filtrar: sin cambios, la consulta no lee nada más.
    let filter: Promise<ChatFilter | null> | null = null;
    const lazy: LiveViewer = {
      app: 'lines',
      ws: s.ws,
      visible: async (ids) => {
        filter ??= sessionViewer(s).then(chatFilterFor);
        const f = await filter;
        return f ? f(ids) : new Set(ids);
      },
    };
    const res = await livePoll(lazy, cursor);
    return NextResponse.json({ ...res, stream: liveStreamAllowed(req, [s.ws]) }, { headers: NO_STORE });
  }
  // Lo que hace falta para revalidar se toma ahora: más tarde no se leen cookies ni headers (lib/wa-live-auth.ts).
  const viewer = liveViewer(s.ws, await sessionViewer(s));
  const session = { userId: s.me, sid: s.user.sid ?? null, workspaceId: s.user.workspace?.id ?? null };
  const role = s.user.role;
  const res = liveStream({
    key: `lines:${s.me}`,
    tab: new URL(req.url).searchParams.get('tab')?.slice(0, 40) || undefined,
    cursor,
    signal: req.signal,
    viewer,
    // Cada minuto: la sesión sigue valiendo, en el mismo workspace, sin dos pasos pendientes, con Lines abierta para
    // la persona, y con el acceso de hoy.
    check: async () => {
      const access = await liveAccessNow(session, 'groups');
      if (!access || access.ws !== s.ws) return null;
      const now = await linesViewerNow(s.ws, s.me, role, access.role);
      return now ? liveViewer(s.ws, now) : null;
    },
  });
  return res ?? NextResponse.json({ error: 'too_many_streams' }, { status: 429, headers: NO_STORE });
}
