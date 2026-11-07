import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { ISSUE_SORTS } from '@/lib/track-views';
import { listAllIssues, MY_ISSUES_TABS, type MyIssuesTab } from '@/lib/track-data';
import { decodeFilter } from '@/lib/track-filter';
import { dayParam, pageParams, sortParam, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Issues de todos los proyectos activos del workspace (página Issues), paginados. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const result = await listAllIssues(user.team?.id ?? null, user.id, {
    sort: sortParam(sp, ISSUE_SORTS),
    q: sp.get('q') ?? undefined,
    filter: decodeFilter(sp.get('filter')),
    today: dayParam(sp.get('today')),
    topLevel: sp.get('topLevel') === '1',
    // Lista compartida: ?mine=assigned|created|subscribed|activity (Mis issues), ?planId= (project), ?projectId= (team).
    mine: (MY_ISSUES_TABS as readonly string[]).includes(sp.get('mine') ?? '') ? { userId: realUserId(user), tab: sp.get('mine') as MyIssuesTab } : undefined,
    planId: sp.get('planId') ?? undefined,
    projectId: sp.get('projectId') ?? undefined,
    page,
    pageSize,
  });
  return NextResponse.json(result);
}
