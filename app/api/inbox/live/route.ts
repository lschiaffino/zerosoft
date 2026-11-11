import { iJson, inboxOwner } from '@/lib/inbox/http';
import { livePoll, liveStream, wantsLiveStream } from '@/lib/wa-live';
import { requestCursor } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// La conexión SSE queda abierta unos minutos y el navegador se reconecta. El mismo valor que el webhook
// (app/api/inbox/webhook): con la misma configuración pueden compartir instancia y el aviso sale en el acto.
export const maxDuration = 250;

/**
 * Aviso en vivo de Inbox: qué chats de la persona cambiaron (solo ids). Solo
 * con la sesión de la persona (inboxOwner: ni API keys ni el MCP). Con
 * `Accept: text/event-stream` (EventSource) es un stream SSE desde ?cursor= o
 * Last-Event-ID; si no, lo mismo por pedido: { events, cursor } (por índice:
 * sin cambios no lee filas).
 */
export async function GET(req: Request) {
  const a = await inboxOwner();
  if ('res' in a) return a.res;
  const viewer = { app: 'inbox' as const, owner: a.owner };
  const cursor = requestCursor(req);
  const want = wantsLiveStream(req);
  if (want === 'off') return new Response(null, { status: 204 });
  if (want === 'poll') return iJson(await livePoll(viewer, cursor));
  const res = liveStream({
    key: `inbox:${a.owner}`,
    cursor,
    signal: req.signal,
    viewer,
    // Cada minuto: la sesión sigue siendo de la misma persona.
    check: async () => {
      const again = await inboxOwner();
      return 'res' in again || again.owner !== a.owner ? null : viewer;
    },
  });
  return res ?? iJson({ error: 'too_many_streams' }, 429);
}
