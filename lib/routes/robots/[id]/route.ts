import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { adoptLoginRobot, deleteRobot, getRobot, getRobotRow, getRobotWorkspaceConfig, setRobotOwner, updateRobot } from '@/lib/robots';
import { robotUpdateSchema } from '@/lib/robots-schema';
import { canEditRobot, canEditRobots, forbidden, memberPatchError, memberSettingsError, notFound, realUserId, robotError, robotUsesLogin, unauthorized } from '@/lib/robots-http';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const robot = await getRobot(user.id, id);
  if (!robot) return notFound();
  const row = await getRobotRow(user.id, id);
  const canEdit = !!row && canEditRobot({ role: user.role, personId: realUserId(user) }, row, await getRobotWorkspaceConfig(user.id));
  return NextResponse.json({ robot, canEdit });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getRobotRow(user.id, id);
  if (!row) return canEditRobots(user) ? notFound() : forbidden();
  if (!canEditRobot({ role: user.role, personId: realUserId(user) }, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  const parsed = robotUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  if (!canEditRobots(user)) {
    const denied = memberPatchError(parsed.data) ?? (await memberSettingsError(user, user.id, parsed.data.settings));
    if (denied) return robotError(403, denied);
  }
  // Los avisos por email salen en el idioma de quien guardó el robot.
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const res = await updateRobot(user.id, id, { ...parsed.data, locale });
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return robotError(400, res.error, { index: res.index });
  }
  // Un admin que agrega un login se hace cargo del robot: al correr se mira quién lo armó.
  // También si guarda uno con login que armó alguien que hoy es member: si no, el robot no corre más.
  let robot = res.robot;
  if (canEditRobots(user)) {
    const after = (await getRobotRow(user.id, id)) ?? row;
    if (row.created_by !== realUserId(user) && robotUsesLogin(after) && !robotUsesLogin(row)) {
      await setRobotOwner(user.id, id, realUserId(user));
      robot = (await getRobot(user.id, id)) ?? robot;
    } else if ((await adoptLoginRobot(after, realUserId(user))) !== after) {
      robot = (await getRobot(user.id, id)) ?? robot;
    }
  }
  return NextResponse.json({ robot, ...(res.droppedRecipients ? { droppedRecipients: res.droppedRecipients } : {}) });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getRobotRow(user.id, id);
  if (!row) return canEditRobots(user) ? notFound() : forbidden();
  if (!canEditRobot({ role: user.role, personId: realUserId(user) }, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  if (!(await deleteRobot(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}
