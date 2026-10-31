import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRobotRow, getRobotWorkspaceConfig, startRobotRun } from '@/lib/robots';
import { robotRunSchema } from '@/lib/robots-schema';
import { canEditRobots, canRunRobot, forbidden, notFound, realUserId, robotError, runErrorStatus, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Corrida sincrónica: arranque del sandbox + hasta MAX_TIMEOUT_SEC (180 s) de navegador.
export const maxDuration = 300;

/** "Run": corre el robot ahora con estas entradas y devuelve la corrida. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getRobotRow(user.id, id);
  if (!row) return canEditRobots(user) ? notFound() : forbidden();
  if (!canRunRobot(user, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  const parsed = robotRunSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return robotError(400, 'invalid_input');
  const res = await startRobotRun(user.id, id, parsed.data.inputs, { trigger: 'manual', actorId: realUserId(user) });
  if (!res.ok) return robotError(runErrorStatus(res.error), res.error, { ...(res.name ? { name: res.name } : {}), ...(res.index !== undefined ? { index: res.index } : {}) });
  return NextResponse.json({ run: res.run });
}
