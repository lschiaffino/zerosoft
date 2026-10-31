import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createRobot, getRobotWorkspaceConfig, getUsage, listRobots } from '@/lib/robots';
import { ROBOT_TEMPLATES, robotCreateSchema } from '@/lib/robots-schema';
import { canEditRobots, forbidden, isRobotBuilder, memberPatchError, memberSettingsError, realUserId, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Robots del workspace + uso del mes (cualquier miembro puede verlos). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({
    robots: await listRobots(user.id),
    usage: await getUsage(user.id),
    canEdit: isRobotBuilder(user.role, await getRobotWorkspaceConfig(user.id)),
  });
}

/** Crea un robot (vacío o desde una plantilla). Admins, y members si el workspace lo permite. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isRobotBuilder(user.role, await getRobotWorkspaceConfig(user.id))) return forbidden();
  const parsed = robotCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  if (!canEditRobots(user)) {
    const denied =
      memberPatchError({ steps: parsed.data.steps, import: parsed.data.import }) ??
      (await memberSettingsError(user, user.id, (parsed.data.import as { settings?: unknown } | undefined)?.settings));
    if (denied) return robotError(403, denied);
    const tpl = parsed.data.template ? ROBOT_TEMPLATES.find((t) => t.key === parsed.data.template) : null;
    if (tpl) {
      const fromTpl = memberPatchError({ steps: tpl.steps, settings: tpl.settings });
      if (fromTpl) return robotError(403, fromTpl);
    }
  }
  const res = await createRobot(user.id, realUserId(user), parsed.data);
  if (!res.ok) return robotError(400, res.error);
  return NextResponse.json(res.robot, { status: 201 });
}
