import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getEventTypeById, ownedBooking } from '@/lib/calendar';
import { bookingPayload } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const booking = await ownedBooking(auth.user.id, id);
  if (!booking) return apiError(404, 'not_found', 'Booking not found.');
  const eventType = await getEventTypeById(booking.event_type_id);
  return NextResponse.json(bookingPayload(booking, eventType ?? { id: booking.event_type_id, slug: '', title: '' }));
}
