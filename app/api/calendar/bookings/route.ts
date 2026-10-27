import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  getEventTypeById,
  findOfferedSlot,
  createBooking,
  expirePendingBooking,
  listUserBookings,
  bookingDateBounds,
  CalendarError,
  type EventTypeWithRules,
} from '@/lib/calendar';
import { bookingCreateSchema, bookingListQuerySchema, validateBookingAnswers, validateGuests } from '@/lib/calendar-schema';
import { invalidBody, crmError, unauthorized } from '@/lib/crm-http';
import { afterBookingCreated } from '@/lib/calendar-lifecycle';
import { getCurrentUser } from '@/lib/session';
import { appBaseUrl } from '@/lib/calendar-notify';
import { createCheckoutForBooking, HOLD_MINUTES, paymentsEnabled, PaymentError } from '@/lib/calendar-payments';
import { buildRedirectUrl, parseUtm, sanitizeUtm } from '@/lib/calendar-redirect';
import type { CalendarBookingRow } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?q=&status=&from=YYYY-MM-DD&to=YYYY-MM-DD — reservas del workspace
 * (anfitrión). Días en la zona del calendario del workspace; `to` incluye el
 * día entero. Con `from`, orden ascendente.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bookingListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return invalidBody(parsed.error);
  const { q, status, from, to, limit } = parsed.data;
  const bounds = await bookingDateBounds(user.id, from, to);
  const rows = await listUserBookings(user.id, {
    q,
    status,
    from: bounds.from,
    to: bounds.to,
    limit,
    order: from ? 'asc' : 'desc',
  });
  return NextResponse.json({ bookings: rows });
}

/**
 * Destino del invitado después de reservar, si el evento tiene uno: con
 * "pasar los datos", la URL lleva la reserva y sus utm_* como parámetros.
 */
function redirectAfterBooking(eventType: EventTypeWithRules, booking: CalendarBookingRow): string | null {
  const rules = eventType.bookingRulesParsed;
  if (typeof rules.redirectUrl !== 'string' || !rules.redirectUrl) return null;
  return buildRedirectUrl(rules.redirectUrl, rules.redirectPassDetails === true, {
    bookingId: booking.id,
    status: booking.status,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    timezone: booking.timezone,
    name: booking.invitee_name,
    email: booking.invitee_email,
    eventSlug: eventType.slug,
    eventTitle: eventType.title,
    utm: parseUtm(booking.utm),
  });
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
    // Respuestas contra los campos del evento (claves, tipos, tamaño y requeridos).
    const validAnswers = validateBookingAnswers(eventType.fieldsParsed, answers);
    if (!validAnswers) return crmError(400, 'invalid_input');
    // Invitados extra: solo si el evento los permite y hasta su tope.
    const guests = validateGuests(eventType.bookingRulesParsed, parsed.data.guests, email);
    if (!guests) return crmError(400, 'too_many_guests');

    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) return crmError(400, 'invalid_input');

    const guestTz = timezone ?? 'UTC';
    const hostId = parsed.data.hostId ?? null;
    const matching = await findOfferedSlot(eventTypeId, startDate, guestTz, { hostId });
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
        answers: validAnswers,
        guests,
        location: parsed.data.location,
        locale: parsed.data.locale,
        utm: sanitizeUtm(parsed.data.utm),
        routingSubmissionId: parsed.data.routingSubmissionId,
      },
      paid
        ? {
            hostId,
            hold: {
              expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
              amountCents: eventType.price_cents,
              currency: eventType.currency,
            },
          }
        : { hostId },
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
        location: synced.location,
        /** true: la reserva espera que el anfitrión la confirme. */
        awaitingApproval: booking.approval === 'pending',
        redirectUrl: redirectAfterBooking(eventType, synced),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
