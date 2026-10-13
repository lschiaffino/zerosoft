import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getEventTypeById, ownedBooking, updateBooking } from '@/lib/calendar';
import { afterBookingCancelled, bookingPayload } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { reason? } — cancela, avisa al invitado (email + .ics) y emite booking.cancelled. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req, 'cal:write');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  const booking = await ownedBooking(auth.user.id, id);
  if (!booking) return apiError(404, 'not_found', 'Booking not found.');
  if (booking.status !== 'confirmed') return apiError(409, 'not_confirmed', 'Only confirmed bookings can be cancelled.');
  const body = z.object({ reason: z.string().max(500).optional() }).safeParse(await req.json().catch(() => ({})));
  const reason = body.success ? (body.data.reason ?? null) : null;
  const updated = await updateBooking(id, { status: 'cancelled', cancelReason: reason });
  if (!updated) return apiError(404, 'not_found', 'Booking not found.');
  await afterBookingCancelled(updated, reason);
  const eventType = await getEventTypeById(updated.event_type_id);
  return NextResponse.json(bookingPayload(updated, eventType ?? { id: updated.event_type_id, slug: '', title: '' }));
}
