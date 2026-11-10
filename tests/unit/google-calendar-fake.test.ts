import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_GOOGLE_TEAM_CALENDAR, fakeGoogleFetch } from '@/lib/google-calendar-fake';

const AUTH = { authorization: 'Bearer fake-gcal-access-1' };

async function busy(timeMin: string, timeMax: string) {
  const res = await fakeGoogleFetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: FAKE_GOOGLE_TEAM_CALENDAR }] }),
  });
  const data = (await res.json()) as { calendars: Record<string, { busy: Array<{ start: string }> }> };
  return data.calendars[FAKE_GOOGLE_TEAM_CALENDAR].busy.map((b) => b.start);
}

describe('Google Calendar falso', () => {
  afterEach(() => vi.useRealTimers());

  it('el "Team sync" queda mañana (UTC) aunque el proceso haya arrancado el día anterior', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T23:59:00Z'));
    expect(await busy('2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z')).toEqual(['2026-11-10T13:00:00.000Z']);
    // Pasada la medianoche UTC, mañana es otro día y el evento se mueve con él.
    vi.setSystemTime(new Date('2026-11-10T00:01:00Z'));
    expect(await busy('2026-11-11T00:00:00Z', '2026-11-12T00:00:00Z')).toEqual(['2026-11-11T13:00:00.000Z']);
    expect(await busy('2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z')).toEqual([]);
  });
});
