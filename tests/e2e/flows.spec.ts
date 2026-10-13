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

test('Cal → CRM: reservar crea el contacto con la reunión en su timeline', async ({ request, page }) => {
  const tag = uid();
  const email = `cal-${tag}@example.com`;
  const et = await request.post('/api/calendar/event-types', {
    data: { slug: `crm-${tag}`, title: `Demo ${tag}`, durationMin: 30, active: true },
  });
  const eventType = await et.json();
  const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
  await request.post(`/api/calendar/event-types/${eventType.id}/availability`, { data: { rules } });
  const day = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const { slots } = await (await request.get(`/api/calendar/event-types/${eventType.id}/slots?date=${day}&timezone=UTC`)).json();
  const booking = await request.post('/api/calendar/bookings', {
    data: { eventTypeId: eventType.id, email, name: 'Rita Gómez', start: slots[0].start, timezone: 'UTC' },
  });
  expect(booking.status()).toBe(201);

  const list = await (await request.get(`/api/crm/contacts?q=${encodeURIComponent(email)}`)).json();
  expect(list.rows).toHaveLength(1);
  const contactId = list.rows[0].id;
  await page.goto(`/en/app/crm/contacts/${contactId}`);
  await expect(page.getByText(`Demo ${tag}`).first()).toBeVisible();
});

test('Link: quick-create desde la lista (tecla C) sin salir de la vista', async ({ page }) => {
  const slug = `qc${uid()}`;
  await page.goto('/en/app/links', { waitUntil: 'networkidle' });
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Paste a long URL…').fill('example.com/quick-create');
  await dialog.getByPlaceholder('my-link').fill(slug);
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/en\/app\/links$/);
  await expect(page.getByRole('status')).toContainText(slug);
  await expect(page.locator('.links-table').getByText(slug).first()).toBeVisible();

  // "More options" lleva al formulario completo con la URL precargada.
  await page.keyboard.press('c');
  await page.getByRole('dialog').getByPlaceholder('Paste a long URL…').fill('https://example.com/full');
  await page.getByRole('link', { name: 'More options' }).click();
  await expect(page).toHaveURL(/\/en\/app\/links\/new\?url=/);
  await expect(page.locator('#nl-url')).toHaveValue('https://example.com/full');
});

test('Docs: "C" crea una página, el título queda enfocado y aparece en el árbol', async ({ page }) => {
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await page.keyboard.press('c');
  await page.waitForURL(/\/en\/app\/docs\/[0-9a-f-]{36}$/);
  const title = `E2E doc ${uid()}`;
  await expect(page.locator('.docs-title')).toBeFocused();
  await page.keyboard.type(title);
  await expect(page.locator('.docs-save-status')).toHaveText(/saved/i);
  await page.reload();
  await expect(page.locator('.docs-tree-title', { hasText: title })).toBeVisible();
});

test('Docs: subpágina desde el árbol y papelera que arrastra a los hijos', async ({ request, page }) => {
  const parent = await (await request.post('/api/docs/pages', { data: { title: `Parent ${uid()}` } })).json();
  const child = await (
    await request.post('/api/docs/pages', { data: { title: `Child ${uid()}`, parent_id: parent.id } })
  ).json();

  await page.goto(`/en/app/docs/${parent.id}`);
  const row = page.locator('.docs-tree-row', { hasText: parent.title }).first();
  await row.hover();
  await row.locator('.docs-tree-add').click();
  await page.waitForURL((u) => !u.pathname.endsWith(parent.id) && /\/app\/docs\/[0-9a-f-]{36}$/.test(u.pathname));
  await expect(page.locator('.docs-breadcrumb')).toContainText(parent.title);

  // "Move to trash" archiva (no borra) la página y sus subpáginas.
  await page.goto(`/en/app/docs/${parent.id}`);
  await page.locator('.docs-action-btn').click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL(/\/en\/app\/docs$/);
  await expect(page.locator('.docs-tree')).not.toContainText(child.title);
  const archivedChild = await (await request.get(`/api/docs/pages/${child.id}`)).json();
  expect(archivedChild.archived ?? archivedChild.page?.archived).toBe(true);

  await page.locator('#trash summary').click();
  await page.locator('.docs-trash-row', { hasText: parent.title }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.docs-tree-title', { hasText: child.title })).toBeVisible({ timeout: 15_000 });
});

test('Docs: Share y Comments se abren a demanda desde la barra superior', async ({ request, page }) => {
  const doc = await (await request.post('/api/docs/pages', { data: { title: `Panels ${uid()}` } })).json();
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-side')).toBeHidden();
  await page.getByRole('button', { name: /^Comments/ }).click();
  await page.locator('.docs-comments textarea').fill('Hola e2e');
  await page.locator('.docs-comments button', { hasText: /^Comment$/ }).click();
  await expect(page.locator('.docs-comments')).toContainText('Hola e2e');
  await page.getByRole('button', { name: /^Share/ }).click();
  await expect(page.locator('.docs-share')).toBeVisible();
});

test('Docs: en mobile el árbol se pliega y no hay scroll horizontal', async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const doc = await (await request.post('/api/docs/pages', { data: { title: `Mobile ${uid()}` } })).json();
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-tree')).toBeHidden();
  await page.locator('.docs-sidebar-toggle').click();
  await expect(page.locator('.docs-tree-title', { hasText: doc.title })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Cal: crear event type desde el modal rápido (tecla C), apagarlo y borrarlo', async ({ page, request }) => {
  const title = `Quick ${uid()}`;
  await page.goto('/en/app/calendar/event-types');
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByPlaceholder('Event name, e.g. Intro call').fill(title);
  await page.getByRole('radio', { name: '45 min' }).click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
  const row = page.locator('.cal-row', { hasText: title });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Arranca activo y con horario lun–vie 9–17: el link reserva sin más pasos.
  const { rows } = await (await request.get('/api/calendar/event-types')).json();
  const created = rows.find((r: { title: string }) => r.title === title);
  expect(created.active).toBe(1);
  expect(created.duration_min).toBe(45);
  const day = new Date(Date.now() + 7 * 86_400_000);
  while (day.getUTCDay() !== 3) day.setUTCDate(day.getUTCDate() + 1);
  const slotsRes = await request.get(
    `/api/calendar/event-types/${created.id}/slots?date=${day.toISOString().slice(0, 10)}&timezone=UTC`,
  );
  expect((await slotsRes.json()).slots.length).toBeGreaterThan(0);

  // Switch en línea: apaga sin entrar al detalle.
  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(async () => (await (await request.get(`/api/calendar/event-types/${created.id}`)).json()).active)
    .toBe(0);

  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: `Delete ${title}` }).click();
  await expect(row).toHaveCount(0);
  expect((await request.get(`/api/calendar/event-types/${created.id}`)).status()).toBe(404);
});

test('Cal: /event-types/new abre el modal sobre la lista', async ({ page }) => {
  await page.goto('/en/app/calendar/event-types/new');
  await expect(page).toHaveURL(/\/en\/app\/calendar\/event-types\?new=1$/);
  await expect(page.getByRole('dialog')).toBeVisible();
  // Con foco en el título (hidratado), Esc cierra.
  await expect(page.getByPlaceholder('Event name, e.g. Intro call')).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
});

test('Cal: routing form rápido abre el editor y se borra desde el detalle', async ({ page }) => {
  const title = `Route ${uid()}`;
  await page.goto('/en/app/calendar/routing');
  await page.getByRole('button', { name: /New routing form/ }).first().click();
  await page.getByPlaceholder('Form name, e.g. Sales or support').fill(title);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/calendar\/routing\/[0-9a-f-]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/app\/calendar\/routing$/, { timeout: 15_000 });
  await expect(page.getByText(title)).toHaveCount(0);
});

// CRM — smoke checks de los flujos arreglados en fase-apps-polish.
// Pegar dentro de tests/e2e/flows.spec.ts (usa `uid` y `expect`/`test` de ahí).

test('CRM: alta rápida de contacto con la tecla C, sin salir de la lista', async ({ page }) => {
  const first = `Quick${uid()}`;
  await page.goto('/en/app/crm/contacts');
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('First name').fill(first);
  await dialog.locator('input[type=email]').fill(`${first.toLowerCase()}@example.com`);
  await page.keyboard.press('Meta+Enter');
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/en\/app\/crm\/contacts$/);
  await expect(page.getByText(first).first()).toBeVisible();
});

test('CRM: /new abre el modal sobre la lista y "All fields" lleva al form completo', async ({ page }) => {
  await page.goto('/en/app/crm/companies/new');
  await expect(page).toHaveURL(/\/en\/app\/crm\/companies$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const name = `Co ${uid()}`;
  await dialog.getByLabel('Name').fill(name);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(name).first()).toBeVisible();

  await page.goto('/en/app/crm/contacts?new=1');
  await page.getByRole('dialog').getByRole('link', { name: 'All fields' }).click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/contacts\/new\?full=1$/);
});

test('CRM: deal rápido desde el board queda en la columna del pipeline', async ({ page }) => {
  const name = `Deal ${uid()}`;
  await page.goto('/en/app/crm/deals');
  await page.getByTestId('crm-quick-deal').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.locator('input[type=number]').fill('1500');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(name).first()).toBeVisible();
});

test('CRM: el timeline tiene una sola fila de tabs y el tab elige el tipo', async ({ request, page }) => {
  const email = `tl-${uid()}@example.com`;
  const contact = await (await request.post('/api/crm/contacts', { data: { email, firstName: 'Timeline' } })).json();
  await page.goto(`/en/app/crm/contacts/${contact.id}`);
  await expect(page.getByRole('tablist')).toHaveCount(1);
  await page.getByRole('tab', { name: /Call/ }).click();
  await page.getByPlaceholder(/Subject/).first().fill('Intro call');
  await page.getByRole('button', { name: /Log call/i }).click();
  await expect(page.getByText('Intro call')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Call/ })).toContainText('1');
});

test('CRM: guardar un reporte es un botón chico que pide nombre en línea', async ({ page }) => {
  const name = `R ${uid()}`;
  await page.goto('/en/app/crm/reports');
  await page.getByRole('button', { name: /Save report/i }).click();
  await page.getByPlaceholder(/Report name/i).fill(name);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name })).toBeVisible();
});

test('CRM: tarea rápida con la tecla C', async ({ page }) => {
  const subject = `Task ${uid()}`;
  await page.goto('/en/app/crm/tasks');
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subject').fill(subject);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden({ timeout: 15_000 });
});

test('CRM: los widgets del dashboard no se superponen', async ({ page }) => {
  await page.goto('/en/app/crm/dashboards');
  const widgets = page.locator('.dash-widget');
  await expect(widgets.first()).toBeVisible();
  const boxes = await widgets.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      expect(overlap, `widget ${i} y ${j}`).toBe(false);
    }
  }
});
