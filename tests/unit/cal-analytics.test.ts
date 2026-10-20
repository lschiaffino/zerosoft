import { describe, expect, it } from 'vitest';
import { computeBookingAnalytics, loadAnalyticsRows, parseAnalyticsRange, type AnalyticsBookingRow } from '@/lib/calendar-analytics';
import { createBooking, createEventType, getOrCreateCalendarUser, setAvailability, updateBooking } from '@/lib/calendar';
import { makeUser } from './helpers';

function row(over: Partial<AnalyticsBookingRow>): AnalyticsBookingRow {
  return {
    created_at: '2030-03-04 12:00:00',
    starts_at: '2030-03-11T15:00:00.000Z',
    status: 'confirmed',
    payment_status: 'none',
    event_type_id: 'a',
    event_type_title: 'Intro',
    ...over,
  };
}

describe('Cal: analítica de reservas', () => {
  it('cuenta creadas, canceladas, no-shows y horarios populares en la zona del workspace', () => {
    const rows = [
      row({}),
      row({ created_at: '2030-03-04 23:30:00', starts_at: '2030-03-11T15:30:00.000Z' }),
      row({ status: 'cancelled', event_type_id: 'b', event_type_title: 'Demo' }),
      row({ status: 'no_show', created_at: '2030-03-05 10:00:00' }),
      row({ status: 'pending' }),
      // Hold de pago vencido: no cuenta.
      row({ status: 'cancelled', payment_status: 'expired' }),
    ];
    const a = computeBookingAnalytics(rows, { fromDate: '2030-03-04', toDate: '2030-03-06', timezone: 'America/Argentina/Buenos_Aires' });
    expect(a.created).toBe(5);
    expect(a.cancelled).toBe(1);
    expect(a.noShow).toBe(1);
    expect(a.pending).toBe(1);
    expect(a.confirmed).toBe(2);
    expect(a.cancelRate).toBeCloseTo(0.2);
    // 23:30 UTC del 4 es el 4 a la noche en Buenos Aires (UTC-3): igual día 4.
    expect(a.byDay).toEqual([
      { date: '2030-03-04', count: 4 },
      { date: '2030-03-05', count: 1 },
      { date: '2030-03-06', count: 0 },
    ]);
    // 15:00 UTC un lunes = 12:00 en Buenos Aires.
    expect(a.heatmap[1][12]).toBe(3);
    expect(a.topSlots[0]).toEqual({ dow: 1, hour: 12, count: 3 });
    expect(a.byEventType.map((e) => [e.title, e.created])).toEqual([
      ['Intro', 4],
      ['Demo', 1],
    ]);
    expect(computeBookingAnalytics([], { fromDate: '2030-03-04', toDate: '2030-03-04', timezone: 'UTC' }).cancelRate).toBeNull();
  });

  it('rango: 30 días por defecto, sin futuro y hasta un año', () => {
    expect(parseAnalyticsRange(undefined, undefined, '2030-03-31')).toEqual({ fromDate: '2030-03-02', toDate: '2030-03-31' });
    expect(parseAnalyticsRange('2030-04-01', '2030-05-01', '2030-03-31')).toEqual({ fromDate: '2030-03-31', toDate: '2030-03-31' });
    expect(parseAnalyticsRange('2020-01-01', '2030-03-31', '2030-03-31').fromDate).toBe('2029-03-31');
    expect(parseAnalyticsRange('nope', 'x', '2030-03-31').toDate).toBe('2030-03-31');
  });

  it('carga solo las reservas del workspace creadas en el rango', async () => {
    const user = await makeUser('an');
    await getOrCreateCalendarUser(user.id);
    const et = await createEventType(user.id, { slug: `an-${crypto.randomUUID().slice(0, 6)}`, title: 'Intro', durationMin: 30, active: true } as Parameters<
      typeof createEventType
    >[1]);
    await setAvailability(et.id, { rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '12:00' })) });
    const d = new Date(Date.now() + 5 * 86_400_000);
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    const b1 = await createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:00:00.000Z` });
    await createBooking({ eventTypeId: et.id, email: 'b@x.com', name: 'B', start: `${day}T10:00:00.000Z` });
    await updateBooking(b1.id, { status: 'cancelled' });
    const rows = await loadAnalyticsRows(user.id, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    expect(rows).toHaveLength(2);
    const other = await makeUser('an2');
    expect(await loadAnalyticsRows(other.id, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000))).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    const a = computeBookingAnalytics(rows, { fromDate: today, toDate: today, timezone: 'UTC' });
    expect(a.created).toBe(2);
    expect(a.cancelled).toBe(1);
  });
});
