import { NextRequest } from 'next/server';
import { fleetActor } from '@/lib/fleet/api';
import { feedSince } from '@/lib/fleet/core';
import { requestCursor, sseResponse } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: la conexión queda abierta unos minutos y el navegador se reconecta.
export const maxDuration = 300;

/** Stream SSE de Fleet: el feed de la persona (sesiones, mensajes, cuentas). */
export async function GET(req: NextRequest) {
  const a = await fleetActor();
  if ('res' in a) return a.res;
  return sseResponse({ cursor: requestCursor(req), poll: (cursor) => feedSince(a.actor, cursor), intervalMs: 2000, signal: req.signal });
}
