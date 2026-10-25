import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { talkActor } from '@/lib/talk';
import { talkStream } from '@/lib/talk-realtime';
import { requestCursor } from '@/lib/realtime';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: la conexión queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 300;

/**
 * Stream SSE de Talk. Todas las pestañas de esta instancia comparten una sola
 * lectura del feed (lib/talk-realtime.ts); acá solo se filtra por acceso.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return talkStream(talkActor(user), requestCursor(req), req.signal);
}
