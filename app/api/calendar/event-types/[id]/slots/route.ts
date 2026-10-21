import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getAvailableDays, getBookingByManageToken, getEventTypeById, getAvailableSlots } from '@/lib/calendar';
import { ianaTimezone } from '@/lib/calendar-schema';
import { notFound, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = await limitByIp(_req, 'slots', 120, 60);
  if (limited) return limited;
  try {
    const eventType = await getEventTypeById(params.id);
    if (!eventType) return notFound();

    const { searchParams } = new URL(_req.url);
    const date = searchParams.get('date') ?? '';
    const tzParsed = ianaTimezone.safeParse(searchParams.get('timezone') ?? 'UTC');
    const timezone = tzParsed.success ? tzParsed.data : 'UTC';

    // Reprogramación: el horario actual del propio booking no cuenta como
    // ocupado, y se puede mover aunque el evento ya no acepte reservas nuevas.
    const rescheduleToken = searchParams.get('reschedule');
    const own = rescheduleToken ? await getBookingByManageToken(rescheduleToken) : undefined;
    const excludeBookingId =
      own && own.event_type_id === params.id && own.status === 'confirmed' ? own.id : undefined;
    if (eventType.active !== 1 && !excludeBookingId) return notFound();

    // ?month=YYYY-MM → días del mes con lugar (para deshabilitar el resto en el calendario).
    const month = searchParams.get('month');
    if (month) {
      return NextResponse.json({ days: await getAvailableDays(params.id, timezone, month, { excludeBookingId }) });
    }

    const slots = await getAvailableSlots(params.id, timezone, date, { excludeBookingId });
    return NextResponse.json({
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        // Evento grupal: lugares que quedan en ese horario.
        ...(s.seatsLeft !== undefined ? { seatsLeft: s.seatsLeft } : {}),
      })),
    });
  } catch {
    return crmError(500, 'generic');
  }
}
