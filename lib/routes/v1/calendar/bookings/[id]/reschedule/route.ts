import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { CalendarError, findOfferedSlot, getEventTypeById, ownedBooking, rescheduleBooking } from '@/lib/calendar';
import { ianaTimezone } from '@/lib/calendar-schema';
import { afterBookingRescheduled, bookingPayload } from '@/lib/calendar-lifecycle';
import { bookingInScope, bookingScopeFor } from '@/lib/calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ start: z.string().datetime({ offset: true }), timezone: ianaTimezone.optional() });

/** POST { start, timezone? } — mueve la reserva a otro horario ofrecido y avisa al invitado (email + .ics). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'cal:write');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const booking = await ownedBooking(auth.user.id, id);
  // Un member (con su key) solo ve y gestiona las reservas que atiende.
  if (!booking || !bookingInScope(booking, bookingScopeFor(auth.role, auth.personId))) {
    return apiError(404, 'not_found', 'Booking not found.');
  }
  if (booking.status !== 'confirmed') return apiError(409, 'not_confirmed', 'Only confirmed bookings can be rescheduled.');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'start (ISO 8601) is required.');
  const slot = await findOfferedSlot(booking.event_type_id, new Date(parsed.data.start), parsed.data.timezone ?? booking.timezone, {
    excludeBookingId: booking.id,
  });
  if (!slot) return apiError(409, 'slot_unavailable', 'That time is not available.');
  try {
    const moved = await rescheduleBooking(booking.id, slot.start);
    const synced = await afterBookingRescheduled(moved, booking.host_user_id, undefined, { byHost: true });
    const eventType = await getEventTypeById(synced.event_type_id);
    return NextResponse.json(bookingPayload(synced, eventType ?? { id: synced.event_type_id, slug: '', title: '' }));
  } catch (err) {
    if (err instanceof CalendarError) return apiError(err.status, err.code, err.code);
    throw err;
  }
}
