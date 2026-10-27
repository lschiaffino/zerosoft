import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { CalendarError, createBooking, findOfferedSlot, getEventType, listUserBookings } from '@/lib/calendar';
import { ianaTimezone, personName } from '@/lib/calendar-schema';
import { afterBookingCreated, bookingPayload } from '@/lib/calendar-lifecycle';
import { bookingScopeFor } from '@/lib/calendar-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?status=confirmed|cancelled|no_show|pending&from=ISO&to=ISO&q= — reservas de tus event types. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'cal:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const from = sp.get('from') ? new Date(sp.get('from')!) : undefined;
  const to = sp.get('to') ? new Date(sp.get('to')!) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return apiError(400, 'invalid_date', 'from/to must be ISO 8601 dates.');
  }
  if (status && !['confirmed', 'cancelled', 'no_show', 'pending'].includes(status)) {
    return apiError(400, 'invalid_status', 'status must be confirmed, cancelled, no_show or pending.');
  }
  const rows = await listUserBookings(auth.user.id, {
    status: (status as 'confirmed' | 'cancelled' | 'no_show' | 'pending' | null) ?? undefined,
    from,
    to,
    q: sp.get('q')?.slice(0, 200) || undefined,
    // La key actúa con el rol de quien la creó: un member ve solo las reservas que atiende.
    hostId: bookingScopeFor(auth.role, auth.personId) ?? undefined,
  });
  return NextResponse.json({
    bookings: rows.map((b) =>
      bookingPayload(b, { id: b.event_type_id, slug: '', title: b.event_type_title }),
    ),
  });
}

const createSchema = z.object({
  eventTypeId: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  name: personName.min(1),
  email: z.string().trim().email().max(254),
  timezone: ianaTimezone.optional(),
});

/** Crea una reserva en nombre de un invitado (mismas reglas que la página pública). */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'cal:write');
  if ('res' in auth) return auth.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'eventTypeId, start (ISO), name and email are required.');
  const eventType = await getEventType(auth.user.id, parsed.data.eventTypeId);
  if (!eventType) return apiError(404, 'not_found', 'Event type not found.');

  const tz = parsed.data.timezone ?? 'UTC';
  const slot = await findOfferedSlot(eventType.id, new Date(parsed.data.start), tz);
  if (!slot) return apiError(409, 'slot_unavailable', 'That time is not available.');
  try {
    const booking = await createBooking({
      eventTypeId: eventType.id,
      start: slot.start.toISOString(),
      name: parsed.data.name,
      email: parsed.data.email,
      timezone: tz,
    });
    const synced = await afterBookingCreated(booking);
    return NextResponse.json(bookingPayload(synced, eventType), { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return apiError(err.status, err.code, err.code);
    throw err;
  }
}
