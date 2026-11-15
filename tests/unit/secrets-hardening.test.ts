import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { sendEmail } from '@/lib/email';
import { paymentsFake } from '@/lib/shop-payments';
import { booksPaymentsFake } from '@/lib/books-payments';

/** Secretos de crons, logs y modos falsos. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Cron: el secreto se compara en tiempo constante y sin él no corre', () => {
  const routes = [
    ['cron/calls', () => import('@/app/api/cron/calls/route')],
    ['cron/robots', () => import('@/app/api/cron/robots/route')],
    ['cron/send-render', () => import('@/app/api/cron/send-render/route')],
  ] as const;
  for (const [name, load] of routes) {
    it(`${name}: 401 con un secreto equivocado o sin header`, async () => {
      vi.stubEnv('CRON_SECRET', 'right-secret-value');
      const { GET } = await load();
      const bad = await GET(new NextRequest(`http://x/api/${name}`, { headers: { authorization: 'Bearer wrong-secret-value' } }));
      expect(bad.status).toBe(401);
      const none = await GET(new NextRequest(`http://x/api/${name}`));
      expect(none.status).toBe(401);
    });
  }

  it('recordatorios de Cal: 401 con un secreto equivocado', async () => {
    vi.stubEnv('CRON_SECRET', 'right-secret-value');
    const { GET } = await import('@/app/api/calendar/reminders/due/route');
    const res = await GET(new NextRequest('http://x/api/calendar/reminders/due', { headers: { authorization: 'Bearer nope' } }));
    expect(res.status).toBe(401);
  });
});

describe('Email: en un deploy sin proveedor, ni el cuerpo ni la dirección van a los logs', () => {
  it('no loguea el código ni el destinatario', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('VERCEL', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendEmail({ to: 'person@client.test', subject: 'Your code', text: 'Code 123456' });
    const printed = [...log.mock.calls, ...warn.mock.calls].flat().join(' ');
    expect(printed).not.toContain('123456');
    expect(printed).not.toContain('person@client.test');
  });
});

describe('Pagos falsos: solo fuera de producción o en el deploy de demo', () => {
  it('SHOP/BOOKS_PAYMENTS_FAKE no se prenden en producción', () => {
    vi.stubEnv('SHOP_PAYMENTS_FAKE', '1');
    vi.stubEnv('BOOKS_PAYMENTS_FAKE', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', '');
    expect(paymentsFake()).toBe(false);
    expect(booksPaymentsFake()).toBe(false);
    vi.stubEnv('DEMO_MODE', 'true');
    expect(paymentsFake()).toBe(true);
    expect(booksPaymentsFake()).toBe(true);
  });
});
