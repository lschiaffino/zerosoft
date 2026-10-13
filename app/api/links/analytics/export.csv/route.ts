import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { exportWorkspaceClicks, parseWorkspaceRange, workspaceClicksToCsv } from '@/lib/link-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CSV con cada visita (clic o escaneo QR) de todos los links en el rango. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const range = parseWorkspaceRange(sp.get('from'), sp.get('to'));
  const csv = workspaceClicksToCsv(await exportWorkspaceClicks(user.id, range));
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="links-${range.from}-${range.to}.csv"`,
    },
  });
}
