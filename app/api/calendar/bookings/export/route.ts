import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { viewerScope } from '@/lib/calendar-access';
import { bookingDateBounds, listUserBookings } from '@/lib/calendar';
import { bookingListQuerySchema } from '@/lib/calendar-schema';
import { bookingsCsv } from '@/lib/calendar-export';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?q=&status=&from=&to= — las reservas del workspace (los mismos filtros que la lista) en CSV, hasta 10.000. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bookingListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return invalidBody(parsed.error);
  const { q, status, from, to } = parsed.data;
  const bounds = await bookingDateBounds(user.id, from, to);
  // Un member exporta solo las reservas que atiende; un admin, las del workspace.
  const rows = await listUserBookings(user.id, {
    q,
    status,
    from: bounds.from,
    to: bounds.to,
    limit: 10_000,
    order: 'asc',
    hostId: viewerScope(user) ?? undefined,
  });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${bookingsCsv(rows, bounds.timezone)}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cal-bookings-${day}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
