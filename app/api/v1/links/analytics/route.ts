import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getWorkspaceAnalytics, parseWorkspaceFilters, parseWorkspaceRange } from '@/lib/link-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Analytics de todos los links de la key: ?from=YYYY-MM-DD&to=YYYY-MM-DD,
 * filtros ?tag=&domain=&link=&country=&device=&folder= y zona ?tz= (IANA).
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(
    await getWorkspaceAnalytics(auth.user.id, parseWorkspaceRange(sp.get('from'), sp.get('to')), {
      filters: parseWorkspaceFilters(sp),
      timezone: sp.get('tz') ?? undefined,
    }),
  );
}
