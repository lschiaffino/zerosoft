import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getRobotBatch } from '@/lib/robots';
import { apiRobotViewer } from '@/lib/robots-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Avance de un lote: conteos por estado y una página de corridas (?limit=, hasta 1.000, y ?offset=). */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const sp = new URL(req.url).searchParams;
  const batch = await getRobotBatch(auth.user.id, id, apiRobotViewer(auth), {
    limit: Number(sp.get('limit')) || undefined,
    offset: Number(sp.get('offset')) || undefined,
  });
  if (!batch) return apiError(404, 'not_found', 'Batch not found.');
  const offset = Number(sp.get('offset')) || 0;
  const next = offset + batch.runs.length;
  return NextResponse.json({
    nextOffset: next < batch.total ? next : null,
    batchId: batch.id,
    robotId: batch.robotId,
    total: batch.total,
    counts: batch.counts,
    done: batch.done,
    runs: batch.runs.map((r) => ({ id: r.id, status: r.status, input: r.input, output: r.output, error: r.error })),
  });
}
