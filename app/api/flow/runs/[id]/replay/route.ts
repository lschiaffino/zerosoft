import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRunWithSteps } from '@/lib/flow';
import { replayRun } from '@/lib/flow-alerts';
import { canEditFlows, flowError, forbidden, notFound, runOwnedBy, runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Replay de una corrida fallida: desde el paso que falló o, si no se puede, completa. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  // Re-ejecutar reusa datos capturados con el acceso de quien creó el flow.
  if (!(await runOwnedBy(user.id, id, user.actingUser?.id ?? user.id))) return flowError(403, 'not_flow_owner');
  const res = await replayRun(user.id, id);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return flowError(res.error === 'rate_limited' ? 429 : 400, res.error);
  }
  return NextResponse.json({ run: await getRunWithSteps(user.id, res.runId, runViewer(user)), mode: res.mode });
}
