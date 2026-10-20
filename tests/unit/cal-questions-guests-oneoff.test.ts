import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBooking,
  createEventType,
  getAvailableDays,
  getAvailableSlots,
  getEventTypeById,
  getOrCreateCalendarUser,
  oneOffDaySlots,
  parseOneOffTimes,
  setAvailability,
  updateEventType,
} from '@/lib/calendar';
import { eventTypeCreateSchema, validateBookingAnswers, validateGuests } from '@/lib/calendar-schema';
import { answerText, cleanOptions, guestLimit, isValidPhone, parseQuestions } from '@/lib/calendar-questions';
import { buildIcs } from '@/lib/ics';
import { bookingGuests, notifyBooking } from '@/lib/calendar-notify';
import { bookingPayload } from '@/lib/calendar-lifecycle';
import { makeUser } from './helpers';

const bookingsRoute = await import('@/app/api/calendar/bookings/route');

function nextDow(dow: number, minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function eventFor(label: string, extra: Record<string, unknown> = {}) {
  const user = await makeUser(label);
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `${label}-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Demo',
    durationMin: 30,
    active: true,
    ...extra,
  } as Parameters<typeof createEventType>[1]);
  return { user, et };
}

function post(body: Record<string, unknown>) {
  return bookingsRoute.POST(
    new Request('http://localhost/api/calendar/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Cal: preguntas nuevas', () => {
  const fields = [
    { name: 'plan', label: 'Plan', type: 'select', options: ['Free', 'Pro'], required: true },
    { name: 'size', label: 'Tamaño', type: 'radio', options: ['1-10', '11-50'] },
    { name: 'topics', label: 'Temas', type: 'checkbox', options: ['Ventas', 'Soporte', 'API'] },
    { name: 'notes', label: 'Notas', type: 'textarea' },
    { name: 'phone', label: 'Teléfono', type: 'phone' },
  ];

  it('valida opciones, listas, varias líneas y teléfonos', () => {
    expect(
      validateBookingAnswers(fields, {
        plan: 'Pro',
        size: '1-10',
        topics: ['API', 'Ventas'],
        notes: ' línea 1\r\nlínea 2 ',
        phone: '+54 11 5555-1234',
      }),
    ).toEqual({ plan: 'Pro', size: '1-10', topics: ['Ventas', 'API'], notes: 'línea 1\nlínea 2', phone: '+54 11 5555-1234' });
    expect(validateBookingAnswers(fields, { plan: 'Enterprise' })).toBeNull();
    expect(validateBookingAnswers(fields, { plan: 'Pro', topics: ['Otra'] })).toBeNull();
    expect(validateBookingAnswers(fields, { plan: 'Pro', topics: 'API' })).toBeNull();
    expect(validateBookingAnswers(fields, { plan: 'Pro', phone: 'llamame' })).toBeNull();
    expect(validateBookingAnswers(fields, { size: '1-10' })).toBeNull();
    // Lista vacía en una opcional = sin respuesta.
    expect(validateBookingAnswers(fields, { plan: 'Free', topics: [] })).toEqual({ plan: 'Free' });
  });

  it('el schema pide opciones en las preguntas de elección', () => {
    const base = { slug: 'x', title: 'X', durationMin: 30 };
    expect(eventTypeCreateSchema.safeParse({ ...base, fields: [{ name: 'a', label: 'A', type: 'select' }] }).success).toBe(false);
    expect(
      eventTypeCreateSchema.safeParse({ ...base, fields: [{ name: 'a', label: 'A', type: 'radio', options: ['Sí'] }] }).success,
    ).toBe(true);
  });

  it('utilidades puras', () => {
    expect(isValidPhone('(011) 4555-1234')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(cleanOptions([' A ', '', 'B', 'A'])).toEqual(['A', 'B']);
    expect(answerText(['A', 'B'], { yes: 'Sí', no: 'No' })).toBe('A, B');
    expect(answerText(false, { yes: 'Sí', no: 'No' })).toBe('No');
    expect(parseQuestions([{ name: 'x', label: 'X', type: 'weird' }, { name: 'y', label: 'Y', type: 'radio', options: ['a', 3] }])).toEqual([
      { name: 'x', label: 'X', type: 'text', required: false, options: [] },
      { name: 'y', label: 'Y', type: 'radio', required: false, options: ['a'] },
    ]);
  });
});

describe('Cal: invitados extra', () => {
  it('solo si el evento los permite, sin repetidos ni el invitado, hasta el tope', () => {
    expect(validateGuests({}, ['a@x.com'], 'me@x.com')).toBeNull();
    expect(validateGuests({}, [], 'me@x.com')).toEqual([]);
    expect(validateGuests({ allowGuests: true }, ['A@x.com', 'a@x.com', 'ME@x.com', 'b@x.com'], 'me@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
    expect(validateGuests({ allowGuests: true, maxGuests: 1 }, ['a@x.com', 'b@x.com'], 'me@x.com')).toBeNull();
    expect(guestLimit({ allowGuests: true })).toBe(10);
    expect(guestLimit({ allowGuests: true, maxGuests: 3 })).toBe(3);
    expect(guestLimit({ maxGuests: 3 })).toBe(0);
  });

  it('el .ics lleva un ATTENDEE por invitado', () => {
    const ics = buildIcs({
      uid: 'u@x',
      sequence: 1,
      method: 'REQUEST',
      start: new Date('2030-01-01T10:00:00Z'),
      end: new Date('2030-01-01T10:30:00Z'),
      title: 'Demo',
      organizer: { name: 'Host', email: 'h@x.com' },
      attendee: { name: 'Gabi', email: 'g@x.com' },
      guests: ['a@x.com'],
    });
    expect(ics).toContain('ATTENDEE;CN="a@x.com";ROLE=OPT-PARTICIPANT;RSVP=FALSE:mailto:a@x.com');
  });

  it('la reserva pública guarda los invitados y les manda la invitación; sin permiso, 400', async () => {
    const { et } = await eventFor('guests', { bookingRules: { allowGuests: true, maxGuests: 2 } });
    await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] });
    const day = nextDow(1);
    const res = await post({
      eventTypeId: et.id,
      email: 'g@x.com',
      name: 'Gabi',
      start: `${day}T09:00:00.000Z`,
      timezone: 'UTC',
      guests: ['ana@x.com', 'beto@x.com'],
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { getDb } = await import('@/lib/db');
    const row = (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as Parameters<
      typeof notifyBooking
    >[0];
    expect(bookingGuests(row)).toEqual(['ana@x.com', 'beto@x.com']);
    expect(bookingPayload(row, et).guests).toEqual(['ana@x.com', 'beto@x.com']);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    await notifyBooking(row, 'created');
    const out = logs.join('\n');
    expect(out).toContain('to=ana@x.com');
    expect(out).toContain('to=beto@x.com');
    expect(out).toContain('added you to');

    const tooMany = await post({
      eventTypeId: et.id,
      email: 'h@x.com',
      name: 'Hugo',
      start: `${day}T10:00:00.000Z`,
      timezone: 'UTC',
      guests: ['a@x.com', 'b@x.com', 'c@x.com'],
    });
    expect(tooMany.status).toBe(400);

    const { et: closed } = await eventFor('noguests');
    await setAvailability(closed.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] });
    const denied = await post({
      eventTypeId: closed.id,
      email: 'g@x.com',
      name: 'Gabi',
      start: `${day}T09:00:00.000Z`,
      timezone: 'UTC',
      guests: ['ana@x.com'],
    });
    expect(denied.status).toBe(400);
  });
});

describe('Cal: reuniones únicas', () => {
  it('slots puros: los elegidos de ese día, futuros y libres', () => {
    const times = [new Date('2030-03-04T15:00:00Z'), new Date('2030-03-04T09:00:00Z'), new Date('2030-03-05T09:00:00Z')];
    const slots = oneOffDaySlots({ times, durationMin: 30, date: '2030-03-04', guestTimezone: 'UTC', now: new Date('2030-01-01') });
    expect(slots.map((s) => s.start.toISOString())).toEqual(['2030-03-04T09:00:00.000Z', '2030-03-04T15:00:00.000Z']);
    expect(
      oneOffDaySlots({ times, durationMin: 30, date: '2030-03-04', guestTimezone: 'UTC', now: new Date('2030-03-04T12:00:00Z') }),
    ).toHaveLength(1);
    expect(
      oneOffDaySlots({
        times,
        durationMin: 30,
        date: '2030-03-04',
        guestTimezone: 'UTC',
        now: new Date('2030-01-01'),
        isFree: (s) => s.start.getUTCHours() !== 9,
      }),
    ).toHaveLength(1);
    expect(parseOneOffTimes(null)).toBeNull();
    expect(parseOneOffTimes('["2030-01-02T10:00:00.000Z","bad","2030-01-01T10:00:00.000Z"]')?.map((d) => d.getUTCDate())).toEqual([
      1, 2,
    ]);
  });

  it('ofrece solo los horarios elegidos (fuera del horario semanal), los aparta y los libera al reservarse', async () => {
    const day = nextDow(6, 4); // sábado: fuera del horario por defecto (lunes a viernes)
    const t1 = `${day}T08:00:00.000Z`;
    const t2 = `${day}T20:00:00.000Z`;
    const { user, et: oneOff } = await eventFor('oneoff', { oneOffTimes: [t2, t1, t1] });
    expect(oneOff.single_use).toBe(1);
    expect(parseOneOffTimes(oneOff.one_off_times)?.map((d) => d.toISOString())).toEqual([t1, t2]);

    const slots = await getAvailableSlots(oneOff.id, 'UTC', day);
    expect(slots.map((s) => s.start.toISOString())).toEqual([t1, t2]);
    expect(await getAvailableDays(oneOff.id, 'UTC', day.slice(0, 7))).toContain(day);

    // Otro evento del mismo anfitrión, abierto el sábado: los horarios ofrecidos quedan apartados.
    const other = await createEventType(user.id, {
      slug: `o-${crypto.randomUUID().slice(0, 6)}`,
      title: 'Otro',
      durationMin: 30,
      active: true,
    } as Parameters<typeof createEventType>[1]);
    await setAvailability(other.id, { rules: [{ dayOfWeek: 6, startTime: '08:00', endTime: '10:00' }] });
    const before = (await getAvailableSlots(other.id, 'UTC', day)).map((s) => s.start.toISOString());
    expect(before).not.toContain(t1);
    expect(before).toContain(`${day}T08:30:00.000Z`);

    await createBooking({ eventTypeId: oneOff.id, email: 'g@x.com', name: 'Gabi', start: t2 });
    expect((await getEventTypeById(oneOff.id))?.used_at).toBeTruthy();
    // Link consumido: no ofrece más horarios y libera el resto.
    expect(await getAvailableSlots(oneOff.id, 'UTC', day)).toEqual([]);
    expect((await getAvailableSlots(other.id, 'UTC', day)).map((s) => s.start.toISOString())).toContain(t1);
  });

  it('editar los horarios los reemplaza y sigue siendo de un solo uso', async () => {
    const day = nextDow(0, 4);
    const { user, et } = await eventFor('oneoff-edit', { oneOffTimes: [`${day}T10:00:00.000Z`] });
    const updated = await updateEventType(user.id, et.id, { oneOffTimes: [`${day}T11:00:00.000Z`], singleUse: false });
    expect(updated?.single_use).toBe(1);
    expect((await getAvailableSlots(et.id, 'UTC', day)).map((s) => s.start.toISOString())).toEqual([`${day}T11:00:00.000Z`]);
  });
});
