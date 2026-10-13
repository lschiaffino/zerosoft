import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listEventTypes } from '@/lib/calendar';
import { appBaseUrl } from '@/lib/calendar-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'cal:read');
  if ('res' in auth) return auth.res;
  const rows = await listEventTypes(auth.user.id);
  return NextResponse.json({
    eventTypes: rows.map((et) => ({
      id: et.id,
      slug: et.slug,
      title: et.title,
      durationMin: et.duration_min,
      active: et.active === 1,
      url: auth.user.handle ? `${appBaseUrl()}/en/book/${auth.user.handle}/${et.slug}` : null,
    })),
  });
}
