import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getUserLink } from '@/lib/links';
import { getAnalytics } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireApiUser(req);
  if ('res' in auth) return auth.res;

  const link = getUserLink(auth.user.id, params.id);
  if (!link) return apiError(404, 'not_found', 'Link not found.');

  const analytics = getAnalytics(link.id, link.created_at, '30d');
  return NextResponse.json({
    slug: link.slug,
    total: analytics.total,
    byDay: analytics.byDay,
  });
}
