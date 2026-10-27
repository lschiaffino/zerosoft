/**
 * Outlook / Microsoft 365 para Cal, por persona (como Google Calendar):
 * - calendarView de los calendarios elegidos (por defecto el principal): lo
 *   que no está "libre" bloquea slots;
 * - events: cada reserva se crea en el calendario elegido del host; si el
 *   invitado eligió Teams, el evento se crea como reunión de Teams
 *   (isOnlineMeeting + teamsForBusiness) y el link queda en la reserva;
 *   reprogramar/cancelar la mueve/borra.
 *
 * OAuth propio (no el buzón del CRM): scopes de calendario solamente y
 * redirect <NEXTAUTH_URL>/api/calendar/outlook/callback, que hay que
 * registrar en la app de Entra ID (MS_CLIENT_ID / MS_CLIENT_SECRET, la misma
 * del CRM). Tokens cifrados en `integrations` (provider outlook_calendar).
 * Con MS_GRAPH_FAKE=1 (tests/demo) va contra lib/microsoft-fake.ts.
 * Best-effort: si Microsoft falla, la reserva sigue. Server-only.
 */
import { getDb, type CalendarBookingRow, type CalendarEventTypeRow, type IntegrationRow } from './db';
import { getIntegration } from './integrations';
import { seal } from './secret-box';
import { graphDate, graphRequest, microsoftAppBase, microsoftTokenRequest } from './microsoft';
import { checkedCalendars, getPersonCalendars } from './calendar-calendars';
import { guestEmails, type ExternalCalendar } from './google-calendar';

export const OUTLOOK_CALENDAR_PROVIDER = 'outlook_calendar';
export const OUTLOOK_CALENDAR_SCOPES = ['openid', 'email', 'offline_access', 'User.Read', 'Calendars.ReadWrite'];

export function outlookCalendarRedirectUri(): string {
  return `${microsoftAppBase()}/api/calendar/outlook/callback`;
}

interface Range {
  start: Date;
  end: Date;
}

async function validToken(row: IntegrationRow): Promise<string | null> {
  if (row.access_token && row.expires_at > Date.now() + 60_000) return row.access_token;
  if (!row.refresh_token) return null;
  const tok = await microsoftTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    scope: OUTLOOK_CALENDAR_SCOPES.join(' '),
  });
  if (!tok.access_token) return null;
  await getDb()
    .prepare(
      `UPDATE integrations SET access_token = ?, expires_at = ?,
         refresh_token = CASE WHEN ? = '' THEN refresh_token ELSE ? END, updated_at = datetime('now')
       WHERE user_id = ? AND provider = ?`,
    )
    .run(
      seal(tok.access_token),
      Date.now() + (tok.expires_in ?? 3600) * 1000,
      tok.refresh_token ?? '',
      tok.refresh_token ? seal(tok.refresh_token) : '',
      row.user_id,
      OUTLOOK_CALENDAR_PROVIDER,
    );
  return tok.access_token;
}

async function tokenFor(userId: string): Promise<string | null> {
  const row = await getIntegration(userId, OUTLOOK_CALENDAR_PROVIDER);
  return row ? validToken(row) : null;
}

export async function outlookCalendarConnected(userId: string): Promise<boolean> {
  return !!(await getIntegration(userId, OUTLOOK_CALENDAR_PROVIDER));
}

/** Calendarios de la persona; null si Microsoft no responde. */
export async function listOutlookCalendars(userId: string): Promise<ExternalCalendar[] | null> {
  const token = await tokenFor(userId);
  if (!token) return null;
  try {
    const data = await graphRequest<{ value?: Array<{ id: string; name?: string; isDefaultCalendar?: boolean; canEdit?: boolean }> }>(
      token,
      '/me/calendars?$select=id,name,isDefaultCalendar,canEdit&$top=100',
    );
    return (data.value ?? []).map((c) => ({
      id: c.id,
      name: c.name || c.id,
      primary: c.isDefaultCalendar === true,
      canWrite: c.canEdit !== false,
    }));
  } catch {
    return null;
  }
}

// ---------- Ocupado ----------

const busyCache = new Map<string, { at: number; ranges: Range[] }>();
const BUSY_TTL_MS = 60_000;

/** Mes (UTC) que contiene `from` con 2 días de margen, igual que Google: una consulta por mes. */
function monthWindow(from: Date, to: Date): { from: Date; to: Date } {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1) - 2 * 86_400_000);
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) + 2 * 86_400_000);
  return to <= end ? { from: start, to: end } : { from, to };
}

interface ViewEvent {
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  showAs?: string;
  isCancelled?: boolean;
}

/** Rangos ocupados de los calendarios elegidos (cache 60s por mes). '' = el principal. */
export async function outlookBusyRanges(userId: string, from: Date, to: Date): Promise<Range[]> {
  const win = monthWindow(from, to);
  const key = `${userId}:${win.from.toISOString()}:${win.to.toISOString()}`;
  const hit = busyCache.get(key);
  let ranges = hit && Date.now() - hit.at < BUSY_TTL_MS ? hit.ranges : null;
  if (!ranges) {
    const token = await tokenFor(userId);
    if (!token) return [];
    const calendars = checkedCalendars(await getPersonCalendars(userId), 'outlook');
    const qs = new URLSearchParams({
      startDateTime: win.from.toISOString(),
      endDateTime: win.to.toISOString(),
      $select: 'start,end,showAs,isCancelled',
      $top: '500',
    }).toString();
    const all: Range[] = [];
    for (const cal of calendars) {
      const path = cal ? `/me/calendars/${encodeURIComponent(cal)}/calendarView?${qs}` : `/me/calendarView?${qs}`;
      const data = await graphRequest<{ value?: ViewEvent[] }>(token, path).catch(() => null);
      for (const e of data?.value ?? []) {
        if (e.isCancelled || e.showAs === 'free') continue;
        const start = graphDate(e.start);
        const end = graphDate(e.end);
        if (start && end) all.push({ start, end });
      }
    }
    ranges = all;
    busyCache.set(key, { at: Date.now(), ranges });
    if (busyCache.size > 500) busyCache.delete(busyCache.keys().next().value as string);
  }
  return ranges.filter((r) => r.start < to && r.end > from);
}

export function invalidateOutlookBusyCache(userId: string): void {
  for (const key of busyCache.keys()) if (key.startsWith(`${userId}:`)) busyCache.delete(key);
}

// ---------- Eventos ----------

function graphTime(iso: string): { dateTime: string; timeZone: string } {
  return { dateTime: iso.replace(/Z$/, ''), timeZone: 'UTC' };
}

/**
 * Crea el evento en el Outlook del host. `teams`: reunión de Teams generada
 * (el link vuelve en onlineMeeting.joinUrl y se guarda como ubicación de la
 * reserva). Devuelve el booking con outlook_event_id (y el link) guardados.
 */
export async function createOutlookEventForBooking(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
  opts: { calendarId?: string; teams?: boolean } = {},
): Promise<CalendarBookingRow> {
  const hostId = booking.host_user_id ?? eventType.user_id;
  const token = await tokenFor(hostId);
  if (!token) return booking;
  invalidateOutlookBusyCache(hostId);
  const body = {
    subject: `${eventType.title} — ${booking.invitee_name}`,
    body: { contentType: 'text', content: `Booked with zerosoft Cal.\n${booking.invitee_name} <${booking.invitee_email}>` },
    start: graphTime(booking.starts_at),
    end: graphTime(booking.ends_at),
    attendees: [
      { type: 'required', emailAddress: { address: booking.invitee_email, name: booking.invitee_name } },
      ...guestEmails(booking.guests).map((address) => ({ type: 'optional', emailAddress: { address } })),
    ],
    ...(booking.location && !opts.teams ? { location: { displayName: booking.location } } : {}),
    ...(opts.teams ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
    showAs: 'busy',
  };
  const path = opts.calendarId ? `/me/calendars/${encodeURIComponent(opts.calendarId)}/events` : '/me/events';
  const ev = await graphRequest<{ id?: string; onlineMeeting?: { joinUrl?: string } | null }>(token, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!ev?.id) return booking;
  const joinUrl = opts.teams ? (ev.onlineMeeting?.joinUrl ?? null) : null;
  await getDb()
    .prepare(
      `UPDATE calendar_bookings SET outlook_event_id = ?, meeting_url = COALESCE(?, meeting_url),
         location = CASE WHEN ? IS NOT NULL THEN ? ELSE location END WHERE id = ?`,
    )
    .run(ev.id, joinUrl, joinUrl, joinUrl, booking.id);
  return {
    ...booking,
    outlook_event_id: ev.id,
    meeting_url: joinUrl ?? booking.meeting_url,
    location: joinUrl ?? booking.location,
  };
}

/** Reprogramación: mueve el evento; si cambió el host, lo borra del anterior y lo crea en el nuevo. */
export async function syncOutlookEventTime(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
  previousHostId: string | null,
  opts: { calendarId?: string; teams?: boolean } = {},
): Promise<CalendarBookingRow> {
  const hostId = booking.host_user_id ?? eventType.user_id;
  if (booking.outlook_event_id && previousHostId && previousHostId !== hostId) {
    await deleteOutlookEventForBooking({ ...booking, host_user_id: previousHostId }, eventType);
    return createOutlookEventForBooking({ ...booking, outlook_event_id: null }, eventType, opts);
  }
  if (!booking.outlook_event_id) return booking;
  const token = await tokenFor(hostId);
  if (!token) return booking;
  invalidateOutlookBusyCache(hostId);
  await graphRequest(token, `/me/events/${encodeURIComponent(booking.outlook_event_id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start: graphTime(booking.starts_at), end: graphTime(booking.ends_at) }),
  }).catch(() => null);
  return booking;
}

export async function deleteOutlookEventForBooking(booking: CalendarBookingRow, eventType: CalendarEventTypeRow): Promise<void> {
  if (!booking.outlook_event_id) return;
  const hostId = booking.host_user_id ?? eventType.user_id;
  const token = await tokenFor(hostId);
  if (!token) return;
  invalidateOutlookBusyCache(hostId);
  await graphRequest(token, `/me/events/${encodeURIComponent(booking.outlook_event_id)}`, { method: 'DELETE' }).catch(() => null);
}
