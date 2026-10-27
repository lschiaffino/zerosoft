/**
 * Cal — lo que una reserva hace afuera, en un solo lugar:
 *
 * 1. Videollamada generada por reserva: Zoom (app Server-to-Server del
 *    workspace, Cal → Ajustes → Conexiones o CRM → Integraciones) y Teams
 *    (el Outlook conectado del anfitrión). Solo si la opción de ubicación no
 *    trae un link fijo; si no se puede generar, queda el link personal.
 * 2. El evento en el calendario del anfitrión: Google o Outlook, el que
 *    eligió en "Agregar reservas a" (por defecto Google si lo conectó). Una
 *    reunión de Teams va siempre a Outlook, que es quien la crea.
 *
 * Todo best-effort: lo llama lib/calendar-lifecycle.ts dentro de `safely`.
 */
import { getDb, getUserById, type CalendarBookingRow } from './db';
import type { EventTypeWithRules } from './calendar';
import { parseLocations } from './calendar-locations';
import { getPersonCalendars, recordWriteResult, writeTarget } from './calendar-calendars';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting } from './crm-apps';
import {
  createGoogleEventForBooking,
  deleteGoogleEventForBooking,
  googleCalendarConnected,
  syncGoogleEventTime,
} from './google-calendar';
import {
  createICloudEventForBooking,
  deleteICloudEventForBooking,
  icloudCalendarConnected,
  syncICloudEventTime,
} from './icloud-calendar';
import {
  createOutlookEventForBooking,
  deleteOutlookEventForBooking,
  outlookCalendarConnected,
  syncOutlookEventTime,
} from './outlook-calendar';

/** La opción elegida (zoom / teams) no trae un link fijo: hay que generar la reunión. */
export function needsGeneratedMeeting(booking: Pick<CalendarBookingRow, 'location_kind'>, eventType: Pick<EventTypeWithRules, 'locations'>, kind: 'zoom' | 'teams'): boolean {
  if (booking.location_kind !== kind) return false;
  const options = parseLocations(eventType.locations).filter((o) => o.kind === kind);
  return options.length > 0 && options.some((o) => !o.value);
}

async function targetFor(hostId: string) {
  const [google, outlook, icloud] = await Promise.all([
    googleCalendarConnected(hostId),
    outlookCalendarConnected(hostId),
    icloudCalendarConnected(hostId),
  ]);
  return { target: writeTarget(await getPersonCalendars(hostId), { google, outlook, icloud }), outlook };
}

async function withZoom(booking: CalendarBookingRow, eventType: EventTypeWithRules): Promise<CalendarBookingRow> {
  if (booking.zoom_meeting_id || !needsGeneratedMeeting(booking, eventType, 'zoom')) return booking;
  const host = await getUserById(booking.host_user_id ?? eventType.user_id);
  const meeting = await createZoomMeeting(eventType.user_id, {
    topic: `${eventType.title} — ${booking.invitee_name}`,
    start: new Date(booking.starts_at),
    durationMin: Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000),
    hostEmail: host?.email ?? null,
    agenda: eventType.description,
    // El log de la app guarda solo el tipo de evento: nada del invitado.
    logLabel: `Cal: ${eventType.title}`,
  }).catch(() => null);
  if (!meeting) return booking;
  await getDb()
    .prepare('UPDATE calendar_bookings SET zoom_meeting_id = ?, meeting_url = ?, location = ? WHERE id = ?')
    .run(meeting.id, meeting.joinUrl, meeting.joinUrl, booking.id);
  return { ...booking, zoom_meeting_id: meeting.id, meeting_url: meeting.joinUrl, location: meeting.joinUrl };
}

/** Reserva confirmada: reunión generada (si aplica) y evento en el calendario del host. */
export async function createExternalForBooking(booking: CalendarBookingRow, eventType: EventTypeWithRules): Promise<CalendarBookingRow> {
  let b = await withZoom(booking, eventType);
  const hostId = b.host_user_id ?? eventType.user_id;
  const { target, outlook } = await targetFor(hostId);
  const teams = outlook && needsGeneratedMeeting(b, eventType, 'teams');
  if (teams) {
    const out = await createOutlookEventForBooking(b, eventType, {
      teams: true,
      calendarId: target?.provider === 'outlook' ? target.calendarId || undefined : undefined,
    });
    await recordWriteResult(hostId, 'outlook', !!out.outlook_event_id);
    return out;
  }
  if (!target) return b;
  if (target.provider === 'google') b = await createGoogleEventForBooking(b, eventType, target.calendarId || 'primary');
  else if (target.provider === 'icloud') b = await createICloudEventForBooking(b, eventType, target.calendarId);
  else b = await createOutlookEventForBooking(b, eventType, { calendarId: target.calendarId || undefined });
  // Si el calendario no aceptó el evento, Conexiones lo avisa (la reserva sigue igual).
  const written = target.provider === 'google' ? !!b.google_event_id : target.provider === 'icloud' ? !!b.icloud_event_url : !!b.outlook_event_id;
  await recordWriteResult(hostId, target.provider, written);
  return b;
}

/** Reprogramación: mueve la reunión y el evento (o los recrea si cambió el host). */
export async function syncExternalTime(
  booking: CalendarBookingRow,
  eventType: EventTypeWithRules,
  previousHostId: string | null,
): Promise<CalendarBookingRow> {
  if (booking.zoom_meeting_id) {
    await updateZoomMeeting(eventType.user_id, booking.zoom_meeting_id, {
      start: new Date(booking.starts_at),
      durationMin: Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000),
    }).catch(() => null);
  }
  const hostId = booking.host_user_id ?? eventType.user_id;
  // Ya tenía evento: se mueve donde está.
  if (booking.outlook_event_id) {
    const { target } = await targetFor(hostId);
    return syncOutlookEventTime(booking, eventType, previousHostId, {
      teams: needsGeneratedMeeting(booking, eventType, 'teams'),
      calendarId: target?.provider === 'outlook' ? target.calendarId || undefined : undefined,
    });
  }
  if (booking.icloud_event_url) {
    const { target } = await targetFor(hostId);
    return syncICloudEventTime(booking, eventType, previousHostId, target?.provider === 'icloud' ? target.calendarId : '');
  }
  if (booking.google_event_id) {
    const { target } = await targetFor(hostId);
    return syncGoogleEventTime(booking, eventType, previousHostId, target?.provider === 'google' ? target.calendarId || 'primary' : 'primary');
  }
  // Sin evento todavía (el host no tenía nada conectado o cambió): se crea.
  return createExternalForBooking(booking, eventType);
}

/** Cancelación: borra la reunión generada y el evento del calendario. */
export async function deleteExternalForBooking(booking: CalendarBookingRow, eventType: EventTypeWithRules): Promise<void> {
  if (booking.zoom_meeting_id) await deleteZoomMeeting(eventType.user_id, booking.zoom_meeting_id).catch(() => null);
  await deleteGoogleEventForBooking(booking, eventType);
  await deleteOutlookEventForBooking(booking, eventType);
  await deleteICloudEventForBooking(booking, eventType);
}
