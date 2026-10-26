import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getRobotRun } from '@/lib/robots';
import { toApiRobotRun } from '@/lib/robots-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado y salida de una corrida (para consultar las que quedaron en cola). */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const run = await getRobotRun(auth.user.id, id);
  if (!run) return apiError(404, 'not_found', 'Run not found.');
  return NextResponse.json({ run: toApiRobotRun(run) });
}
