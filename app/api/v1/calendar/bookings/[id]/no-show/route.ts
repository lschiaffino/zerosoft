import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { CalendarError, getEventTypeById, ownedBooking, updateBooking } from '@/lib/calendar';
import { bookingPayload } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — marca que el invitado no se presentó (reserva confirmada). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'cal:write');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const booking = await ownedBooking(auth.user.id, id);
  if (!booking) return apiError(404, 'not_found', 'Booking not found.');
  if (booking.status !== 'confirmed') return apiError(409, 'not_confirmed', 'Only confirmed bookings can be marked as no-show.');
  // Antes del inicio no hay no-show: marcarlo liberaría el horario sin avisar a nadie.
  if (new Date(booking.starts_at).getTime() > Date.now()) {
    return apiError(409, 'not_started', 'A booking can be marked as no-show only once it has started.');
  }
  let updated;
  try {
    updated = await updateBooking(id, { status: 'no_show' }, { fromStatus: 'confirmed' });
  } catch (err) {
    if (err instanceof CalendarError) return apiError(err.status, 'not_confirmed', 'Only confirmed bookings can be marked as no-show.');
    throw err;
  }
  if (!updated) return apiError(404, 'not_found', 'Booking not found.');
  const eventType = await getEventTypeById(updated.event_type_id);
  return NextResponse.json(bookingPayload(updated, eventType ?? { id: updated.event_type_id, slug: '', title: '' }));
}
