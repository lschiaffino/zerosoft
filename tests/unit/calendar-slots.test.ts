import { describe, expect, it } from 'vitest';
import {
  createBlockedSlot,
  createBooking,
  createEventType,
  getAvailableSlots,
  getOrCreateCalendarUser,
  setAvailability,
} from '@/lib/calendar';
import { makeUser } from './helpers';

/** Una fecha (YYYY-MM-DD, UTC) N días en el futuro que cae en lunes. */
function nextMonday(minDaysAhead = 2): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setup() {
  const user = await makeUser('cal');
  await getOrCreateCalendarUser(user.id); // timezone UTC por defecto
  const et = await createEventType(user.id, {
    slug: `t-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Test',
    durationMin: 30,
    active: true,
  } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
  return { user, et };
}

describe('Cal: motor de disponibilidad', () => {
  it('genera slots de 30 min dentro de la disponibilidad', async () => {
    const { et } = await setup();
    const day = nextMonday();
    const slots = await getAvailableSlots(et.id, 'UTC', day);
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });

  it('un día sin reglas no tiene slots', async () => {
    const { et } = await setup();
    const monday = nextMonday();
    const tuesday = new Date(`${monday}T00:00:00Z`);
    tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    expect(await getAvailableSlots(et.id, 'UTC', tuesday.toISOString().slice(0, 10))).toEqual([]);
  });

  it('excluye bookings confirmados y bloqueos', async () => {
    const { user, et } = await setup();
    const day = nextMonday();
    await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    await createBlockedSlot(user.id, { startsAt: `${day}T10:00:00.000Z`, endsAt: `${day}T10:30:00.000Z` } as Parameters<typeof createBlockedSlot>[1]);
    const slots = await getAvailableSlots(et.id, 'UTC', day);
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual(['09:30', '10:30']);
  });

  it('respeta la zona horaria del invitado', async () => {
    const { et } = await setup();
    const day = nextMonday();
    // 09:00 UTC = 06:00 en Buenos Aires: el mismo día local tiene los mismos 4 slots.
    const slots = await getAvailableSlots(et.id, 'America/Argentina/Buenos_Aires', day);
    expect(slots).toHaveLength(4);
    expect(slots[0].start.toISOString()).toBe(`${day}T09:00:00.000Z`);
  });
});
