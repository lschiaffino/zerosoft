import { NextRequest, NextResponse } from 'next/server';
import {
  getEventTypeById,
  getAvailableSlots,
  createBooking,
  CalendarError,
} from '@/lib/calendar';
import { bookingCreateSchema } from '@/lib/calendar-schema';
import { invalidBody, crmError } from '@/lib/crm-http';
import { sendBookingConfirmation } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = bookingCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { eventTypeId, email, name, start, timezone, answers } = parsed.data;

  try {
    const eventType = await getEventTypeById(eventTypeId);
    if (!eventType || eventType.active !== 1) return crmError(404, 'not_found');

    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) return crmError(400, 'invalid_input');

    const startDay = startDate.toISOString().slice(0, 10);
    const guestTz = timezone ?? 'UTC';
    const slots = await getAvailableSlots(eventTypeId, guestTz, startDay);
    const matching = slots.find(
      (s) => Math.abs(s.start.getTime() - startDate.getTime()) < 60_000,
    );
    if (!matching) return crmError(409, 'slot_unavailable');

    const booking = await createBooking({
      eventTypeId,
      email,
      name,
      start: matching.start.toISOString(),
      timezone: guestTz,
      answers,
    });

    await sendBookingConfirmation({
      to: email,
      guestName: name,
      eventTitle: eventType.title,
      start: matching.start,
      end: matching.end,
      timezone: guestTz,
      location: eventType.location,
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
