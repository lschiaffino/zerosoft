import { NextRequest, NextResponse } from 'next/server';
import { listIssues } from '@/lib/analytics/errors';
import { ISSUE_FILTERS, type IssueFilter } from '@/lib/analytics/more-types';
import { dateRangeSchema } from '@/lib/analytics/types';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Errores agrupados por huella: ?project=&from=-30d&status=active&q=&sort=last|count. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const range = dateRangeSchema.safeParse({ from: sp.get('from') ?? '-30d' });
  if (!range.success) return aError(400, 'invalid_range');
  const limit = await rateLimit(`aquery:${actor.workspaceId}`, 240, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  const status = sp.get('status');
  const result = await listIssues(project, {
    from: range.data.from,
    status: ISSUE_FILTERS.includes(status as IssueFilter) ? (status as IssueFilter) : 'active',
    q: sp.get('q') ?? undefined,
    sort: sp.get('sort') === 'count' ? 'count' : 'last',
  });
  return NextResponse.json(result);
}
