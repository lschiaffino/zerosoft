import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createRobotRecording, getRobotRow, getRobotWorkspaceConfig } from '@/lib/robots';
import { canEditRobot, canEditRobots, forbidden, notFound, realUserId, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Abre una grabación en vivo para este robot. Quien puede editarlo. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getRobotRow(user.id, id);
  if (!row) return canEditRobots(user) ? notFound() : forbidden();
  const personId = realUserId(user);
  if (!canEditRobot({ role: user.role, personId }, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  const rec = await createRobotRecording(user.id, id, personId);
  if (!rec) return notFound();
  const origin = req.nextUrl.origin;
  return NextResponse.json({ ...rec, sendUrl: `${origin}/api/robots/recordings/${rec.id}/steps` }, { status: 201 });
}
