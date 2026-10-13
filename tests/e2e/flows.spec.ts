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

  const { handle } = await (await request.get('/api/calendar/config')).json();
  expect(handle).toBeTruthy();
  const res = await page.goto(`/en/book/${handle}/${slug}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByText('E2E').first()).toBeVisible();

  // Los links viejos /book/<slug> redirigen al nuevo.
  await page.goto(`/en/book/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/en/book/${handle}/${slug}$`));
});

test('Cal: cambiar el handle actualiza el link público', async ({ request, page }) => {
  const original = (await (await request.get('/api/calendar/config')).json()).handle as string;
  const next = `e2e-${uid()}`;
  const taken = await request.post('/api/calendar/config', { data: { handle: 'zerosoft' } });
  expect(taken.status()).toBe(400);
  const ok = await request.post('/api/calendar/config', { data: { handle: next, timezone: 'America/Argentina/Buenos_Aires' } });
  expect(ok.ok()).toBeTruthy();
  const badTz = await request.post('/api/calendar/config', { data: { timezone: 'Mars/Olympus' } });
  expect(badTz.status()).toBe(400);

  const slug = `h-${uid()}`;
  await request.post('/api/calendar/event-types', { data: { slug, title: 'Handle test', durationMin: 15, active: true } });
  expect((await page.goto(`/en/book/${next}/${slug}`))?.status()).toBe(200);
  expect((await page.goto(`/en/book/${original}/${slug}`))?.status()).toBe(404);
  await request.post('/api/calendar/config', { data: { handle: original } });
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

test('CRM: contacto → deal en el board → nota en el timeline', async ({ request, page }) => {
  const tag = uid();
  const contactRes = await request.post('/api/crm/contacts', {
    data: { firstName: 'E2E', lastName: tag, email: `e2e-${tag}@example.com` },
  });
  expect(contactRes.status()).toBe(201);
  const contact = await contactRes.json();

  const pipelines = await (await request.get('/api/crm/pipelines')).json();
  const pipeline = pipelines.rows[0];
  const stage = pipeline.stages[0];
  const dealRes = await request.post('/api/crm/deals', {
    data: { name: `Deal ${tag}`, pipelineId: pipeline.id, stageId: stage.id, amount: 1200, contactIds: [contact.id] },
  });
  expect(dealRes.status()).toBe(201);

  const note = await request.post('/api/crm/activities', {
    data: { type: 'note', subject: `Nota ${tag}`, body: 'hola', contactId: contact.id },
  });
  expect(note.status()).toBe(201);

  // Referencia a un registro inexistente → 400, no 500.
  const bad = await request.post('/api/crm/contacts', {
    data: { email: `x-${tag}@example.com`, companyId: '00000000-0000-0000-0000-000000000000' },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe('invalid_company');

  await page.goto(`/en/app/crm/contacts/${contact.id}`);
  await expect(page.getByText(`Nota ${tag}`).first()).toBeVisible();
  await expect(page.getByText(`Deal ${tag}`).first()).toBeVisible();

  await page.goto(`/en/app/crm/deals?pipeline=${pipeline.id}`);
  await expect(page.getByText(`Deal ${tag}`).first()).toBeVisible();
});
