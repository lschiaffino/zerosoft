import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listAllIssues } from '@/lib/track-data';
import { pageParams, sortParam, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'priority', 'identifier'] as const;

/** Issues de todos los proyectos activos del workspace (página Issues), paginados. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const result = await listAllIssues(user.team?.id ?? null, user.id, {
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });
  return NextResponse.json(result);
}
