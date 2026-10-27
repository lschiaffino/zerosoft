import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  CalendarError,
  findOfferedSlot,
  getBookingByManageToken,
  getEventTypeById,
  reconfirmBooking,
  rescheduleBooking,
  updateBooking,
} from '@/lib/calendar';
import { bookingManageSchema } from '@/lib/calendar-schema';
import { afterBookingCancelled, afterBookingReconfirmed, afterBookingRescheduled } from '@/lib/calendar-lifecycle';
import { refundCancelledBooking } from '@/lib/calendar-payments';
import { crmError, invalidBody, notFound } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';
import type { CalendarBookingRow } from '@/lib/db';

/** Lo que hace el invitado desde su link queda en la actividad del workspace (sin persona del equipo). */
async function logGuest(booking: CalendarBookingRow, action: string): Promise<void> {
  const et = await getEventTypeById(booking.event_type_id);
  if (et) await logCalActivity(et.user_id, null, action, { type: 'booking', id: booking.id, summary: booking.invitee_name });
}

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
  // Una solicitud que espera confirmación se puede retirar (cancelar), no mover.
  const awaitingApproval = booking.status === 'pending' && booking.approval === 'pending';
  if (booking.status !== 'confirmed' && !awaitingApproval) return crmError(409, 'not_confirmed');
  if (new Date(booking.starts_at).getTime() < Date.now()) return crmError(409, 'already_started');

  const body: unknown = await req.json().catch(() => null);
  const parsed = bookingManageSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    if (parsed.data.action === 'cancel') {
      const updated = await updateBooking(
        booking.id,
        {
          status: 'cancelled',
          cancelReason: parsed.data.reason ? `Guest: ${parsed.data.reason}` : 'Cancelled by guest',
        },
        { fromStatus: booking.status },
      );
      // Cancelar antes del inicio reembolsa el pago completo (si lo hubo).
      if (updated) await afterBookingCancelled(await refundCancelledBooking(updated), parsed.data.reason ?? null);
      if (updated) await logGuest(booking, 'booking.guest_cancelled');
      return NextResponse.json({ status: 'cancelled' });
    }

    if (awaitingApproval) return crmError(409, 'not_confirmed');
    if (parsed.data.action === 'reconfirm') {
      const at = await reconfirmBooking(booking.id);
      if (at) await afterBookingReconfirmed({ ...booking, reconfirmed_at: at });
      if (at) await logGuest(booking, 'booking.guest_reconfirmed');
      return NextResponse.json({ status: 'confirmed', reconfirmedAt: at ?? booking.reconfirmed_at });
    }
    const tz = parsed.data.timezone ?? booking.timezone;
    const offered = await findOfferedSlot(booking.event_type_id, new Date(parsed.data.start), tz, {
      excludeBookingId: booking.id,
    });
    if (!offered) return crmError(409, 'slot_unavailable');
    const moved = await rescheduleBooking(booking.id, offered.start);
    await afterBookingRescheduled(moved, booking.host_user_id, parsed.data.locale);
    await logGuest(booking, 'booking.guest_rescheduled');
    return NextResponse.json({ status: 'confirmed', startsAt: moved.starts_at, endsAt: moved.ends_at });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
