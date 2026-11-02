import { NextRequest, NextResponse } from 'next/server';
import { parseWebFilters, webVitals } from '@/lib/analytics/web-more';
import { dateRangeSchema } from '@/lib/analytics/types';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Web vitals: p75 por métrica y por página. ?project=&from=-7d&f=path:/x (mismos filtros que la página). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const range = dateRangeSchema.safeParse({ from: sp.get('from') ?? '-7d' });
  if (!range.success) return aError(400, 'invalid_range');
  const limit = await rateLimit(`aquery:${actor.workspaceId}`, 240, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  return NextResponse.json({ vitals: await webVitals(project, { from: range.data.from, filters: parseWebFilters(sp.getAll('f')) }) });
}
