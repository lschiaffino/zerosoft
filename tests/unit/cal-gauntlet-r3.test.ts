import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bookingDateBounds,
  computeDaySlots,
  createBooking,
  createEventType,
  findOfferedSlot,
  getAvailableDays,
  getAvailableSlots,
  getOrCreateCalendarUser,
  legacyBookPath,
  listDueReminders,
  rescheduleBooking,
  revivePaidBooking,
  setAvailability,
  updateCalendarUser,
  updateEventType,
} from '@/lib/calendar';
import { legacyRoutingPath } from '@/lib/calendar-routing';
import { validateBookingAnswers } from '@/lib/calendar-schema';
import { notifyBooking } from '@/lib/calendar-notify';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

/** Una fecha (YYYY-MM-DD, UTC) N días en el futuro que cae en lunes. */
function nextMonday(minDaysAhead = 2): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setup(opts: { durationMin?: number; singleUse?: boolean } = {}) {
  const user = await makeUser('r3');
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `t-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Test',
    durationMin: opts.durationMin ?? 30,
    active: true,
    ...(opts.singleUse ? { singleUse: true } : {}),
  } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
  return { user, et };
}

describe('Cal r3: links legacy /book/<slug> y /r/<slug>', () => {
  it('un evento nuevo con el slug igual al handle de otro no secuestra su perfil', async () => {
    const victim = await makeUser('victima');
    const handle = ((await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(victim.id)) as { handle: string })
      .handle;
    expect(handle).toBeTruthy();
    const attacker = await makeUser('atacante');
    await getOrCreateCalendarUser(attacker.id);
    await createEventType(attacker.id, { slug: handle, title: 'Agenda', durationMin: 30, active: true } as Parameters<
      typeof createEventType
    >[1]);
    expect(await legacyBookPath(handle)).toBeNull();
  });

  it('solo redirigen slugs de antes de la migración de handles', async () => {
    const { et } = await setup();
    // Creado después de la migración: no tuvo nunca un link /book/<slug>.
    expect(await legacyBookPath(et.slug)).toBeNull();
    await getDb().prepare("UPDATE calendar_event_types SET created_at = '2000-01-01 00:00:00' WHERE id = ?").run(et.id);
    expect(await legacyBookPath(et.slug)).toMatch(new RegExp(`/book/[^/]+/${et.slug}$`));

    const owner = await makeUser('rf');
    const slug = `f-${crypto.randomUUID().slice(0, 6)}`;
    await getDb()
      .prepare(
        `INSERT INTO calendar_routing_forms (id, user_id, slug, title, active, created_at, updated_at)
         VALUES (?, ?, ?, 'F', 1, datetime('now'), datetime('now'))`,
      )
      .run(crypto.randomUUID(), owner.id, slug);
    expect(await legacyRoutingPath(slug)).toBeNull();
  });
});

describe('Cal r3: slots que cruzan la medianoche del invitado', () => {
  it('el slot pertenece al día local de su inicio aunque termine al día siguiente', () => {
    // Anfitrión en UTC 18:00–19:00, evento de 60 min; invitado en Kolkata (UTC+5:30):
    // 18:00 UTC = 23:30 IST, termina 00:30 del día siguiente.
    const date = nextMonday();
    const slots = computeDaySlots({
      date,
      guestTimezone: 'Asia/Kolkata',
      scheduleTimezone: 'UTC',
      weekly: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }],
      overrides: [],
      durationMin: 60,
      minStart: new Date(0),
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([`${date}T18:00:00.000Z`]);
  });

  it('se puede reservar ese horario', async () => {
    const { et } = await setup({ durationMin: 60 });
    await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }] });
    const day = nextMonday();
    const offered = await findOfferedSlot(et.id, new Date(`${day}T18:00:00.000Z`), 'Asia/Kolkata');
    expect(offered?.start.toISOString()).toBe(`${day}T18:00:00.000Z`);
  });
});

describe('Cal r3: reprogramar links de un solo uso y eventos desactivados', () => {
  it('una reserva de un link de un solo uso se puede mover', async () => {
    const { et } = await setup({ singleUse: true });
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    // El link quedó consumido: nadie más puede reservar...
    expect(await getAvailableSlots(et.id, 'UTC', day)).toEqual([]);
    // ...pero la reserva existente sí ve horarios para moverse.
    const slots = await getAvailableSlots(et.id, 'UTC', day, { excludeBookingId: b.id });
    expect(slots.length).toBeGreaterThan(0);
    expect(await getAvailableDays(et.id, 'UTC', day.slice(0, 7), { excludeBookingId: b.id })).toContain(day);
    const offered = await findOfferedSlot(et.id, new Date(`${day}T10:00:00.000Z`), 'UTC', { excludeBookingId: b.id });
    expect(offered).not.toBeNull();
    const moved = await rescheduleBooking(b.id, offered!.start);
    expect(moved.starts_at).toBe(`${day}T10:00:00.000Z`);
  });

  it('con el tipo de evento desactivado, las reservas existentes se pueden mover', async () => {
    const { user, et } = await setup();
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    await updateEventType(user.id, et.id, { active: false });
    expect(await getAvailableSlots(et.id, 'UTC', day)).toEqual([]);
    expect((await getAvailableSlots(et.id, 'UTC', day, { excludeBookingId: b.id })).length).toBeGreaterThan(0);
  });

  it('un id de reserva de otro evento no habilita horarios', async () => {
    const { et } = await setup({ singleUse: true });
    const other = await setup();
    const day = nextMonday();
    await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    const foreign = await createBooking({ eventTypeId: other.et.id, email: 'h@x.com', name: 'H', start: `${day}T09:00:00.000Z` });
    expect(await getAvailableSlots(et.id, 'UTC', day, { excludeBookingId: foreign.id })).toEqual([]);
  });
});

describe('Cal r3: pago tardío en un link de un solo uso', () => {
  it('no revive la reserva si otra ya consumió el link', async () => {
    const { et } = await setup({ singleUse: true });
    const day = nextMonday();
    const a = await createBooking(
      { eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:00:00.000Z` },
      { hold: { expiresAt: new Date(Date.now() + 60_000), amountCents: 5000, currency: 'usd' } },
    );
    // El hold de A vence sin webhook.
    await getDb()
      .prepare(
        `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired'
         WHERE id = ?`,
      )
      .run(a.id);
    // B reserva y confirma: el link queda consumido.
    await createBooking({ eventTypeId: et.id, email: 'b@x.com', name: 'B', start: `${day}T10:00:00.000Z` });
    // Llega el pago tardío de A: no se revive (va al reembolso).
    expect(await revivePaidBooking(a.id)).toBeNull();
    const row = (await getDb().prepare('SELECT status FROM calendar_bookings WHERE id = ?').get(a.id)) as { status: string };
    expect(row.status).toBe('cancelled');
  });

  it('sin otra reserva, el pago tardío sí revive y consume el link', async () => {
    const { et } = await setup({ singleUse: true });
    const day = nextMonday();
    const a = await createBooking(
      { eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:00:00.000Z` },
      { hold: { expiresAt: new Date(Date.now() + 60_000), amountCents: 5000, currency: 'usd' } },
    );
    await getDb()
      .prepare(
        `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired'
         WHERE id = ?`,
      )
      .run(a.id);
    const revived = await revivePaidBooking(a.id);
    expect(revived?.status).toBe('confirmed');
    const etRow = (await getDb().prepare('SELECT used_at FROM calendar_event_types WHERE id = ?').get(et.id)) as {
      used_at: string | null;
    };
    expect(etRow.used_at).toBeTruthy();
  });
});

describe('Cal r3: reservas concurrentes de distinta duración', () => {
  it('dos reservas superpuestas con inicios distintos: solo una entra', async () => {
    const { user, et } = await setup();
    const demo = await createEventType(user.id, {
      slug: `d-${crypto.randomUUID().slice(0, 6)}`,
      title: 'Demo',
      durationMin: 60,
      active: true,
    } as Parameters<typeof createEventType>[1]);
    await setAvailability(demo.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    const day = nextMonday();
    const results = await Promise.allSettled([
      createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:30:00.000Z` }),
      createBooking({ eventTypeId: demo.id, email: 'b@x.com', name: 'B', start: `${day}T09:00:00.000Z` }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('reprogramar sobre un horario que otra reserva tomó a la vez falla', async () => {
    const { user, et } = await setup();
    const demo = await createEventType(user.id, {
      slug: `d-${crypto.randomUUID().slice(0, 6)}`,
      title: 'Demo',
      durationMin: 60,
      active: true,
    } as Parameters<typeof createEventType>[1]);
    await setAvailability(demo.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'a@x.com', name: 'A', start: `${day}T09:00:00.000Z` });
    const results = await Promise.allSettled([
      rescheduleBooking(b.id, new Date(`${day}T10:30:00.000Z`)),
      createBooking({ eventTypeId: demo.id, email: 'b@x.com', name: 'B', start: `${day}T10:00:00.000Z` }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('Cal r3: filtros de fecha en la zona del anfitrión', () => {
  it('Desde/Hasta usan el día del calendario del workspace', async () => {
    const user = await makeUser('tz');
    await getOrCreateCalendarUser(user.id);
    await updateCalendarUser(user.id, { timezone: 'Asia/Tokyo' });
    const b = await bookingDateBounds(user.id, '2026-10-20', '2026-10-20');
    expect(b.from?.toISOString()).toBe('2026-10-19T15:00:00.000Z');
    expect(b.to?.toISOString()).toBe('2026-10-20T14:59:59.999Z');
  });
});

describe('Cal r3: emails y recordatorios', () => {
  afterEach(() => vi.restoreAllMocks());

  it('el email al anfitrión muestra la hora en su zona', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const { user, et } = await setup();
    await updateCalendarUser(user.id, { timezone: 'America/Argentina/Buenos_Aires' });
    await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    const day = nextMonday();
    const b = await createBooking({
      eventTypeId: et.id,
      email: 'g@x.com',
      name: 'G',
      start: `${day}T12:00:00.000Z`,
      timezone: 'Asia/Tokyo',
    });
    await notifyBooking(b, 'created');
    const out = logs.join('\n');
    expect(out).toContain('(Asia/Tokyo)');
    expect(out).toContain('(America/Argentina/Buenos_Aires)');
  });

  it('el recordatorio trae el link de la reunión y descarta los de reuniones que ya empezaron', async () => {
    const { et } = await setup();
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    await getDb().prepare("UPDATE calendar_bookings SET meeting_url = 'https://meet.google.com/abc' WHERE id = ?").run(b.id);
    await getDb()
      .prepare("UPDATE calendar_reminders SET send_at = '2000-01-01T00:00:00.000Z' WHERE booking_id = ?")
      .run(b.id);
    const due = (await listDueReminders(500)).find((r) => r.booking_id === b.id);
    expect(due?.meeting_url).toBe('https://meet.google.com/abc');

    // Reunión que ya empezó: el recordatorio pendiente se descarta.
    const past = new Date(Date.now() - 3_600_000).toISOString();
    await getDb().prepare('UPDATE calendar_bookings SET starts_at = ? WHERE id = ?').run(past, b.id);
    expect((await listDueReminders(500)).find((r) => r.booking_id === b.id)).toBeUndefined();
    const rem = (await getDb().prepare('SELECT sent_at FROM calendar_reminders WHERE booking_id = ?').get(b.id)) as {
      sent_at: string | null;
    };
    expect(rem.sent_at).toBeTruthy();
  });
});

describe('Cal r3: respuestas de la reserva pública', () => {
  const fields = [
    { name: 'company', label: 'Company', type: 'text', required: true },
    { name: 'seats', label: 'Seats', type: 'number' },
    { name: 'terms', label: 'Terms', type: 'boolean', required: true },
  ];

  it('acepta respuestas válidas y normaliza', () => {
    expect(validateBookingAnswers(fields, { company: ' Acme ', seats: '5', terms: true })).toEqual({
      company: 'Acme',
      seats: 5,
      terms: true,
    });
  });

  it('rechaza claves desconocidas, requeridos faltantes, tipos y tamaños inválidos', () => {
    expect(validateBookingAnswers(fields, { company: 'A', terms: true, extra: 'x' })).toBeNull();
    expect(validateBookingAnswers(fields, { terms: true })).toBeNull();
    expect(validateBookingAnswers(fields, { company: 'A', terms: false })).toBeNull();
    expect(validateBookingAnswers(fields, { company: 'A', terms: true, seats: 'abc' })).toBeNull();
    expect(validateBookingAnswers(fields, { company: 'x'.repeat(2001), terms: true })).toBeNull();
    expect(validateBookingAnswers([], undefined)).toEqual({});
  });
});
