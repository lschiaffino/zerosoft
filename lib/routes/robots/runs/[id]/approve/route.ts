import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { approveSuggestedSelector, getRobotRow, getRobotRun, getRobotWorkspaceConfig } from '@/lib/robots';
import { canEditRobot, canEditRobots, forbidden, notFound, realUserId, robotError, robotViewer, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ step: z.string().regex(/^[0-9.]{1,20}$/) });

/** Aprobar el selector que sugirió una corrida para un paso de acción. Quien puede editar el robot y ver la corrida. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRobotRun(user.id, id, robotViewer(user));
  if (!run) return canEditRobots(user) ? notFound() : forbidden();
  const row = await getRobotRow(user.id, run.robotId);
  if (!row || run.dataHidden || !canEditRobot({ role: user.role, personId: realUserId(user) }, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  const res = await approveSuggestedSelector(user.id, id, parsed.data.step);
  if (!res.ok) return res.error === 'not_found' ? notFound() : robotError(409, 'suggestion_stale');
  return NextResponse.json({ robot: res.robot });
}
