import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { requestCursor } from '@/lib/realtime';
import {
  boardEventsSince,
  boardLiveStream,
  guestLiveActor,
  handleLiveSend,
  liveAllowed,
  memberLiveActor,
  type BoardLiveActor,
} from '@/lib/board-live';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: la conexión queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 300;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Tiempo real de una pizarra. Ruta estática (no suma al presupuesto de rutas):
 * `?board=<id>` con sesión, o `?guest=<token>` con el link de invitado.
 * 404 si no existe o no la puede ver (no se confirma que exista).
 */
async function actorFor(req: NextRequest): Promise<BoardLiveActor | NextResponse> {
  const p = new URL(req.url).searchParams;
  const guest = p.get('guest');
  if (guest) return (await guestLiveActor(guest)) ?? jsonError(404, 'not_found');
  const board = p.get('board') ?? '';
  if (!ID_RE.test(board)) return jsonError(404, 'not_found');
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return (await memberLiveActor(user, board)) ?? jsonError(404, 'not_found');
}

/** GET: stream SSE (o `?poll=1`, el mismo feed por polling: { events, cursor }). */
export async function GET(req: NextRequest) {
  const actor = await actorFor(req);
  if (actor instanceof Response) return actor;
  const cursor = requestCursor(req);
  if (new URL(req.url).searchParams.get('poll') === '1') {
    const batch = await boardEventsSince(actor.boardId, cursor);
    return NextResponse.json(batch, { headers: { 'cache-control': 'no-store' } });
  }
  return boardLiveStream(actor, cursor, req.signal);
}

/** POST: cursor, selección, vista y elementos cambiados de esta pestaña; o traer a todos; o salir. */
export async function POST(req: NextRequest) {
  const actor = await actorFor(req);
  if (actor instanceof Response) return actor;
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > 300 * 1024) return jsonError(413, 'too_large');
  const raw = await req.text();
  if (raw.length > 300 * 1024) return jsonError(413, 'too_large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, 'invalid_input');
  }
  const socket = (body as { socketId?: unknown })?.socketId;
  if (!liveAllowed(`${actor.boardId}:${typeof socket === 'string' ? socket : ''}`)) return jsonError(429, 'rate_limited');
  const res = await handleLiveSend(actor, body);
  if (!res.ok) return jsonError(res.status, res.code);
  return new NextResponse(null, { status: 204 });
}
