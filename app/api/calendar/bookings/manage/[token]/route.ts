import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  CalendarError,
  findOfferedSlot,
  getBookingByManageToken,
  rescheduleBooking,
  updateBooking,
} from '@/lib/calendar';
import { bookingManageSchema } from '@/lib/calendar-schema';
import { afterBookingCancelled, afterBookingRescheduled } from '@/lib/calendar-lifecycle';
import { crmError, invalidBody, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Link de gestión del invitado (sin cuenta): el token de 40 caracteres es la
 * credencial. POST { action: 'cancel', reason? } | { action: 'reschedule', start }.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const limited = await limitByIp(req, 'booking-manage', 20, 600);
  if (limited) return limited;
  const { token } = await props.params;
  const booking = await getBookingByManageToken(token);
  if (!booking) return notFound();
  if (booking.status !== 'confirmed') return crmError(409, 'not_confirmed');
  if (new Date(booking.starts_at).getTime() < Date.now()) return crmError(409, 'already_started');

  const body: unknown = await req.json().catch(() => null);
  const parsed = bookingManageSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    if (parsed.data.action === 'cancel') {
      const updated = await updateBooking(booking.id, {
        status: 'cancelled',
        cancelReason: parsed.data.reason ? `Guest: ${parsed.data.reason}` : 'Cancelled by guest',
      });
      if (updated) await afterBookingCancelled(updated, parsed.data.reason ?? null);
      return NextResponse.json({ status: 'cancelled' });
    }

    const tz = parsed.data.timezone ?? booking.timezone;
    const offered = await findOfferedSlot(booking.event_type_id, new Date(parsed.data.start), tz, {
      excludeBookingId: booking.id,
    });
    if (!offered) return crmError(409, 'slot_unavailable');
    const moved = await rescheduleBooking(booking.id, offered.start);
    await afterBookingRescheduled(moved, booking.host_user_id, parsed.data.locale);
    return NextResponse.json({ status: 'confirmed', startsAt: moved.starts_at, endsAt: moved.ends_at });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
