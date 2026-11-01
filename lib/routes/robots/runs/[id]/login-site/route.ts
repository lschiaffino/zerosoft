import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getRobotRun, applyLoginSiteFromRun } from '@/lib/robots';
import { canEditRobots, forbidden, notFound, realUserId, robotError, robotViewer, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ step: z.string().regex(/^[0-9.]{1,20}$/) });

/** "Usar este sitio": un admin aprueba como sitio del login el destino que encontró esta corrida. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const run = await getRobotRun(user.id, id, robotViewer(user));
  if (!run) return notFound();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  const res = await applyLoginSiteFromRun(user.id, id, parsed.data.step, realUserId(user));
  if (!res.ok) return res.error === 'not_found' ? notFound() : robotError(409, 'suggestion_stale');
  return NextResponse.json({ robot: res.robot, origin: res.origin });
}
