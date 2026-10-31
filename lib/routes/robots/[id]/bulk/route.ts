import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { enqueueRobotBatch, getRobotRow, getRobotWorkspaceConfig, listRobotBatches } from '@/lib/robots';
import { robotBulkSchema } from '@/lib/robots-schema';
import { canEditRobots, canRunRobot, forbidden, notFound, realUserId, robotError, runErrorStatus, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Correr en lote" desde la app (CSV): una corrida en cola por fila, igual
 * que POST /api/v1/robots/:id/bulk. No espera al navegador. Quien puede correr el robot.
 * Un archivo grande llega en partes de hasta 1.000 filas con el mismo batchId.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getRobotRow(user.id, id);
  if (!row) return canEditRobots(user) ? notFound() : forbidden();
  if (!canRunRobot(user, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  const parsed = robotBulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'too_many_inputs');
  const res = await enqueueRobotBatch(user.id, id, parsed.data.inputs, { actorId: realUserId(user), batchId: parsed.data.batchId, offset: parsed.data.offset });
  if (!res.ok) {
    const status = res.error === 'too_many_inputs' ? 400 : runErrorStatus(res.error);
    return robotError(status, res.error, { ...(res.name ? { name: res.name } : {}), ...(res.index !== undefined ? { index: res.index } : {}) });
  }
  return NextResponse.json({ batchId: res.batchId, total: res.total, queued: res.runs.length }, { status: 202 });
}

/** Lotes recientes del robot con su avance (cualquiera que vea el robot: solo conteos). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getRobotRow(user.id, id))) return notFound();
  return NextResponse.json({ batches: await listRobotBatches(user.id, id) });
}
