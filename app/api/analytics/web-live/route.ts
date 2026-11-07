import { NextRequest, NextResponse } from 'next/server';
import { liveVisitors } from '@/lib/analytics/web-more';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Personas distintas en los últimos 5 minutos (?project=). La página la pide mientras la pestaña está visible. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  const limit = await rateLimit(`alive:${actor.workspaceId}`, 120, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  return NextResponse.json({ visitors: await liveVisitors(project) });
}
