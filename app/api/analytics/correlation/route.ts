import { NextRequest, NextResponse } from 'next/server';
import { correlationQuerySchema } from '@/lib/analytics/types';
import { QueryError, runCorrelation } from '@/lib/analytics/query';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Qué hicieron los que convirtieron en un embudo y los que no: body { projectId, query }. */
export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const body = await readJson(req);
  const project = await actorProject(actor, typeof body?.projectId === 'string' ? body.projectId : null);
  if (isResponse(project)) return project;
  const limit = await rateLimit(`acorr:${actor.workspaceId}`, 30, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  const q = correlationQuerySchema.safeParse(body?.query);
  if (!q.success) return aError(400, 'invalid_query');
  try {
    return NextResponse.json({ result: await runCorrelation(project, q.data) });
  } catch (err) {
    if (err instanceof QueryError) return aError(400, err.code);
    throw err;
  }
}
