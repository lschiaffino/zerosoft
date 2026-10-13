import { afterEach, describe, expect, it, vi } from 'vitest';
import { upsertIntegration } from '@/lib/integrations';
import {
  createBooking,
  createEventType,
  getAvailableSlots,
  getOrCreateCalendarUser,
  setAvailability,
} from '@/lib/calendar';
import { createGoogleEventForBooking, GOOGLE_CALENDAR_PROVIDER, wantsGoogleMeet } from '@/lib/google-calendar';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { makeUser } from './helpers';

function nextMonday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function connectedHost() {
  const user = await makeUser('gcal');
  await getOrCreateCalendarUser(user.id);
  await upsertIntegration({
    userId: user.id, provider: GOOGLE_CALENDAR_PROVIDER, email: 'h@gmail.com',
    accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, scope: 'calendar.events calendar.freebusy',
  });
  const et = await createEventType(user.id, { slug: `g-${crypto.randomUUID().slice(0, 6)}`, title: 'Intro', durationMin: 30, active: true, location: '' } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
  return { user, et };
}

describe('Google Calendar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Meet se genera cuando no hay otra ubicación', () => {
    expect(wantsGoogleMeet('')).toBe(true);
    expect(wantsGoogleMeet('https://meet.google.com/new')).toBe(true);
    expect(wantsGoogleMeet('https://zoom.us/j/1')).toBe(false);
  });

  it('los eventos de Google bloquean slots', async () => {
    const { et } = await connectedHost();
    const day = nextMonday();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/freeBusy')) {
        return new Response(JSON.stringify({ calendars: { primary: { busy: [{ start: `${day}T09:30:00Z`, end: `${day}T10:30:00Z` }] } } }));
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const slots = (await getAvailableSlots(et.id, 'UTC', day)).map((s) => s.start.toISOString().slice(11, 16));
    expect(slots).toEqual(['09:00', '10:30']);
  });

  it('si Google falla, la agenda sigue funcionando', async () => {
    const { et } = await connectedHost();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    expect(await getAvailableSlots(et.id, 'UTC', nextMonday())).toHaveLength(4);
  });

  it('crea el evento con Meet y guarda id + link', async () => {
    const { et } = await connectedHost();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/events')) {
        const body = JSON.parse(String(init?.body));
        expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
        expect(String(url)).toContain('sendUpdates=none');
        return new Response(JSON.stringify({ id: 'gev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }));
      }
      return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }));
    }));
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${nextMonday()}T09:00:00.000Z` });
    const synced = await createGoogleEventForBooking(booking, et);
    expect(synced.meeting_url).toBe('https://meet.google.com/abc-defg-hij');
    const row = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(booking.id)) as CalendarBookingRow;
    expect(row.google_event_id).toBe('gev1');
  });
});
