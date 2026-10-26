import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRunWithSteps } from '@/lib/flow';
import { rerunFromStep } from '@/lib/flow-engine';
import { flowRerunSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, notFound, runOwnedBy, runViewer, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Re-ejecuta una corrida terminada desde un nodo, reusando las salidas anteriores. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  // Re-ejecutar reusa datos capturados con el acceso de quien creó el flow.
  if (!(await runOwnedBy(user.id, id, user.actingUser?.id ?? user.id))) return flowError(403, 'not_flow_owner');
  const parsed = flowRerunSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await rerunFromStep(user.id, id, parsed.data.fromNodeId);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return flowError(res.error === 'rate_limited' ? 429 : 400, res.error);
  }
  return NextResponse.json({ run: await getRunWithSteps(user.id, res.runId, runViewer(user)) });
}
