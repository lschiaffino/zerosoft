import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { delegatedIdentity } from '@/lib/mcp/identity';
import { livePoll, liveStream, liveStreamAllowed, wantsLiveStream } from '@/lib/wa-live';
import { liveAccessNow } from '@/lib/wa-live-auth';
import { requestCursor } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// La conexión SSE queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 250;

const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

/**
 * Aviso en vivo de Inbox: qué chats de la persona cambiaron (solo ids y si
 * mueve la lista). Solo con la sesión de la persona, como inboxOwner(): ni API
 * keys ni el MCP. Con `Accept: text/event-stream` (EventSource) y el stream
 * habilitado para la persona (WA_LIVE_WORKSPACES) es un stream SSE desde
 * ?cursor= o Last-Event-ID; si no, lo mismo por pedido:
 * { events, cursor, stream } (por índice: sin cambios no lee filas).
 */
export async function GET(req: Request) {
  // Lo mismo que inboxOwner() (lib/inbox/http.ts), quedándose además con la sesión para revalidar el stream.
  const user = delegatedIdentity() ? null : await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  const owner = realUserId(user);
  const viewer = { app: 'inbox' as const, owner };
  const cursor = requestCursor(req);
  const want = wantsLiveStream(req, [owner]);
  if (want === 'off') return new NextResponse(null, { status: 204, headers: NO_STORE });
  if (want === 'poll') return NextResponse.json({ ...(await livePoll(viewer, cursor)), stream: liveStreamAllowed(req, [owner]) }, { headers: NO_STORE });
  // Lo que hace falta para revalidar se toma ahora: más tarde no se leen cookies ni headers (lib/wa-live-auth.ts).
  const session = { userId: owner, sid: user.sid ?? null, workspaceId: user.workspace?.id ?? null };
  const res = liveStream({
    key: `inbox:${owner}`,
    tab: new URL(req.url).searchParams.get('tab')?.slice(0, 40) || undefined,
    cursor,
    signal: req.signal,
    viewer,
    // Cada minuto: la sesión de la persona sigue valiendo, en el mismo workspace, sin dos pasos pendientes y con
    // Inbox abierta para ella.
    check: async () => ((await liveAccessNow(session, 'inbox')) ? viewer : null),
  });
  return res ?? NextResponse.json({ error: 'too_many_streams' }, { status: 429, headers: NO_STORE });
}
