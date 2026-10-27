import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { actorIdOf, logCalActivity } from '@/lib/calendar-activity';
import { approveBooking, declineBooking, ownedBooking, CalendarError } from '@/lib/calendar';
import { bookingInScope, viewerScope } from '@/lib/calendar-access';
import { bookingApprovalSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized, crmError } from '@/lib/crm-http';
import { afterBookingApproved, afterBookingDeclined } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { decision: 'confirm' | 'decline', reason? } — el anfitrión responde a
 * una reserva que pide confirmación. Confirmarla dispara lo mismo que una
 * reserva nueva (Google, CRM, recordatorios, booking.created); rechazarla
 * libera el horario y le avisa al invitado.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const owned = await ownedBooking(user.id, id);
  if (!owned || !bookingInScope(owned, viewerScope(user))) return notFound();

  const parsed = bookingApprovalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    if (parsed.data.decision === 'confirm') {
      const booking = await approveBooking(id);
      await logCalActivity(user.id, actorIdOf(user), 'booking.approved', { type: 'booking', id: booking.id, summary: booking.invitee_name });
      return NextResponse.json(await afterBookingApproved(booking));
    }
    const booking = await declineBooking(id, parsed.data.reason ?? null);
    await afterBookingDeclined(booking, parsed.data.reason ?? null);
    await logCalActivity(user.id, actorIdOf(user), 'booking.declined', { type: 'booking', id: booking.id, summary: booking.invitee_name });
    return NextResponse.json(booking);
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
