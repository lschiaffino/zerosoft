import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getWorkspaceAnalytics, parseWorkspaceFilters, parseWorkspaceRange } from '@/lib/link-analytics';
import { viewerOf } from '@/lib/link-folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Analytics de todos los links del usuario: ?from=YYYY-MM-DD&to=YYYY-MM-DD,
 * filtros ?tag=&domain=&link=&country=&device=&folder= y zona ?tz= (IANA).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(
    await getWorkspaceAnalytics(user.id, parseWorkspaceRange(sp.get('from'), sp.get('to')), {
      filters: parseWorkspaceFilters(sp),
      timezone: sp.get('tz') ?? undefined,
      viewer: viewerOf(user),
    }),
  );
}
