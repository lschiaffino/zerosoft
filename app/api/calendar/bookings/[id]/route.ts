import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { updateBooking, CalendarError } from '@/lib/calendar';
import { bookingUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ownsBooking(userId: string, bookingId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      `SELECT b.id, e.user_id
       FROM calendar_bookings b
       JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE b.id = ?`,
    )
    .get(bookingId)) as { id: string; user_id: string } | undefined;
  return row?.user_id === userId;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = (await getDb()
    .prepare(
      `SELECT b.*, e.title as event_type_title, e.duration_min as event_type_duration_min
       FROM calendar_bookings b
       JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE b.id = ?`,
    )
    .get(params.id)) as Record<string, unknown> | undefined;
  if (!row) return notFound();
  if (row.user_id !== user.id) return unauthorized();
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
    const booking = await updateBooking(params.id, parsed.data);
    if (!booking) return notFound();
    return NextResponse.json(booking);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
