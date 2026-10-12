import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

test('sitio: home y páginas de producto responden', async ({ page }) => {
  for (const path of ['/en', '/es/products/link', '/pt/products/cal', '/en/status']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
});

test('Link: crear, redirigir y contar el click', async ({ request, page }) => {
  const slug = `e2e${uid()}`;
  const created = await request.post('/api/links', { data: { url: 'https://example.com/destino', slug } });
  expect(created.status()).toBe(201);
  const link = await created.json();

  const redirect = await request.get(`/${slug}`, { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(redirect.status());
  expect(redirect.headers()['location']).toBe('https://example.com/destino');

  await expect
    .poll(async () => {
      const res = await request.get(`/api/links/${link.id}`);
      const body = await res.json();
      return body.clicks ?? body.link?.clicks ?? body.total_clicks;
    })
    .toBeGreaterThan(0);

  const res = await page.goto('/en/app/links');
  expect(res?.status()).toBe(200);
  await expect(page.getByText(slug).first()).toBeVisible();
});

test('Link: el gate con contraseña bloquea y luego deja pasar', async ({ request }) => {
  const slug = `gate${uid()}`;
  await request.post('/api/links', { data: { url: 'https://example.com/privado', slug, password: 'ceros' } });
  const first = await request.get(`/${slug}`, { maxRedirects: 0 });
  expect(first.headers()['location'] ?? '').toContain('/gate/');
  const bad = await request.post('/api/gate', { data: { slug, password: 'mal' } });
  expect(bad.ok()).toBeFalsy();
  const good = await request.post('/api/gate', { data: { slug, password: 'ceros' } });
  expect(good.ok()).toBeTruthy();
});

test('Cal: crear evento, ver slots y reservar', async ({ request, page }) => {
  const slug = `e2e-${uid()}`;
  const et = await request.post('/api/calendar/event-types', {
    data: { slug, title: 'E2E', durationMin: 30, active: true },
  });
  expect(et.status()).toBe(201);
  const eventType = await et.json();
  const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
  expect((await request.post(`/api/calendar/event-types/${eventType.id}/availability`, { data: { rules } })).ok()).toBeTruthy();

  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const slotsRes = await request.get(`/api/calendar/event-types/${eventType.id}/slots?date=${day}&timezone=UTC`);
  const { slots } = await slotsRes.json();
  expect(slots.length).toBeGreaterThan(0);

  const booking = await request.post('/api/calendar/bookings', {
    data: { eventTypeId: eventType.id, email: 'guest@example.com', name: 'Guest', start: slots[0].start, timezone: 'UTC' },
  });
  expect(booking.status()).toBe(201);

  const again = await request.get(`/api/calendar/event-types/${eventType.id}/slots?date=${day}&timezone=UTC`);
  const after = (await again.json()).slots as Array<{ start: string }>;
  expect(after.map((s) => s.start)).not.toContain(slots[0].start);

  const res = await page.goto(`/en/book/${slug}`);
  expect(res?.status()).toBe(200);
});

test('Chat: el widget manda un mensaje y aparece en el inbox', async ({ request }) => {
  const w = await request.post('/api/chat/widgets', { data: { name: `E2E ${uid()}` } });
  expect(w.status()).toBeLessThan(300);
  const widget = await w.json();
  const widgetId = widget.id ?? widget.widget?.id;

  const pre = await request.fetch('/api/chat/messages', {
    method: 'OPTIONS',
    headers: { origin: 'https://cliente.example', 'access-control-request-method': 'POST' },
  });
  expect(pre.headers()['access-control-allow-origin']).toBe('*');

  const visitorId = `v-${uid()}`;
  const sent = await request.post('/api/chat/messages', {
    headers: { origin: 'https://cliente.example' },
    data: { widgetId, visitorId, body: 'Hola desde e2e' },
  });
  expect(sent.status()).toBeLessThan(300);

  const thread = await request.get(`/api/chat/messages?widgetId=${widgetId}&visitorId=${visitorId}`);
  expect(JSON.stringify(await thread.json())).toContain('Hola desde e2e');
});

test('Track: crear proyecto e issue', async ({ request }) => {
  const p = await request.post('/api/track/projects', { data: { name: `E2E ${uid()}` } });
  expect(p.status()).toBe(201);
  const project = await p.json();
  const i = await request.post(`/api/track/projects/${project.id}/issues`, { data: { title: 'Primer issue' } });
  expect(i.status()).toBeLessThan(300);
  const list = await request.get(`/api/track/projects/${project.id}/issues`);
  expect(JSON.stringify(await list.json())).toContain('Primer issue');
});

test('Link: el gate corta la fuerza bruta con 429', async ({ request }) => {
  const slug = `brute${uid()}`;
  await request.post('/api/links', { data: { url: 'https://example.com/x', slug, password: 'secreta' } });
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    statuses.push((await request.post('/api/gate', { data: { slug, password: `mal${i}` } })).status());
  }
  expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
  expect(statuses.at(-1)).toBe(429);
});
