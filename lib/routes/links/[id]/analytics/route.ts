import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { getAnalytics, type AnalyticsRange, parseRange } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;

  const raw = req.nextUrl.searchParams.get('range');
  const range: AnalyticsRange = parseRange(raw);
  return NextResponse.json(await getAnalytics(link.id, link.created_at, range));
}
