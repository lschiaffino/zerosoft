import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { enqueueRobotBatch } from '@/lib/robots';
import { robotApiError } from '@/lib/robots-api';
import { MAX_BULK_INPUTS, robotBulkSchema } from '@/lib/robots-schema';
import { roleAtLeast } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Un robot sobre muchas entradas: una corrida en cola por entrada (máximo
 * 100), que corren de a una. Responde 202 con el lote; el avance se consulta
 * en GET /api/v1/robots/batches/:id.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  if (!roleAtLeast(auth.role, 'admin')) return apiError(403, 'forbidden', 'Running robots requires a workspace admin.');
  const { id } = await props.params;
  const parsed = robotBulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, 'invalid_input', `Body must be { "inputs": object[] } with 1 to ${MAX_BULK_INPUTS} items.`);
  }
  const res = await enqueueRobotBatch(auth.user.id, id, parsed.data.inputs, { actorId: auth.personId });
  if (!res.ok) return robotApiError(res.error, { name: res.name, index: res.index });
  return NextResponse.json(
    {
      batchId: res.batchId,
      total: res.runs.length,
      runs: res.runs.map((r) => ({ id: r.id, status: r.status, input: r.input })),
    },
    { status: 202 },
  );
}
