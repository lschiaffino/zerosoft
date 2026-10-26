import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookingBusyRange,
  claimReminder,
  createBlockedSlot,
  createBooking,
  createEventType,
  getAvailableSlots,
  getOrCreateCalendarUser,
  releaseReminder,
  roundRobinOrder,
  setEventHosts,
} from '@/lib/calendar';
import { createSchedule } from '@/lib/calendar-schedules';
import { processDueWorkflowRuns, setWorkflowSteps, shouldSendWorkflowRun } from '@/lib/calendar-workflows';
import { createApiKey } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';
import { FLOW_EVENT_TYPES } from '@/lib/flow-schema';
import vercel from '@/vercel.json';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));
const emitted = vi.hoisted(() => [] as Array<{ type: string; data: { id?: string; status?: string } }>);
vi.mock('@/lib/events', async (orig) => ({
  ...(await orig<typeof import('@/lib/events')>()),
  emitEvent: async (_ws: string, type: string, data: { id?: string; status?: string }) => void emitted.push({ type, data }),
}));

const bookingRoute = await import('@/lib/routes/calendar/bookings/[id]/route');
const v1NoShow = await import('@/lib/routes/v1/calendar/bookings/[id]/no-show/route');
const minuteCron = await import('@/app/api/cron/minute/route');

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

async function setup(label: string, bookingRules?: Record<string, number>) {
  const u = await makeUser(label);
  await getOrCreateCalendarUser(u.id);
  const s = await createSchedule(u.id, {
    name: 'Todo',
    timezone: 'UTC',
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '18:00' })),
  });
  const et = await createEventType(u.id, { slug: `fx-${label}`, title: 'Demo', durationMin: 30, scheduleId: s.id });
  if (bookingRules) {
    await getDb().prepare('UPDATE calendar_event_types SET booking_rules = ? WHERE id = ?').run(JSON.stringify(bookingRules), et.id);
  }
  return { u, et };
}

const book = (eventTypeId: string, start: string, email = 'g@x.com') => createBooking({ eventTypeId, email, name: 'G', start });

beforeEach(() => {
  session.user = null;
  emitted.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('Flow y Cal: cron de cada minuto', () => {
  it('vercel.json corre /api/cron/minute cada minuto y mantiene el tick horario y robots', () => {
    const crons = (vercel as { crons: Array<{ path: string; schedule: string }> }).crons;
    expect(crons).toContainEqual({ path: '/api/cron/minute', schedule: '* * * * *' });
    expect(crons).toContainEqual({ path: '/api/cron/tick', schedule: '17 * * * *' });
    expect(crons.find((c) => c.path === '/api/cron/robots')).toBeTruthy();
  });

  it('exige CRON_SECRET y corre recordatorios, workflows y la cola de Flow', async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'shh';
    try {
      expect((await minuteCron.GET(req('http://x/api/cron/minute'))).status).toBe(401);
      expect((await minuteCron.GET(req('http://x/api/cron/minute', 'GET', undefined, { authorization: 'Bearer nope' }))).status).toBe(401);
      const ok = await minuteCron.GET(req('http://x/api/cron/minute', 'GET', undefined, { authorization: 'Bearer shh' }));
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { reminders: { workflows: unknown }; flow: { runs: number } };
      expect(body.reminders.workflows).toBeTruthy();
      expect(typeof body.flow.runs).toBe('number');
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it('un recordatorio se reclama una sola vez y se libera si falla el envío', async () => {
    const { et } = await setup('rem1');
    const day = nextDow(3, 4);
    const b = await book(et.id, `${day}T10:00:00.000Z`);
    const r = (await getDb().prepare('SELECT id FROM calendar_reminders WHERE booking_id = ?').get(b.id)) as { id: string };
    expect(r).toBeTruthy();
    const claims = await Promise.all([claimReminder(r.id), claimReminder(r.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await releaseReminder(r.id);
    expect(await claimReminder(r.id)).toBe(true);
  });
});

describe('Cal workflows: pasos "antes" que salen un poco tarde', () => {
  it('shouldSendWorkflowRun: se envía tarde mientras la reunión no empezó', () => {
    const run = { send_at: '2026-05-01T09:45:00.000Z', starts_at: '2026-05-01T10:00:00.000Z' };
    expect(shouldSendWorkflowRun(run, new Date('2026-05-01T09:46:00Z'))).toBe(true);
    expect(shouldSendWorkflowRun(run, new Date('2026-05-01T09:59:59Z'))).toBe(true);
    expect(shouldSendWorkflowRun(run, new Date('2026-05-01T10:00:00Z'))).toBe(false);
    expect(shouldSendWorkflowRun(run, new Date('2026-05-01T10:17:00Z'))).toBe(false);
    // Un paso "después" sale siempre.
    expect(shouldSendWorkflowRun({ ...run, send_at: '2026-05-01T10:30:00.000Z' }, new Date('2026-05-01T12:00:00Z'))).toBe(true);
  });

  it('un "15 minutos antes" levantado 5 minutos tarde se envía una sola vez aunque corran dos crons', async () => {
    const { u, et } = await setup('wflate');
    await setWorkflowSteps(u.id, et.id, [
      { recipient: 'guest' as const, offsetMin: -15, subject: 'Arranca pronto wflate', body: 'Ya casi' },
    ]);
    const day = nextDow(4, 4);
    const b = await book(et.id, `${day}T10:00:00.000Z`, 'late@x.com');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const at = new Date(Date.parse(`${day}T09:50:00Z`));
    await Promise.all([processDueWorkflowRuns(at), processDueWorkflowRuns(at)]);
    const sends = logs.filter((l) => l.includes('Arranca pronto wflate')).length;
    expect(sends).toBe(1);
    const runs = (await getDb().prepare('SELECT sent_at FROM calendar_workflow_runs WHERE booking_id = ?').all(b.id)) as Array<{
      sent_at: string | null;
    }>;
    expect(runs.every((r) => r.sent_at)).toBe(true);
    expect((await processDueWorkflowRuns(at)).sent).toBe(0);
  });
});

describe('Cal: buffers de las reservas existentes', () => {
  it('bookingBusyRange estira cada lado solo lo que excede al buffer enfrentado', () => {
    const r = { start: new Date('2026-05-01T09:00:00Z'), end: new Date('2026-05-01T09:30:00Z') };
    expect(bookingBusyRange(r, { before: 0, after: 15 }, { before: 0, after: 0 }).end.toISOString()).toBe('2026-05-01T09:45:00.000Z');
    expect(bookingBusyRange(r, { before: 0, after: 15 }, { before: 15, after: 0 }).end.toISOString()).toBe('2026-05-01T09:30:00.000Z');
    expect(bookingBusyRange(r, { before: 10, after: 0 }, { before: 0, after: 4 }).start.toISOString()).toBe('2026-05-01T08:54:00.000Z');
  });

  it('con buffer después de 15 min no hay reservas pegadas, en ninguno de los dos órdenes', async () => {
    const day = nextDow(1, 4);
    // Orden 1: primero 9:00, después 9:30 (antes entraba sin margen).
    const a = await setup('buf1', { bufferAfterMin: 15 });
    await book(a.et.id, `${day}T09:00:00.000Z`);
    const slotsA = (await getAvailableSlots(a.et.id, 'UTC', day)).map((s) => s.start.toISOString().slice(11, 16));
    expect(slotsA).not.toContain('09:30');
    expect(slotsA).toContain('10:00');
    await expect(book(a.et.id, `${day}T09:30:00.000Z`, 'b@x.com')).rejects.toMatchObject({ code: 'slot_unavailable' });
    expect((await book(a.et.id, `${day}T10:00:00.000Z`, 'c@x.com')).starts_at).toBe(`${day}T10:00:00.000Z`);

    // Orden 2: primero 9:30, después 9:00 (ya se bloqueaba).
    const b = await setup('buf2', { bufferAfterMin: 15 });
    await book(b.et.id, `${day}T09:30:00.000Z`);
    await expect(book(b.et.id, `${day}T09:00:00.000Z`, 'b@x.com')).rejects.toMatchObject({ code: 'slot_unavailable' });
  });

  it('el buffer de una reserva de otro event type del mismo host también protege', async () => {
    const day = nextDow(2, 4);
    const { u, et } = await setup('buf3', { bufferBeforeMin: 30 });
    const s = (await getDb().prepare('SELECT schedule_id FROM calendar_event_types WHERE id = ?').get(et.id)) as { schedule_id: string };
    const plain = await createEventType(u.id, { slug: 'fx-buf3-plain', title: 'Sin buffer', durationMin: 30, scheduleId: s.schedule_id });
    await book(et.id, `${day}T10:00:00.000Z`);
    // 9:30 a 10:00 cae en los 30 min antes de la reserva de las 10.
    const slots = (await getAvailableSlots(plain.id, 'UTC', day)).map((x) => x.start.toISOString().slice(11, 16));
    expect(slots).not.toContain('09:30');
    expect(slots).toContain('09:00');
    await expect(book(plain.id, `${day}T09:30:00.000Z`, 'p@x.com')).rejects.toMatchObject({ code: 'slot_unavailable' });
    const row = (await getDb()
      .prepare('SELECT buffer_before_min, buffer_after_min FROM calendar_bookings WHERE event_type_id = ?')
      .get(et.id)) as { buffer_before_min: number; buffer_after_min: number };
    expect(row).toEqual({ buffer_before_min: 30, buffer_after_min: 0 });
  });
});

describe('Cal: round-robin justo', () => {
  it('roundRobinOrder: primero quien hace más que no recibe, a igualdad el orden desde el cursor', () => {
    expect(roundRobinOrder(['a', 'b', 'c'], 1, new Map())).toEqual(['b', 'c', 'a']);
    const last = new Map([
      ['a', '2026-05-01T10:00:00.000Z'],
      ['b', '2026-05-01T09:00:00.000Z'],
    ]);
    expect(roundRobinOrder(['a', 'b', 'c'], 0, last)).toEqual(['c', 'b', 'a']);
  });

  it('si al del turno le tocaba un horario ocupado, no pierde el turno', async () => {
    const { u: a, et } = await setup('rr1');
    const b = await makeUser('rr1b');
    const c = await makeUser('rr1c');
    await setEventHosts(et.id, [a.id, b.id, c.id]);
    const day = nextDow(5, 4);
    // A está bloqueado a las 9: esa reserva va a B.
    await createBlockedSlot(a.id, { startsAt: `${day}T09:00:00.000Z`, endsAt: `${day}T09:30:00.000Z` } as Parameters<
      typeof createBlockedSlot
    >[1]);
    const hosts: string[] = [];
    for (const [i, time] of ['09:00', '11:00', '13:00', '15:00'].entries()) {
      hosts.push((await book(et.id, `${day}T${time}:00.000Z`, `rr${i}@x.com`)).host_user_id!);
    }
    // B (por A ocupado), después A recupera su turno, C, y vuelve B.
    expect(hosts).toEqual([b.id, a.id, c.id, b.id]);
  });
});

describe('Cal: webhook booking.no_show', () => {
  async function pastBooking(eventTypeId: string, hostId: string) {
    const past = new Date(Date.now() - 2 * 86_400_000);
    past.setUTCHours(10, 0, 0, 0);
    const id = crypto.randomUUID();
    await getDb()
      .prepare(
        `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id, manage_token)
         VALUES (?, ?, 'ns@x.com', 'NS', ?, ?, 'confirmed', ?, ?)`,
      )
      .run(id, eventTypeId, past.toISOString(), new Date(past.getTime() + 1_800_000).toISOString(), hostId, crypto.randomUUID().replace(/-/g, ''));
    return id;
  }

  it('existe en los catálogos de webhooks y de Flow', () => {
    expect(WEBHOOK_EVENTS).toContain('booking.no_show');
    expect(FLOW_EVENT_TYPES).toContain('booking.no_show');
  });

  it('se emite al marcar no-show desde el panel y desde la API v1, una vez por cambio', async () => {
    const { u, et } = await setup('ns1');
    const adminId = await pastBooking(et.id, u.id);
    session.user = u;
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'no_show' }), ctx(adminId))).status).toBe(200);
    expect(emitted.filter((e) => e.type === 'booking.no_show')).toEqual([
      { type: 'booking.no_show', data: expect.objectContaining({ id: adminId, status: 'no_show' }) },
    ]);
    // Volver a guardar el mismo estado no lo repite.
    expect((await bookingRoute.PATCH(req('http://x', 'PATCH', { status: 'no_show' }), ctx(adminId))).status).toBe(200);
    expect(emitted.filter((e) => e.type === 'booking.no_show')).toHaveLength(1);

    const v1Id = await pastBooking(et.id, u.id);
    const { key } = await createApiKey(u.id, 'test');
    const res = await v1NoShow.POST(req('http://x', 'POST', {}, { authorization: `Bearer ${key}` }), ctx(v1Id));
    expect(res.status).toBe(200);
    const events = emitted.filter((e) => e.type === 'booking.no_show');
    expect(events).toHaveLength(2);
    expect(events[1].data).toMatchObject({ id: v1Id, status: 'no_show' });
  });
});
