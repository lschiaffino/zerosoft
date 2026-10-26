import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { clicksToCsv, EXPORT_LIMIT, exportClicks, type AnalyticsRange, parseRange } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;

  const sp = req.nextUrl.searchParams;
  const rawRange = sp.get('range');
  const range: AnalyticsRange = parseRange(rawRange);
  const country = sp.get('country') ?? undefined;

  const clicks = await exportClicks(link.id, link.created_at, { range, country });
  const csv = clicksToCsv(clicks);
  const filename = `${link.slug}-clicks-${range}.csv`;

  return new NextResponse('\uFEFF' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      // Se cortó en EXPORT_LIMIT (los más recientes): el total sigue en las analytics.
      ...(clicks.length >= EXPORT_LIMIT ? { 'x-export-truncated': String(EXPORT_LIMIT) } : {}),
    },
  });
}
