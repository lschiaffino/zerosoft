import { describe, expect, it } from 'vitest';
import {
  countBookingsThisWeek,
  createBlockedSlot,
  createBooking,
  createEventType,
  effectiveMaxFutureDays,
  getAvailableDays,
  getAvailableSlots,
  getBookingByManageToken,
  getOrCreateCalendarUser,
  listEventHosts,
  registerBusyProvider,
  rescheduleBooking,
  setAvailability,
  setEventHosts,
  updateEventType,
} from '@/lib/calendar';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

/** Llamadas a calendarios externos por usuario (para contar round-trips del motor). */
const externalCalls = new Map<string, number>();
registerBusyProvider(async (userId) => {
  externalCalls.set(userId, (externalCalls.get(userId) ?? 0) + 1);
  return [];
});

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

describe('Cal: días del mes en una sola carga', () => {
  it('consulta la ocupación una vez por host y coincide con los slots de cada día', async () => {
    const { user, et } = await setup();
    const h2 = await makeUser('host-m');
    await setEventHosts(et.id, [user.id, h2.id]);
    const monday = nextMonday();
    await createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${monday}T09:00:00.000Z` });
    const month = monday.slice(0, 7);
    externalCalls.clear();
    const days = await getAvailableDays(et.id, 'UTC', month);
    expect(externalCalls.get(user.id)).toBe(1);
    expect(externalCalls.get(h2.id)).toBe(1);

    const [y, m] = month.split('-').map(Number);
    const expected: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      if (date >= today && (await getAvailableSlots(et.id, 'UTC', date)).length > 0) expected.push(date);
    }
    expect(days).toEqual(expected);
  });
});

describe('Cal: máximo de días para reservar', () => {
  it('sin regla propia del evento usa el ajuste del workspace', async () => {
    const { user, et } = await setup();
    const calUser = await getOrCreateCalendarUser(user.id);
    expect(effectiveMaxFutureDays(et, { ...calUser, max_booking_days: 90 })).toBe(90);
    expect(effectiveMaxFutureDays({ ...et, bookingRulesParsed: { maxFutureDays: 7 } }, { ...calUser, max_booking_days: 90 })).toBe(7);
    expect(effectiveMaxFutureDays(et, undefined)).toBe(30);
  });
});

describe('Cal: reservas de esta semana', () => {
  it('cuenta también las del domingo', async () => {
    const { user, et } = await setup();
    const now = new Date();
    const sunday = new Date(now);
    sunday.setUTCDate(now.getUTCDate() + ((7 - now.getUTCDay()) % 7));
    sunday.setUTCHours(15, 0, 0, 0);
    const before = await countBookingsThisWeek(user.id);
    await getDb()
      .prepare(
        `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id)
         VALUES (?, ?, 's@x.com', 'S', ?, ?, 'confirmed', ?)`,
      )
      .run(crypto.randomUUID(), et.id, sunday.toISOString(), new Date(sunday.getTime() + 1_800_000).toISOString(), user.id);
    expect(await countBookingsThisWeek(user.id)).toBe(before + 1);
  });
});

describe('Cal: team y hosts del tipo de evento', () => {
  it('solo acepta el team del workspace y hosts que sean miembros', async () => {
    const owner = await makeUser('own');
    const team = await createTeam(owner.id, 'Ventas');
    const member = await makeUser('mem');
    await addMember(team.id, member.id);
    const stranger = await makeUser('ajeno');
    const foreignTeam = await createTeam(stranger.id, 'Otro');
    await getOrCreateCalendarUser(owner.id);

    const reject = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    await reject(createEventType(owner.id, { slug: 'x1', title: 'X', durationMin: 30, teamId: foreignTeam.id }));
    await reject(createEventType(owner.id, { slug: 'x2', title: 'X', durationMin: 30, hostIds: [stranger.id] }));

    const et = await createEventType(owner.id, { slug: 'x3', title: 'X', durationMin: 30, teamId: team.id, hostIds: [owner.id, member.id] });
    expect((await listEventHosts(et.id)).map((h) => h.user_id)).toEqual([owner.id, member.id]);
    await reject(updateEventType(owner.id, et.id, { teamId: foreignTeam.id }));
    await reject(updateEventType(owner.id, et.id, { hostIds: [member.id, stranger.id] }));
    await expect(updateEventType(owner.id, et.id, { hostIds: [member.id] })).resolves.toMatchObject({ team_id: team.id });

    // Al salir del team deja de ser host.
    await removeMember(team.id, member.id);
    expect(await listEventHosts(et.id)).toEqual([]);
  });
});
