import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { actorIdOf, logCalActivity } from '@/lib/calendar-activity';
import { CalendarError, findOfferedSlot, ownedBooking, rescheduleBooking } from '@/lib/calendar';
import { hostRescheduleSchema } from '@/lib/calendar-schema';
import { afterBookingRescheduled } from '@/lib/calendar-lifecycle';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reprogramación del lado del anfitrión: el nuevo horario tiene que ser uno
 * que la página de reservas ofrece (ignorando la propia reserva). Le avisa
 * al invitado por email con el .ics actualizado.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const booking = await ownedBooking(user.id, id);
  if (!booking) return notFound();
  if (booking.status !== 'confirmed') return crmError(409, 'not_confirmed');

  const parsed = hostRescheduleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const start = new Date(parsed.data.start);
  if (Number.isNaN(start.getTime())) return crmError(400, 'invalid_input');

  const slot = await findOfferedSlot(booking.event_type_id, start, parsed.data.timezone ?? booking.timezone, {
    excludeBookingId: booking.id,
  });
  if (!slot) return crmError(409, 'slot_unavailable');
  try {
    const moved = await rescheduleBooking(booking.id, slot.start);
    const synced = await afterBookingRescheduled(moved, booking.host_user_id, undefined, { byHost: true });
    await logCalActivity(user.id, actorIdOf(user), 'booking.rescheduled', { type: 'booking', id: synced.id, summary: synced.invitee_name });
    return NextResponse.json(synced);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
