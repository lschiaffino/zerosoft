/**
 * Google Calendar falso para tests y demo de Cal: un `fetch` que imita lo que
 * usa lib/google-calendar.ts (calendarList, freeBusy, events) con calendarios
 * en memoria, más el OAuth (el "consentimiento" vuelve directo al callback).
 * Solo con CAL_GOOGLE_FAKE=1 y además NODE_ENV=test o DEMO_MODE=true (mismo
 * patrón que MS_GRAPH_FAKE). En producción nunca.
 *
 * Calendarios: el principal (vacío), "Team" (un evento ocupado mañana de 13 a
 * 14 UTC) y "Holidays" (solo lectura).
 *
 * Para Voice, la lista de eventos del principal (GET /calendars/primary/events)
 * suma una invitación de otra persona que no bloquea horarios
 * (transparency: transparent, como un evento "disponible"): "Pricing review"
 * con Ana, que siempre empieza 4 minutos después del pedido. No está en
 * freeBusy, así que no cambia los horarios de Cal.
 */
export const FAKE_GOOGLE_VOICE_EVENT_ID = 'fake-gcal-voice-1';
export const FAKE_GOOGLE_VOICE_GUEST = 'ana@fake-guest.test';

export const FAKE_GOOGLE_EMAIL = 'demo.google@fake-google.test';
export const FAKE_GOOGLE_TEAM_CALENDAR = 'team@group.fake-google.test';
export const FAKE_GOOGLE_HOLIDAYS_CALENDAR = 'holidays@group.fake-google.test';
const API = 'https://www.googleapis.com/calendar/v3';

export function fakeGoogleCalendarAllowed(): boolean {
  if (process.env.CAL_GOOGLE_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

interface FakeEvent {
  id: string;
  calendarId: string;
  start: string;
  end: string;
  summary: string;
  hangoutLink?: string;
  attendees?: Array<{ email: string; displayName?: string; self?: boolean; responseStatus?: string }>;
}

function voiceDemoEvent(): FakeEvent {
  const start = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 4 * 60_000);
  return {
    id: FAKE_GOOGLE_VOICE_EVENT_ID,
    calendarId: FAKE_GOOGLE_EMAIL,
    start: start.toISOString(),
    end: new Date(start.getTime() + 30 * 60_000).toISOString(),
    summary: 'Pricing review',
    hangoutLink: 'https://meet.google.com/fak-voic-xyz',
    attendees: [
      { email: FAKE_GOOGLE_EMAIL, self: true, responseStatus: 'accepted' },
      { email: FAKE_GOOGLE_VOICE_GUEST, displayName: 'Ana Guest', responseStatus: 'accepted' },
    ],
  };
}

const g = globalThis as unknown as { __zsFakeGcal?: { seq: number; events: FakeEvent[] } };

function state(): { seq: number; events: FakeEvent[] } {
  if (!g.__zsFakeGcal) {
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(13, 0, 0, 0);
    g.__zsFakeGcal = {
      seq: 0,
      events: [
        {
          id: 'fake-gcal-team-1',
          calendarId: FAKE_GOOGLE_TEAM_CALENDAR,
          start: tomorrow.toISOString(),
          end: new Date(tomorrow.getTime() + 3_600_000).toISOString(),
          summary: 'Team sync',
        },
      ],
    };
  }
  return g.__zsFakeGcal;
}

/** Eventos que Cal creó en el Google falso (para tests). */
export function fakeGoogleEvents(): FakeEvent[] {
  return state().events;
}

export function fakeGoogleTokens(): { access_token: string; refresh_token: string; expires_in: number; scope: string } {
  return {
    access_token: `fake-gcal-access-${Date.now()}`,
    refresh_token: 'fake-gcal-refresh',
    expires_in: 3600,
    scope:
      'openid email https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export async function fakeGoogleFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const auth = new Headers(init.headers).get('authorization') ?? '';
  if (!auth.startsWith('Bearer fake-gcal-access')) return json({ error: { code: 401 } }, 401);
  if (!url.href.startsWith(API)) return json({ error: { code: 404 } }, 404);
  const s = state();
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.pathname.replace('/calendar/v3', '');

  if (path === '/users/me/calendarList') {
    return json({
      items: [
        { id: FAKE_GOOGLE_EMAIL, summary: FAKE_GOOGLE_EMAIL, primary: true, accessRole: 'owner' },
        { id: FAKE_GOOGLE_TEAM_CALENDAR, summary: 'Team', accessRole: 'writer' },
        { id: FAKE_GOOGLE_HOLIDAYS_CALENDAR, summary: 'Holidays', accessRole: 'reader' },
      ],
    });
  }
  if (path === '/freeBusy' && method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as { timeMin: string; timeMax: string; items: Array<{ id: string }> };
    const from = Date.parse(body.timeMin);
    const to = Date.parse(body.timeMax);
    const calendars: Record<string, { busy: Array<{ start: string; end: string }> }> = {};
    for (const item of body.items ?? []) {
      const id = item.id === 'primary' ? FAKE_GOOGLE_EMAIL : item.id;
      calendars[item.id] = {
        busy: s.events
          .filter((e) => e.calendarId === id && Date.parse(e.start) < to && Date.parse(e.end) > from)
          .map((e) => ({ start: e.start, end: e.end })),
      };
    }
    return json({ calendars });
  }
  const create = /^\/calendars\/([^/]+)\/events$/.exec(path);
  if (create && method === 'GET') {
    const calendarId = decodeURIComponent(create[1]) === 'primary' ? FAKE_GOOGLE_EMAIL : decodeURIComponent(create[1]);
    const from = Date.parse(url.searchParams.get('timeMin') ?? '');
    const to = Date.parse(url.searchParams.get('timeMax') ?? '');
    const list = [...s.events, ...(calendarId === FAKE_GOOGLE_EMAIL ? [voiceDemoEvent()] : [])]
      .filter((e) => e.calendarId === calendarId && Date.parse(e.start) < to && Date.parse(e.end) > from)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return json({
      items: list.map((e) => ({
        id: e.id,
        status: 'confirmed',
        summary: e.summary,
        start: { dateTime: e.start },
        end: { dateTime: e.end },
        ...(e.hangoutLink ? { hangoutLink: e.hangoutLink } : {}),
        ...(e.attendees ? { attendees: e.attendees } : {}),
      })),
    });
  }
  if (create && method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as {
      summary?: string;
      start?: { dateTime: string };
      end?: { dateTime: string };
      conferenceData?: unknown;
    };
    s.seq += 1;
    const calendarId = decodeURIComponent(create[1]) === 'primary' ? FAKE_GOOGLE_EMAIL : decodeURIComponent(create[1]);
    const ev: FakeEvent = {
      id: `fake-gcal-event-${s.seq}`,
      calendarId,
      start: body.start?.dateTime ?? '',
      end: body.end?.dateTime ?? '',
      summary: body.summary ?? '',
      ...(body.conferenceData ? { hangoutLink: `https://meet.google.com/fak-${String(s.seq).padStart(4, '0')}-xyz` } : {}),
    };
    s.events.push(ev);
    return json(ev);
  }
  const one = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(path);
  if (one) {
    const i = s.events.findIndex((e) => e.id === decodeURIComponent(one[2]));
    if (i < 0) return json({ error: { code: 404 } }, 404);
    if (method === 'DELETE') {
      s.events.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') {
      const body = JSON.parse(String(init.body ?? '{}')) as { start?: { dateTime: string }; end?: { dateTime: string } };
      if (body.start) s.events[i].start = body.start.dateTime;
      if (body.end) s.events[i].end = body.end.dateTime;
      return json(s.events[i]);
    }
  }
  return json({ error: { code: 404, path } }, 404);
}
