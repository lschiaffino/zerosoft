import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooking, createEventType, getOrCreateCalendarUser, listUserBookings } from '@/lib/calendar';
import { createSchedule } from '@/lib/calendar-schedules';
import { createApiKey } from '@/lib/api-auth';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const listRoute = await import('@/app/api/calendar/bookings/route');
const bookingRoute = await import('@/lib/routes/calendar/bookings/[id]/route');
const rescheduleRoute = await import('@/lib/routes/calendar/bookings/[id]/reschedule/route');
const slotsRoute = await import('@/lib/routes/calendar/bookings/[id]/slots/route');
const v1NoShow = await import('@/lib/routes/v1/calendar/bookings/[id]/no-show/route');
const v1Reschedule = await import('@/lib/routes/v1/calendar/bookings/[id]/reschedule/route');
const v1List = await import('@/app/api/v1/calendar/bookings/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function req(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const r = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Object.assign(r, { nextUrl: new URL(url) }) as never;
}

function nextDow(dow: number, minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setup(label: string) {
  const u = await makeUser(label);
  await getOrCreateCalendarUser(u.id);
  const s = await createSchedule(u.id, {
    name: 'Todo',
    timezone: 'UTC',
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '18:00' })),
  });
  const et = await createEventType(u.id, { slug: `adm-${label}`, title: 'Demo', durationMin: 60, scheduleId: s.id });
  const day = nextDow(2);
  const ana = await createBooking({ eventTypeId: et.id, email: 'ana@acme.com', name: 'Ana Pérez', start: `${day}T09:00:00.000Z` });
  const bruno = await createBooking({ eventTypeId: et.id, email: 'bruno@foo.io', name: 'Bruno', start: `${day}T11:00:00.000Z` });
  // Una reserva pasada (para no-show).
  const past = new Date(Date.now() - 2 * 86_400_000);
  past.setUTCHours(10, 0, 0, 0);
  const pastId = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id, manage_token)
       VALUES (?, ?, 'carla@x.com', 'Carla', ?, ?, 'confirmed', ?, ?)`,
    )
    .run(pastId, et.id, past.toISOString(), new Date(past.getTime() + 3_600_000).toISOString(), u.id, crypto.randomUUID().replace(/-/g, ''));
  return { u, et, day, ana, bruno, pastId };
}

async function row(id: string) {
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

beforeEach(() => {
  session.user = null;
});
afterEach(() => vi.restoreAllMocks());

describe('reservas: búsqueda y filtros', () => {
  it('busca por nombre o email, filtra por estado y fechas, y aísla por workspace', async () => {
    const { u, day } = await setup('adm1');
    const other = await makeUser('adm1b');
    expect((await listUserBookings(u.id, { q: 'acme' })).map((b) => b.invitee_name)).toEqual(['Ana Pérez']);
    expect((await listUserBookings(u.id, { q: 'BRUNO' })).map((b) => b.invitee_email)).toEqual(['bruno@foo.io']);
    expect(await listUserBookings(u.id, { q: '%' })).toEqual([]);
    expect(await listUserBookings(other.id, { q: 'ana' })).toEqual([]);

    session.user = u;
    const res = await listRoute.GET(req(`http://x/api/calendar/bookings?from=${day}&to=${day}`));
    const data = (await res.json()) as { bookings: CalendarBookingRow[] };
    expect(data.bookings.map((b) => b.invitee_name)).toEqual(['Ana Pérez', 'Bruno']);
    const byStatus = (await (await listRoute.GET(req('http://x/api/calendar/bookings?status=cancelled'))).json()) as {
      bookings: unknown[];
    };
    expect(byStatus.bookings).toEqual([]);
    expect((await listRoute.GET(req('http://x/api/calendar/bookings?from=ayer'))).status).toBe(400);

    session.user = other;
    const none = (await (await listRoute.GET(req('http://x/api/calendar/bookings'))).json()) as { bookings: unknown[] };
    expect(none.bookings).toEqual([]);
    session.user = null;
    expect((await listRoute.GET(req('http://x/api/calendar/bookings'))).status).toBe(401);
  });
});

describe('reservas: acciones del anfitrión', () => {
  it('no-show, cancelar con motivo y aislamiento', async () => {
    const { u, ana, pastId } = await setup('adm2');
    const other = await makeUser('adm2b');
    session.user = other;
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'no_show' }), ctx(pastId))).status).toBe(404);

    session.user = u;
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'no_show' }), ctx(pastId))).status).toBe(200);
    expect((await row(pastId)).status).toBe('no_show');

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const cancel = await bookingRoute.PATCH(
      req('http://x', 'PATCH', { status: 'cancelled', cancelReason: 'Me surgió algo' }),
      ctx(ana.id),
    );
    expect(cancel.status).toBe(200);
    expect(await row(ana.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'Me surgió algo' });
    expect(logs.join('\n')).toContain('Me surgió algo');
  });

  it('una reserva esperando pago solo se puede cancelar', async () => {
    const { u, et, day } = await setup('adm3');
    const pending = await createBooking(
      { eventTypeId: et.id, email: 'p@x.com', name: 'P', start: `${day}T15:00:00.000Z` },
      { hold: { expiresAt: new Date(Date.now() + 30 * 60_000), amountCents: 100, currency: 'usd' } },
    );
    session.user = u;
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'confirmed' }), ctx(pending.id))).status).toBe(409);
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'no_show' }), ctx(pending.id))).status).toBe(409);
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'cancelled' }), ctx(pending.id))).status).toBe(200);
  });

  it('una cancelada no vuelve a confirmada; un no-show vuelve solo si el horario sigue libre', async () => {
    const { u, et, ana, bruno, pastId } = await setup('adm5');
    session.user = u;
    const patch = (id: string, status: string) => bookingRoute.PATCH(req('http://x', 'PATCH', { status }), ctx(id));
    expect((await patch(ana.id, 'cancelled')).status).toBe(200);
    expect((await patch(ana.id, 'confirmed')).status).toBe(409);
    expect((await patch(ana.id, 'no_show')).status).toBe(409);
    expect((await row(ana.id)).status).toBe('cancelled');

    expect((await patch(pastId, 'no_show')).status).toBe(200);
    expect((await patch(pastId, 'confirmed')).status).toBe(200);

    // No-show de bruno y otra reserva toma su horario: ya no se puede deshacer.
    // (Una reserva futura no se puede marcar no-show por la API: se fuerza el estado.)
    expect((await patch(bruno.id, 'no_show')).status).toBe(409);
    await getDb().prepare("UPDATE calendar_bookings SET status = 'no_show' WHERE id = ?").run(bruno.id);
    await createBooking({ eventTypeId: et.id, email: 'z@x.com', name: 'Z', start: bruno.starts_at });
    expect((await patch(bruno.id, 'confirmed')).status).toBe(409);
    expect((await row(bruno.id)).status).toBe('no_show');
  });

  it('reprogramar: solo horarios ofrecidos, avisa al invitado con .ics y no al anfitrión', async () => {
    const { u, ana, day } = await setup('adm4');
    const other = await makeUser('adm4b');

    session.user = other;
    expect((await slotsRoute.GET(req(`http://x?date=${day}&timezone=UTC`), ctx(ana.id))).status).toBe(404);
    expect((await rescheduleRoute.POST(req('http://x', 'POST', { start: `${day}T13:00:00.000Z` }), ctx(ana.id))).status).toBe(404);

    session.user = u;
    const slots = (await (await slotsRoute.GET(req(`http://x?date=${day}&timezone=UTC`), ctx(ana.id))).json()) as {
      slots: Array<{ start: string }>;
    };
    const starts = slots.slots.map((s) => s.start);
    // La propia reserva no cuenta como ocupada; la de Bruno sí.
    expect(starts).toContain(`${day}T09:00:00.000Z`);
    expect(starts).not.toContain(`${day}T11:00:00.000Z`);

    // Ocupado por Bruno / fuera del horario.
    expect((await rescheduleRoute.POST(req('http://x', 'POST', { start: `${day}T11:00:00.000Z` }), ctx(ana.id))).status).toBe(409);
    expect((await rescheduleRoute.POST(req('http://x', 'POST', { start: `${day}T20:00:00.000Z` }), ctx(ana.id))).status).toBe(409);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const ok = await rescheduleRoute.POST(req('http://x', 'POST', { start: `${day}T13:00:00.000Z` }), ctx(ana.id));
    expect(ok.status).toBe(200);
    expect(await row(ana.id)).toMatchObject({ starts_at: `${day}T13:00:00.000Z`, rescheduled_from: `${day}T09:00:00.000Z` });
    const out = logs.join('\n');
    expect(out).toContain('to=ana@acme.com');
    expect(out).toContain('invite.ics');
    expect(out).not.toContain(`to=${u.email}`);
  });
});

describe('API v1: reprogramar y no-show', () => {
  it('exige key del workspace y aplica las mismas reglas', async () => {
    const { u, bruno, pastId, day } = await setup('adm5');
    const other = await makeUser('adm5b');
    const { key } = await createApiKey(u.id, 'test');
    const { key: otherKey } = await createApiKey(other.id, 'test');
    const auth = (k: string) => ({ authorization: `Bearer ${k}` });

    expect((await v1NoShow.POST(req('http://x', 'POST', {}, auth(otherKey)), ctx(pastId))).status).toBe(404);
    const ns = await v1NoShow.POST(req('http://x', 'POST', {}, auth(key)), ctx(pastId));
    expect(ns.status).toBe(200);
    expect(((await ns.json()) as { status: string }).status).toBe('no_show');
    expect((await v1NoShow.POST(req('http://x', 'POST', {}, auth(key)), ctx(pastId))).status).toBe(409);

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(
      (await v1Reschedule.POST(req('http://x', 'POST', { start: `${day}T16:00:00.000Z` }, auth(otherKey)), ctx(bruno.id))).status,
    ).toBe(404);
    expect((await v1Reschedule.POST(req('http://x', 'POST', { start: 'mañana' }, auth(key)), ctx(bruno.id))).status).toBe(400);
    const moved = await v1Reschedule.POST(req('http://x', 'POST', { start: `${day}T16:00:00.000Z` }, auth(key)), ctx(bruno.id));
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { startsAt: string }).startsAt).toBe(`${day}T16:00:00.000Z`);

    const list = await v1List.GET(req('http://x/api/v1/calendar/bookings?q=bruno&status=confirmed', 'GET', undefined, auth(key)));
    expect(((await list.json()) as { bookings: Array<{ invitee: { email: string } }> }).bookings.map((b) => b.invitee.email)).toEqual([
      'bruno@foo.io',
    ]);
  });

  it('el spec OpenAPI incluye los endpoints nuevos', async () => {
    const { buildOpenApiSpec } = await import('@/lib/openapi');
    const spec = buildOpenApiSpec() as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths['/api/v1/calendar/bookings/{id}/reschedule']?.post).toBeTruthy();
    expect(spec.paths['/api/v1/calendar/bookings/{id}/no-show']?.post).toBeTruthy();
  });
});
