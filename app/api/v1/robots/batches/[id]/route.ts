import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getRobotBatch } from '@/lib/robots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Avance de un lote: conteos por estado y la salida de cada corrida. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const batch = await getRobotBatch(auth.user.id, id);
  if (!batch) return apiError(404, 'not_found', 'Batch not found.');
  return NextResponse.json({
    batchId: batch.id,
    robotId: batch.robotId,
    total: batch.total,
    counts: batch.counts,
    done: batch.done,
    runs: batch.runs.map((r) => ({ id: r.id, status: r.status, input: r.input, output: r.output, error: r.error })),
  });
}
