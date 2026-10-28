import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { runSearchFromParams, searchRuns } from '@/lib/flow-monitor';
import { runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Corridas de todos los flows del workspace (?status=&flow=&q=&days=&before=).
 * Cualquier miembro ve estado, tiempos y errores; los datos, solo quien los capturó.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await searchRuns(user.id, runViewer(user), runSearchFromParams(req.nextUrl.searchParams)));
}
