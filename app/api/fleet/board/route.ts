import { NextRequest } from 'next/server';
import { fJson, withFleet } from '@/lib/fleet/api';
import { loadBoard } from '@/lib/fleet/board';
import { listSessions } from '@/lib/fleet/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: el tablero entero (sesiones con su PR y deploy, PRs, deploys, corridas, releases, cuentas y resumen).
 * ?archived=1: solo las sesiones archivadas.
 */
export async function GET(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    if (req.nextUrl.searchParams.get('archived') === '1') return fJson({ sessions: await listSessions(actor, { archived: true }) });
    return fJson(await loadBoard(actor));
  });
}
