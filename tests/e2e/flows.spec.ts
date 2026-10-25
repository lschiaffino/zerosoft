import { expect, test } from '@playwright/test';

/** La tecla C abre el modal de alta rápida; reintenta hasta que la página hidrate. */
async function openQuickCreate(page: import('@playwright/test').Page) {
  await expect(async () => {
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

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

  // /book/<slug> solo redirige event types anteriores a los handles (005_user_handles);
  // uno creado ahora no tiene link viejo y no puede secuestrar el path de un handle.
  const legacy = await page.goto(`/en/book/${slug}`);
  expect(legacy?.status()).toBe(404);
  await expect(page).toHaveURL(new RegExp(`/en/book/${slug}$`));
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
  await openQuickCreate(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Paste a long URL…').fill('example.com/quick-create');
  await dialog.getByPlaceholder('my-link').fill(slug);
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/en\/app\/links$/, { timeout: 15_000 });
  await expect(page.getByRole('status')).toContainText(slug);
  await expect(page.locator('.links-table').getByText(slug).first()).toBeVisible();

  // "More options" lleva al formulario completo con la URL precargada.
  await openQuickCreate(page);
  await page.getByRole('dialog').getByPlaceholder('Paste a long URL…').fill('https://example.com/full');
  await page.getByRole('link', { name: 'More options' }).click();
  await expect(page).toHaveURL(/\/en\/app\/links\/new\?url=/, { timeout: 15_000 });
  await expect(page.locator('#nl-url')).toHaveValue('https://example.com/full');
});

test('Docs: "C" crea una página, el título queda enfocado y aparece en el árbol', async ({ page }) => {
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await expect(async () => {
    await page.keyboard.press('c');
    await page.waitForURL(/\/en\/app\/docs\/[0-9a-f-]{36}$/, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
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
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
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
  await expect(page.getByRole('dialog', { name: 'Share' })).toBeVisible();
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
  await openQuickCreate(page);
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
  await expect(page).toHaveURL(/\/en\/app\/calendar\/event-types\?new=1$/, { timeout: 15_000 });
  await expect(page.getByRole('dialog')).toBeVisible();
  // Con foco en el título (hidratado), Esc cierra.
  await expect(page.getByPlaceholder('Event name, e.g. Intro call')).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
});

test('Cal: routing form rápido abre el editor y se borra desde el detalle', async ({ page }) => {
  const title = `Route ${uid()}`;
  await page.goto('/en/app/calendar/routing');
  await page.getByRole('button', { name: /Create form/ }).first().click();
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
  await openQuickCreate(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('First name').fill(first);
  await dialog.locator('input[type=email]').fill(`${first.toLowerCase()}@example.com`);
  await page.keyboard.press('Meta+Enter');
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/en\/app\/crm\/contacts$/, { timeout: 15_000 });
  await expect(page.getByText(first).first()).toBeVisible();
});

test('CRM: /new abre el modal sobre la lista y "All fields" lleva al form completo', async ({ page }) => {
  await page.goto('/en/app/crm/companies/new');
  await expect(page).toHaveURL(/\/en\/app\/crm\/companies$/, { timeout: 15_000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const name = `Co ${uid()}`;
  await dialog.getByLabel('Name').fill(name);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(name).first()).toBeVisible();

  await page.goto('/en/app/crm/contacts?new=1');
  await page.getByRole('dialog').getByRole('link', { name: 'All fields' }).click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/contacts\/new\?full=1$/, { timeout: 15_000 });
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
  await openQuickCreate(page);
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

// Chat — smoke e2e de los flujos rápidos (pegar en tests/e2e/flows.spec.ts;
// usa el `uid()` y los imports que ya están arriba del archivo).

test('Chat: crear widget desde el overview con "C" y abrir su configuración', async ({ page }) => {
  await page.goto('/en/app/chat', { waitUntil: 'networkidle' });
  const name = `E2E widget ${uid()}`;
  const dialog = page.getByRole('dialog');
  // El atajo se registra al hidratar: reintenta hasta que abre el modal.
  await expect(async () => {
    await page.keyboard.press('c');
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/chat\/widgets\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Saved replies' })).toBeVisible();
  // El editor del widget está en pestañas.
  await expect(page.getByRole('navigation', { name: 'Widget settings' }).getByRole('link')).toHaveCount(5);
});

test('Chat: respuestas guardadas y reglas se crean en un modal, sin salir de la vista', async ({ request, page }) => {
  const w = await request.post('/api/chat/widgets', { data: { name: `E2E ${uid()}` } });
  const { id: widgetId } = await w.json();

  await page.goto(`/en/app/chat/widgets/${widgetId}/canned`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create reply' }).click();
  await page.getByRole('dialog').getByLabel('Shortcut').fill('Hola Mundo');
  await page.getByPlaceholder('Type your saved message here…').fill('Hi! How can we help?');
  await page.keyboard.press('Meta+Enter');
  await expect(page.getByText('/hola-mundo')).toBeVisible();
  // Editar: click en la fila abre el mismo modal.
  await page.getByText('/hola-mundo').click();
  await page.getByPlaceholder('Type your saved message here…').fill('Edited body');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Edited body')).toBeVisible();

  await page.getByRole('link', { name: 'Rules', exact: true }).click();
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.keyboard.type('Pricing questions');
  await page.getByRole('dialog').locator('select').first().selectOption('keyword');
  await page.getByPlaceholder('refund, pricing…').fill('pricing');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Pricing questions')).toBeVisible();
});

test('Chat: responder con Enter (y "/" inserta una respuesta guardada) y resolver', async ({ request, page }) => {
  const w = await request.post('/api/chat/widgets', { data: { name: `E2E ${uid()}` } });
  const { id: widgetId } = await w.json();
  await request.post(`/api/chat/widgets/${widgetId}/canned`, {
    data: { shortcut: '/thanks', title: 'Thanks', body: 'Thanks for writing in!' },
  });
  const visitorId = `v-${uid()}`;
  const sent = await request.post('/api/chat/messages', {
    headers: { origin: 'https://cliente.example' },
    data: { widgetId, visitorId, body: 'Need pricing help' },
  });
  const { message } = await sent.json();

  await page.goto(`/en/app/chat/inbox/${message.conversation_id}`, { waitUntil: 'networkidle' });
  const composer = page.getByRole('textbox', { name: 'Reply' });
  await composer.fill('/than');
  await expect(page.locator('.chat-picker')).toBeVisible();
  await composer.press('Enter'); // inserta la respuesta guardada
  await composer.press('Enter'); // envía
  await expect(page.locator('.chat-message[data-sender="user"]').getByText('Thanks for writing in!')).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  // El hilo scrollea su propio contenedor, no la página.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

// ---------- Fase C: arreglos rápidos ----------

test('CRM: "Add deal" en la company abre el modal y el deal queda asociado, sin salir', async ({ request, page }) => {
  const co = await request.post('/api/crm/companies', { data: { name: `Co ${uid()}` } });
  const company = await co.json();
  await page.goto(`/en/app/crm/companies/${company.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('crm-quick-deal-company').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('quick-deal-company')).toContainText(company.name);
  const name = `Deal ${uid()}`;
  await dialog.locator('.qm-title').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  expect(page.url()).toContain(`/companies/${company.id}`);
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('CRM: nuevo workflow con el asistente (disparador, acciones, revisar) lleva al editor', async ({ page }) => {
  await page.goto('/en/app/crm/workflows/new', { waitUntil: 'networkidle' });
  await page.getByTestId('workflow-trigger').selectOption('deal_won');
  await page.getByTestId('workflow-wizard-next').click();
  await expect(page.getByTestId('workflow-action')).toHaveCount(1);
  // La tarea necesita título: sin él, Siguiente no pasa a Revisar.
  await page.getByTestId('workflow-action').getByLabel('Task title').fill('Kickoff call');
  await page.getByTestId('workflow-wizard-next').click();
  await page.getByLabel('Workflow name').fill(`WF ${uid()}`);
  await page.getByTestId('workflow-create').click();
  await expect(page).toHaveURL(/\/app\/crm\/workflows\/[0-9a-f-]{36}/);
});

test('Track: sub-issue, cycles y status del proyecto sin salir de la vista', async ({ request, page }) => {
  const p = await request.post('/api/track/projects', { data: { name: `Fase C ${uid()}` } });
  const project = await p.json();
  const i = await request.post(`/api/track/projects/${project.id}/issues`, { data: { title: 'Padre' } });
  const parent = await i.json();

  await page.goto(`/en/app/track/issues/${parent.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-add-subissue').click();
  // Composer en línea como en Linear: título y Enter.
  await page.getByTestId('track-subissue-input').fill('Hijo');
  await page.keyboard.press('Enter');
  await expect(page.locator('.track-subtask-list')).toContainText('Hijo');
  expect(page.url()).toContain(`/issues/${parent.id}`);

  // Ciclos y status viven en el drawer de ajustes del proyecto, no sobre la lista.
  await page.goto(`/en/app/track/projects/${project.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-cycles')).toHaveCount(0);
  await page.getByTestId('track-project-settings').click();
  const drawer = page.getByTestId('track-project-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByTestId('track-new-cycle').click();
  await drawer.getByLabel('Name').fill('Sprint E2E');
  await drawer.getByRole('button', { name: 'Create cycle' }).click();
  await expect(drawer.getByTestId('track-cycle')).toContainText('Sprint E2E');
  await expect(drawer.getByTestId('track-cycle').getByRole('progressbar')).toBeVisible();

  await drawer.getByTestId('track-settings-tab-statuses').click();
  await expect(drawer.getByTestId('track-status-item')).toHaveCount(5);
});

test('Track: el drawer de ajustes cierra con Esc y devuelve el foco', async ({ request, page }) => {
  const project = await (await request.post('/api/track/projects', { data: { name: `Drawer ${uid()}` } })).json();
  await page.goto(`/en/app/track/projects/${project.id}`, { waitUntil: 'networkidle' });
  const opener = page.getByTestId('track-project-settings');
  await opener.click();
  const drawer = page.getByTestId('track-project-drawer');
  await expect(drawer).toBeVisible();
  // Flechas entre pestañas.
  await drawer.getByTestId('track-settings-tab-cycles').focus();
  await page.keyboard.press('ArrowRight');
  await expect(drawer.getByTestId('track-settings-tab-statuses')).toHaveAttribute('aria-selected', 'true');
  // C no abre el quick-create con el drawer abierto.
  await page.keyboard.press('c');
  await expect(page.getByPlaceholder('Issue title')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Track: /issues/new abre el quick-create en el proyecto y "/" enfoca la búsqueda', async ({ request, page }) => {
  const project = await (await request.post('/api/track/projects', { data: { name: `Nuevo ${uid()}` } })).json();
  await request.post(`/api/track/projects/${project.id}/issues`, { data: { title: 'Existente' } });
  await page.goto(`/en/app/track/projects/${project.id}/issues/new`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`/app/track/projects/${project.id}`));
  const title = page.getByPlaceholder('Issue title');
  await expect(title).toBeVisible();
  await title.fill('Desde el link viejo');
  await page.keyboard.press('Enter');
  await expect(page.locator('.track-table')).toContainText('Desde el link viejo');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('/');
  await expect(page.getByTestId('track-search')).toBeFocused();
});

test('Track: proyecto nuevo deriva el identificador y GitHub arranca colapsado', async ({ page }) => {
  const name = `Kit ${uid()}`;
  await page.goto('/en/app/track/projects/new', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-project-slug')).toBeHidden();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('track-project-slug')).toHaveAttribute('placeholder', name.toLowerCase().replace(' ', '-'));
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/app\/track\/projects\/[0-9a-f-]{36}/);

  await page.goto('/en/app/track/settings?tab=github', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-github-repos')).toHaveCount(0);
  await page.getByTestId('track-github-start').click();
  await expect(page.getByTestId('track-github-repos')).toBeVisible();
});

test('Track: "New project" abre un modal en el overview', async ({ page }) => {
  await page.goto('/en/app/track', { waitUntil: 'networkidle' });
  await page.getByTestId('track-new-project').click();
  await page.getByRole('dialog').getByLabel('Name').fill(`Modal ${uid()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/app\/track\/projects\/[0-9a-f-]{36}/);
});

test('Link: multi-select archiva en lote y la edición abre un panel lateral', async ({ request, page }) => {
  const tag = `bulk${uid()}`;
  const slugs = [`m${uid()}`, `m${uid()}`];
  const ids: string[] = [];
  for (const slug of slugs) {
    const r = await request.post('/api/links', { data: { url: 'https://example.com/bulk', slug, tags: [tag] } });
    ids.push((await r.json()).id);
  }
  await page.goto(`/en/app/links?tag=${tag}`, { waitUntil: 'networkidle' });
  for (const slug of slugs) await page.getByRole('checkbox', { name: `Select ${slug}` }).check();
  await expect(page.getByTestId('links-bulk-bar')).toContainText('2 selected');
  await page.getByTestId('links-bulk-bar').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/links/${ids[0]}`)).json()).archived)
    .toBeTruthy();

  // Editar ya no es un panel lateral: es la pestaña Ajustes (y ?edit=1 de links viejos lleva ahí).
  await page.goto(`/en/app/links/${ids[1]}?edit=1`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/tab=settings/);
  await expect(page.getByRole('navigation', { name: 'Link sections' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await page.locator('#el-title').fill('Renamed by e2e');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved')).toBeVisible();
  await expect.poll(async () => (await (await request.get(`/api/links/${ids[1]}`)).json()).title).toBe('Renamed by e2e');
});

test('Link: el detalle está en pestañas y cada una carga sola', async ({ request, page }) => {
  const slug = `tabs${uid()}`;
  const link = await (await request.post('/api/links', { data: { url: 'https://example.com/tabs', slug } })).json();
  await page.goto(`/en/app/links/${link.id}`, { waitUntil: 'networkidle' });
  const tabs = page.getByRole('navigation', { name: 'Link sections' });
  for (const name of ['Overview', 'Analytics', 'QR', 'Routing', 'Settings']) {
    await expect(tabs.getByRole('link', { name })).toBeVisible();
  }
  // Sin clicks, el resumen es un vacío con el link para copiar (la tira de cifras aparece con el primer click).
  await expect(page.getByRole('heading', { name: 'No clicks yet' })).toBeVisible();
  await expect(page.locator('.ui-empty').getByRole('button', { name: 'Copy link' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Routing' }).click();
  await expect(page).toHaveURL(/tab=routing/);
  await expect(page.getByRole('button', { name: 'Add rule' })).toBeVisible();
  // A/B y deep links quedan en "Advanced".
  await expect(page.getByRole('button', { name: 'Add variant' })).toBeHidden();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await expect(page.getByRole('button', { name: 'Add variant' })).toBeVisible();
});

test('Link: "New" tiene Single / Bulk / Import y Dominios su propia pantalla', async ({ page }) => {
  await page.goto('/en/app/links/new', { waitUntil: 'networkidle' });
  const tabs = page.getByRole('navigation', { name: 'Ways to create' });
  await expect(tabs.getByRole('link', { name: 'Single' })).toHaveAttribute('aria-current', 'page');
  // Camino básico: URL y slug. El título está en Avanzado.
  await expect(page.locator('#nl-url')).toBeVisible();
  await expect(page.locator('#nl-slug')).toBeVisible();
  await expect(page.locator('#nl-title')).toBeHidden();
  await tabs.getByRole('link', { name: 'Bulk' }).click();
  await expect(page).toHaveURL(/\/app\/links\/bulk$/);
  await expect(page.locator('#bulk-urls')).toBeVisible();
  await page.getByRole('navigation', { name: 'Ways to create' }).getByRole('link', { name: 'Import' }).click();
  await expect(page).toHaveURL(/\/app\/links\/import$/);
  await expect(page.getByRole('heading', { name: 'Import from Bitly' })).toBeVisible();

  await page.goto('/en/app/links/domains', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Domains', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Domain', { exact: true })).toBeVisible();
});

test('Chat: Reports tiene su propia entrada en la navegación', async ({ page }) => {
  await page.goto('/en/app/chat', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Reports' }).first().click();
  await expect(page).toHaveURL(/\/app\/chat\/reports/);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
});

// ---------- Fase D1/D2: centro de ayuda y notas internas ----------

test('Docs → centro de ayuda: publicar la hace visible en /h/<handle> y despublicar la saca', async ({ request, page }) => {
  const { handle } = await (await request.get('/api/calendar/config')).json();
  const title = `Help ${uid()}`;
  const doc = await (await request.post('/api/docs/pages', { data: { title } })).json();
  await request.patch(`/api/docs/pages/${doc.id}`, {
    data: {
      content: [
        { id: 'h1', type: 'heading', level: 1, content: 'Primer paso' },
        { id: 'p1', type: 'paragraph', content: 'Contenido del artículo e2e.' },
      ],
    },
  });
  // Sin publicar: no existe en el centro de ayuda.
  expect((await page.goto(`/en/h/${handle}`))?.status()).toBe(200);
  await expect(page.getByText(title)).toHaveCount(0);

  const published = await (await request.patch(`/api/docs/pages/${doc.id}`, { data: { published: true } })).json();
  expect(published.slug).toBeTruthy();
  await page.goto(`/en/h/${handle}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: title }).first().click();
  await expect(page).toHaveURL(new RegExp(`/h/${handle}/${published.slug}$`));
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Contenido del artículo e2e.')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Thanks for letting us know.')).toBeVisible();

  await request.patch(`/api/docs/pages/${doc.id}`, { data: { published: false } });
  expect((await page.goto(`/en/h/${handle}/${published.slug}`))?.status()).toBe(404);
});

test('Chat: nota interna visible para agentes, nunca para el visitante', async ({ request, page }) => {
  const { id: widgetId } = await (await request.post('/api/chat/widgets', { data: { name: `E2E ${uid()}` } })).json();
  const visitorId = `v-${uid()}`;
  const sent = await request.post('/api/chat/messages', {
    headers: { origin: 'https://cliente.example' },
    data: { widgetId, visitorId, body: 'Necesito ayuda' },
  });
  const { message } = await sent.json();

  await page.goto(`/en/app/chat/inbox/${message.conversation_id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Internal note' }).click();
  const composer = page.getByRole('textbox', { name: 'Internal note' });
  await composer.fill('Cliente VIP, revisar plan');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-note]').getByText('Cliente VIP, revisar plan')).toBeVisible();

  const thread = await request.get(`/api/chat/messages?widgetId=${widgetId}&visitorId=${visitorId}`);
  const text = JSON.stringify(await thread.json());
  expect(text).toContain('Necesito ayuda');
  expect(text).not.toContain('Cliente VIP');
});

// ---------- Cal D9: horarios, reservas del anfitrión, recordatorios y cobro ----------
test.describe('cal d9', () => {
  /** Próxima fecha (UTC) con ese día de semana, al menos `minDays` días adelante. */
  const nextDow = (dow: number, minDays = 3) => {
    const d = new Date(Date.now() + minDays * 86_400_000);
    while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  test('horario con excepción por fecha cambia los slots del evento', async ({ request, page }) => {
    const created = await request.post('/api/calendar/schedules', {
      data: {
        name: `E2E ${uid()}`,
        timezone: 'UTC',
        rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '12:00' })),
      },
    });
    expect(created.status()).toBe(201);
    const schedule = await created.json();
    const slug = `d9-${uid()}`;
    const et = await (
      await request.post('/api/calendar/event-types', { data: { slug, title: 'D9', durationMin: 60, scheduleId: schedule.id } })
    ).json();
    // Lejos de las reservas que otros tests hacen a +3/+4/+7 días con el mismo
    // anfitrión demo: si caen el mismo lunes, ocupan un slot y el conteo falla.
    const monday = nextDow(1, 21);
    const slots = async () =>
      (await (await request.get(`/api/calendar/event-types/${et.id}/slots?date=${monday}&timezone=UTC`)).json()).slots as unknown[];
    expect(await slots()).toHaveLength(3);
    await request.patch(`/api/calendar/schedules/${schedule.id}`, { data: { overrides: [{ date: monday }] } });
    expect(await slots()).toHaveLength(0);

    await page.goto('/en/app/calendar/availability', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: new RegExp(schedule.name) }).click();
    // Las excepciones van plegadas: el disclosure dice cuántas hay.
    const overrides = page.getByRole('button', { name: /Date overrides/ });
    await expect(overrides).toContainText('1 date');
    if ((await overrides.getAttribute('aria-expanded')) !== 'true') await overrides.click();
    await expect(page.locator('.cal-override-row input[type="date"]')).toHaveValue(monday, { timeout: 20_000 });
  });

  test('el anfitrión busca, reprograma y cancela con motivo desde Reservas', async ({ request, page }) => {
    const slug = `d9b-${uid()}`;
    const et = await (await request.post('/api/calendar/event-types', { data: { slug, title: 'D9 admin', durationMin: 60 } })).json();
    const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' }));
    await request.post(`/api/calendar/event-types/${et.id}/availability`, { data: { rules } });
    const day = nextDow(3);
    const name = `Guest ${uid()}`;
    // Primer horario libre (el usuario demo puede tener otras reservas ese día).
    const free = (await (await request.get(`/api/calendar/event-types/${et.id}/slots?date=${day}&timezone=UTC`)).json())
      .slots as Array<{ start: string }>;
    const booking = await request.post('/api/calendar/bookings', {
      data: { eventTypeId: et.id, email: 'd9@example.com', name, start: free[0].start, timezone: 'UTC' },
    });
    expect(booking.status()).toBe(201);

    await page.goto('/en/app/calendar/bookings', { waitUntil: 'networkidle' });
    await page.getByRole('searchbox', { name: 'Search by name or email' }).fill(name);
    const row = page.locator('.booking-card-item', { hasText: name });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole('button', { name: 'Reschedule' }).click();
    await row.locator('.cal-bk-panel input[type="date"]').fill(day);
    await row.locator('.cal-bk-slots .btn').nth(2).click();
    await expect(page.getByText('Booking moved. The guest got an email.')).toBeVisible({ timeout: 20_000 });

    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await row.locator('.cal-bk-panel textarea').fill('Host is sick');
    await row.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(row.locator('.cal-bk-status')).toHaveText(/Cancelled/, { timeout: 20_000 });
  });

  test('recordatorios y precio se guardan desde el tipo de evento', async ({ request, page }) => {
    const slug = `d9w-${uid()}`;
    const et = await (await request.post('/api/calendar/event-types', { data: { slug, title: 'D9 wf', durationMin: 30 } })).json();
    await page.goto(`/en/app/calendar/event-types/${et.id}?tab=advanced`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByLabel('Price').fill('25');
    await expect(page.getByText('To charge, connect Stripe in Settings.')).toBeVisible({ timeout: 20_000 });
    // Un solo Guardar para todo el tipo de evento.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible({ timeout: 20_000 });
    const steps = (await (await request.get(`/api/calendar/event-types/${et.id}/workflows`)).json()).steps;
    expect(steps).toEqual([expect.objectContaining({ recipient: 'guest', offsetMin: -60, subject: 'Reminder: {{event.title}}' })]);
    expect((await (await request.get(`/api/calendar/event-types/${et.id}`)).json()).price_cents).toBe(2500);
    // Sin Stripe conectado, la reserva paga se rechaza.
    const day = nextDow(2);
    const slotsRes = await request.get(`/api/calendar/event-types/${et.id}/slots?date=${day}&timezone=UTC`);
    const first = ((await slotsRes.json()).slots as Array<{ start: string }>)[0];
    const res = await request.post('/api/calendar/bookings', {
      data: { eventTypeId: et.id, email: 'p@example.com', name: 'P', start: first.start, timezone: 'UTC' },
    });
    expect(res.status()).toBe(409);
  });
});

// ---------- Track d9: labels, edición masiva, GitHub y triage ----------
test.describe('track d9', () => {
  test('labels del workspace, edición masiva, GitHub y triage', async ({ page, request }) => {
    const { createHmac } = await import('crypto');
    const p = await request.post('/api/track/projects', { data: { name: `D9 ${uid()}` } });
    expect(p.status()).toBe(201);
    const project = await p.json();
    const ids: string[] = [];
    for (const title of ['Uno', 'Dos', 'Tres']) {
      const r = await request.post(`/api/track/projects/${project.id}/issues`, { data: { title } });
      ids.push((await r.json()).id);
    }

    // Labels del workspace: alta por API y visibles en Ajustes.
    const labelName = `d9-${uid()}`;
    expect((await request.post('/api/track/labels', { data: { name: labelName, color: '#2f6fd1' } })).status()).toBe(201);
    await page.goto('/en/app/track/settings', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-labels-settings')).toContainText('Labels');
    await expect(page.getByTestId('track-label-row').locator(`input[value="${labelName}"]`)).toBeVisible();

    // Edición masiva: checkbox + shift+clic y barra de acciones.
    await page.goto(`/en/app/track/projects/${project.id}`, { waitUntil: 'networkidle' });
    const boxes = page.getByTestId('track-select-row');
    await expect(boxes).toHaveCount(3);
    await boxes.nth(0).click();
    await boxes.nth(2).click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('track-bulk-bar')).toContainText('3 selected');
    await page.getByTestId('track-bulk-priority').selectOption('urgent');
    await expect
      .poll(async () => {
        const res = await request.get(`/api/track/projects/${project.id}/issues?priority=urgent`);
        return (await res.json()).total;
      }, { timeout: 20_000 })
      .toBe(3);
    await page.getByTestId('track-bulk-labels').selectOption({ label: `Add ${labelName}` });
    await expect
      .poll(async () => (await (await request.get(`/api/track/issues/${ids[0]}`)).json()).labels, { timeout: 20_000 })
      .toContain(labelName);

    // GitHub: conectar, entregar un PR firmado y ver el vínculo en el issue.
    const conn = await request.put('/api/track/github', { data: { repos: ['acme/web'], regenerateSecret: true } });
    expect(conn.status()).toBe(200);
    const { config, secret } = await conn.json();
    const issue = await (await request.get(`/api/track/issues/${ids[0]}`)).json();
    const body = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'acme/web' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/acme/web/pull/7',
        title: `Arreglo ${issue.identifier}`,
        body: '',
        head: { ref: 'fix' },
        user: { login: 'octo' },
      },
    });
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const headers = { 'content-type': 'application/json', 'x-github-event': 'pull_request' };
    const hook = await request.post(`/api/track/github/webhook/${config.id}`, {
      data: body,
      headers: { ...headers, 'x-hub-signature-256': sig },
    });
    expect(hook.status()).toBe(200);
    const bad = await request.post(`/api/track/github/webhook/${config.id}`, {
      data: body,
      headers: { ...headers, 'x-hub-signature-256': 'sha256=00' },
    });
    expect(bad.status()).toBe(401);
    await page.goto(`/en/app/track/issues/${ids[0]}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-issue-github')).toContainText('#7');
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByTestId('track-copy-branch')).toHaveAttribute('data-branch', /-uno$/);

    // Triage: se activa desde la configuración del proyecto.
    await page.goto(`/en/app/track/projects/${project.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId('track-project-settings').click();
    await page.getByTestId('track-settings-tab-triage').click();
    await page.getByTestId('track-triage-toggle').check();
    await page.getByTestId('track-project-drawer-close').click();
    await page.getByTestId('track-triage-tab').click();
    await expect(page.getByText('No issues waiting for triage.')).toBeVisible();
  });
});

// ---------- link d9: analytics del workspace, segmentación y QR con marca ----------
test.describe('link d9', () => {
  test('QR cuenta escaneos aparte y el dashboard los muestra', async ({ request, page }) => {
    const slug = `qr${uid()}`;
    const link = await (await request.post('/api/links', { data: { url: 'https://example.com/qr', slug } })).json();
    const scan = await request.get(`/${slug}?qr=1`, { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(scan.status());
    await expect.poll(async () => (await (await request.get(`/api/links/${link.id}`)).json()).qr_scans).toBe(1);

    await page.goto('/en/app/links/analytics', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByTestId('analytics-scans')).not.toHaveText('0');
    const csv = await request.get('/api/links/analytics/export.csv');
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain(slug);
  });

  test('segmentación por dispositivo y diseño del QR', async ({ request, page }) => {
    const slug = `tg${uid()}`;
    const link = await (await request.post('/api/links', { data: { url: 'https://example.com/main', slug } })).json();
    const patched = await request.patch(`/api/links/${link.id}`, {
      data: { targeting: { rules: [{ devices: ['android'], url: 'https://example.com/android' }] } },
    });
    expect(patched.status()).toBe(200);
    const android = await request.get(`/${slug}`, {
      maxRedirects: 0,
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36' },
    });
    expect(android.headers()['location']).toBe('https://example.com/android');

    await page.goto(`/en/app/links/${link.id}?tab=routing`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('tg-rule')).toHaveCount(1);
    await page.goto(`/en/app/links/${link.id}?tab=qr`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('qr-preview').locator('svg')).toBeVisible();
    await page.getByRole('button', { name: 'Save design' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
  });
});

// ---------- CRM core: detalle en tabs, menú "More" y altas cortas ----------

test('CRM: el detalle del contacto separa Actividad, Propiedades y Relacionados', async ({ request, page }) => {
  const email = `tabs-${uid()}@example.com`;
  const contact = await (await request.post('/api/crm/contacts', { data: { email, firstName: 'Tabs' } })).json();
  await page.goto(`/en/app/crm/contacts/${contact.id}`);
  const tabs = page.getByRole('navigation', { name: 'Record sections' });
  await expect(tabs.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
  // El resumen de Actividad muestra el email sin cambiar de tab.
  await expect(page.getByRole('complementary', { name: 'Summary' }).getByText(email)).toBeVisible();

  await tabs.getByRole('link', { name: 'Properties' }).click();
  await expect(page).toHaveURL(/tab=properties/);
  await expect(page.getByTestId('contact-score-card')).toBeVisible();

  await tabs.getByRole('link', { name: 'Related' }).click();
  await expect(page).toHaveURL(/tab=related/);
  await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();
});

test('CRM: "More" abre el historial en un drawer, Esc devuelve el foco y eliminar pide confirmación', async ({
  request,
  page,
}) => {
  const email = `more-${uid()}@example.com`;
  const contact = await (await request.post('/api/crm/contacts', { data: { email, firstName: 'More' } })).json();
  await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  const more = page.getByTestId('record-more');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'History' })).toBeFocused();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'History' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  await page.getByRole('menuitem', { name: 'Delete contact' }).click();
  const modal = page.getByRole('dialog');
  const confirm = modal.getByRole('button', { name: 'Move to recycle bin' });
  await expect(confirm).toBeDisabled();
  await modal.getByLabel(`Type ${email} to confirm`).fill(email);
  await confirm.click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/contacts$/, { timeout: 15_000 });
});

test('CRM: el alta completa de contacto muestra lo básico y guarda el resto en "More fields"', async ({ page }) => {
  const first = `Full${uid()}`;
  await page.goto('/en/app/crm/contacts/new?full=1');
  await expect(page.getByLabel('Job title')).toBeHidden();
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Email').fill(`${first.toLowerCase()}@example.com`);
  const toggle = page.getByRole('button', { name: /More fields/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.getByLabel('Job title').fill('CTO');
  await page.getByRole('button', { name: 'Create contact' }).click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/contacts\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: first })).toBeVisible();
  await expect(page.getByText('CTO').first()).toBeVisible();
});

test('CRM: el alta completa de deal pide nombre, monto y etapa; la moneda acompaña al monto', async ({ page }) => {
  const name = `FullDeal ${uid()}`;
  await page.goto('/en/app/crm/deals/new?full=1');
  await expect(page.getByLabel('Currency')).toBeHidden();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Amount').fill('2500');
  await page.getByRole('button', { name: /More fields/ }).click();
  await page.getByLabel('Currency').fill('eur');
  await expect(page.locator('.ui-addon')).toHaveText('EUR');
  await page.getByRole('button', { name: 'Create deal' }).click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/deals\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});
