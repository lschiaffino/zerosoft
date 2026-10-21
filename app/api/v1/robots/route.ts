import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listRobots } from '@/lib/robots';
import { toApiRobot } from '@/lib/robots-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Robots del workspace con sus entradas (para saber qué mandar al correrlos). */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const robots = await listRobots(auth.user.id);
  return NextResponse.json({ robots: robots.map(toApiRobot) });
}
