import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { enqueueRobotBatch } from '@/lib/robots';
import { robotBulkSchema } from '@/lib/robots-schema';
import { canEditRobots, forbidden, realUserId, robotError, runErrorStatus, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Correr en lote" desde la app (CSV): una corrida en cola por fila, igual
 * que POST /api/v1/robots/:id/bulk. No espera al navegador. Solo admins.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = robotBulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'too_many_inputs');
  const res = await enqueueRobotBatch(user.id, id, parsed.data.inputs, { actorId: realUserId(user) });
  if (!res.ok) {
    const status = res.error === 'too_many_inputs' ? 400 : runErrorStatus(res.error);
    return robotError(status, res.error, { ...(res.name ? { name: res.name } : {}), ...(res.index !== undefined ? { index: res.index } : {}) });
  }
  return NextResponse.json({ batchId: res.batchId, total: res.runs.length }, { status: 202 });
}
