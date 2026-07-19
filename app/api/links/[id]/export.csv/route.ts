import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getUserLink } from '@/lib/links';
import { clicksToCsv, exportClicks, type AnalyticsRange } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const link = await getUserLink(user.id, params.id);
  if (!link) return notFound();

  const sp = req.nextUrl.searchParams;
  const rawRange = sp.get('range');
  const range: AnalyticsRange = rawRange === '7d' || rawRange === 'all' ? rawRange : '30d';
  const country = sp.get('country') ?? undefined;

  const clicks = await exportClicks(link.id, link.created_at, { range, country });
  const csv = clicksToCsv(clicks);
  const filename = `${link.slug}-clicks-${range}.csv`;

  return new NextResponse('\uFEFF' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
