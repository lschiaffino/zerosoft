import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { exportRobot, getRobot } from '@/lib/robots';
import { canEditRobots, forbidden, notFound, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Robot como .json (sin credenciales, sesiones ni corridas). Solo admins: trae la configuración entera. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const robot = await getRobot(user.id, id);
  if (!robot) return notFound();
  const name = `${robot.name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'robot'}.robot.json`;
  return new NextResponse(JSON.stringify(exportRobot(robot), null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` },
  });
}
