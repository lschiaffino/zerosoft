import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  getEventTypeById,
  findOfferedSlot,
  createBooking,
  CalendarError,
} from '@/lib/calendar';
import { bookingCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, crmError } from '@/lib/crm-http';
import { afterBookingCreated } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    const booking = await createBooking({
      eventTypeId,
      email,
      name,
      start: matching.start.toISOString(),
      timezone: guestTz,
      answers,
      locale: parsed.data.locale,
    });

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
