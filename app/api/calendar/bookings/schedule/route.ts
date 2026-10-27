import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { CalendarError, createBooking, findOfferedSlot, getEventType, listEventHosts } from '@/lib/calendar';
import { ianaTimezone, personName, validateBookingAnswers, validateGuests } from '@/lib/calendar-schema';
import { MAX_GUESTS } from '@/lib/calendar-questions';
import { afterBookingCreated } from '@/lib/calendar-lifecycle';
import { parseHostToken } from '@/lib/calendar-host-token';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const email = z.string().trim().min(3).max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'invalid_email' });
const schema = z.object({
  eventTypeId: z.string().min(1).max(64),
  start: z.string().min(1).max(40),
  /** Zona horaria del invitado: su confirmación y recordatorios van en esa hora. */
  timezone: ianaTimezone.optional(),
  name: personName.refine((v) => v.length > 0, { message: 'invalid_name' }),
  email,
  guests: z.array(email).max(MAX_GUESTS).optional(),
  /** Anfitrión elegido (token opaco de la persona); sin él, el reparto de siempre. */
  host: z.string().max(400).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  location: z.object({ key: z.string().trim().max(40).optional(), phone: z.string().trim().max(40).optional() }).optional(),
});

/**
 * Agendar en nombre de un invitado (como "Schedule on behalf" de Calendly):
 * alguien del workspace elige el tipo de evento, el anfitrión, un horario
 * ofrecido en la zona del invitado, la ubicación y los invitados extra. La
 * reserva queda confirmada (sin pago ni aprobación: la agenda alguien del
 * equipo), el invitado recibe la confirmación con su link de gestión y queda
 * registrado quién la agendó. Un admin agenda para cualquier anfitrión del
 * evento; un member, solo consigo como anfitrión y en eventos que atiende.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;
  const eventType = await getEventType(user.id, d.eventTypeId);
  if (!eventType || eventType.active !== 1) return notFound();
  if (eventType.kind === 'poll') return notFound();

  const me = realUserId(user);
  const pool = (await listEventHosts(eventType.id)).map((h) => h.user_id);
  const hosts = pool.length > 0 ? pool : [eventType.user_id];
  let hostId: string | null = d.host ? parseHostToken(d.host) : null;
  if (hostId && !hosts.includes(hostId)) return crmError(400, 'invalid_host');
  if (!isWorkspaceAdmin(user)) {
    // Un member solo agenda reuniones que atiende él.
    if (!hosts.includes(me)) return crmError(403, 'forbidden');
    if (hostId && hostId !== me) return crmError(403, 'forbidden');
    if (eventType.scheduling !== 'collective' || hosts.length <= 1) hostId = me;
  }

  const guests = validateGuests({ allowGuests: true, maxGuests: MAX_GUESTS }, d.guests, d.email);
  if (!guests) return crmError(400, 'too_many_guests');
  // Las preguntas obligatorias las completa el invitado; acá no se piden.
  const answers = validateBookingAnswers(
    eventType.fieldsParsed.map((f) => ({ ...f, required: false })),
    {},
  );
  const start = new Date(d.start);
  if (Number.isNaN(start.getTime())) return crmError(400, 'invalid_input');
  const tz = d.timezone ?? 'UTC';
  try {
    const slot = await findOfferedSlot(eventType.id, start, tz, { hostId });
    if (!slot) return crmError(409, 'slot_unavailable');
    const booking = await createBooking(
      {
        eventTypeId: eventType.id,
        email: d.email,
        name: d.name,
        start: slot.start.toISOString(),
        timezone: tz,
        answers: answers ?? {},
        guests,
        locale: d.locale,
        location: d.location,
      },
      { bookedBy: me, hostId, skipApproval: true },
    );
    const synced = await afterBookingCreated(booking, d.locale);
    await logCalActivity(user.id, me, 'booking.scheduled_on_behalf', {
      type: 'booking',
      id: booking.id,
      summary: `${eventType.title} · ${d.name}`,
    });
    return NextResponse.json(synced, { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return crmError(err.status, err.code);
    return crmError(500, 'generic');
  }
}
