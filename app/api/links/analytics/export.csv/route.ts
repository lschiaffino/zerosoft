import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  exportWorkspaceClicks,
  parseWorkspaceFilters,
  parseWorkspaceRange,
  workspaceClicksToCsv,
} from '@/lib/link-analytics';
import { viewerOf } from '@/lib/link-folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CSV con cada visita (clic o escaneo QR) de todos los links en el rango, con los filtros de la página. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const range = parseWorkspaceRange(sp.get('from'), sp.get('to'));
  const rows = await exportWorkspaceClicks(user.id, range, {
    filters: parseWorkspaceFilters(sp),
    timezone: sp.get('tz') ?? undefined,
    viewer: viewerOf(user),
  });
  return new NextResponse(workspaceClicksToCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="links-${range.from}-${range.to}.csv"`,
    },
  });
}
