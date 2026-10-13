import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createRobot, getUsage, listRobots } from '@/lib/robots';
import { robotCreateSchema } from '@/lib/robots-schema';
import { canEditRobots, forbidden, realUserId, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Robots del workspace + uso del mes (cualquier miembro puede verlos). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({
    robots: await listRobots(user.id),
    usage: await getUsage(user.id),
    canEdit: canEditRobots(user),
  });
}

/** Crea un robot (vacío o desde una plantilla). Solo admins. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = robotCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  const res = await createRobot(user.id, realUserId(user), parsed.data);
  if (!res.ok) return robotError(400, res.error);
  return NextResponse.json(res.robot, { status: 201 });
}
