import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getUserLink } from '@/lib/links';
import { listClicks, type AnalyticsRange } from '@/lib/track';

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

  const link = await getUserLink(user.id, params.id);
  if (!link) return notFound();

  const sp = req.nextUrl.searchParams;
  const rawRange = sp.get('range');
  const range: AnalyticsRange = rawRange === '7d' || rawRange === 'all' ? rawRange : '30d';
  const country = sp.get('country') ?? undefined;
  const page = Number(sp.get('page') ?? '1') || 1;
  const pageSize = Number(sp.get('pageSize') ?? '25') || 25;

  const result = await listClicks(link.id, link.created_at, { range, country, page, pageSize });
  return NextResponse.json(result);
}
