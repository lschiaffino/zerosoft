import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveBooking,
  CalendarError,
  computeDaySlots,
  createBooking,
  createEventType,
  declineBooking,
  expireUnconfirmedBookings,
  findOfferedSlot,
  getAvailableDays,
  getAvailableSlots,
  getOrCreateCalendarUser,
  rescheduleBooking,
  setAvailability,
  setEventHosts,
  updateEventType,
} from '@/lib/calendar';
import { normalizeLimits, periodBounds, slotStepMin, withinLimits } from '@/lib/calendar-limits';
import { buildRedirectUrl, isValidRedirectUrl, parseUtm, sanitizeUtm } from '@/lib/calendar-redirect';
import { eventTypeCreateSchema } from '@/lib/calendar-schema';
import { bookingPayload } from '@/lib/calendar-lifecycle';
import { notifyBooking } from '@/lib/calendar-notify';
import { meetingLimitsDraft, meetingLimitsPayload } from '@/components/calendar/cal-utils';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { makeUser } from './helpers';

const bookingsRoute = await import('@/app/api/calendar/bookings/route');

function nextDow(dow: number, minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function setup(label: string, rules: Record<string, unknown> = {}, opts: { durationMin?: number } = {}) {
  const user = await makeUser(label);
  await getOrCreateCalendarUser(user.id);
  const et = await createEventType(user.id, {
    slug: `${label}-${crypto.randomUUID().slice(0, 6)}`,
    title: 'Demo',
    durationMin: opts.durationMin ?? 30,
    active: true,
    bookingRules: rules,
  } as Parameters<typeof createEventType>[1]);
  // Lunes a viernes de 9 a 12 (UTC: la zona por defecto del workspace).
  await setAvailability(et.id, {
    rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '12:00' })),
  });
  return { user, et };
}

const book = (eventTypeId: string, start: string, extra: Record<string, unknown> = {}) =>
  createBooking({ eventTypeId, email: `g-${crypto.randomUUID().slice(0, 6)}@x.com`, name: 'Gabi', start, ...extra });

async function bookingById(id: string): Promise<CalendarBookingRow> {
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CalendarError);
  await p.catch((e: CalendarError) => expect(e.code).toBe(code));
}

afterEach(() => vi.restoreAllMocks());

// ---------- Reglas puras ----------

describe('Cal: saltos de inicio', () => {
  it('sin intervalo propio, la duración; con uno válido, ese', () => {
    expect(slotStepMin(60)).toBe(60);
    expect(slotStepMin(60, 15)).toBe(15);
    expect(slotStepMin(60, 3)).toBe(60);
    expect(slotStepMin(60, 12.5)).toBe(60);
  });

  it('una reunión de 60 minutos cada 15 entre 9 y 11', () => {
    const slots = computeDaySlots({
      date: '2026-11-02',
      guestTimezone: 'UTC',
      scheduleTimezone: 'UTC',
      weekly: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }],
      overrides: [],
      durationMin: 60,
      stepMin: 15,
      minStart: new Date(0),
    });
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00']);
    expect(slots.every((s) => s.end.getTime() - s.start.getTime() === 3_600_000)).toBe(true);
  });
});

describe('Cal: períodos de los topes', () => {
  it('día, semana (inicio configurable) y mes en la zona del horario', () => {
    const at = new Date('2026-11-04T15:00:00Z'); // miércoles
    expect(periodBounds(at, 'day', 'UTC')).toEqual({ start: new Date('2026-11-04T00:00:00Z'), end: new Date('2026-11-05T00:00:00Z') });
    expect(periodBounds(at, 'week', 'UTC', 1).start.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(periodBounds(at, 'week', 'UTC', 0).start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(periodBounds(at, 'month', 'UTC')).toEqual({ start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') });
    // Buenos Aires (UTC-3): el día local empieza a las 03:00 UTC.
    expect(periodBounds(new Date('2026-11-04T02:00:00Z'), 'day', 'America/Argentina/Buenos_Aires').start.toISOString()).toBe(
      '2026-11-03T03:00:00.000Z',
    );
    // Diciembre pasa a enero del año siguiente.
    expect(periodBounds(new Date('2026-12-20T12:00:00Z'), 'month', 'UTC').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('withinLimits cuenta solo las reservas del mismo período', () => {
    const starts = [new Date('2026-11-02T09:00:00Z'), new Date('2026-11-03T09:00:00Z')];
    expect(withinLimits(starts, new Date('2026-11-02T10:00:00Z'), { day: 1 }, 'UTC')).toBe(false);
    expect(withinLimits(starts, new Date('2026-11-04T10:00:00Z'), { day: 1 }, 'UTC')).toBe(true);
    expect(withinLimits(starts, new Date('2026-11-04T10:00:00Z'), { week: 2 }, 'UTC')).toBe(false);
    expect(withinLimits(starts, new Date('2026-11-09T10:00:00Z'), { week: 2 }, 'UTC')).toBe(true);
    expect(withinLimits(starts, new Date('2026-11-30T10:00:00Z'), { month: 3 }, 'UTC')).toBe(true);
  });

  it('normalizeLimits descarta valores inválidos', () => {
    expect(normalizeLimits({ day: 2, week: 0, month: 1.5, extra: 3 })).toEqual({ day: 2 });
    expect(normalizeLimits(null)).toEqual({});
  });

  it('el formulario guarda solo los topes completos', () => {
    expect(meetingLimitsPayload({ day: '3', week: '', month: ' ' })).toEqual({ day: 3 });
    expect(meetingLimitsPayload({ day: '', week: '', month: '' })).toBeUndefined();
    expect(meetingLimitsPayload({ day: '0', week: '', month: '' })).toBeNull();
    expect(meetingLimitsPayload({ day: '2.5', week: '', month: '' })).toBeNull();
    expect(meetingLimitsDraft({ week: 4 })).toEqual({ day: '', week: '4', month: '' });
  });
});

describe('Cal: UTM y redirección', () => {
  it('sanitizeUtm deja solo utm_* de una línea', () => {
    expect(sanitizeUtm({ utm_source: 'news', utm_medium: ['cpc', 'x'], foo: 'bar', utm_term: '  ', utm_content: 'a\nb' })).toEqual({
      utm_source: 'news',
      utm_medium: 'cpc',
      utm_content: 'a b',
    });
    expect(sanitizeUtm({ utm_campaign: 'x'.repeat(300) }).utm_campaign).toHaveLength(200);
    expect(parseUtm('nope')).toEqual({});
  });

  it('solo URLs http/https absolutas y sin credenciales', () => {
    expect(isValidRedirectUrl('https://example.com/thanks')).toBe(true);
    expect(isValidRedirectUrl('http://example.com')).toBe(true);
    expect(isValidRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isValidRedirectUrl('/relative')).toBe(false);
    expect(isValidRedirectUrl('https://user:pw@example.com')).toBe(false);
    expect(eventTypeCreateSchema.safeParse({ slug: 'a', title: 'A', durationMin: 30, bookingRules: { redirectUrl: 'ftp://x.com' } }).success).toBe(false);
    expect(
      eventTypeCreateSchema.safeParse({ slug: 'a', title: 'A', durationMin: 30, bookingRules: { redirectUrl: 'https://x.com/ok' } }).success,
    ).toBe(true);
    expect(eventTypeCreateSchema.safeParse({ slug: 'a', title: 'A', durationMin: 30, bookingRules: { meetingLimits: { day: 0 } } }).success).toBe(false);
  });

  it('con "pasar datos" la URL lleva la reserva y sus utm, y conserva sus parámetros', () => {
    const details = {
      bookingId: 'b1',
      status: 'confirmed',
      startsAt: '2026-11-02T09:00:00.000Z',
      endsAt: '2026-11-02T09:30:00.000Z',
      timezone: 'UTC',
      name: 'Ana Pérez',
      email: 'ana@x.com',
      eventSlug: 'intro',
      eventTitle: 'Intro',
      utm: { utm_source: 'news' },
    };
    expect(buildRedirectUrl('https://x.com/thanks?ref=1', false, details)).toBe('https://x.com/thanks?ref=1');
    const url = new URL(buildRedirectUrl('https://x.com/thanks?ref=1', true, details)!);
    expect(url.searchParams.get('ref')).toBe('1');
    expect(url.searchParams.get('booking_id')).toBe('b1');
    expect(url.searchParams.get('name')).toBe('Ana Pérez');
    expect(url.searchParams.get('utm_source')).toBe('news');
    expect(buildRedirectUrl('javascript:alert(1)', true, details)).toBeNull();
  });
});

// ---------- Motor y reservas ----------

describe('Cal: intervalo de inicio en el motor', () => {
  it('60 minutos cada 30 entre 9 y 12 ofrece 5 inicios', async () => {
    const { et } = await setup('int', { slotIntervalMin: 30 }, { durationMin: 60 });
    const day = nextDow(1);
    const slots = await getAvailableSlots(et.id, 'UTC', day);
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
    // Una reserva a las 9:30 ocupa 9:30-10:30: quedan 10:30 y 11:00 (9:00 se superpone).
    await book(et.id, `${day}T09:30:00.000Z`);
    const after = await getAvailableSlots(et.id, 'UTC', day);
    expect(after.map((s) => s.start.toISOString().slice(11, 16))).toEqual(['10:30', '11:00']);
  });
});

describe('Cal: topes de reuniones', () => {
  it('tope diario: el día lleno no ofrece horarios y la reserva se rechaza', async () => {
    const { et } = await setup('lim-day', { meetingLimits: { day: 2 } });
    const day = nextDow(1);
    await book(et.id, `${day}T09:00:00.000Z`);
    expect((await getAvailableSlots(et.id, 'UTC', day)).length).toBeGreaterThan(0);
    await book(et.id, `${day}T10:00:00.000Z`);
    expect(await getAvailableSlots(et.id, 'UTC', day)).toEqual([]);
    expect(await findOfferedSlot(et.id, new Date(`${day}T11:00:00.000Z`), 'UTC')).toBeNull();
    await expectCode(book(et.id, `${day}T11:00:00.000Z`), 'slot_unavailable');
    // El día siguiente sigue libre, y el mes no muestra el día lleno.
    expect((await getAvailableSlots(et.id, 'UTC', addDays(day, 1))).length).toBeGreaterThan(0);
    expect(await getAvailableDays(et.id, 'UTC', day.slice(0, 7))).not.toContain(day);
  });

  it('tope semanal cuenta toda la semana; una cancelada no cuenta', async () => {
    const { et } = await setup('lim-week', { meetingLimits: { week: 1 } });
    const monday = nextDow(1);
    const first = await book(et.id, `${monday}T09:00:00.000Z`);
    expect(await getAvailableSlots(et.id, 'UTC', addDays(monday, 2))).toEqual([]);
    expect((await getAvailableSlots(et.id, 'UTC', addDays(monday, 7))).length).toBeGreaterThan(0);
    await getDb().prepare("UPDATE calendar_bookings SET status = 'cancelled' WHERE id = ?").run(first.id);
    expect((await getAvailableSlots(et.id, 'UTC', addDays(monday, 2))).length).toBeGreaterThan(0);
  });

  it('reprogramar dentro del mismo día no choca con su propio lugar', async () => {
    const { et } = await setup('lim-resched', { meetingLimits: { day: 1 } });
    const day = nextDow(1);
    const b = await book(et.id, `${day}T09:00:00.000Z`);
    const moved = await rescheduleBooking(b.id, new Date(`${day}T10:00:00.000Z`));
    expect(moved.starts_at).toBe(`${day}T10:00:00.000Z`);
  });

  it('tope por host: la segunda reserva del día va al otro host del pool', async () => {
    const { user, et } = await setup('lim-host', { hostMeetingLimits: { day: 1 } });
    const other = await makeUser('lim-host-2');
    await setEventHosts(et.id, [user.id, other.id]);
    const day = nextDow(1);
    const a = await book(et.id, `${day}T09:00:00.000Z`);
    const b = await book(et.id, `${day}T10:00:00.000Z`);
    expect(new Set([a.host_user_id, b.host_user_id])).toEqual(new Set([user.id, other.id]));
    // Los dos hosts llegaron a su tope: no queda nada ese día.
    expect(await getAvailableSlots(et.id, 'UTC', day)).toEqual([]);
    await expectCode(book(et.id, `${day}T11:00:00.000Z`), 'slot_unavailable');
  });
});

describe('Cal: confirmación del anfitrión', () => {
  it('la reserva queda pendiente, ocupa el horario y no programa recordatorios', async () => {
    const { et } = await setup('appr', { requiresConfirmation: true });
    const day = nextDow(1, 4);
    const b = await book(et.id, `${day}T09:00:00.000Z`);
    expect(b.status).toBe('pending');
    expect(b.approval).toBe('pending');
    expect(b.hold_expires_at).toBeNull();
    expect(await findOfferedSlot(et.id, new Date(`${day}T09:00:00.000Z`), 'UTC')).toBeNull();
    const reminders = await getDb().prepare('SELECT COUNT(*) AS c FROM calendar_reminders WHERE booking_id = ?').get(b.id);
    expect(Number((reminders as { c: number }).c)).toBe(0);

    const approved = await approveBooking(b.id);
    expect(approved.status).toBe('confirmed');
    expect(approved.approval).toBe('approved');
    const after = await getDb().prepare('SELECT COUNT(*) AS c FROM calendar_reminders WHERE booking_id = ?').get(b.id);
    expect(Number((after as { c: number }).c)).toBe(1);
    await expectCode(approveBooking(b.id), 'status_changed');
  });

  it('rechazarla libera el horario', async () => {
    const { et } = await setup('decl', { requiresConfirmation: true });
    const day = nextDow(1);
    const b = await book(et.id, `${day}T09:00:00.000Z`);
    const declined = await declineBooking(b.id, 'Sin lugar');
    expect(declined.status).toBe('cancelled');
    expect(declined.approval).toBe('declined');
    expect(declined.cancel_reason).toBe('Sin lugar');
    expect(await findOfferedSlot(et.id, new Date(`${day}T09:00:00.000Z`), 'UTC')).not.toBeNull();
    await expectCode(declineBooking(b.id), 'status_changed');
  });

  it('una solicitud sin respuesta vence al llegar su inicio', async () => {
    const { et } = await setup('exp', { requiresConfirmation: true });
    const day = nextDow(1);
    const b = await book(et.id, `${day}T09:00:00.000Z`);
    const expired = await expireUnconfirmedBookings(new Date(`${day}T09:00:00.000Z`));
    expect(expired.map((r) => r.id)).toContain(b.id);
    const row = await bookingById(b.id);
    expect(row.status).toBe('cancelled');
    expect(row.cancel_reason).toBe('not_confirmed');
  });

  it('no se combina con un precio', async () => {
    const user = await makeUser('appr-paid');
    await getOrCreateCalendarUser(user.id);
    await expectCode(
      createEventType(user.id, {
        slug: `p-${crypto.randomUUID().slice(0, 6)}`,
        title: 'Paga',
        durationMin: 30,
        priceCents: 1000,
        currency: 'usd',
        bookingRules: { requiresConfirmation: true },
      } as Parameters<typeof createEventType>[1]),
      'confirmation_paid',
    );
    const { user: owner, et } = await setup('appr-paid-2', { requiresConfirmation: true });
    await expectCode(updateEventType(owner.id, et.id, { priceCents: 1000 }) as Promise<unknown>, 'confirmation_paid');
  });

  it('emails: solicitud sin .ics al invitado y link de revisión al anfitrión', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const { et } = await setup('appr-mail', { requiresConfirmation: true });
    const b = await book(et.id, `${nextDow(1)}T09:00:00.000Z`, { locale: 'es' });
    await notifyBooking(b, 'requested');
    const out = logs.join('\n');
    expect(out).toContain('Recibimos tu solicitud: Demo');
    expect(out).toContain('Solicitud de reserva: Demo de Gabi');
    expect(out).toContain('/es/app/calendar/bookings?status=pending');
    expect(out).toContain('Retirar la solicitud');
    expect(out).not.toContain('invite.ics');
  });
});

describe('Cal: UTM en la reserva y redirección desde la ruta', () => {
  it('guarda solo utm_* y los manda en el payload del webhook', async () => {
    const { et } = await setup('utm');
    const b = await book(et.id, `${nextDow(1)}T09:00:00.000Z`, { utm: { utm_source: 'news', utm_medium: 'email', ref: 'x' } });
    expect(JSON.parse(b.utm)).toEqual({ utm_source: 'news', utm_medium: 'email' });
    const payload = bookingPayload(b, et);
    expect(payload.utm).toEqual({ utm_source: 'news', utm_medium: 'email' });
    expect(payload.approval).toBe('none');
  });

  it('POST /api/calendar/bookings devuelve la redirección con los datos', async () => {
    const { et } = await setup('redir', { redirectUrl: 'https://example.com/thanks', redirectPassDetails: true, requiresConfirmation: true });
    const start = `${nextDow(1)}T09:00:00.000Z`;
    const body = { eventTypeId: et.id, email: 'ana@x.com', name: 'Ana', start, timezone: 'UTC', utm: { utm_campaign: 'otoño' } };
    const r = new Request('http://localhost/api/calendar/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.1` },
      body: JSON.stringify(body),
    });
    const res = await bookingsRoute.POST(Object.assign(r, { nextUrl: new URL(r.url) }) as never);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { awaitingApproval: boolean; redirectUrl: string; status: string };
    expect(data.status).toBe('pending');
    expect(data.awaitingApproval).toBe(true);
    const url = new URL(data.redirectUrl);
    expect(url.origin + url.pathname).toBe('https://example.com/thanks');
    expect(url.searchParams.get('status')).toBe('pending');
    expect(url.searchParams.get('email')).toBe('ana@x.com');
    expect(url.searchParams.get('utm_campaign')).toBe('otoño');
  });
});
