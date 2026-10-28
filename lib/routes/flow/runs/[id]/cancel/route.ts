import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { cancelRun, getRunWithSteps } from '@/lib/flow';
import { canEditFlows, flowError, forbidden, notFound, runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancela una corrida en cola o en espera (borra sus Esperar y reintentos pendientes). */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const res = await cancelRun(user.id, id);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return flowError(409, res.error);
  }
  return NextResponse.json({ run: await getRunWithSteps(user.id, id, runViewer(user)) });
}
