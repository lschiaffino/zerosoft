import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { updateBooking, CalendarError } from '@/lib/calendar';
import { bookingUpdateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';
import { getDb } from '@/lib/db';
import { notifyBooking } from '@/lib/calendar-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dueño del event type o host asignado. */
async function ownsBooking(userId: string, bookingId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      `SELECT e.user_id AS owner_id, b.host_user_id
       FROM calendar_bookings b
       JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE b.id = ?`,
    )
    .get(bookingId)) as { owner_id: string; host_user_id: string | null } | undefined;
  return row !== undefined && (row.owner_id === userId || row.host_user_id === userId);
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
    const before = (await getDb().prepare('SELECT status FROM calendar_bookings WHERE id = ?').get(params.id)) as
      | { status: string }
      | undefined;
    const booking = await updateBooking(params.id, parsed.data);
    if (!booking) return notFound();
    if (before?.status === 'confirmed' && booking.status === 'cancelled') {
      await notifyBooking(booking, 'cancelled', { reason: parsed.data.cancelReason ?? null });
    }
    return NextResponse.json(booking);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
