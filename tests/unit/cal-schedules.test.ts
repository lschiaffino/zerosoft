import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import {
  CalendarError,
  computeDaySlots,
  createBooking,
  createEventType,
  deleteEventType,
  getAvailableSlots,
  getEventType,
  getOrCreateCalendarUser,
  setAvailability,
  updateBooking,
  updateCalendarUser,
  updateEventType,
} from '@/lib/calendar';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  ScheduleError,
  updateSchedule,
  windowsForDate,
  type ScheduleRule,
} from '@/lib/calendar-schedules';
import { MIGRATIONS, runMigrations } from '@/lib/schema/migrations';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const schedulesRoute = await import('@/app/api/calendar/schedules/route');
const scheduleRoute = await import('@/lib/routes/calendar/schedules/[id]/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

const EPOCH = new Date(0);
const iso = (slots: Array<{ start: Date }>) => slots.map((s) => s.start.toISOString());
const weekdays = (start: string, end: string): ScheduleRule[] =>
  [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: start, endTime: end }));

/** Próxima fecha (UTC) con ese día de semana, al menos `minDays` adelante. */
function nextDow(dow: number, minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  session.user = null;
});

describe('windowsForDate', () => {
  const rules = [
    { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' },
    { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
  ];
  it('usa las horas semanales ordenadas', () => {
    expect(windowsForDate('2026-11-02', 1, rules, [])).toEqual([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '17:00' },
    ]);
    expect(windowsForDate('2026-11-03', 2, rules, [])).toEqual([]);
  });
  it('una excepción sin horas bloquea el día; con horas reemplaza', () => {
    expect(windowsForDate('2026-11-02', 1, rules, [{ date: '2026-11-02', startTime: null, endTime: null }])).toEqual([]);
    expect(
      windowsForDate('2026-11-02', 1, rules, [{ date: '2026-11-02', startTime: '10:00', endTime: '11:00' }]),
    ).toEqual([{ startTime: '10:00', endTime: '11:00' }]);
    // Sábado sin horas semanales: la excepción agrega horas.
    expect(
      windowsForDate('2026-11-07', 6, rules, [{ date: '2026-11-07', startTime: '10:00', endTime: '12:00' }]),
    ).toEqual([{ startTime: '10:00', endTime: '12:00' }]);
    // Bloqueo y rango la misma fecha: gana el bloqueo.
    expect(
      windowsForDate('2026-11-02', 1, rules, [
        { date: '2026-11-02', startTime: '10:00', endTime: '11:00' },
        { date: '2026-11-02', startTime: null, endTime: null },
      ]),
    ).toEqual([]);
  });
});

describe('computeDaySlots: zonas horarias y DST', () => {
  const base = { guestTimezone: 'UTC', overrides: [], durationMin: 60, minStart: EPOCH };

  it('el mismo horario de Nueva York cambia de offset UTC al terminar el horario de verano', () => {
    const ny = { ...base, scheduleTimezone: 'America/New_York', weekly: weekdays('09:00', '12:00') };
    // Lunes 26/10/2026: EDT (UTC-4).
    expect(iso(computeDaySlots({ ...ny, date: '2026-10-26' }))).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-10-26T14:00:00.000Z',
      '2026-10-26T15:00:00.000Z',
    ]);
    // Lunes 2/11/2026: EST (UTC-5), el DST terminó el domingo 1/11.
    expect(iso(computeDaySlots({ ...ny, date: '2026-11-02' }))).toEqual([
      '2026-11-02T14:00:00.000Z',
      '2026-11-02T15:00:00.000Z',
      '2026-11-02T16:00:00.000Z',
    ]);
  });

  it('día de adelanto de hora (8/3/2026): la hora 02:00 no existe y la ventana dura una hora menos', () => {
    const slots = computeDaySlots({
      ...base,
      guestTimezone: 'America/New_York',
      scheduleTimezone: 'America/New_York',
      weekly: [{ dayOfWeek: 0, startTime: '01:00', endTime: '04:00' }],
      date: '2026-03-08',
    });
    expect(iso(slots)).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z']);
  });

  it('día de atraso de hora (1/11/2026): la ventana dura una hora más', () => {
    const slots = computeDaySlots({
      ...base,
      guestTimezone: 'America/New_York',
      scheduleTimezone: 'America/New_York',
      weekly: [{ dayOfWeek: 0, startTime: '00:00', endTime: '03:00' }],
      date: '2026-11-01',
    });
    expect(iso(slots)).toEqual([
      '2026-11-01T04:00:00.000Z',
      '2026-11-01T05:00:00.000Z',
      '2026-11-01T06:00:00.000Z',
      '2026-11-01T07:00:00.000Z',
    ]);
  });

  it('el día local del invitado puede ser el anterior al del horario (Tokio vs Los Ángeles)', () => {
    const tokyo = {
      ...base,
      guestTimezone: 'America/Los_Angeles',
      scheduleTimezone: 'Asia/Tokyo',
      weekly: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }],
    };
    // Lunes 12/10 09:00 en Tokio = domingo 11/10 17:00 en Los Ángeles.
    expect(iso(computeDaySlots({ ...tokyo, date: '2026-10-11' }))).toEqual(['2026-10-12T00:00:00.000Z']);
    expect(computeDaySlots({ ...tokyo, date: '2026-10-12' })).toEqual([]);
  });

  it('excepciones por fecha en la zona del horario, aviso mínimo y ocupación', () => {
    const sp = {
      ...base,
      scheduleTimezone: 'America/Argentina/Buenos_Aires',
      weekly: weekdays('09:00', '12:00'),
    };
    // Bloqueado.
    expect(
      computeDaySlots({ ...sp, date: '2026-10-19', overrides: [{ date: '2026-10-19', startTime: null, endTime: null }] }),
    ).toEqual([]);
    // Horas especiales: 15 a 16 de Buenos Aires (UTC-3).
    expect(
      iso(computeDaySlots({ ...sp, date: '2026-10-19', overrides: [{ date: '2026-10-19', startTime: '15:00', endTime: '16:00' }] })),
    ).toEqual(['2026-10-19T18:00:00.000Z']);
    // Aviso mínimo: lo anterior a minStart no se ofrece.
    expect(iso(computeDaySlots({ ...sp, date: '2026-10-19', minStart: new Date('2026-10-19T13:30:00Z') }))).toEqual([
      '2026-10-19T14:00:00.000Z',
    ]);
    // Ocupación externa.
    expect(
      iso(computeDaySlots({ ...sp, date: '2026-10-19', isFree: (s) => s.start.toISOString() !== '2026-10-19T12:00:00.000Z' })),
    ).toEqual(['2026-10-19T13:00:00.000Z', '2026-10-19T14:00:00.000Z']);
  });

  it('fecha inválida → sin slots', () => {
    expect(computeDaySlots({ ...base, scheduleTimezone: 'UTC', weekly: weekdays('09:00', '17:00'), date: 'nope' })).toEqual([]);
  });
});

describe('horarios en la base', () => {
  it('un tipo de evento nuevo usa el horario por defecto (se crea lunes a viernes 9 a 17)', async () => {
    const u = await makeUser('sch');
    await getOrCreateCalendarUser(u.id);
    const et = await createEventType(u.id, { slug: 'a', title: 'A', durationMin: 60 });
    const schedules = await listSchedules(u.id);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ is_default: 1, timezone: 'UTC', eventTypeCount: 1 });
    expect(et.schedule_id).toBe(schedules[0].id);
    const monday = nextDow(1);
    expect(await getAvailableSlots(et.id, 'UTC', monday)).toHaveLength(8);
  });

  it('las excepciones del horario cambian los slots del evento; las reglas propias lo desvinculan', async () => {
    const u = await makeUser('sch2');
    await getOrCreateCalendarUser(u.id);
    const s = await createSchedule(u.id, { name: 'Mañanas', timezone: 'UTC', rules: weekdays('09:00', '11:00') });
    const et = await createEventType(u.id, { slug: 'b', title: 'B', durationMin: 60, scheduleId: s.id });
    const monday = nextDow(1);
    const tuesday = nextDow(2);
    expect(await getAvailableSlots(et.id, 'UTC', monday)).toHaveLength(2);
    await updateSchedule(u.id, s.id, {
      overrides: [
        { date: monday, startTime: null, endTime: null },
        { date: tuesday, startTime: '15:00', endTime: '16:00' },
      ],
    });
    expect(await getAvailableSlots(et.id, 'UTC', monday)).toEqual([]);
    expect(iso(await getAvailableSlots(et.id, 'UTC', tuesday))).toEqual([`${tuesday}T15:00:00.000Z`]);

    // Reglas propias (endpoint viejo de availability): el evento deja de usar el horario.
    await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] });
    expect((await getEventType(u.id, et.id))?.schedule_id).toBeNull();
    expect(iso(await getAvailableSlots(et.id, 'UTC', monday))).toEqual([`${monday}T10:00:00.000Z`]);
  });

  it('aislamiento: otro workspace no ve, no edita, no borra ni asigna el horario', async () => {
    const a = await makeUser('scha');
    const b = await makeUser('schb');
    const s = await createSchedule(a.id, { name: 'A', timezone: 'UTC' });
    expect(await getSchedule(b.id, s.id)).toBeNull();
    expect(await updateSchedule(b.id, s.id, { name: 'x' })).toBeNull();
    expect(await deleteSchedule(b.id, s.id)).toBe(false);
    await expect(createEventType(b.id, { slug: 'c', title: 'C', durationMin: 30, scheduleId: s.id })).rejects.toBeInstanceOf(
      CalendarError,
    );
    const etB = await createEventType(b.id, { slug: 'd', title: 'D', durationMin: 30 });
    await expect(updateEventType(b.id, etB.id, { scheduleId: s.id })).rejects.toMatchObject({ code: 'invalid_schedule' });
    expect((await getSchedule(a.id, s.id))?.name).toBe('A');
  });

  it('no se borra un horario en uso; al borrar el default otro pasa a default', async () => {
    const u = await makeUser('sch3');
    const s1 = await createSchedule(u.id, { name: 'Uno', timezone: 'UTC' });
    const s2 = await createSchedule(u.id, { name: 'Dos', timezone: 'UTC' });
    expect((await getSchedule(u.id, s1.id))?.is_default).toBe(1);
    const et = await createEventType(u.id, { slug: 'e', title: 'E', durationMin: 30, scheduleId: s1.id });
    await expect(deleteSchedule(u.id, s1.id)).rejects.toBeInstanceOf(ScheduleError);
    await updateEventType(u.id, et.id, { scheduleId: s2.id });
    expect(await deleteSchedule(u.id, s1.id)).toBe(true);
    expect((await getSchedule(u.id, s2.id))?.is_default).toBe(1);
  });

  it('cambiar la zona del workspace muda el horario por defecto que seguía en la zona anterior', async () => {
    const u = await makeUser('sch4');
    await getOrCreateCalendarUser(u.id);
    const et = await createEventType(u.id, { slug: 'tz', title: 'TZ', durationMin: 60 });
    const custom = await createSchedule(u.id, { name: 'Tokio', timezone: 'Asia/Tokyo', rules: weekdays('09:00', '10:00') });
    await updateCalendarUser(u.id, { timezone: 'America/Argentina/Buenos_Aires' });
    const [def] = (await listSchedules(u.id)).filter((s) => s.is_default === 1);
    expect(def.timezone).toBe('America/Argentina/Buenos_Aires');
    expect((await getSchedule(u.id, custom.id))?.timezone).toBe('Asia/Tokyo');
    // 09:00 hora de Buenos Aires = 12:00 UTC.
    const monday = nextDow(1);
    expect(iso(await getAvailableSlots(et.id, 'UTC', monday))[0]).toBe(`${monday}T12:00:00.000Z`);

    // Si el anfitrión ya le puso otra zona al horario, no se toca.
    await updateSchedule(u.id, def.id, { timezone: 'Europe/Madrid' });
    await updateCalendarUser(u.id, { timezone: 'UTC' });
    expect((await getSchedule(u.id, def.id))?.timezone).toBe('Europe/Madrid');
  });
});

describe('borrar un tipo de evento', () => {
  it('con reservas por venir no se borra (409); con solo canceladas, sí', async () => {
    const u = await makeUser('deltype');
    await getOrCreateCalendarUser(u.id);
    const et = await createEventType(u.id, { slug: 'del', title: 'Del', durationMin: 60 });
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${nextDow(2)}T10:00:00.000Z` });
    await expect(deleteEventType(u.id, et.id)).rejects.toMatchObject({ code: 'has_upcoming_bookings', status: 409 });
    expect(await getEventType(u.id, et.id)).toBeDefined();
    await updateBooking(b.id, { status: 'cancelled' });
    expect(await deleteEventType(u.id, et.id)).toBe(true);
  });
});

describe('API /api/calendar/schedules', () => {
  it('exige sesión y aísla por workspace', async () => {
    expect((await schedulesRoute.GET()).status).toBe(401);
    const a = await makeUser('apia');
    const b = await makeUser('apib');
    session.user = a;
    const created = await schedulesRoute.POST(
      json('http://x/api/calendar/schedules', 'POST', {
        name: 'Tardes',
        timezone: 'Europe/Madrid',
        rules: [{ dayOfWeek: 2, startTime: '14:00', endTime: '18:00' }],
        overrides: [{ date: '2026-12-25' }],
      }),
    );
    expect(created.status).toBe(201);
    const s = (await created.json()) as { id: string; overrides: unknown[] };
    expect(s.overrides).toEqual([{ date: '2026-12-25', startTime: null, endTime: null }]);

    // Validación: fin antes del inicio y zona inválida.
    const bad = await schedulesRoute.POST(
      json('http://x/api/calendar/schedules', 'POST', {
        name: 'Mal',
        timezone: 'Mars/Base',
        rules: [{ dayOfWeek: 2, startTime: '18:00', endTime: '14:00' }],
      }),
    );
    expect(bad.status).toBe(400);

    session.user = b;
    expect((await scheduleRoute.GET(json('http://x', 'GET'), ctx(s.id))).status).toBe(404);
    expect((await scheduleRoute.PATCH(json('http://x', 'PATCH', { name: 'robo' }), ctx(s.id))).status).toBe(404);
    expect((await scheduleRoute.DELETE(json('http://x', 'DELETE'), ctx(s.id))).status).toBe(404);
    const listB = (await (await schedulesRoute.GET()).json()) as { schedules: unknown[] };
    expect(listB.schedules).toEqual([]);

    session.user = a;
    const patched = await scheduleRoute.PATCH(json('http://x', 'PATCH', { name: 'Tardes largas' }), ctx(s.id));
    expect(((await patched.json()) as { name: string }).name).toBe('Tardes largas');
  });
});

describe('migración 027_cal_schedules (no destructiva)', () => {
  it('agrupa reglas iguales en un horario, conserva calendar_availability y deja sin horario a los eventos sin reglas', async () => {
    const client = createClient({ url: `file:${path.join(os.tmpdir(), `mig-cal-${crypto.randomUUID()}.db`)}` });
    const idx = MIGRATIONS.findIndex((m) => m.id === '027_cal_schedules');
    await runMigrations(client, MIGRATIONS.slice(0, idx));
    await client.executeMultiple(`
      INSERT INTO users (id, email, handle) VALUES ('u1', 'u1@test.local', 'u1');
      INSERT INTO calendar_users (id, user_id, timezone) VALUES ('cu1', 'u1', 'America/Bogota');
      INSERT INTO calendar_event_types (id, user_id, slug, title, duration_min, created_at) VALUES
        ('e1', 'u1', 'e1', 'Uno', 30, '2026-01-01'),
        ('e2', 'u1', 'e2', 'Dos', 30, '2026-01-02'),
        ('e3', 'u1', 'e3', 'Tres', 30, '2026-01-03'),
        ('e4', 'u1', 'e4', 'Cuatro', 30, '2026-01-04');
      INSERT INTO calendar_availability (id, event_type_id, day_of_week, start_time, end_time) VALUES
        ('a1', 'e1', 1, '09:00', '17:00'), ('a2', 'e1', 2, '09:00', '17:00'),
        ('a3', 'e2', 2, '09:00', '17:00'), ('a4', 'e2', 1, '09:00', '17:00'),
        ('a5', 'e3', 6, '10:00', '12:00');
      INSERT INTO calendar_bookings (id, event_type_id, invitee_email, starts_at, ends_at, status) VALUES
        ('b1', 'e1', 'g@x.com', '2026-01-05T09:00:00Z', '2026-01-05T09:30:00Z', 'confirmed');
      INSERT INTO calendar_reminders (id, booking_id, send_at) VALUES ('r1', 'b1', '2026-01-04T09:00:00Z');
    `);
    await client.execute('PRAGMA foreign_keys = ON');
    await runMigrations(client);

    const schedules = (await client.execute('SELECT id, name, timezone, is_default FROM calendar_schedules ORDER BY is_default DESC')).rows;
    expect(schedules).toHaveLength(2);
    expect(schedules[0]).toMatchObject({ name: 'Horario principal', timezone: 'America/Bogota', is_default: 1 });
    expect(schedules[1]).toMatchObject({ name: 'Tres', is_default: 0 });
    const ets = Object.fromEntries(
      (await client.execute('SELECT id, schedule_id FROM calendar_event_types')).rows.map((r) => [r.id, r.schedule_id]),
    );
    expect(ets.e1).toBe(schedules[0].id);
    expect(ets.e2).toBe(schedules[0].id);
    expect(ets.e3).toBe(schedules[1].id);
    expect(ets.e4).toBeNull();
    const rules = (await client.execute({ sql: 'SELECT COUNT(*) AS c FROM calendar_schedule_rules WHERE schedule_id = ?', args: [schedules[0].id] })).rows[0];
    expect(Number(rules.c)).toBe(2);
    // Nada se borró.
    expect(Number((await client.execute('SELECT COUNT(*) AS c FROM calendar_availability')).rows[0].c)).toBe(5);

    // 027_cal_payments reconstruyó calendar_bookings: conserva filas, hijos e índices, y acepta 'pending'.
    expect((await client.execute("SELECT status, payment_status FROM calendar_bookings WHERE id = 'b1'")).rows[0]).toMatchObject({
      status: 'confirmed',
      payment_status: 'none',
    });
    expect((await client.execute("SELECT id FROM calendar_reminders WHERE booking_id = 'b1'")).rows).toHaveLength(1);
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
    await client.execute(
      "INSERT INTO calendar_bookings (id, event_type_id, invitee_email, starts_at, ends_at, status) VALUES ('b2', 'e1', 'h@x.com', '2026-01-06T09:00:00Z', '2026-01-06T09:30:00Z', 'pending')",
    );
    await expect(
      client.execute(
        "INSERT INTO calendar_bookings (id, event_type_id, invitee_email, starts_at, ends_at, status) VALUES ('b3', 'e1', 'h@x.com', '2026-01-07T09:00:00Z', '2026-01-07T09:30:00Z', 'nope')",
      ),
    ).rejects.toThrow(/CHECK/);
    const indexes = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'calendar_bookings'")).rows.map(
      (r) => r.name,
    );
    expect(indexes).toEqual(expect.arrayContaining(['idx_calendar_bookings_manage', 'idx_calendar_bookings_host_slot', 'idx_calendar_bookings_pending']));
    // Correr de nuevo no hace nada.
    expect(await runMigrations(client)).toEqual([]);
  }, 60_000);
});
