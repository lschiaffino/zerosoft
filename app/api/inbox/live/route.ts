import { NextResponse } from 'next/server';
import { iJson, inboxOwner } from '@/lib/inbox/http';
import { liveStream, livePoll } from '@/lib/wa-live';
import { requestCursor } from '@/lib/realtime';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: la conexión queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 250;

/**
 * Aviso en vivo de la lista de Inbox: qué chats de la persona cambiaron (solo
 * ids). SSE; con ?poll=1, lo mismo por polling ({ events, cursor }).
 */
export async function GET(req: Request) {
  const a = await inboxOwner();
  if ('res' in a) return a.res;
  const limited = await limitByIp(req, 'inbox-live', 120, 60);
  if (limited) return limited;
  const viewer = { app: 'inbox' as const, owner: a.owner };
  const cursor = requestCursor(req);
  if (new URL(req.url).searchParams.get('poll') === '1') return iJson(await livePoll(viewer, cursor));
  const res = liveStream({
    key: `inbox:${a.owner}`,
    cursor,
    signal: req.signal,
    viewer,
    check: async () => {
      const again = await inboxOwner();
      return 'res' in again || again.owner !== a.owner ? null : viewer;
    },
  });
  return res ?? NextResponse.json({ error: 'too_many_streams' }, { status: 429 });
}
