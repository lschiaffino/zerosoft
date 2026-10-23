import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { cancelQueuedRobotRun } from '@/lib/robots';
import { canEditRobots, forbidden, notFound, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancela una corrida que espera en cola. Una corrida en curso responde 409. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const res = await cancelQueuedRobotRun(user.id, id);
  if (!res.ok) return res.error === 'not_found' ? notFound() : robotError(409, res.error);
  return NextResponse.json({ run: res.run });
}
