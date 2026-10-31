import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { enqueueRobotBatch, getRobotRow, getRobotWorkspaceConfig } from '@/lib/robots';
import { canRunRobot } from '@/lib/robots-http';
import { robotApiError } from '@/lib/robots-api';
import { MAX_BATCH_INPUTS, MAX_BULK_INPUTS, robotBulkSchema } from '@/lib/robots-schema';
import { roleAtLeast } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Un robot sobre muchas entradas: una corrida en cola por entrada (máximo
 * 1.000 por pedido; hasta 50.000 por lote, en partes con el mismo batchId y el
 * offset de la primera fila). Responde 202; el avance se consulta en
 * GET /api/v1/robots/batches/:id.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const row = await getRobotRow(auth.user.id, id);
  if (!row && !roleAtLeast(auth.role, 'admin')) return apiError(403, 'forbidden', 'Running robots requires a workspace admin.');
  if (row && !canRunRobot({ role: auth.role }, row, await getRobotWorkspaceConfig(auth.user.id))) {
    return apiError(403, 'forbidden', 'Running this robot requires a workspace admin.');
  }
  const parsed = robotBulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, 'invalid_input', `Body must be { "inputs": object[], "batchId"?: uuid, "offset"?: number, "total"?: number } with 1 to ${MAX_BULK_INPUTS} items per request and ${MAX_BATCH_INPUTS} per batch. With batchId, send "total" too.`);
  }
  const res = await enqueueRobotBatch(auth.user.id, id, parsed.data.inputs, { actorId: auth.personId, batchId: parsed.data.batchId, offset: parsed.data.offset, total: parsed.data.total });
  if (!res.ok) return robotApiError(res.error, { name: res.name, index: res.index });
  return NextResponse.json(
    {
      batchId: res.batchId,
      total: res.total,
      committed: res.committed,
      runs: res.runs.map((r) => ({ id: r.id, status: r.status, input: r.input })),
    },
    { status: 202 },
  );
}
