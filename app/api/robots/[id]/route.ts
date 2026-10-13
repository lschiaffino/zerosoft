import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteRobot, getRobot, updateRobot } from '@/lib/robots';
import { robotUpdateSchema } from '@/lib/robots-schema';
import { canEditRobots, forbidden, notFound, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const robot = await getRobot(user.id, id);
  if (!robot) return notFound();
  return NextResponse.json({ robot, canEdit: canEditRobots(user) });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = robotUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  const res = await updateRobot(user.id, id, parsed.data);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return robotError(400, res.error, { index: res.index });
  }
  return NextResponse.json({ robot: res.robot });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  if (!(await deleteRobot(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}
