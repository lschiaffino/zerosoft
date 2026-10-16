import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createBooking,
  createEventType,
  findOfferedSlot,
  getOrCreateCalendarUser,
  getPublicProfile,
  listBusyRanges,
  registerBusyProvider,
  rescheduleBooking,
  setAvailability,
  setEventHosts,
  subtractRange,
  type TimeRange,
} from '@/lib/calendar';
import { availabilityBatchSchema, blockedSlotCreateSchema, bookingCreateSchema } from '@/lib/calendar-schema';
import { buildIcs } from '@/lib/ics';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { makeUser } from './helpers';

type SessionLike = { id: string; email: string; actingUser?: { id: string } };
const session = vi.hoisted(() => ({ user: null as null | SessionLike }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: SessionLike) => u.actingUser?.id ?? u.id,
}));
const blockedRoute = await import('@/app/api/calendar/blocked-slots/route');
const remindersRoute = await import('@/app/api/calendar/reminders/due/route');

/** Una fecha (YYYY-MM-DD, UTC) N días en el futuro que cae en lunes. */
function nextMonday(minDaysAhead = 2): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setup(label: string, opts: { singleUse?: boolean; ownerId?: string; durationMin?: number } = {}) {
  const user = opts.ownerId ? { id: opts.ownerId } : await makeUser(label);
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `${label}-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Demo',
    durationMin: opts.durationMin ?? 30,
    active: true,
    ...(opts.singleUse ? { singleUse: true } : {}),
  } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] });
  return { user, et };
}

async function bookingById(id: string): Promise<CalendarBookingRow> {
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

/** Calendario externo falso: por host, los rangos que devuelve (o un efecto al consultarlo). */
const external = new Map<string, () => TimeRange[] | Promise<TimeRange[]>>();
registerBusyProvider(async (userId) => (await external.get(userId)?.()) ?? []);

beforeEach(() => {
  session.user = null;
  external.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cal r5: inyección de líneas en el .ics', () => {
  it('un nombre con CRLF no agrega propiedades', () => {
    const ics = buildIcs({
      uid: 'b@x',
      sequence: 0,
      method: 'REQUEST',
      start: new Date('2026-11-02T13:00:00Z'),
      end: new Date('2026-11-02T13:30:00Z'),
      title: 'Demo',
      organizer: { name: 'Host', email: 'host@x.com' },
      attendee: { name: 'Ana\r\nLOCATION:https://evil.example/meet\r\nX-A:', email: 'g@x.com\r\nURL:https://evil.example' },
    });
    const lines = ics.split('\r\n');
    expect(lines.some((l) => l.startsWith('LOCATION:'))).toBe(false);
    expect(lines.some((l) => l.startsWith('URL:'))).toBe(false);
    expect(lines.some((l) => l.startsWith('X-A:'))).toBe(false);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('el schema público rechaza nombres con saltos de línea o caracteres de control', () => {
    const base = { eventTypeId: 'e1', email: 'g@x.com', start: '2026-11-02T13:00:00Z' };
    expect(bookingCreateSchema.safeParse({ ...base, name: 'Ana\r\nLOCATION:x' }).success).toBe(false);
    expect(bookingCreateSchema.safeParse({ ...base, name: 'Ana\tB' }).success).toBe(false);
    expect(bookingCreateSchema.safeParse({ ...base, name: '  Ana Pérez  ' }).success).toBe(true);
  });
});

describe('Cal r5: perfil público', () => {
  it('no lista links de un solo uso (ni sin usar ni usados)', async () => {
    const user = await makeUser('prof');
    const handle = `h${crypto.randomUUID().slice(0, 8)}`;
    await getDb().prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, user.id);
    const { et: open } = await setup('pub', { ownerId: user.id });
    const { et: single } = await setup('one', { ownerId: user.id, singleUse: true });
    const profile = await getPublicProfile(handle);
    const ids = profile?.eventTypes.map((e) => e.id) ?? [];
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(single.id);
  });
});

describe('Cal r5: bloqueos de horario por persona', () => {
  it('un miembro que bloquea desde el workspace del team bloquea su agenda, no la del dueño', async () => {
    const owner = await makeUser('blk-own');
    const member = await makeUser('blk-mem');
    session.user = { id: owner.id, email: owner.email, actingUser: { id: member.id } };
    const day = nextMonday();
    const res = await blockedRoute.POST(
      new NextRequest('http://x/api/calendar/blocked-slots', {
        method: 'POST',
        body: JSON.stringify({ startsAt: `${day}T15:00:00.000Z`, endsAt: `${day}T17:00:00.000Z` }),
      }),
    );
    expect(res.status).toBe(201);
    const from = new Date(`${day}T00:00:00.000Z`);
    const to = new Date(`${day}T23:59:00.000Z`);
    expect(await listBusyRanges(member.id, from, to, { internalOnly: true })).toHaveLength(1);
    expect(await listBusyRanges(owner.id, from, to, { internalOnly: true })).toHaveLength(0);

    // El dueño (sin actingUser) no lo ve en su lista.
    session.user = { id: owner.id, email: owner.email };
    const list = (await (await blockedRoute.GET(new NextRequest('http://x/api/calendar/blocked-slots'))).json()) as {
      rows: unknown[];
    };
    expect(list.rows).toHaveLength(0);
  });

  it('rechaza un bloqueo con el fin antes del inicio', async () => {
    const user = await makeUser('blk-inv');
    session.user = { id: user.id, email: user.email };
    const res = await blockedRoute.POST(
      new NextRequest('http://x/api/calendar/blocked-slots', {
        method: 'POST',
        body: JSON.stringify({ startsAt: '2026-11-02T17:00:00.000Z', endsAt: '2026-11-02T09:00:00.000Z' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_range');
  });

  it('el schema normaliza a ISO UTC', () => {
    const parsed = blockedSlotCreateSchema.parse({ startsAt: '2026-11-02T10:00:00-03:00', endsAt: '2026-11-02T11:00:00-03:00' });
    expect(parsed.startsAt).toBe('2026-11-02T13:00:00.000Z');
    expect(blockedSlotCreateSchema.safeParse({ startsAt: 'nope', endsAt: '2026-11-02T11:00:00Z' }).success).toBe(false);
  });
});

describe('Cal r5: reprogramar con el evento propio en Google', () => {
  it('subtractRange recorta, parte o deja igual', () => {
    const r = (a: number, b: number) => ({ start: new Date(a), end: new Date(b) });
    expect(subtractRange(r(0, 10), r(20, 30))).toEqual([r(0, 10)]);
    expect(subtractRange(r(0, 10), r(0, 10))).toEqual([]);
    expect(subtractRange(r(0, 30), r(10, 20))).toEqual([r(0, 10), r(20, 30)]);
  });

  it('se puede mover a un horario que se superpone con el actual', async () => {
    const { user, et } = await setup('gmove');
    // Con 30 min de margen antes, el slot de las 9:30 toca el de las 9:00.
    await getDb()
      .prepare('UPDATE calendar_event_types SET booking_rules = ? WHERE id = ?')
      .run(JSON.stringify({ bufferBeforeMin: 30 }), et.id);
    const day = nextMonday();
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    // El evento de Google de esta misma reserva.
    external.set(user.id, () => [{ start: new Date(booking.starts_at), end: new Date(booking.ends_at) }]);
    const target = new Date(`${day}T09:30:00.000Z`);
    const slot = await findOfferedSlot(et.id, target, 'UTC', { excludeBookingId: booking.id });
    expect(slot).not.toBeNull();
    const moved = await rescheduleBooking(booking.id, target);
    expect(moved.starts_at).toBe(target.toISOString());
    // Sin excluir la reserva, el evento de Google sigue ocupando el horario.
    expect(await findOfferedSlot(et.id, target, 'UTC')).toBeNull();
  });

  it('en round-robin no se reasigna por su propio evento de Google', async () => {
    const a = await makeUser('grr-a');
    const b = await makeUser('grr-b');
    const { et } = await setup('grr', { ownerId: a.id, durationMin: 60 });
    await setEventHosts(et.id, [a.id, b.id]);
    const day = nextMonday();
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    const host = booking.host_user_id!;
    external.set(host, () => [{ start: new Date(booking.starts_at), end: new Date(booking.ends_at) }]);
    const moved = await rescheduleBooking(booking.id, new Date(`${day}T09:30:00.000Z`));
    expect(moved.host_user_id).toBe(host);
  });
});

describe('Cal r5: rescheduleBooking', () => {
  it('una cancelación simultánea gana: no queda reprogramada', async () => {
    const { user, et } = await setup('race');
    const day = nextMonday();
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    // Se cancela mientras se busca host (después de leer el estado).
    external.set(user.id, async () => {
      await getDb().prepare(`UPDATE calendar_bookings SET status = 'cancelled' WHERE id = ?`).run(booking.id);
      return [];
    });
    await expect(rescheduleBooking(booking.id, new Date(`${day}T10:00:00.000Z`))).rejects.toMatchObject({
      code: 'not_confirmed',
    });
    const after = await bookingById(booking.id);
    expect(after.status).toBe('cancelled');
    expect(after.starts_at).toBe(booking.starts_at);
  });

  it('un hold vencido en el horario destino no impide reprogramar', async () => {
    const { user, et } = await setup('hold');
    const day = nextMonday();
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    const holdId = crypto.randomUUID();
    await getDb()
      .prepare(
        `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id, payment_status, hold_expires_at)
         VALUES (?, ?, 'h@x.com', 'H', ?, ?, 'pending', ?, 'pending', ?)`,
      )
      .run(holdId, et.id, `${day}T11:00:00.000Z`, `${day}T11:30:00.000Z`, user.id, new Date(Date.now() - 60_000).toISOString());
    const moved = await rescheduleBooking(booking.id, new Date(`${day}T11:00:00.000Z`));
    expect(moved.starts_at).toBe(`${day}T11:00:00.000Z`);
    expect((await bookingById(holdId)).status).toBe('cancelled');
  });
});

describe('Cal r5: horas propias', () => {
  it('rechaza rangos invertidos', () => {
    expect(availabilityBatchSchema.safeParse({ rules: [{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00' }] }).success).toBe(
      false,
    );
    expect(availabilityBatchSchema.safeParse({ rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }] }).success).toBe(
      true,
    );
  });
});

describe('Cal r5: recordatorios', () => {
  it('el cron vacía la cola en tandas (más de 50 vencidos)', async () => {
    const { user, et } = await setup('rem');
    const ids: string[] = [];
    const start = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const end = new Date(Date.now() + 7 * 3_600_000).toISOString();
    for (let i = 0; i < 60; i++) {
      const bid = crypto.randomUUID();
      await getDb()
        .prepare(
          `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id)
           VALUES (?, ?, ?, 'R', ?, ?, 'confirmed', NULL)`,
        )
        .run(bid, et.id, `r${i}@x.com`, start, end);
      const rid = crypto.randomUUID();
      await getDb()
        .prepare(`INSERT INTO calendar_reminders (id, booking_id, kind, send_at) VALUES (?, ?, 'reminder_24h', ?)`)
        .run(rid, bid, new Date(Date.now() - 60_000).toISOString());
      ids.push(rid);
    }
    void user;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await remindersRoute.POST(new NextRequest('http://x/api/calendar/reminders/due', { method: 'POST' }));
    expect(res.status).toBe(200);
    const placeholders = ids.map(() => '?').join(',');
    const pending = (await getDb()
      .prepare(`SELECT COUNT(*) AS c FROM calendar_reminders WHERE sent_at IS NULL AND id IN (${placeholders})`)
      .get(...ids)) as { c: number };
    expect(Number(pending.c)).toBe(0);
  });
});
