import { getDb, type CalendarBookingRow, type CalendarEventTypeRow } from './db';
import { getIntegration, getValidAccessToken } from './integrations';
import { checkedCalendars, getPersonCalendars } from './calendar-calendars';
import { fakeGoogleCalendarAllowed, fakeGoogleFetch } from './google-calendar-fake';

/**
 * Google Calendar para Cal, por persona (cada host conecta su propio calendario):
 * - freeBusy: los eventos de los calendarios elegidos (por defecto el
 *   principal) bloquean slots, así no hay doble reserva.
 * - events: cada reserva se crea en el calendario elegido del host (por
 *   defecto el principal), con link de Google Meet si el event type lo pide;
 *   reprogramar/cancelar la actualiza/borra en ese mismo calendario.
 * - calendarList: la lista para elegir (scope calendar.calendarlist.readonly;
 *   las conexiones viejas sin ese scope ven "volvé a conectar").
 * Todo es best-effort: si Google falla, la reserva sigue funcionando.
 * CAL_GOOGLE_FAKE=1 (tests/demo) va contra lib/google-calendar-fake.ts.
 */

export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';
export const GOOGLE_CALENDARLIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const GOOGLE_CALENDAR_SCOPE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  GOOGLE_CALENDARLIST_SCOPE,
].join(' ');

const API = 'https://www.googleapis.com/calendar/v3';

interface Range {
  start: Date;
  end: Date;
}

function gfetch(url: string, init: RequestInit): Promise<Response> {
  return fakeGoogleCalendarAllowed() ? fakeGoogleFetch(url, init) : fetch(url, init);
}

async function tokenFor(userId: string): Promise<string | null> {
  const row = await getIntegration(userId, GOOGLE_CALENDAR_PROVIDER);
  if (!row) return null;
  return getValidAccessToken(row);
}

export async function googleCalendarConnected(userId: string): Promise<boolean> {
  return !!(await getIntegration(userId, GOOGLE_CALENDAR_PROVIDER));
}

// ---------- Lista de calendarios ----------

export interface ExternalCalendar {
  id: string;
  name: string;
  primary: boolean;
  /** Se pueden crear eventos (dueño o editor). */
  canWrite: boolean;
}

/** Calendarios de la persona; null si Google no responde o falta el scope (hay que reconectar). */
export async function listGoogleCalendars(userId: string): Promise<ExternalCalendar[] | null> {
  const token = await tokenFor(userId);
  if (!token) return null;
  const res = await gfetch(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=100`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    items?: Array<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }>;
  } | null;
  return (data?.items ?? []).map((c) => ({
    id: c.primary ? 'primary' : c.id,
    name: c.summaryOverride || c.summary || c.id,
    primary: c.primary === true,
    canWrite: c.accessRole === 'owner' || c.accessRole === 'writer',
  }));
}

// ---------- Free/busy ----------

const busyCache = new Map<string, { at: number; ranges: Range[] }>();
const BUSY_TTL_MS = 60_000;

/**
 * Ventana que se le pide a Google: el mes (UTC) que contiene `from`, con 2 días
 * de margen a cada lado. Así el calendario de un mes entero (31 consultas de
 * slots) hace UNA sola llamada a freeBusy, que queda en caché.
 */
function monthWindow(from: Date, to: Date): { from: Date; to: Date } {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1) - 2 * 86_400_000);
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) + 2 * 86_400_000);
  return to <= end ? { from: start, to: end } : { from, to };
}

/** Rangos ocupados de los calendarios elegidos del usuario (cache 60s por mes). */
export async function googleBusyRanges(userId: string, from: Date, to: Date): Promise<Range[]> {
  const win = monthWindow(from, to);
  const key = `${userId}:${win.from.toISOString()}:${win.to.toISOString()}`;
  const hit = busyCache.get(key);
  let ranges = hit && Date.now() - hit.at < BUSY_TTL_MS ? hit.ranges : null;

  if (!ranges) {
    const token = await tokenFor(userId);
    if (!token) return [];
    const calendars = checkedCalendars(await getPersonCalendars(userId), 'google');
    const res = await gfetch(`${API}/freeBusy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: win.from.toISOString(), timeMax: win.to.toISOString(), items: calendars.map((id) => ({ id })) }),
    }).catch(() => null);
    if (!res?.ok) return [];
    const data = (await res.json().catch(() => null)) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    } | null;
    ranges = Object.values(data?.calendars ?? {}).flatMap((c) =>
      (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
    );
    busyCache.set(key, { at: Date.now(), ranges });
    if (busyCache.size > 500) busyCache.delete(busyCache.keys().next().value as string);
  }
  return ranges.filter((r) => r.start < to && r.end > from);
}

/** Tras crear/mover/cancelar una reserva (o cambiar los calendarios), la caché de ese host deja de valer. */
export function invalidateBusyCache(userId: string): void {
  for (const key of busyCache.keys()) if (key.startsWith(`${userId}:`)) busyCache.delete(key);
}

// ---------- Events ----------

/** El event type pide un link de Google Meet (ubicación vacía o "Google Meet"). */
export function wantsGoogleMeet(location: string | null | undefined): boolean {
  const l = (location ?? '').trim().toLowerCase();
  return l === '' || l === 'google meet' || l === 'google_meet' || l === 'https://meet.google.com/new';
}

/**
 * La reserva lleva Google Meet: el invitado eligió esa ubicación o, sin
 * ubicaciones estructuradas, el texto del evento lo pide.
 */
export function bookingWantsMeet(
  booking: Pick<CalendarBookingRow, 'location_kind'>,
  eventType: Pick<CalendarEventTypeRow, 'location'>,
): boolean {
  if (booking.location_kind) return booking.location_kind === 'google_meet';
  return wantsGoogleMeet(eventType.location);
}

/** Invitados extra de la reserva (JSON de emails; vacío si falta o está roto). */
export function guestEmails(json: string | undefined): string[] {
  try {
    const list: unknown = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string' && g.includes('@')) : [];
  } catch {
    return [];
  }
}

function eventBody(booking: CalendarBookingRow, eventType: CalendarEventTypeRow, withMeet: boolean) {
  return {
    summary: `${eventType.title} — ${booking.invitee_name}`,
    description: `Booked with zerosoft Cal.\n${booking.invitee_name} <${booking.invitee_email}>`,
    start: { dateTime: booking.starts_at, timeZone: 'UTC' },
    end: { dateTime: booking.ends_at, timeZone: 'UTC' },
    attendees: [
      { email: booking.invitee_email, displayName: booking.invitee_name },
      ...guestEmails(booking.guests).map((email) => ({ email, optional: true })),
    ],
    ...(booking.location
      ? { location: booking.location }
      : !booking.location_kind && !wantsGoogleMeet(eventType.location)
        ? { location: eventType.location }
        : {}),
    ...(withMeet
      ? { conferenceData: { createRequest: { requestId: booking.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
      : {}),
    reminders: { useDefault: true },
  };
}

function calendarPath(calendarId: string | null | undefined): string {
  return encodeURIComponent(calendarId || 'primary');
}

/**
 * Crea el evento en el calendario del host (`calendarId`, por defecto el
 * principal). sendUpdates=none: el invitado ya recibe nuestro email con .ics.
 * Devuelve el booking con google_event_id, el calendario y meeting_url
 * guardados (o el mismo si el host no tiene Google conectado).
 */
export async function createGoogleEventForBooking(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
  calendarId = 'primary',
): Promise<CalendarBookingRow> {
  const hostId = booking.host_user_id ?? eventType.user_id;
  const token = await tokenFor(hostId);
  if (!token) return booking;
  invalidateBusyCache(hostId);
  const withMeet = bookingWantsMeet(booking, eventType);
  const res = await gfetch(`${API}/calendars/${calendarPath(calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(eventBody(booking, eventType, withMeet)),
  }).catch(() => null);
  if (!res?.ok) return booking;
  const ev = (await res.json().catch(() => null)) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  } | null;
  if (!ev?.id) return booking;
  const meetingUrl =
    ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null;
  const stored = calendarId && calendarId !== 'primary' ? calendarId : null;
  await getDb()
    .prepare('UPDATE calendar_bookings SET google_event_id = ?, google_calendar_id = ?, meeting_url = COALESCE(?, meeting_url) WHERE id = ?')
    .run(ev.id, stored, meetingUrl, booking.id);
  return { ...booking, google_event_id: ev.id, google_calendar_id: stored, meeting_url: meetingUrl ?? booking.meeting_url };
}

/** Reprogramación: mueve el evento (si el host cambió, lo recrea en el nuevo). */
export async function syncGoogleEventTime(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
  previousHostId: string | null,
  calendarId = 'primary',
): Promise<CalendarBookingRow> {
  const hostId = booking.host_user_id ?? eventType.user_id;
  if (booking.google_event_id && previousHostId && previousHostId !== hostId) {
    await deleteGoogleEventForBooking({ ...booking, host_user_id: previousHostId }, eventType);
    return createGoogleEventForBooking({ ...booking, google_event_id: null, google_calendar_id: null }, eventType, calendarId);
  }
  if (!booking.google_event_id) return createGoogleEventForBooking(booking, eventType, calendarId);
  const token = await tokenFor(hostId);
  if (!token) return booking;
  invalidateBusyCache(hostId);
  await gfetch(
    `${API}/calendars/${calendarPath(booking.google_calendar_id)}/events/${encodeURIComponent(booking.google_event_id)}?sendUpdates=none`,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        start: { dateTime: booking.starts_at, timeZone: 'UTC' },
        end: { dateTime: booking.ends_at, timeZone: 'UTC' },
        ...(booking.location ? { location: booking.location } : {}),
      }),
    },
  ).catch(() => null);
  return booking;
}

export async function deleteGoogleEventForBooking(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
): Promise<void> {
  if (!booking.google_event_id) return;
  const hostId = booking.host_user_id ?? eventType.user_id;
  const token = await tokenFor(hostId);
  if (!token) return;
  invalidateBusyCache(hostId);
  await gfetch(
    `${API}/calendars/${calendarPath(booking.google_calendar_id)}/events/${encodeURIComponent(booking.google_event_id)}?sendUpdates=none`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  ).catch(() => null);
}

// ---------- Eventos para Voice (reuniones con sus asistentes) ----------

export interface ExternalMeetingEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: Array<{ name: string; email: string }>;
  meetingUrl: string | null;
}

/**
 * Próximos eventos de los calendarios elegidos de la persona (los mismos que
 * revisa Cal), con sus asistentes y el link de la videollamada. Sin eventos
 * de todo el día, cancelados o rechazados. [] si no hay Google conectado o
 * no responde. Usa el scope calendar.events que ya pide Cal.
 */
export async function listGoogleEvents(userId: string, from: Date, to: Date): Promise<ExternalMeetingEvent[]> {
  const token = await tokenFor(userId);
  if (!token) return [];
  const calendars = checkedCalendars(await getPersonCalendars(userId), 'google');
  const out: ExternalMeetingEvent[] = [];
  for (const cal of calendars.slice(0, 10)) {
    const qs = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });
    const res = await gfetch(`${API}/calendars/${calendarPath(cal)}/events?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json().catch(() => null)) as {
      items?: Array<{
        id: string;
        status?: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        hangoutLink?: string;
        location?: string;
        conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
        attendees?: Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string; resource?: boolean }>;
      }>;
    } | null;
    for (const e of data?.items ?? []) {
      if (e.status === 'cancelled' || !e.start?.dateTime || !e.end?.dateTime) continue;
      const me = e.attendees?.find((a) => a.self);
      if (me?.responseStatus === 'declined') continue;
      const url =
        e.hangoutLink ??
        e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ??
        (e.location && /^https:\/\//.test(e.location) ? e.location : null);
      out.push({
        id: e.id,
        title: e.summary ?? '',
        startsAt: new Date(e.start.dateTime).toISOString(),
        endsAt: new Date(e.end.dateTime).toISOString(),
        attendees: (e.attendees ?? [])
          .filter((a) => !a.self && !a.resource && a.email)
          .map((a) => ({ name: a.displayName ?? '', email: String(a.email).toLowerCase() })),
        meetingUrl: url ?? null,
      });
    }
  }
  return out;
}
