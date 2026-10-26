import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getUserLinkByRef } from '@/lib/links';
import { getAnalytics } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;

  const link = await getUserLinkByRef(auth.user.id, params.id);
  if (!link) return apiError(404, 'not_found', 'Link not found.');

  const analytics = await getAnalytics(link.id, link.created_at, '30d');
  return NextResponse.json({
    slug: link.slug,
    total: analytics.total,
    byDay: analytics.byDay,
  });
}
