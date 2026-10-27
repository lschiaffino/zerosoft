import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { bookingDateBounds, getCalendarUser, localDate } from '@/lib/calendar';
import { computeBookingAnalytics, loadAnalyticsRows, parseAnalyticsRange } from '@/lib/calendar-analytics';
import { analyticsCsv } from '@/lib/calendar-export';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?from=&to=&host=&et= — la analítica de Cal en CSV (totales, por día, por tipo de evento y por persona). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const timezone = (await getCalendarUser(user.id))?.timezone || 'UTC';
  const range = parseAnalyticsRange(sp.get('from') ?? undefined, sp.get('to') ?? undefined, localDate(new Date(), timezone));
  const bounds = await bookingDateBounds(user.id, range.fromDate, range.toDate);
  const rows =
    bounds.from && bounds.to
      ? await loadAnalyticsRows(user.id, bounds.from, bounds.to, {
          hostId: sp.get('host')?.slice(0, 64) || null,
          eventTypeId: sp.get('et')?.slice(0, 64) || null,
        })
      : [];
  const csv = analyticsCsv(computeBookingAnalytics(rows, { ...range, timezone }), range);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cal-analytics-${range.fromDate}-${range.toDate}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
