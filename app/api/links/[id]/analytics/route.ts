import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getUserLink } from '@/lib/links';
import { getAnalytics, type AnalyticsRange } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const link = await getUserLink(user.id, params.id);
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const raw = req.nextUrl.searchParams.get('range');
  const range: AnalyticsRange = raw === '7d' || raw === 'all' ? raw : '30d';
  return NextResponse.json(await getAnalytics(link.id, link.created_at, range));
}
