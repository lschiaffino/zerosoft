import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { takeOverLoginRobot } from '@/lib/robots';
import { canEditRobots, forbidden, notFound, realUserId, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ creatorId: z.string().min(1).max(200) });

/** Un admin confirma en el diálogo que se hace cargo de los pasos de un robot con login. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  const res = await takeOverLoginRobot(user.id, id, realUserId(user), parsed.data.creatorId);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    if (res.error === 'forbidden') return forbidden();
    return robotError(res.error === 'takeover_stale' ? 409 : 400, res.error, res.index !== undefined ? { index: res.index } : {});
  }
  return NextResponse.json({ robot: res.robot });
}
