import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEventType,
  createBooking,
  expireUnpaidHolds,
  findOfferedSlot,
  getOrCreateCalendarUser,
  updateEventType,
} from '@/lib/calendar';
import { createSchedule } from '@/lib/calendar-schedules';
import {
  abandonCheckout,
  getPaymentSettings,
  reconcileCheckout,
  savePaymentSettings,
  signStripePayload,
  stripeUnitAmount,
  verifyStripeSignature,
} from '@/lib/calendar-payments';
import { getDb, type CalendarBookingRow } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role?: string }, admin: true }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  isWorkspaceAdmin: () => session.admin,
}));

const bookingsRoute = await import('@/app/api/calendar/bookings/route');
const webhookRoute = await import('@/lib/routes/calendar/payments/webhook/[token]/route');
const paymentsRoute = await import('@/app/api/calendar/payments/route');
const bookingAdminRoute = await import('@/lib/routes/calendar/bookings/[id]/route');
const manageRoute = await import('@/lib/routes/calendar/bookings/manage/[token]/route');

const KEY = 'sk_test_51abcDEF123456';
const WHSEC = 'whsec_testsecret123';

function nextDow(dow: number, minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const stripeCalls: Array<{ url: string; method: string; body: string; auth: string }> = [];
let sessionCounter = 0;
let sessionPaid = true;

function stripeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://api.stripe.com/')) return Promise.reject(new Error(`unexpected fetch ${url}`));
  const headers = new Headers(init?.headers);
  stripeCalls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? ''), auth: headers.get('authorization') ?? '' });
  if (url.endsWith('/checkout/sessions') && init?.method === 'POST') {
    sessionCounter += 1;
    const id = `cs_test_${sessionCounter}`;
    return Promise.resolve(Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` }));
  }
  if (url.endsWith('/refunds') && init?.method === 'POST') return Promise.resolve(Response.json({ id: 're_test_1', status: 'succeeded' }));
  const exp = /checkout\/sessions\/([^/?]+)\/expire$/.exec(url);
  if (exp && init?.method === 'POST') return Promise.resolve(Response.json({ id: exp[1], status: 'expired' }));
  const m = /checkout\/sessions\/([^/?]+)$/.exec(url);
  if (m) return Promise.resolve(Response.json({ id: m[1], payment_status: sessionPaid ? 'paid' : 'unpaid', payment_intent: `pi_${m[1]}` }));
  return Promise.resolve(Response.json({ error: { message: 'nope' } }, { status: 404 }));
}

beforeAll(() => {
  process.env.RATE_LIMIT_DISABLED = 'true';
  // Sin DNS en los tests: safeFetch no resuelve api.stripe.com.
  process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
});
afterAll(() => {
  delete process.env.RATE_LIMIT_DISABLED;
  delete process.env.ALLOW_PRIVATE_WEBHOOKS;
});
beforeEach(() => {
  session.user = null;
  session.admin = true;
  stripeCalls.length = 0;
  sessionPaid = true;
  vi.stubGlobal('fetch', vi.fn(stripeFetch));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function paidEventType(label: string, opts: { configure?: boolean; webhook?: boolean } = {}) {
  const u = await makeUser(label);
  await getOrCreateCalendarUser(u.id);
  const s = await createSchedule(u.id, {
    name: 'Todo',
    timezone: 'UTC',
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '18:00' })),
  });
  const et = await createEventType(u.id, {
    slug: `pay-${label}`,
    title: 'Consulta',
    durationMin: 60,
    scheduleId: s.id,
    priceCents: 4500,
    currency: 'usd',
  });
  if (opts.configure !== false) {
    await savePaymentSettings(u.id, { stripeSecretKey: KEY, ...(opts.webhook !== false ? { stripeWebhookSecret: WHSEC } : {}) });
  }
  const settings = await getPaymentSettings(u.id);
  const token = settings.webhookPath.split('/').pop() as string;
  return { u, et, token };
}

function book(eventTypeId: string, start: string, email = 'g@x.com') {
  return bookingsRoute.POST(
    new Request('http://localhost/api/calendar/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventTypeId, email, name: 'Gabi', start, timezone: 'UTC', locale: 'es' }),
    }) as never,
  );
}

function webhook(token: string, event: unknown, opts: { secret?: string; t?: number } = {}) {
  const raw = JSON.stringify(event);
  return webhookRoute.POST(
    new Request(`http://localhost/api/calendar/payments/webhook/${token}`, {
      method: 'POST',
      headers: { 'stripe-signature': signStripePayload(raw, opts.secret ?? WHSEC, opts.t) },
      body: raw,
    }) as never,
    { params: Promise.resolve({ token }) },
  );
}

/** Evento de Checkout como lo manda Stripe para la sesión de una reserva. */
function sessionEvent(type: string, row: CalendarBookingRow, object: Record<string, unknown> = {}) {
  return {
    type,
    data: {
      object: {
        id: row.stripe_session_id,
        payment_status: 'paid',
        amount_total: row.amount_cents,
        currency: row.currency,
        payment_intent: `pi_${row.id}`,
        metadata: { booking_id: row.id, source: 'zerosoft_cal' },
        ...object,
      },
    },
  };
}

async function outcomeOf(res: Response): Promise<string> {
  return ((await res.json()) as { outcome: string }).outcome;
}

async function bookingRow(id: string) {
  return (await getDb().prepare('SELECT * FROM calendar_bookings WHERE id = ?').get(id)) as CalendarBookingRow;
}

describe('firma del webhook de Stripe', () => {
  const body = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  it('acepta la firma correcta y rechaza secreto, cuerpo, tiempo o formato incorrectos', () => {
    const header = signStripePayload(body, WHSEC, t);
    expect(verifyStripeSignature(body, header, WHSEC, t)).toBe(true);
    expect(verifyStripeSignature(body, header, WHSEC, t + 299)).toBe(true);
    expect(verifyStripeSignature(body, header, WHSEC, t + 301)).toBe(false);
    expect(verifyStripeSignature(body, header, 'whsec_other', t)).toBe(false);
    expect(verifyStripeSignature(`${body} `, header, WHSEC, t)).toBe(false);
    expect(verifyStripeSignature(body, null, WHSEC, t)).toBe(false);
    expect(verifyStripeSignature(body, 'garbage', WHSEC, t)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=zz`, WHSEC, t)).toBe(false);
    // Varias firmas v1 (rotación de secreto): alcanza con una válida.
    const v1 = header.split('v1=')[1];
    expect(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${v1}`, WHSEC, t)).toBe(true);
  });

  it('monedas sin decimales', () => {
    expect(stripeUnitAmount(4500, 'usd')).toBe(4500);
    expect(stripeUnitAmount(1_000_000, 'clp')).toBe(10_000);
  });
});

describe('configuración de pagos', () => {
  it('guarda la clave cifrada y nunca la devuelve', async () => {
    const u = await makeUser('paycfg');
    const view = await savePaymentSettings(u.id, { stripeSecretKey: KEY });
    expect(view).toMatchObject({ configured: true, mode: 'test', hasWebhookSecret: false });
    expect(view.keyHint).toBe('sk_test_…3456');
    const raw = (await getDb().prepare('SELECT stripe_secret_key FROM calendar_payment_settings WHERE user_id = ?').get(u.id)) as {
      stripe_secret_key: string;
    };
    expect(raw.stripe_secret_key.startsWith('enc:v1:')).toBe(true);
    expect(raw.stripe_secret_key).not.toContain('abcDEF');
    expect((await savePaymentSettings(u.id, { stripeSecretKey: '' })).configured).toBe(false);
  });

  it('API: sesión, solo admins guardan, formato de clave validado, aislado por workspace', async () => {
    expect((await paymentsRoute.GET()).status).toBe(401);
    const a = await makeUser('payapi');
    const b = await makeUser('payapib');
    session.user = a;
    const put = (body: unknown) =>
      paymentsRoute.PUT(
        new Request('http://x/api/calendar/payments', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }) as never,
      );
    expect((await put({ stripeSecretKey: 'pk_test_123' })).status).toBe(400);
    const ok = await put({ stripeSecretKey: KEY, stripeWebhookSecret: WHSEC });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain(KEY);
    session.admin = false;
    expect((await put({ stripeSecretKey: '' })).status).toBe(403);
    session.user = b;
    expect(((await (await paymentsRoute.GET()).json()) as { configured: boolean }).configured).toBe(false);
  });
});

describe('reserva paga con Stripe Checkout', () => {
  it('retiene el horario, crea la sesión con la clave del workspace y el webhook la confirma una vez', async () => {
    const { et, token } = await paidEventType('pay1');
    const day = nextDow(2);
    const res = await book(et.id, `${day}T10:00:00.000Z`);
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; status: string; checkoutUrl: string; manageToken: string };
    expect(data.status).toBe('pending');
    expect(data.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/cs_test_${sessionCounter}`);

    const call = stripeCalls[0];
    expect(call.auth).toBe(`Bearer ${KEY}`);
    const form = new URLSearchParams(call.body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('4500');
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(form.get('metadata[booking_id]')).toBe(data.id);
    expect(form.get('success_url')).toContain(`/es/book/manage/${data.manageToken}?paid=1&session_id={CHECKOUT_SESSION_ID}`);
    expect(Number(form.get('expires_at')) - Date.now() / 1000).toBeGreaterThan(30 * 60);

    let row = await bookingRow(data.id);
    expect(row).toMatchObject({ status: 'pending', payment_status: 'pending', amount_cents: 4500, currency: 'usd' });
    // El hold ocupa el horario.
    expect(await findOfferedSlot(et.id, new Date(`${day}T10:00:00.000Z`), 'UTC')).toBeNull();
    expect((await book(et.id, `${day}T10:00:00.000Z`, 'other@x.com')).status).toBe(409);

    const event = sessionEvent('checkout.session.completed', row);
    const ok = await webhook(token, event);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { outcome: string }).outcome).toBe('confirmed');
    row = await bookingRow(data.id);
    expect(row).toMatchObject({ status: 'confirmed', payment_status: 'paid', hold_expires_at: null });
    // Recordatorio de 24h programado al confirmar.
    const reminders = await getDb().prepare('SELECT COUNT(*) AS c FROM calendar_reminders WHERE booking_id = ?').get(data.id);
    expect(Number((reminders as { c: number }).c)).toBe(1);
    // Reintento del mismo evento: no hace nada.
    expect(((await (await webhook(token, event)).json()) as { outcome: string }).outcome).toBe('ignored');
  });

  it('firma inválida, token desconocido o reserva de otro workspace no confirman nada', async () => {
    const a = await paidEventType('pay2');
    const b = await paidEventType('pay2b');
    const day = nextDow(3);
    const data = (await (await book(a.et.id, `${day}T11:00:00.000Z`)).json()) as { id: string };
    const event = sessionEvent('checkout.session.completed', await bookingRow(data.id));

    expect((await webhook(a.token, event, { secret: 'whsec_wrong' })).status).toBe(400);
    expect((await webhook(a.token, event, { t: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(400);
    expect((await webhook('nope', event)).status).toBe(404);
    // Firmado con el secreto de B y enviado a la URL de B: la reserva es de A.
    expect(((await (await webhook(b.token, event)).json()) as { outcome: string }).outcome).toBe('ignored');
    expect((await bookingRow(data.id)).status).toBe('pending');
  });

  it('sin pago: el hold vence (cron o checkout.session.expired) y el horario se libera', async () => {
    const { et, token } = await paidEventType('pay3');
    const day = nextDow(4);
    const first = (await (await book(et.id, `${day}T12:00:00.000Z`)).json()) as { id: string };
    expect(await expireUnpaidHolds(new Date(Date.now() + 36 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(await bookingRow(first.id)).toMatchObject({ status: 'cancelled', payment_status: 'expired', cancel_reason: 'payment_expired' });
    expect(await findOfferedSlot(et.id, new Date(`${day}T12:00:00.000Z`), 'UTC')).not.toBeNull();

    const second = (await (await book(et.id, `${day}T12:00:00.000Z`, 'h@x.com')).json()) as { id: string };
    const res = await webhook(token, sessionEvent('checkout.session.expired', await bookingRow(second.id), { payment_status: 'unpaid' }));
    expect(((await res.json()) as { outcome: string }).outcome).toBe('expired');
    expect((await bookingRow(second.id)).status).toBe('cancelled');
  });

  it('al volver de Checkout se confirma consultando la sesión (si el webhook todavía no llegó)', async () => {
    const { et } = await paidEventType('pay4');
    const day = nextDow(5);
    const data = (await (await book(et.id, `${day}T13:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    sessionPaid = false;
    expect(await reconcileCheckout(row, row.stripe_session_id as string)).toBeNull();
    expect(await reconcileCheckout(row, 'cs_forged')).toBeNull();
    sessionPaid = true;
    expect((await reconcileCheckout(row, row.stripe_session_id as string))?.status).toBe('confirmed');
  });

  it('con precio pero sin Stripe conectado: 409 y no se crea la reserva; si Stripe falla se libera', async () => {
    const { u, et } = await paidEventType('pay5', { configure: false });
    const day = nextDow(1);
    const res = await book(et.id, `${day}T14:00:00.000Z`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('payments_not_configured');

    // Solo la clave, sin signing secret: tampoco se cobra (el pago podría no confirmarse nunca).
    await savePaymentSettings(u.id, { stripeSecretKey: KEY });
    expect((await book(et.id, `${day}T14:00:00.000Z`)).status).toBe(409);

    await savePaymentSettings(u.id, { stripeWebhookSecret: WHSEC });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'boom' } }, { status: 500 })));
    expect((await book(et.id, `${day}T14:00:00.000Z`)).status).toBe(502);
    expect(await findOfferedSlot(et.id, new Date(`${day}T14:00:00.000Z`), 'UTC')).not.toBeNull();

    // Gratis otra vez: reserva confirmada directo, sin Stripe.
    await updateEventType(u.id, et.id, { priceCents: 0 });
    const free = await book(et.id, `${day}T14:00:00.000Z`);
    expect(((await free.json()) as { status: string }).status).toBe('confirmed');
  });
});

describe('webhook: la sesión tiene que ser la de la reserva', () => {
  it('ignora Payment Links con client_reference_id, otra sesión, otro monto u otra moneda', async () => {
    const { et, token } = await paidEventType('pay6');
    const day = nextDow(2, 10);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);

    // Payment Link de USD 1 de la misma cuenta, con ?client_reference_id=<reserva>.
    const paymentLink = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_live_link', payment_status: 'paid', amount_total: 100, currency: 'usd', client_reference_id: data.id } },
    };
    expect(await outcomeOf(await webhook(token, paymentLink))).toBe('ignored');
    // metadata copiada pero sin la marca de Cal, otra sesión, otro monto u otra moneda.
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row, { metadata: { booking_id: data.id } })))).toBe('ignored');
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row, { id: 'cs_test_other' })))).toBe('ignored');
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row, { amount_total: 100 })))).toBe('ignored');
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row, { currency: 'mxn' })))).toBe('ignored');
    // Ni expirar la reserva desde otra sesión.
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.expired', row, { id: 'cs_test_other' })))).toBe('ignored');
    expect(await bookingRow(data.id)).toMatchObject({ status: 'pending', payment_status: 'pending' });

    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('confirmed');
  });
});

describe('pagos tardíos', () => {
  it('hold vencido por el cron con el horario libre: el pago confirma igual', async () => {
    const { et, token } = await paidEventType('pay7');
    const day = nextDow(3, 10);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    await expireUnpaidHolds(new Date(Date.now() + 36 * 60_000));
    expect((await bookingRow(data.id)).status).toBe('cancelled');

    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('confirmed');
    expect(await bookingRow(data.id)).toMatchObject({ status: 'confirmed', payment_status: 'paid', cancel_reason: null });
    expect(stripeCalls.some((c) => c.url.endsWith('/refunds'))).toBe(false);
  });

  it('hold vencido y horario ya tomado: se reembolsa una sola vez y no queda reserva', async () => {
    const { et, token } = await paidEventType('pay8');
    const day = nextDow(4, 10);
    const first = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(first.id);
    await expireUnpaidHolds(new Date(Date.now() + 36 * 60_000));
    const second = (await (await book(et.id, `${day}T10:00:00.000Z`, 'other@x.com')).json()) as { id: string };
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', await bookingRow(second.id))))).toBe('confirmed');

    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('refunded');
    const refunds = stripeCalls.filter((c) => c.url.endsWith('/refunds'));
    expect(refunds).toHaveLength(1);
    expect(new URLSearchParams(refunds[0].body).get('payment_intent')).toBe(`pi_${first.id}`);
    expect(await bookingRow(first.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    // Reintento de Stripe: no reembolsa de nuevo.
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('ignored');
    expect(stripeCalls.filter((c) => c.url.endsWith('/refunds'))).toHaveLength(1);
  });

  it('el anfitrión cancela el hold: se expira la sesión y un pago que igual llega se reembolsa', async () => {
    const { u, et, token } = await paidEventType('pay9');
    const day = nextDow(5, 10);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    session.user = u;
    const res = await bookingAdminRoute.PATCH(
      new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }) as never,
      { params: Promise.resolve({ id: data.id }) },
    );
    expect(res.status).toBe(200);
    expect(stripeCalls.some((c) => c.method === 'POST' && c.url.endsWith(`/checkout/sessions/${row.stripe_session_id}/expire`))).toBe(true);

    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('refunded');
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
  });

  it('medio asíncrono (sesión completa sin pagar): el hold se estira y el pago posterior confirma', async () => {
    const { et, token } = await paidEventType('pay10');
    const day = nextDow(6, 10);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row, { payment_status: 'unpaid' })))).toBe('held');
    expect(await expireUnpaidHolds(new Date(Date.now() + 36 * 60_000))).toBe(0);
    expect((await bookingRow(data.id)).status).toBe('pending');
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.async_payment_succeeded', row)))).toBe('confirmed');
  });
});

describe('holds y el índice único', () => {
  it('dos holds del mismo host al mismo horario no pueden coexistir', async () => {
    const { u, et } = await paidEventType('pay11');
    const day = nextDow(1, 10);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    // Lo que haría una segunda request que pasó pickFreeHost a la vez.
    await expect(
      getDb()
        .prepare(
          `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, host_user_id, payment_status, hold_expires_at)
           VALUES (?, ?, 'race@x.com', 'R', ?, ?, 'pending', ?, 'pending', ?)`,
        )
        .run(crypto.randomUUID(), et.id, row.starts_at, row.ends_at, u.id, new Date(Date.now() + 30 * 60_000).toISOString()),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('un hold vencido que el cron no limpió no bloquea una reserva nueva', async () => {
    const { et } = await paidEventType('pay12');
    const day = nextDow(2, 11);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    await getDb()
      .prepare('UPDATE calendar_bookings SET hold_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), data.id);
    expect((await book(et.id, `${day}T10:00:00.000Z`, 'next@x.com')).status).toBe(201);
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'payment_expired' });
  });
});

describe('volver de Checkout sin pagar', () => {
  it('cancel_url pasa por la gestión: libera el hold, expira la sesión y vuelve a la página de reserva', async () => {
    const { u, et } = await paidEventType('pay13');
    const day = nextDow(3, 11);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string; manageToken: string };
    const form = new URLSearchParams(stripeCalls[0].body);
    expect(form.get('cancel_url')).toContain(`/es/book/manage/${data.manageToken}?checkout=cancelled`);
    const row = await bookingRow(data.id);

    expect(await abandonCheckout(row)).toBe(`/book/${u.handle}/${et.slug}`);
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'payment_expired' });
    expect(stripeCalls.some((c) => c.url.endsWith(`/checkout/sessions/${row.stripe_session_id}/expire`))).toBe(true);
    // El mismo invitado puede volver a elegir el mismo horario.
    expect((await book(et.id, `${day}T10:00:00.000Z`)).status).toBe(201);
  });
});

function cancelAsHost(id: string, body: Record<string, unknown> = { status: 'cancelled' }) {
  return bookingAdminRoute.PATCH(
    new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id }) },
  );
}

/** Reserva paga y confirmada por el webhook. */
async function paidBooking(label: string, day: string) {
  const ctx = await paidEventType(label);
  const data = (await (await book(ctx.et.id, `${day}T10:00:00.000Z`)).json()) as { id: string; manageToken: string };
  expect(await outcomeOf(await webhook(ctx.token, sessionEvent('checkout.session.completed', await bookingRow(data.id))))).toBe('confirmed');
  return { ...ctx, data };
}

describe('cancelar una reserva paga', () => {
  it('el anfitrión cancela: se reembolsa una sola vez y queda refunded', async () => {
    const { u, data } = await paidBooking('pay14', nextDow(4, 11));
    const row = await bookingRow(data.id);
    session.user = u;
    const res = await cancelAsHost(data.id, { status: 'cancelled', cancelReason: 'Me surgió algo' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { payment_status: string }).payment_status).toBe('refunded');
    const refunds = stripeCalls.filter((c) => c.url.endsWith('/refunds'));
    expect(refunds).toHaveLength(1);
    expect(new URLSearchParams(refunds[0].body).get('payment_intent')).toBe(`pi_${row.stripe_session_id}`);
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    // Repetir la cancelación no reembolsa de nuevo.
    expect((await cancelAsHost(data.id)).status).toBe(200);
    expect(stripeCalls.filter((c) => c.url.endsWith('/refunds'))).toHaveLength(1);
  });

  it('el invitado cancela desde su link de gestión: también se reembolsa', async () => {
    const { data } = await paidBooking('pay15', nextDow(5, 11));
    const res = await manageRoute.POST(
      new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }) as never,
      { params: Promise.resolve({ token: data.manageToken }) },
    );
    expect(res.status).toBe(200);
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    expect(stripeCalls.filter((c) => c.url.endsWith('/refunds'))).toHaveLength(1);
  });

  it('si Stripe falla, la cancelación sigue y el pago queda en paid', async () => {
    const { u, data } = await paidBooking('pay16', nextDow(6, 11));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'boom' } }, { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    session.user = u;
    expect((await cancelAsHost(data.id)).status).toBe(200);
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', payment_status: 'paid' });
  });
});

describe('medio asíncrono y el inicio de la reunión', () => {
  it('el hold no se estira más allá del inicio y un pago acreditado con la reunión empezada se reembolsa', async () => {
    const { et, token } = await paidEventType('pay17');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const data = (await (await book(et.id, `${tomorrow}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row, { payment_status: 'unpaid' })))).toBe('held');
    expect((await bookingRow(data.id)).hold_expires_at).toBe(row.starts_at);

    // El boleto se acredita cuando la reunión ya pasó (y el cron no corrió).
    const past = (ms: number) => new Date(Date.now() - ms).toISOString();
    await getDb()
      .prepare('UPDATE calendar_bookings SET starts_at = ?, ends_at = ?, hold_expires_at = ? WHERE id = ?')
      .run(past(2 * 3_600_000), past(3_600_000), past(2 * 3_600_000), data.id);
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.async_payment_succeeded', row)))).toBe('refunded');
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
  });
});

describe('hold vencido que el cron todavía no limpió', () => {
  it('un pago tardío no confirma encima de otra reserva solapada: se reembolsa', async () => {
    const { u, et, token } = await paidEventType('pay18');
    const day = nextDow(1, 11);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    await getDb()
      .prepare('UPDATE calendar_bookings SET hold_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), data.id);
    // Otro tipo de evento gratis del mismo anfitrión, con otro inicio que se solapa.
    const free = await createEventType(u.id, { slug: 'pay18-free', title: 'Libre', durationMin: 60, scheduleId: et.schedule_id ?? undefined });
    const other = await createBooking({ eventTypeId: free.id, email: 'o@x.com', name: 'O', start: `${day}T10:30:00.000Z` });
    expect(other.status).toBe('confirmed');

    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('refunded');
    expect(await bookingRow(data.id)).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
  });

  it('con el horario libre, el pago tardío confirma igual', async () => {
    const { et, token } = await paidEventType('pay19');
    const day = nextDow(2, 12);
    const data = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const row = await bookingRow(data.id);
    await getDb()
      .prepare('UPDATE calendar_bookings SET hold_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), data.id);
    expect(await outcomeOf(await webhook(token, sessionEvent('checkout.session.completed', row)))).toBe('confirmed');
    expect(await bookingRow(data.id)).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
  });
});

describe('link de un solo uso con precio', () => {
  it('mientras hay un hold vivo no acepta otra reserva; si el hold vence, sí', async () => {
    const { u, et } = await paidEventType('pay20');
    await updateEventType(u.id, et.id, { singleUse: true });
    const day = nextDow(3, 12);
    const first = (await (await book(et.id, `${day}T10:00:00.000Z`)).json()) as { id: string };
    const second = await book(et.id, `${day}T14:00:00.000Z`, 'other@x.com');
    expect(second.status).toBe(410);
    await expireUnpaidHolds(new Date(Date.now() + 36 * 60_000));
    expect((await bookingRow(first.id)).status).toBe('cancelled');
    expect((await book(et.id, `${day}T14:00:00.000Z`, 'other@x.com')).status).toBe(201);
  });
});
