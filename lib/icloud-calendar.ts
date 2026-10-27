/**
 * Calendario de iCloud para Cal, por persona, por CalDAV (lo mismo que hace
 * Calendly): Apple ID + contraseña de app (appleid.apple.com › Inicio de
 * sesión y seguridad › Contraseñas de apps). La contraseña se guarda cifrada
 * en `integrations` (provider icloud_calendar, vía lib/secret-box) y nunca
 * vuelve a la UI.
 *
 * - Descubrimiento: PROPFIND current-user-principal → calendar-home-set →
 *   calendarios con VEVENT.
 * - Ocupado: REPORT calendar-query con time-range y <C:expand> (el servidor
 *   expande las repeticiones) en los calendarios elegidos.
 * - Eventos: PUT <calendario>/<uid>.ics al reservar, PUT de nuevo al
 *   reprogramar y DELETE al cancelar.
 *
 * Con CAL_ICLOUD_FAKE=1 (y NODE_ENV=test o DEMO_MODE=true) va contra un
 * servidor en memoria: nada sale a Apple. Best-effort como Google y Outlook.
 * Server-only.
 */
import { getDb, type CalendarBookingRow, type CalendarEventTypeRow } from './db';
import { getIntegration, upsertIntegration } from './integrations';
import { safeFetch } from './safe-fetch';
import { checkedCalendars, getPersonCalendars } from './calendar-calendars';
import { guestEmails, type ExternalCalendar } from './google-calendar';

export const ICLOUD_CALENDAR_PROVIDER = 'icloud_calendar';
const ICLOUD_BASE = 'https://caldav.icloud.com';

interface Range {
  start: Date;
  end: Date;
}

export function fakeICloudAllowed(): boolean {
  if (process.env.CAL_ICLOUD_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

export class ICloudError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

// ---------- Servidor falso (tests y demo) ----------

const FAKE_HOME = '/fake-home/calendars/';
export const FAKE_ICLOUD_HOME_CAL = `${FAKE_HOME}home/`;
export const FAKE_ICLOUD_WORK_CAL = `${FAKE_HOME}work/`;
const gFake = globalThis as unknown as { __zsFakeICloud?: { events: Array<{ href: string; ics: string }> } };

function fakeState() {
  if (!gFake.__zsFakeICloud) {
    const t = new Date(Date.now() + 86_400_000);
    t.setUTCHours(11, 0, 0, 0);
    const end = new Date(t.getTime() + 3_600_000);
    gFake.__zsFakeICloud = {
      events: [{ href: `${FAKE_ICLOUD_WORK_CAL}fake-1.ics`, ics: icsEvent({ uid: 'fake-1', start: t, end, summary: 'Dentist' }) }],
    };
  }
  return gFake.__zsFakeICloud;
}

/** Eventos del iCloud falso (para tests). */
export function fakeICloudEvents(): Array<{ href: string; ics: string }> {
  return fakeState().events;
}

function xml(body: string, status = 207): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/xml; charset=utf-8' } });
}

async function fakeDav(url: string, init: RequestInit): Promise<Response> {
  const auth = new Headers(init.headers).get('authorization') ?? '';
  const [user, pass] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':');
  if (!user?.includes('@') || !/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(pass ?? '')) return new Response('', { status: 401 });
  const u = new URL(url);
  const method = (init.method ?? 'GET').toUpperCase();
  const body = String(init.body ?? '');
  const s = fakeState();
  if (method === 'PROPFIND' && u.pathname === '/') {
    return xml(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/fake-principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`);
  }
  if (method === 'PROPFIND' && u.pathname === '/fake-principal/') {
    return xml(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/fake-principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>${ICLOUD_BASE}${FAKE_HOME}</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`);
  }
  if (method === 'PROPFIND' && u.pathname === FAKE_HOME) {
    const cal = (href: string, name: string) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:displayname>${name}</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`;
    return xml(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${FAKE_HOME}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>${cal(FAKE_ICLOUD_HOME_CAL, 'Home')}${cal(FAKE_ICLOUD_WORK_CAL, 'Work')}</d:multistatus>`);
  }
  if (method === 'REPORT') {
    const m = /time-range start="(\d{8}T\d{6}Z)" end="(\d{8}T\d{6}Z)"/.exec(body);
    const from = m ? parseIcsDate(m[1]) : null;
    const to = m ? parseIcsDate(m[2]) : null;
    const hits = s.events.filter((e) => {
      if (!e.href.startsWith(u.pathname)) return false;
      const r = icsRange(e.ics);
      return r && from && to && r.start < to && r.end > from;
    });
    return xml(
      `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${hits
        .map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><c:calendar-data>${e.ics}</c:calendar-data></d:prop></d:propstat></d:response>`)
        .join('')}</d:multistatus>`,
    );
  }
  if (method === 'PUT') {
    const i = s.events.findIndex((e) => e.href === u.pathname);
    if (i >= 0) s.events[i].ics = body;
    else s.events.push({ href: u.pathname, ics: body });
    return new Response('', { status: i >= 0 ? 204 : 201 });
  }
  if (method === 'DELETE') {
    const i = s.events.findIndex((e) => e.href === u.pathname);
    if (i >= 0) s.events.splice(i, 1);
    return new Response('', { status: i >= 0 ? 204 : 404 });
  }
  return new Response('', { status: 405 });
}

// ---------- ICS ----------

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function icsEvent(input: {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  attendees?: Array<{ email: string; name?: string }>;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//zerosoft//Cal//EN',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(input.start)}`,
    `DTEND:${icsStamp(input.end)}`,
    `SUMMARY:${icsText(input.summary)}`,
    ...(input.description ? [`DESCRIPTION:${icsText(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    ...(input.attendees ?? []).map((a) => `ATTENDEE;CN=${icsText(a.name ?? a.email)}:mailto:${a.email}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** Fecha de ICS: 20261028T100000Z (UTC), 20261028T100000 con TZID, o 20261028 (día entero). */
export function parseIcsDate(value: string, tzid?: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (z || !tzid) return new Date(utc);
  // Hora local en TZID → UTC: se corrige por la diferencia de esa zona en ese momento.
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return new Date(utc - (asUtc - utc));
  } catch {
    return new Date(utc);
  }
}

/** Inicio y fin del primer VEVENT (sin DTEND: una hora, o el día entero si es fecha). */
export function icsRange(ics: string): Range | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const field = (name: string) => {
    const m = new RegExp(`^${name}((?:;[^:\\r\\n]*)?):([^\\r\\n]+)`, 'm').exec(unfolded);
    if (!m) return null;
    const tz = /TZID=([^;:]+)/.exec(m[1])?.[1];
    return { value: m[2].trim(), tz, allDay: /VALUE=DATE(?!-)/.test(m[1]) || /^\d{8}$/.test(m[2].trim()) };
  };
  if (/^STATUS:CANCELLED/m.test(unfolded) || /^TRANSP:TRANSPARENT/m.test(unfolded)) return null;
  const s = field('DTSTART');
  if (!s) return null;
  const start = parseIcsDate(s.value, s.tz);
  if (!start) return null;
  const e = field('DTEND');
  const end = e ? parseIcsDate(e.value, e.tz) : new Date(start.getTime() + (s.allDay ? 86_400_000 : 3_600_000));
  return end && end > start ? { start, end } : null;
}

// ---------- CalDAV ----------

interface Creds {
  appleId: string;
  password: string;
  home: string;
}

async function dav(creds: Pick<Creds, 'appleId' | 'password'>, url: string, method: string, body = '', headers: Record<string, string> = {}): Promise<Response | null> {
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${creds.appleId}:${creds.password}`).toString('base64')}`,
      'content-type': method === 'PUT' ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8',
      ...headers,
    },
    ...(body ? { body } : {}),
  };
  // Solo se habla con iCloud: nunca se manda la contraseña a otra URL.
  if (!url.startsWith('https://') || !/\.icloud\.com$/.test(new URL(url).hostname)) return null;
  if (fakeICloudAllowed()) return fakeDav(url, init);
  return safeFetch(url, init, 10_000).catch(() => null);
}

function hrefs(xmlText: string, tag: string): string[] {
  const re = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>\\s*<(?:[a-z]+:)?href[^>]*>([^<]+)</`, 'gi');
  return [...xmlText.matchAll(re)].map((m) => m[1].trim());
}

function abs(href: string, base: string): string {
  return new URL(href, base).toString();
}

/** Descubre el calendar home del Apple ID (valida la contraseña de app de paso). */
export async function discoverICloud(appleId: string, password: string): Promise<string> {
  const creds = { appleId, password };
  const propfind = (props: string) =>
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`;
  const root = await dav(creds, `${ICLOUD_BASE}/`, 'PROPFIND', propfind('<d:current-user-principal/>'), { depth: '0' });
  if (!root || root.status === 401) throw new ICloudError('icloud_auth_failed');
  if (!root.ok) throw new ICloudError('icloud_error');
  const principal = hrefs(await root.text(), 'current-user-principal')[0];
  if (!principal) throw new ICloudError('icloud_error');
  const p = await dav(creds, abs(principal, `${ICLOUD_BASE}/`), 'PROPFIND', propfind('<c:calendar-home-set/>'), { depth: '0' });
  if (!p?.ok) throw new ICloudError('icloud_error');
  const home = hrefs(await p.text(), 'calendar-home-set')[0];
  if (!home) throw new ICloudError('icloud_error');
  return abs(home, `${ICLOUD_BASE}/`);
}

export async function connectICloud(personId: string, appleId: string, password: string): Promise<void> {
  const id = appleId.trim().toLowerCase();
  const pass = password.trim().replace(/\s+/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) || !/^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i.test(pass)) throw new ICloudError('invalid_input');
  const normalized = pass.toLowerCase().replace(/^(.{4})-?(.{4})-?(.{4})-?(.{4})$/, '$1-$2-$3-$4');
  const home = await discoverICloud(id, normalized);
  await upsertIntegration({
    userId: personId,
    provider: ICLOUD_CALENDAR_PROVIDER,
    email: id,
    accessToken: normalized,
    // El calendar home va en refresh_token (también cifrado); no vence.
    refreshToken: home,
    expiresAt: 0,
    scope: 'caldav',
  });
}

async function credsFor(personId: string): Promise<Creds | null> {
  const row = await getIntegration(personId, ICLOUD_CALENDAR_PROVIDER);
  if (!row?.access_token || !row.refresh_token) return null;
  return { appleId: row.email, password: row.access_token, home: row.refresh_token };
}

export async function icloudCalendarConnected(personId: string): Promise<boolean> {
  return !!(await getIntegration(personId, ICLOUD_CALENDAR_PROVIDER));
}

/** Calendarios con eventos de la persona; el primero cuenta como principal. */
export async function listICloudCalendars(personId: string): Promise<ExternalCalendar[] | null> {
  const creds = await credsFor(personId);
  if (!creds) return null;
  const res = await dav(
    creds,
    creds.home,
    'PROPFIND',
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
    { depth: '1' },
  );
  if (!res?.ok) return null;
  const text = await res.text();
  const out: ExternalCalendar[] = [];
  for (const block of text.split(/<\/(?:[a-z]+:)?response>/i)) {
    if (!/<(?:[a-z]+:)?calendar\s*\/>/i.test(block) || !/name="VEVENT"/i.test(block)) continue;
    const href = /<(?:[a-z]+:)?href[^>]*>([^<]+)</i.exec(block)?.[1]?.trim();
    if (!href) continue;
    const name = /<(?:[a-z]+:)?displayname[^>]*>([^<]*)</i.exec(block)?.[1]?.trim() || href;
    out.push({ id: abs(href, creds.home), name, primary: out.length === 0, canWrite: true });
  }
  return out;
}

const busyCache = new Map<string, { at: number; ranges: Range[] }>();
const BUSY_TTL_MS = 60_000;

export function invalidateICloudBusyCache(personId: string): void {
  for (const key of busyCache.keys()) if (key.startsWith(`${personId}:`)) busyCache.delete(key);
}

function monthWindow(from: Date, to: Date): { from: Date; to: Date } {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1) - 2 * 86_400_000);
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) + 2 * 86_400_000);
  return to <= end ? { from: start, to: end } : { from, to };
}

/** Ocupado de los calendarios elegidos (por defecto el primero), con las repeticiones expandidas. */
export async function icloudBusyRanges(personId: string, from: Date, to: Date): Promise<Range[]> {
  const win = monthWindow(from, to);
  const key = `${personId}:${win.from.toISOString()}:${win.to.toISOString()}`;
  const hit = busyCache.get(key);
  let ranges = hit && Date.now() - hit.at < BUSY_TTL_MS ? hit.ranges : null;
  if (!ranges) {
    const creds = await credsFor(personId);
    if (!creds) return [];
    let calendars = checkedCalendars(await getPersonCalendars(personId), 'icloud').filter(Boolean);
    if (calendars.length === 0) {
      const first = (await listICloudCalendars(personId))?.[0]?.id;
      calendars = first ? [first] : [];
    }
    const range = `start="${icsStamp(win.from)}" end="${icsStamp(win.to)}"`;
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const all: Range[] = [];
    for (const cal of calendars) {
      const res = await dav(creds, cal, 'REPORT', body, { depth: '1' });
      if (!res?.ok) continue;
      const text = await res.text();
      for (const m of text.matchAll(/<(?:[a-z]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?calendar-data>/gi)) {
        const ics = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        for (const ev of ics.split(/BEGIN:VEVENT/).slice(1)) {
          const r = icsRange(`BEGIN:VEVENT${ev}`);
          if (r) all.push(r);
        }
      }
    }
    ranges = all;
    busyCache.set(key, { at: Date.now(), ranges });
    if (busyCache.size > 500) busyCache.delete(busyCache.keys().next().value as string);
  }
  return ranges.filter((r) => r.start < to && r.end > from);
}

function eventIcs(booking: CalendarBookingRow, eventType: CalendarEventTypeRow): string {
  return icsEvent({
    uid: `${booking.id}@zerosoft.ai`,
    start: new Date(booking.starts_at),
    end: new Date(booking.ends_at),
    summary: `${eventType.title} - ${booking.invitee_name}`,
    description: `Booked with zerosoft Cal.\n${booking.invitee_name} <${booking.invitee_email}>${booking.meeting_url ? `\n${booking.meeting_url}` : ''}`,
    location: booking.location || booking.meeting_url || '',
    attendees: [{ email: booking.invitee_email, name: booking.invitee_name }, ...guestEmails(booking.guests).map((email) => ({ email }))],
  });
}

/** Crea el evento en el iCloud del host (en `calendarId` o el primero). */
export async function createICloudEventForBooking(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
  calendarId = '',
): Promise<CalendarBookingRow> {
  const hostId = booking.host_user_id ?? eventType.user_id;
  const creds = await credsFor(hostId);
  if (!creds) return booking;
  const cal = calendarId || (await listICloudCalendars(hostId))?.[0]?.id;
  if (!cal) return booking;
  const url = abs(`${booking.id}.ics`, cal.endsWith('/') ? cal : `${cal}/`);
  const res = await dav(creds, url, 'PUT', eventIcs(booking, eventType));
  if (!res || res.status >= 300) return booking;
  invalidateICloudBusyCache(hostId);
  await getDb().prepare('UPDATE calendar_bookings SET icloud_event_url = ? WHERE id = ?').run(url, booking.id);
  return { ...booking, icloud_event_url: url };
}

export async function syncICloudEventTime(
  booking: CalendarBookingRow,
  eventType: CalendarEventTypeRow,
  previousHostId: string | null,
  calendarId = '',
): Promise<CalendarBookingRow> {
  const hostId = booking.host_user_id ?? eventType.user_id;
  if (booking.icloud_event_url && previousHostId && previousHostId !== hostId) {
    await deleteICloudEventForBooking({ ...booking, host_user_id: previousHostId }, eventType);
    return createICloudEventForBooking({ ...booking, icloud_event_url: null }, eventType, calendarId);
  }
  if (!booking.icloud_event_url) return createICloudEventForBooking(booking, eventType, calendarId);
  const creds = await credsFor(hostId);
  if (!creds) return booking;
  await dav(creds, booking.icloud_event_url, 'PUT', eventIcs(booking, eventType));
  invalidateICloudBusyCache(hostId);
  return booking;
}

export async function deleteICloudEventForBooking(booking: CalendarBookingRow, eventType: CalendarEventTypeRow): Promise<void> {
  if (!booking.icloud_event_url) return;
  const hostId = booking.host_user_id ?? eventType.user_id;
  const creds = await credsFor(hostId);
  if (!creds) return;
  await dav(creds, booking.icloud_event_url, 'DELETE');
  invalidateICloudBusyCache(hostId);
}
