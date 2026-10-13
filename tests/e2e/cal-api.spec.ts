import { createHmac } from 'crypto';
import http from 'http';
import { expect, test } from '@playwright/test';

/** Un receptor de webhooks local que guarda lo que le llega. */
function receiver() {
  const got: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  return new Promise<{ url: string; got: typeof got; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/hook`, got, close: () => server.close() });
    }),
  );
}

test('Cal API v1 + webhooks firmados', async ({ request }) => {
  // API key del workspace demo.
  const key = (await (await request.post('/api/keys', { data: { name: 'e2e' } })).json()).key as string;
  const auth = { authorization: `Bearer ${key}` };

  const rx = await receiver();
  try {
    const created = await request.post('/api/webhooks', { data: { url: rx.url, events: ['booking.created', 'booking.cancelled'] } });
    expect(created.status(), await created.text()).toBe(201);
    const { secret } = await created.json();
    expect(secret).toMatch(/^whsec_/);

    const slug = `api-${Math.random().toString(36).slice(2, 8)}`;
    const et = await (await request.post('/api/calendar/event-types', { data: { slug, title: 'API call', durationMin: 30, active: true, location: 'Phone' } })).json();
    const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
    await request.post(`/api/calendar/event-types/${et.id}/availability`, { data: { rules } });

    const types = await (await request.get('/api/v1/calendar/event-types', { headers: auth })).json();
    expect(types.eventTypes.map((t: { slug: string }) => t.slug)).toContain(slug);

    const day = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    const booked = await request.post('/api/v1/calendar/bookings', {
      headers: auth,
      data: { eventTypeId: et.id, start: `${day}T13:00:00.000Z`, name: 'Ana', email: 'ana@example.com' },
    });
    expect(booked.status(), await booked.text()).toBe(201);
    const booking = await booked.json();
    expect(booking.invitee.email).toBe('ana@example.com');

    const again = await request.post('/api/v1/calendar/bookings', {
      headers: auth,
      data: { eventTypeId: et.id, start: `${day}T13:00:00.000Z`, name: 'Beto', email: 'b@example.com' },
    });
    expect(again.status()).toBe(409);

    const cancelled = await request.post(`/api/v1/calendar/bookings/${booking.id}/cancel`, { headers: auth, data: { reason: 'api' } });
    expect((await cancelled.json()).status).toBe('cancelled');

    await expect.poll(() => rx.got.map((g) => JSON.parse(g.body).type)).toEqual(['booking.created', 'booking.cancelled']);
    for (const g of rx.got) {
      const sig = String(g.headers['zerosoft-signature']);
      const [, t, v1] = /t=(\d+),v1=([a-f0-9]+)/.exec(sig)!;
      expect(createHmac('sha256', secret).update(`${t}.${g.body}`).digest('hex')).toBe(v1);
    }
    expect(JSON.parse(rx.got[0].body).data.eventType.slug).toBe(slug);

    const list = await (await request.get(`/api/v1/calendar/bookings?status=cancelled`, { headers: auth })).json();
    expect(list.bookings.map((b: { id: string }) => b.id)).toContain(booking.id);
  } finally {
    rx.close();
  }
});
