import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  exportWorkspaceClicks,
  exportWorkspaceConversions,
  parseWorkspaceFilters,
  parseWorkspaceRange,
  workspaceClicksToCsv,
  workspaceConversionsToCsv,
} from '@/lib/link-analytics';
import { viewerOf } from '@/lib/link-folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CSV de todos los links en el rango, con los filtros de la página: cada
 * visita (clic o escaneo QR) o, con ?kind=conversions, cada lead y venta.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const range = parseWorkspaceRange(sp.get('from'), sp.get('to'));
  const opts = { filters: parseWorkspaceFilters(sp), timezone: sp.get('tz') ?? undefined, viewer: viewerOf(user) };
  const conversions = sp.get('kind') === 'conversions';
  const csv = conversions
    ? workspaceConversionsToCsv(await exportWorkspaceConversions(user.id, range, opts))
    : workspaceClicksToCsv(await exportWorkspaceClicks(user.id, range, opts));
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="links-${conversions ? 'conversions-' : ''}${range.from}-${range.to}.csv"`,
    },
  });
}
