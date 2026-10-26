import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getAvailableSlots, ownedBooking } from '@/lib/calendar';
import { ianaTimezone } from '@/lib/calendar-schema';
import { notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?date=YYYY-MM-DD&timezone= — horarios libres para mover esta reserva (anfitrión). */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const booking = await ownedBooking(user.id, id);
  if (!booking) return notFound();
  const sp = req.nextUrl.searchParams;
  const tz = ianaTimezone.safeParse(sp.get('timezone') ?? booking.timezone);
  const slots = await getAvailableSlots(booking.event_type_id, tz.success ? tz.data : 'UTC', sp.get('date') ?? '', {
    excludeBookingId: booking.id,
  });
  return NextResponse.json({ slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) });
}
