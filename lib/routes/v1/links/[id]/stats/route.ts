import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getLinkForViewer, getUserLinkByRef } from '@/lib/links';
import { apiViewerOf } from '@/lib/link-folders';
import { getAnalytics } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;

  const byRef = await getUserLinkByRef(auth.user.id, params.id);
  const found = byRef ? await getLinkForViewer(auth.user.id, byRef.id, apiViewerOf(auth), 'view') : null;
  if (!found || 'status' in found) return apiError(404, 'not_found', 'Link not found.');
  const link = found.link;

  const analytics = await getAnalytics(link.id, link.created_at, '30d');
  return NextResponse.json({
    slug: link.slug,
    total: analytics.total,
    byDay: analytics.byDay,
  });
}
