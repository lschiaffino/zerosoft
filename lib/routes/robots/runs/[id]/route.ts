import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { cancelQueuedRun, getRobotRow, getRobotRun, getRobotWorkspaceConfig, runActor } from '@/lib/robots';
import { canEditRobots, canRunRobot, forbidden, notFound, realUserId, robotError, robotViewer, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRobotRun(user.id, id, robotViewer(user));
  if (!run) return notFound();
  return NextResponse.json({ run });
}

/** Saca la corrida de la cola (solo si todavía no arrancó). Admins, o quien la lanzó. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRobotRun(user.id, id);
  if (!run) return notFound();
  const robot = await getRobotRow(user.id, run.robotId);
  if (!robot || !canRunRobot(user, robot, await getRobotWorkspaceConfig(user.id))) return forbidden();
  if (!canEditRobots(user) && (await runActor(user.id, id)) !== realUserId(user)) return forbidden();
  if (!(await cancelQueuedRun(user.id, id))) return robotError(409, 'not_queued');
  return NextResponse.json({ ok: true });
}
