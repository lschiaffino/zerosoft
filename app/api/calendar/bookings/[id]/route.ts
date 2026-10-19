import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { updateBooking, hostSlotFree, ownedBooking, CalendarError } from '@/lib/calendar';
import { bookingUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { expireCheckoutForBooking, refundCancelledBooking } from '@/lib/calendar-payments';
import { afterBookingCancelled, afterBookingNoShow } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dueño del event type o host asignado (mientras siga en el team). */
async function ownsBooking(userId: string, bookingId: string): Promise<boolean> {
  return (await ownedBooking(userId, bookingId)) !== null;
}

/**
 * Transiciones de estado que puede hacer el anfitrión. Una reserva esperando
 * pago solo se cancela (se confirma con el pago); una cancelada no vuelve,
 * porque su horario pudo tomarlo otra persona y sus avisos ya no existen.
 */
const TRANSITIONS: Record<string, string[]> = {
  pending: ['cancelled'],
  confirmed: ['confirmed', 'cancelled', 'no_show'],
  no_show: ['no_show', 'confirmed', 'cancelled'],
  cancelled: ['cancelled'],
};

function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await ownsBooking(user.id, params.id))) return notFound();
  const row = (await getDb()
    .prepare(
      `SELECT b.*, e.title as event_type_title, e.duration_min as event_type_duration_min
       FROM calendar_bookings b
       JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE b.id = ?`,
    )
    .get(params.id)) as Record<string, unknown> | undefined;
  if (!row) return notFound();
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  if (!(await ownsBooking(user.id, params.id))) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = bookingUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const before = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(params.id)) as
      | CalendarBookingRow
      | undefined;
    if (!before) return notFound();
    if (parsed.data.status && !canTransition(before.status, parsed.data.status)) return crmError(409, 'not_confirmed');
    // Antes del inicio no hay no-show: marcarlo liberaría el horario sin avisar a nadie.
    if (
      parsed.data.status === 'no_show' &&
      before.status !== 'no_show' &&
      new Date(before.starts_at).getTime() > Date.now()
    ) {
      return crmError(409, 'not_started');
    }
    // Deshacer un no-show: el horario tiene que seguir libre para el host.
    if (before.status === 'no_show' && parsed.data.status === 'confirmed' && !(await hostSlotFree(before))) {
      return crmError(409, 'slot_unavailable');
    }
    let booking = await updateBooking(params.id, parsed.data, { fromStatus: before.status });
    if (!booking) return notFound();
    if (before.status === 'confirmed' && booking.status === 'cancelled') {
      // Reserva paga cancelada por el anfitrión: se reembolsa el pago completo.
      booking = await refundCancelledBooking(booking);
      await afterBookingCancelled(booking, parsed.data.cancelReason ?? null);
    }
    // No-show recién marcado: webhook booking.no_show y trigger de Flow.
    if (before.status !== 'no_show' && booking.status === 'no_show') await afterBookingNoShow(booking);
    // Hold cancelado por el anfitrión: la sesión de Checkout deja de aceptar el pago.
    if (before.status === 'pending' && booking.status === 'cancelled') await expireCheckoutForBooking(before);
    return NextResponse.json(booking);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
