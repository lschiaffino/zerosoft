import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listEventsSince, talkActor } from '@/lib/talk';
import { heartbeat } from '@/lib/talk-extras';
import { requestCursor, sseResponse } from '@/lib/realtime';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: la conexión queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 300;

/** Stream SSE del feed de Talk (lib/realtime.ts). También marca presencia mientras está abierto. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const actor = talkActor(user);
  return sseResponse({
    cursor: requestCursor(req),
    poll: (cursor) => listEventsSince(actor, cursor),
    intervalMs: 3000,
    maxMs: 240_000,
    tick: () => heartbeat(actor),
    tickMs: 60_000,
    signal: req.signal,
  });
}
