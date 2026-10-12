import { describe, expect, it } from 'vitest';
import {
  createBlockedSlot,
  createBooking,
  createEventType,
  getAvailableDays,
  getAvailableSlots,
  getBookingByManageToken,
  getOrCreateCalendarUser,
  rescheduleBooking,
  setAvailability,
  setEventHosts,
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

describe('Cal: ocupación por persona, round-robin y carreras', () => {
  it('una reserva en un event type bloquea la misma hora en otro del mismo host', async () => {
    const { user, et } = await setup();
    const other = await createEventType(user.id, { slug: `o-${crypto.randomUUID().slice(0, 6)}`, title: 'Otro', durationMin: 30, active: true } as Parameters<typeof createEventType>[1]);
    await setAvailability(other.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    const day = nextMonday();
    await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:30:00.000Z` });
    const slots = await getAvailableSlots(other.id, 'UTC', day);
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).not.toContain('09:30');
  });

  it('dos reservas simultáneas del mismo slot: solo una gana', async () => {
    const { et } = await setup();
    const day = nextMonday();
    const start = `${day}T10:00:00.000Z`;
    const results = await Promise.allSettled([
      createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start }),
      createBooking({ eventTypeId: et.id, email: 'b@x.com', name: 'B', start }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('round-robin: con un host ocupado asigna al otro, y el slot sigue disponible', async () => {
    const { user, et } = await setup();
    const h2 = await makeUser('host2');
    await setEventHosts(et.id, [user.id, h2.id]);
    const day = nextMonday();
    const start = `${day}T09:00:00.000Z`;
    const first = await createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start });
    const slots = await getAvailableSlots(et.id, 'UTC', day);
    expect(slots.map((s) => s.start.toISOString())).toContain(start);
    const second = await createBooking({ eventTypeId: et.id, email: 'b@x.com', name: 'B', start });
    expect(second.host_user_id).not.toBe(first.host_user_id);
    const after = await getAvailableSlots(et.id, 'UTC', day);
    expect(after.map((s) => s.start.toISOString())).not.toContain(start);
  });

  it('reprogramar mueve la reserva y libera el horario viejo', async () => {
    const { et } = await setup();
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    expect(b.manage_token).toHaveLength(40);
    const moved = await rescheduleBooking(b.id, new Date(`${day}T10:30:00.000Z`));
    expect(moved.starts_at).toBe(`${day}T10:30:00.000Z`);
    expect(moved.rescheduled_from).toBe(`${day}T09:00:00.000Z`);
    const slots = (await getAvailableSlots(et.id, 'UTC', day)).map((s) => s.start.toISOString().slice(11, 16));
    expect(slots).toContain('09:00');
    expect(slots).not.toContain('10:30');
    expect((await getBookingByManageToken(b.manage_token!))?.id).toBe(b.id);
  });
});

describe('Cal: días disponibles del mes', () => {
  it('solo devuelve días con reglas y lugar (lunes en este setup)', async () => {
    const { et } = await setup();
    const monday = nextMonday();
    const days = await getAvailableDays(et.id, 'UTC', monday.slice(0, 7));
    expect(days).toContain(monday);
    for (const d of days) expect(new Date(`${d}T12:00:00Z`).getUTCDay()).toBe(1);
  });
});
