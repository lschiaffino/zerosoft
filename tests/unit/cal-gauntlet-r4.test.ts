import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmPendingBooking,
  createBooking,
  createEventType,
  getOrCreateCalendarUser,
  ownedBooking,
  rescheduleBooking,
  setAvailability,
  setEventHosts,
  updateBooking,
  updateEventType,
} from '@/lib/calendar';
import { afterBookingRescheduled } from '@/lib/calendar-lifecycle';
import { parsePriceInput, priceInputValue, priceProblem } from '@/lib/calendar-price';
import { processDueWorkflowRuns, setWorkflowSteps } from '@/lib/calendar-workflows';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));
const bookingRoute = await import('@/lib/routes/calendar/bookings/[id]/route');

/** Una fecha (YYYY-MM-DD, UTC) N días en el futuro que cae en lunes. */
function nextMonday(minDaysAhead = 2): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setup(label: string, opts: { singleUse?: boolean; teamId?: string; hostIds?: string[]; ownerId?: string } = {}) {
  const user = opts.ownerId ? { id: opts.ownerId } : await makeUser(label);
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `${label}-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Demo',
    durationMin: 30,
    active: true,
    ...(opts.singleUse ? { singleUse: true } : {}),
    ...(opts.teamId ? { teamId: opts.teamId } : {}),
    ...(opts.hostIds ? { hostIds: opts.hostIds } : {}),
  } as Parameters<typeof createEventType>[1]);
  await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] });
  return { user, et };
}

async function bookingById(id: string): Promise<CalendarBookingRow> {
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
  return logs;
}

beforeEach(() => {
  session.user = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Cal r4: reprogramar en round-robin', () => {
  it('mantiene al host actual si está libre en el horario nuevo', async () => {
    const a = await makeUser('rr-a');
    const b = await makeUser('rr-b');
    const { et } = await setup('rr1', { ownerId: a.id });
    await setEventHosts(et.id, [a.id, b.id]);
    const day = nextMonday();
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    expect(booking.host_user_id).toBe(a.id);
    // El cursor quedó apuntando a B: igual la reserva sigue con A.
    const moved = await rescheduleBooking(booking.id, new Date(`${day}T10:00:00.000Z`));
    expect(moved.host_user_id).toBe(a.id);
  });

  it('si pasa a otro host, el anterior recibe la cancelación y el nuevo la reserva', async () => {
    const a = await makeUser('rr-a');
    const b = await makeUser('rr-b');
    const { et } = await setup('rr2', { ownerId: a.id });
    await setEventHosts(et.id, [a.id, b.id]);
    const day = nextMonday();
    const booking = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'Gabi', start: `${day}T09:00:00.000Z` });
    expect(booking.host_user_id).toBe(a.id);
    await getDb()
      .prepare('INSERT INTO calendar_blocked_slots (id, user_id, starts_at, ends_at) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), a.id, `${day}T10:30:00.000Z`, `${day}T11:00:00.000Z`);
    const moved = await rescheduleBooking(booking.id, new Date(`${day}T10:30:00.000Z`));
    expect(moved.host_user_id).toBe(b.id);

    const logs = captureLogs();
    await afterBookingRescheduled(moved, a.id, undefined, { byHost: true });
    const out = logs.join('\n');
    expect(out).toContain(`to=g@x.com from=`);
    expect(out).toMatch(new RegExp(`to=${a.email} .*subject="Cancelled: Demo`));
    expect(out).toMatch(new RegExp(`to=${b.email} .*subject="New booking: Demo`));
  });
});

describe('Cal r4: miembro que sale del team', () => {
  it('sus reservas por venir pasan al owner y deja de verlas', async () => {
    const owner = await makeUser('own4');
    const team = await createTeam(owner.id, 'Ventas');
    const member = await makeUser('mem4');
    await addMember(team.id, member.id);
    const { et } = await setup('team4', { ownerId: owner.id, teamId: team.id, hostIds: [member.id] });
    const day = nextMonday();
    const future = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    expect(future.host_user_id).toBe(member.id);
    expect(await ownedBooking(member.id, future.id)).not.toBeNull();
    // Una reserva pasada que tuvo asignada.
    const pastId = crypto.randomUUID();
    await getDb()
      .prepare(
        `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id)
         VALUES (?, ?, 'p@x.com', 'P', '2020-01-06T09:00:00.000Z', '2020-01-06T09:30:00.000Z', 'confirmed', ?)`,
      )
      .run(pastId, et.id, member.id);

    const logs = captureLogs();
    await removeMember(team.id, member.id);
    expect((await bookingById(future.id)).host_user_id).toBe(owner.id);
    expect(logs.join('\n')).toMatch(new RegExp(`to=${owner.email} .*subject="New booking: Demo`));
    expect(logs.join('\n')).not.toContain(`to=${member.email}`);
    expect(await ownedBooking(member.id, future.id)).toBeNull();
    expect(await ownedBooking(member.id, pastId)).toBeNull();
    expect(await ownedBooking(owner.id, pastId)).not.toBeNull();
  });

  it('si queda otro host libre en el pool, la reserva pasa a ese host', async () => {
    const owner = await makeUser('own5');
    const team = await createTeam(owner.id, 'Ventas');
    const m1 = await makeUser('m5a');
    const m2 = await makeUser('m5b');
    await addMember(team.id, m1.id);
    await addMember(team.id, m2.id);
    const { et } = await setup('team5', { ownerId: owner.id, teamId: team.id, hostIds: [m1.id, m2.id] });
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    expect(b.host_user_id).toBe(m1.id);
    captureLogs();
    await removeMember(team.id, m1.id);
    expect((await bookingById(b.id)).host_user_id).toBe(m2.id);
  });
});

describe('Cal r4: precio con separador de miles', () => {
  it('parsePriceInput entiende miles y decimales con punto o coma', () => {
    expect(parsePriceInput('15.000', 'clp')).toBe(1_500_000);
    expect(parsePriceInput('15.000', 'ars')).toBe(1_500_000);
    expect(parsePriceInput('1.500.000', 'ars')).toBe(150_000_000);
    expect(parsePriceInput('1.500,50', 'ars')).toBe(150_050);
    expect(parsePriceInput('1,500.50', 'usd')).toBe(150_050);
    expect(parsePriceInput('15,5', 'usd')).toBe(1550);
    expect(parsePriceInput('15.50', 'usd')).toBe(1550);
    expect(parsePriceInput('15000', 'clp')).toBe(1_500_000);
    expect(parsePriceInput('0', 'usd')).toBe(0);
    expect(parsePriceInput('15.50', 'clp')).toBeNull();
    expect(parsePriceInput('1.50.0', 'usd')).toBeNull();
    expect(parsePriceInput('15.0000', 'usd')).toBeNull();
    expect(parsePriceInput('abc', 'usd')).toBeNull();
    expect(parsePriceInput('-5', 'usd')).toBeNull();
  });

  it('monedas sin decimales se muestran sin centavos', () => {
    expect(priceInputValue(1_500_000, 'clp')).toBe('15000');
    expect(priceInputValue(1550, 'usd')).toBe('15.50');
  });

  it('el servidor rechaza precios que Stripe no cobra', async () => {
    expect(priceProblem(20, 'usd')).toBe('below_minimum');
    expect(priceProblem(1550, 'clp')).toBe('zero_decimal');
    expect(priceProblem(0, 'usd')).toBeNull();
    const u = await makeUser('price');
    await getOrCreateCalendarUser(u.id);
    await expect(
      createEventType(u.id, { slug: `p-${crypto.randomUUID().slice(0, 6)}`, title: 'P', durationMin: 30, priceCents: 20, currency: 'usd' }),
    ).rejects.toMatchObject({ code: 'invalid_price', status: 400 });
    const et = await createEventType(u.id, {
      slug: `p-${crypto.randomUUID().slice(0, 6)}`,
      title: 'P',
      durationMin: 30,
      priceCents: 1550,
      currency: 'usd',
    });
    await expect(updateEventType(u.id, et.id, { currency: 'clp' })).rejects.toMatchObject({ code: 'invalid_price' });
    await expect(updateEventType(u.id, et.id, { priceCents: 1_500_000, currency: 'clp' })).resolves.toMatchObject({
      price_cents: 1_500_000,
    });
  });
});

describe('Cal r4: link de un solo uso con pago', () => {
  it('un hold no se confirma si otra reserva ya consumió el link', async () => {
    const { user, et } = await setup('su4', { singleUse: true });
    const day = nextMonday();
    const hold = await createBooking(
      { eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` },
      { hold: { expiresAt: new Date(Date.now() + 30 * 60_000), amountCents: 1000, currency: 'usd' } },
    );
    // Otra reserva del mismo link que entró en la carrera.
    await getDb()
      .prepare(
        `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id)
         VALUES (?, ?, 'o@x.com', 'O', ?, ?, 'confirmed', ?)`,
      )
      .run(crypto.randomUUID(), et.id, `${day}T11:00:00.000Z`, `${day}T11:30:00.000Z`, user.id);
    expect(await confirmPendingBooking(hold.id)).toBeNull();
    const after = await bookingById(hold.id);
    expect(after.status).toBe('cancelled');
    expect(after.cancel_reason).toBe('link_used');
  });
});

describe('Cal r4: transiciones condicionadas al estado leído', () => {
  it('no cancela una reserva que cambió de estado mientras tanto', async () => {
    const { et } = await setup('tr4');
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    await expect(updateBooking(b.id, { status: 'cancelled' }, { fromStatus: 'pending' })).rejects.toMatchObject({
      code: 'status_changed',
      status: 409,
    });
    expect((await bookingById(b.id)).status).toBe('confirmed');
  });
});

describe('Cal r4: no-show antes del inicio', () => {
  it('PATCH no marca no-show una reserva que todavía no empezó', async () => {
    const { user, et } = await setup('ns4');
    const day = nextMonday();
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'G', start: `${day}T09:00:00.000Z` });
    session.user = { id: user.id, email: `${user.id}@test.local` };
    const res = await bookingRoute.PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'no_show' }),
      }) as never,
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_started' });
    expect((await bookingById(b.id)).status).toBe('confirmed');
  });
});

describe('Cal r4: pasos de workflow que fallan siempre', () => {
  it('se abandonan después de unos intentos y no frenan al resto', async () => {
    const { user, et } = await setup('wf4r');
    await setWorkflowSteps(user.id, et.id, [{ recipient: 'guest', offsetMin: 30, subject: 'Gracias r4', body: 'Gracias' }]);
    const day = nextMonday();
    const bad = await createBooking({ eventTypeId: et.id, email: 'bad@x.com', name: 'B', start: `${day}T09:00:00.000Z` });
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) =>
      init.body.includes('bad@x.com')
        ? new Response(JSON.stringify({ message: 'Invalid `to` field' }), { status: 422 })
        : new Response(JSON.stringify({ id: 'ok' }), { status: 200 }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const later = new Date(Date.parse(`${day}T09:00:00Z`) + 2 * 86_400_000);
    for (let i = 0; i < 5; i++) await processDueWorkflowRuns(later);
    const run = (await getDb()
      .prepare('SELECT attempts, failed_at, sent_at FROM calendar_workflow_runs WHERE booking_id = ?')
      .get(bad.id)) as { attempts: number; failed_at: string | null; sent_at: string | null };
    expect(run.attempts).toBe(5);
    expect(run.failed_at).not.toBeNull();
    expect(run.sent_at).toBeNull();
    // Ya no entra en el lote del cron.
    const good = await createBooking({ eventTypeId: et.id, email: 'good@x.com', name: 'G', start: `${day}T10:00:00.000Z` });
    const res = await processDueWorkflowRuns(later);
    expect(res.failed).toBe(0);
    expect(
      ((await getDb().prepare('SELECT sent_at FROM calendar_workflow_runs WHERE booking_id = ?').get(good.id)) as {
        sent_at: string | null;
      }).sent_at,
    ).not.toBeNull();
  });
});
