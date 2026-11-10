import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { getSessionDetail, getSessionRow, updateSession } from '@/lib/voice';
import { contactLabel, linkBooking, linkCalendarEvent } from '@/lib/voice-integrations';
import { findCalendarEvent, forgetCalendarCache, parseEventKey } from '@/lib/voice-calendar';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vincula la reunión con el calendario.
 * - { bookingId }: una reserva de Cal (y su contacto del CRM por el email del invitado).
 * - { eventKey }: un evento de Cal, Google u Outlook de la persona (asistentes, título si no hay, contacto).
 * - { eventKey: null }: desvincula el evento (los asistentes quedan).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const row = await getSessionRow(auth.owner, id);
  if (!row || row.kind !== 'meeting') return voiceJsonError(404, 'not_found');
  try {
    if ('eventKey' in body) {
      if (body.eventKey === null) {
        await updateSession(auth.owner, id, { eventKey: null, calBookingId: null });
        forgetCalendarCache(auth.owner);
        return NextResponse.json({ ok: true, eventKey: null });
      }
      const key = typeof body.eventKey === 'string' ? body.eventKey.slice(0, 600) : '';
      if (!parseEventKey(key)) return voiceJsonError(400, 'invalid_input');
      // El evento se busca en el calendario de la persona: no se confía en lo que manda el cliente.
      const event = await findCalendarEvent(auth.owner, key);
      if (!event) return voiceJsonError(404, 'event_not_found');
      const detail = await getSessionDetail(auth.owner, id);
      const res = await linkCalendarEvent({ owner: auth.owner, scope: await sessionScope(auth.user), sessionId: id, event, attendees: detail?.attendees ?? [] });
      forgetCalendarCache(auth.owner);
      const fresh = await getSessionDetail(auth.owner, id);
      return NextResponse.json({
        ok: true,
        title: res.title,
        eventKey: event.key,
        calBookingId: fresh?.calBookingId ?? null,
        attendees: fresh?.attendees ?? [],
        contact: await contactLabel(auth.owner.workspaceId, fresh?.contactId ?? null),
      });
    }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId.slice(0, 64) : '';
    if (!bookingId) return voiceJsonError(400, 'invalid_input');
    const res = await linkBooking({ owner: auth.owner, scope: await sessionScope(auth.user), sessionId: id, bookingId, currentTitle: row.title });
    if (!res.ok) return voiceJsonError(404, 'booking_not_found');
    return NextResponse.json({ ...res, contact: await contactLabel(auth.owner.workspaceId, res.contactId) });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
