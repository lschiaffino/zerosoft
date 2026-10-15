import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  getEventTypeById,
  findOfferedSlot,
  createBooking,
  expirePendingBooking,
  listUserBookings,
  CalendarError,
} from '@/lib/calendar';
import { bookingCreateSchema, bookingListQuerySchema } from '@/lib/calendar-schema';
import { invalidBody, crmError, unauthorized } from '@/lib/crm-http';
import { afterBookingCreated } from '@/lib/calendar-lifecycle';
import { getCurrentUser } from '@/lib/session';
import { appBaseUrl } from '@/lib/calendar-notify';
import { createCheckoutForBooking, HOLD_MINUTES, paymentsEnabled, PaymentError } from '@/lib/calendar-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?q=&status=&from=YYYY-MM-DD&to=YYYY-MM-DD — reservas del workspace
 * (anfitrión). `to` incluye el día entero (UTC). Con `from`, orden ascendente.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bookingListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return invalidBody(parsed.error);
  const { q, status, from, to, limit } = parsed.data;
  const rows = await listUserBookings(user.id, {
    q,
    status,
    from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
    limit,
    order: from ? 'asc' : 'desc',
  });
  return NextResponse.json({ bookings: rows });
}

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'booking', 10, 600);
  if (limited) return limited;
  const body: unknown = await req.json().catch(() => null);
  const parsed = bookingCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { eventTypeId, email, name, start, timezone, answers } = parsed.data;

  try {
    const eventType = await getEventTypeById(eventTypeId);
    if (!eventType || eventType.active !== 1) return crmError(404, 'not_found');
    if (eventType.single_use === 1 && eventType.used_at) return crmError(410, 'link_expired');

    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) return crmError(400, 'invalid_input');

    const guestTz = timezone ?? 'UTC';
    const matching = await findOfferedSlot(eventTypeId, startDate, guestTz);
    if (!matching) return crmError(409, 'slot_unavailable');

    const paid = eventType.price_cents > 0;
    if (paid && !(await paymentsEnabled(eventType.user_id))) return crmError(409, 'payments_not_configured');

    const booking = await createBooking(
      {
        eventTypeId,
        email,
        name,
        start: matching.start.toISOString(),
        timezone: guestTz,
        answers,
        locale: parsed.data.locale,
      },
      paid
        ? {
            hold: {
              expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
              amountCents: eventType.price_cents,
              currency: eventType.currency,
            },
          }
        : {},
    );

    // Con precio: la reserva queda retenida hasta que Stripe confirme el pago.
    if (paid) {
      const locale = parsed.data.locale ?? 'en';
      try {
        const checkoutUrl = await createCheckoutForBooking(booking, eventType, {
          origin: appBaseUrl(),
          locale,
        });
        return NextResponse.json(
          {
            id: booking.id,
            startsAt: booking.starts_at,
            endsAt: booking.ends_at,
            status: 'pending',
            manageToken: booking.manage_token,
            checkoutUrl,
            holdExpiresAt: booking.hold_expires_at,
          },
          { status: 201 },
        );
      } catch (err) {
        // Sin sesión de pago, el horario se libera enseguida.
        await expirePendingBooking(booking.id);
        if (err instanceof PaymentError) return crmError(502, 'payment_failed');
        throw err;
      }
    }

    const synced = await afterBookingCreated(booking, parsed.data.locale);

    // Solo lo que el invitado necesita (el token es suyo: gestionar su reserva).
    return NextResponse.json(
      {
        id: booking.id,
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        status: booking.status,
        manageToken: booking.manage_token,
        meetingUrl: synced.meeting_url,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
