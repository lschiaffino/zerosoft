import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { CalendarError } from '@/lib/calendar';
import { bookPoll, getPoll } from '@/lib/calendar-polls';
import { afterBookingCreated } from '@/lib/calendar-lifecycle';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ optionId: z.string().min(1).max(64), locale: z.enum(['en', 'es', 'pt']).optional() });

/** Reserva el horario elegido de la encuesta con todos los participantes. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const current = await getPoll(user.id, id);
  if (!current) return notFound();
  // Reserva quien la creó (es el anfitrión) o un admin.
  if (current.created_by !== realUserId(user) && !isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const { poll, booking } = await bookPoll(user.id, id, parsed.data.optionId, parsed.data.locale);
    const synced = await afterBookingCreated(booking, booking.locale);
    await logCalActivity(user.id, realUserId(user), 'poll.booked', { type: 'poll', id, summary: poll.title });
    return NextResponse.json({ poll, booking: { id: synced.id, startsAt: synced.starts_at, meetingUrl: synced.meeting_url } });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
