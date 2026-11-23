import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM, bloque P5: los tres índices con la misma barra y la misma tabla.
 * - Seleccionar la página y después "todos los de esta vista" (el server los cuenta);
 * - Crear tareas en masa sobre todos los que coinciden;
 * - Exportar la vista (CSV con toda la vista filtrada, no solo la página);
 * - Editar filtros rápidos (se guarda en la URL de la vista) y "Sin actividad";
 * - Menú de columna: ordenar, mover y quitar; cierra con Esc y clic afuera;
 * - Ficha: "+ Agregar" de una tarjeta de asociaciones busca en el server;
 * - 390: sin scroll lateral y con áreas táctiles de 40 px.
 *
 * Cada test crea sus registros con una marca propia y filtra por ella (la
 * cuenta demo es compartida). Se busca por rol, testid o atributo.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const PHONE = { width: 390, height: 844 };

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

async function json<T>(res: Promise<{ ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function noSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

/** `n` contactos con la marca en el apellido. */
async function seedContacts(request: APIRequestContext, tag: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Pfive', lastName: `${String(i).padStart(2, '0')} ${tag}`, email: `p5-${i}-${tag}@p5.example` } }));
    ids.push(c.id);
  }
  return ids;
}

const rows = (page: Page) => page.locator('.crm-table tbody tr');

test.describe('select all matching and bulk tasks', () => {
  test('select the page, then every record in the view, and create one task per record', async ({ page, request }) => {
    const tag = uid();
    const ids = await seedContacts(request, tag, 27);
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(25);

    await page.locator('thead input.row-check').check();
    const banner = page.getByTestId('select-all-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('bulk-count')).toHaveText('25 selected');
    await page.getByTestId('select-all-matching').click();
    await expect(page.getByTestId('select-all-clear')).toBeVisible();
    await expect(page.getByTestId('bulk-count')).toHaveText('27 selected');

    // Crear tareas: el panel cierra con Esc; con título, crea una por registro.
    const bar = page.getByTestId('crm-bulk-bar');
    await bar.getByTestId('bulk-tasks').click();
    await expect(bar.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bar.getByRole('dialog')).toHaveCount(0);
    await expect(bar.getByTestId('bulk-tasks')).toBeFocused();
    await bar.getByTestId('bulk-tasks').click();
    await bar.getByTestId('bulk-task-subject').fill(`Call back ${tag}`);
    await bar.getByTestId('bulk-task-due').fill('2026-12-15');
    await expect(bar.getByTestId('bulk-task-create')).toHaveText('Create 27 tasks');
    const done = page.waitForResponse((r) => r.url().includes('/api/crm/contacts/bulk') && r.request().method() === 'POST');
    await bar.getByTestId('bulk-task-create').click();
    expect((await done).ok()).toBe(true);
    await expect(page.locator('.bulk-notice')).toContainText('27 tasks created');

    // Cada contacto tiene su tarea (la del último, que no estaba en la página, también).
    for (const id of [ids[0], ids[26]]) {
      const timeline = await json<{ rows: Array<{ subject: string; type: string }> }>(request.get(`/api/crm/activities?contactId=${id}`));
      expect(timeline.rows.some((r) => r.type === 'task' && r.subject === `Call back ${tag}`)).toBe(true);
    }

    // Cambiar un filtro deja de lado "todos los que coinciden".
    await page.locator('thead input.row-check').check();
    await page.getByTestId('select-all-matching').click();
    await expect(page.getByTestId('select-all-clear')).toBeVisible();
    await page.getByTestId('select-all-clear').click();
    await expect(page.getByTestId('crm-bulk-bar')).toHaveCount(0);
  });

  test('deals use the same bulk bar and name cell', async ({ page, request }) => {
    const tag = uid();
    const { rows: pipelines } = await json<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> }>(request.get('/api/crm/pipelines'));
    const p = pipelines[0];
    const stage = p.stages.find((s) => !s.is_won && !s.is_lost)!;
    await json(request.post('/api/crm/deals', { data: { name: `P5 deal ${tag}`, pipelineId: p.id, stageId: stage.id, amount: 100 } }));
    await page.goto(`/en/app/crm/deals?pipeline=${p.id}&view=table&q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId('record-name')).toHaveText(`P5 deal ${tag}`);
    await rows(page).first().locator('input.row-check').check();
    const bar = page.getByTestId('crm-bulk-bar');
    for (const id of ['bulk-assign', 'bulk-edit', 'bulk-tasks', 'bulk-export', 'bulk-delete']) await expect(bar.getByTestId(id)).toBeVisible();
    // Nada de pastillas: la prioridad es texto.
    const prio = rows(page).first().locator('.dot-label');
    await expect(prio).toBeVisible();
    expect(await prio.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
  });
});

test.describe('toolbar', () => {
  test('export view downloads the whole filtered view, not only the page', async ({ page, request }) => {
    const tag = uid();
    await seedContacts(request, tag, 27);
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    const href = await page.getByTestId('export-view').getAttribute('href');
    expect(href).toContain('list=');
    const csv = await (await request.get(href!)).text();
    expect(csv.trim().split('\n')).toHaveLength(28);
    expect(csv).toContain(`p5-26-${tag}@p5.example`);
  });

  test('edit quick filters: add one to the row, saved in the view URL; No activity filters', async ({ page, request }) => {
    const tag = uid();
    const [withActivity] = await seedContacts(request, tag, 2);
    await json(request.post('/api/crm/activities', { data: { type: 'note', body: 'Touched', contactId: withActivity } }));
    await page.goto(`/en/app/crm/companies?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('companies-tag-filter')).toHaveCount(0);
    const picker = page.getByTestId('quick-filter-picker');
    await picker.click();
    const menu = page.getByTestId('quick-filter-picker-menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(picker).toBeFocused();
    await picker.click();
    await page.locator('h1').first().click();
    await expect(menu).toHaveCount(0);
    await picker.click();
    await menu.getByTestId('quick-filter-toggle-industry').click();
    await expect(page).toHaveURL(/qf=owner%2Ccreated%2Cactivity%2Clifecycle(&|$)/);
    await expect(page.getByTestId('companies-industry-filter')).toHaveCount(0);

    // Contactos: "Sin actividad" en el filtro de última actividad.
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(2);
    await page.getByTestId('contacts-activity-filter').click();
    await page.getByTestId('contacts-activity-filter-none').click();
    await expect(page).toHaveURL(/noActivity=1/);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('contacts-activity-filter')).toHaveClass(/\bon\b/);
  });

  test('column header menu: sort, move, remove; closes on Esc and outside click', async ({ page, request }) => {
    const tag = uid();
    await seedContacts(request, tag, 3);
    await page.goto(`/en/app/crm/contacts?q=${tag}&cols=name,email,phone,company`, { waitUntil: 'networkidle' });
    const head = page.locator('.crm-table thead th[data-col="email"]');
    await head.hover();
    const btn = page.getByTestId('col-menu-email');
    await btn.click();
    const menu = page.getByTestId('col-menu-email-list');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(btn).toBeFocused();
    await btn.click();
    await page.locator('h1').first().click();
    await expect(menu).toHaveCount(0);

    // Ordenar desc por email.
    await head.hover();
    await btn.click();
    await menu.getByRole('menuitem', { name: 'Sort descending' }).click();
    await expect(page).toHaveURL(/sort=email_desc/);
    await expect(rows(page).first()).toContainText(`p5-2-${tag}`);

    // Mover a la derecha y quitar.
    await page.locator('.crm-table thead th[data-col="email"]').hover();
    await page.getByTestId('col-menu-email').click();
    await page.getByTestId('col-menu-email-list').getByRole('menuitem', { name: 'Move right' }).click();
    await expect(page).toHaveURL(/cols=name%2Cphone%2Cemail%2Ccompany/);
    await page.locator('.crm-table thead th[data-col="phone"]').hover();
    await page.getByTestId('col-menu-phone').click();
    await page.getByTestId('col-menu-phone-remove').click();
    await expect(page.locator('.crm-table thead th[data-col="phone"]')).toHaveCount(0);
    // El nombre no se quita.
    await page.locator('.crm-table thead th[data-col="name"]').hover();
    await page.getByTestId('col-menu-name').click();
    await expect(page.getByTestId('col-menu-name-remove')).toHaveCount(0);
  });
});

test.describe('record page', () => {
  test('+ Add on an association card searches the server, not just the first records', async ({ page, request }) => {
    const tag = uid();
    const [contactId] = await seedContacts(request, tag, 1);
    // Una empresa con un nombre que va última en orden alfabético: no entra en la lista inicial.
    const company = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: `zzz P5 picker ${tag}` } }));
    await page.goto(`/en/app/crm/contacts/${contactId}`, { waitUntil: 'networkidle' });
    const card = page.locator('[data-card="contact.companies"]');
    await card.getByTestId('record-card-add').click();
    const picker = card.getByTestId('assoc-picker');
    await expect(picker).toBeVisible();
    await expect(card.getByTestId('assoc-picker-search')).toBeFocused();
    // Esc cierra y devuelve el foco al botón; clic afuera también cierra.
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(card.getByTestId('record-card-add')).toBeFocused();
    await card.getByTestId('record-card-add').click();
    await page.locator('h1').first().click();
    await expect(picker).toHaveCount(0);

    await card.getByTestId('record-card-add').click();
    const searched = page.waitForResponse((r) => r.url().includes('/api/crm/associations/search') && r.url().includes(tag));
    await card.getByTestId('assoc-picker-search').fill(`picker ${tag}`);
    expect((await searched).ok()).toBe(true);
    await card.getByRole('option', { name: new RegExp(`zzz P5 picker ${tag}`) }).click();
    await expect(card.getByRole('link', { name: `zzz P5 picker ${tag}` })).toBeVisible();
    await expect(card.locator('.rec-card-count')).toHaveText('1');
    const assoc = await json<{ companies?: Array<{ id: string }> }>(request.get(`/api/crm/associations?type=contact&id=${contactId}`));
    expect(JSON.stringify(assoc)).toContain(company.id);
  });
});

test('390: toolbar, select all banner and the record picker fit, 40px targets, no side scroll', async ({ browser, request }) => {
  const tag = uid();
  const [contactId] = await seedContacts(request, tag, 27);
  const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await noSideScroll(page);
    for (const id of ['quick-filter-picker', 'export-view']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.height, id).toBeGreaterThanOrEqual(40);
      expect(b.x + b.width, id).toBeLessThanOrEqual(PHONE.width);
    }
    await page.locator('thead input.row-check').check();
    await expect(page.getByTestId('select-all-matching')).toBeVisible();
    expect((await page.getByTestId('select-all-matching').boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await noSideScroll(page);
    await page.getByTestId('select-all-matching').click();
    await expect(page.getByTestId('bulk-count')).toHaveText('27 selected');
    await page.getByTestId('bulk-tasks').click();
    const pop = page.getByTestId('crm-bulk-bar').getByRole('dialog');
    const pb = (await pop.boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(PHONE.width);
    await page.keyboard.press('Escape');
    await noSideScroll(page);

    await page.goto(`/en/app/crm/contacts/${contactId}?tab=related`, { waitUntil: 'networkidle' });
    const card = page.locator('[data-card="contact.companies"]');
    const add = card.getByTestId('record-card-add');
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await add.click();
    const picker = card.getByTestId('assoc-picker');
    await expect(picker).toBeVisible();
    const box = (await picker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    await noSideScroll(page);
  } finally {
    await ctx.close();
  }
});
