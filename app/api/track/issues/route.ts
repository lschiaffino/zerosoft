import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { ISSUE_SORTS } from '@/lib/track-views';
import { listAllIssues } from '@/lib/track-data';
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
    page,
    pageSize,
  });
  return NextResponse.json(result);
}
