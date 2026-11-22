import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * CRM, bloque P2: listados de contactos y empresas con la estructura de HubSpot
 * y la ficha con buscador de propiedades.
 * - pestañas de vistas (Todas, Mis, Sin asignar);
 * - filtros rápidos (responsable, fecha de creación, última actividad, etapa) que
 *   abren un menú que cierra con Esc, clic afuera y al elegir;
 * - primera columna con avatar: el nombre abre la vista previa, "Abrir" la ficha;
 * - edición en la celda, acciones masivas (asignar, agregar a lista, exportar);
 * - filas por página;
 * - ficha: buscar propiedades, editar una, asociar y quitar una empresa;
 * - a 390 px: sin scroll lateral y con áreas táctiles de 40 px.
 *
 * Cada test crea sus registros con una marca propia y filtra el listado por ella:
 * la cuenta demo es compartida. Se busca por rol, testid o atributo.
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
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

async function seedContacts(request: APIRequestContext, tag: string) {
  const a = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Quinn', lastName: `Lead ${tag}`, email: `quinn-${tag}@p2.example`, leadStatus: 'new' } }));
  const b = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Rory', lastName: `Open ${tag}`, email: `rory-${tag}@p2.example`, leadStatus: 'open' } }));
  return { a: a.id, b: b.id, nameA: `Quinn Lead ${tag}`, nameB: `Rory Open ${tag}` };
}

const rows = (page: Page) => page.locator('.crm-table tbody tr');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
/** Filtro rápido de la fila (la misma barra que deals): `contacts-owner-filter`, `companies-created-filter`… */
const quick = (page: Page, entity: 'contacts' | 'companies', id: string): Locator => page.getByTestId(`${entity}-${id}-filter`);

test.describe('contacts index', () => {
  test('views tabs, quick filters with Esc / outside close, and clear', async ({ page, request }) => {
    const tag = uid();
    const s = await seedContacts(request, tag);
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(2);

    // Pestañas de vistas como HubSpot: Todas, Mis contactos, Sin asignar.
    const tabs = page.locator('.views-tabs');
    await expect(tabs.locator('a, button').filter({ hasText: /^All contacts$/ }).first()).toBeVisible();
    await expect(tabs.locator('a, button').filter({ hasText: /^My contacts$/ }).first()).toBeVisible();
    await expect(tabs.locator('a, button').filter({ hasText: /^Unassigned contacts$/ }).first()).toBeVisible();

    // La fila de filtros rápidos está a la vista, como en deals.
    const bar = page.getByTestId('quick-filters');
    for (const id of ['owner', 'created', 'activity', 'lead-status', 'lifecycle']) await expect(quick(page, 'contacts', id)).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Advanced filters' })).toBeVisible();

    // Estado del lead: filtra en el server.
    await quick(page, 'contacts', 'lead-status').selectOption('open');
    await expect(page).toHaveURL(/leadStatus=open/);
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, s.nameB)).toBeVisible();

    // Fecha de creación: el menú cierra con Esc (foco al botón) y con un clic afuera.
    const created = quick(page, 'contacts', 'created');
    const menu = page.getByTestId('contacts-created-filter-menu');
    await created.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(created).toBeFocused();
    await created.click();
    await expect(menu).toBeVisible();
    await page.locator('h1').first().click();
    await expect(menu).toHaveCount(0);

    // "Hoy" sigue mostrando lo creado recién (el día se lee en la zona de la persona); "El mes pasado" no.
    await created.click();
    await menu.getByRole('button', { name: 'Today' }).click();
    await expect(page).toHaveURL(/createdFrom=/);
    await expect(rows(page)).toHaveCount(1);
    await expect(created).toHaveClass(/\bon\b/);
    await created.click();
    await menu.getByRole('button', { name: 'Last month' }).click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('.ui-empty').first()).toBeVisible();

    // Limpiar quita todos los filtros (también la búsqueda).
    await page.getByTestId('quick-clear').click();
    await expect(page).not.toHaveURL(/createdFrom=|leadStatus=|q=/);
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(2);

    // Responsable: "Sin responsable" va a la URL.
    await quick(page, 'contacts', 'owner').selectOption('unassigned');
    await expect(page).toHaveURL(/owner=unassigned/);
    await expect(rows(page)).toHaveCount(0);
  });

  test('name opens the preview, Open goes to the record, inline edit, page size', async ({ page, request }) => {
    const tag = uid();
    const s = await seedContacts(request, tag);
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });

    // Primera columna: avatar con iniciales, fija al desplazar la tabla.
    const first = row(page, s.nameA);
    await expect(first.locator('.hs-avatar')).toHaveText('QL');
    await expect(page.locator('.crm-table')).toHaveClass(/is-frozen/);

    // Clic en el nombre: vista previa al costado, sin salir del listado.
    await first.getByTestId('record-name').click();
    await expect(page.locator('.preview-panel')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/crm\/contacts\?/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.preview-panel')).toHaveCount(0);

    // Edición en la celda: estado del lead.
    await page.goto(`/en/app/crm/contacts?q=${tag}&cols=name,email,leadStatus,owner`, { waitUntil: 'networkidle' });
    // Columnas: selección, nombre, email, estado del lead.
    await row(page, s.nameA).locator('td:nth-child(4) .cell-inline').click();
    const saved = page.waitForResponse((r) => r.url().includes(`/api/crm/contacts/${s.a}`) && r.request().method() === 'PATCH');
    await row(page, s.nameA).getByRole('combobox', { name: 'leadStatus' }).selectOption('connected');
    expect((await saved).ok()).toBe(true);
    await expect.poll(async () => (await json<{ contact: { lead_status: string } }>(request.get(`/api/crm/contacts/${s.a}`))).contact.lead_status).toBe('connected');

    // "Abrir" lleva a la ficha.
    await row(page, s.nameA).hover();
    await row(page, s.nameA).getByTestId('record-open').click();
    await page.waitForURL(new RegExp(`/app/crm/contacts/${s.a}$`));

    // Filas por página.
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await page.getByTestId('page-size').selectOption('50');
    await expect(page).toHaveURL(/per=50/);
    await expect(page.getByTestId('page-size')).toHaveValue('50');
  });

  test('bulk bar: assign, add to list, export, panels close on Esc', async ({ page, request }) => {
    const tag = uid();
    const s = await seedContacts(request, tag);
    const list = await json<{ id: string }>(request.post('/api/crm/lists', { data: { name: `P2 list ${tag}`, entity: 'contacts', kind: 'static' } }));
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });

    await page.locator('thead input.row-check').check();
    const bar = page.getByTestId('crm-bulk-bar');
    await expect(bar).toContainText('2 selected');
    for (const id of ['bulk-assign', 'bulk-edit', 'bulk-list', 'bulk-export', 'bulk-delete']) await expect(bar.getByTestId(id)).toBeVisible();

    // Exportar la selección: CSV con solo esos dos.
    const href = await bar.getByTestId('bulk-export').getAttribute('href');
    const csv = await (await request.get(href!)).text();
    expect(csv).toContain(`quinn-${tag}@p2.example`);
    expect(csv).toContain(`rory-${tag}@p2.example`);
    expect(csv.trim().split('\n')).toHaveLength(3);

    // Panel de "Agregar a lista": Esc lo cierra; elegir y agregar.
    await bar.getByTestId('bulk-list').click();
    await expect(bar.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bar.getByRole('dialog')).toHaveCount(0);
    await bar.getByTestId('bulk-list').click();
    await bar.getByRole('dialog').getByRole('combobox').selectOption(list.id);
    await bar.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.bulk-notice')).toContainText('2 contacts added to the list');
    const detail = await json<{ members?: Array<{ id: string }>; contacts?: Array<{ id: string }> }>(request.get(`/api/crm/lists/${list.id}`));
    expect(JSON.stringify(detail)).toContain(s.a);

    // Asignar: "Sin responsable" para los dos.
    await page.locator('thead input.row-check').check();
    await bar.getByTestId('bulk-assign').click();
    const done = page.waitForResponse((r) => r.url().includes('/api/crm/contacts/bulk'));
    await bar.getByRole('dialog').getByRole('option', { name: 'No owner' }).click();
    expect((await done).ok()).toBe(true);
    await expect(page.locator('.bulk-notice')).toBeVisible();
    await page.goto(`/en/app/crm/contacts?q=${tag}&owner=unassigned`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(2);

    // Clic afuera cierra el panel abierto.
    await page.locator('thead input.row-check').check();
    await bar.getByTestId('bulk-edit').click();
    await expect(bar.getByRole('dialog')).toBeVisible();
    await page.locator('h1').first().click();
    await expect(bar.getByRole('dialog')).toHaveCount(0);
  });

  test('390: quick filters and bulk bar fit, 40px targets, no side scroll', async ({ browser, request }) => {
    const tag = uid();
    const s = await seedContacts(request, tag);
    const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true });
    const page = await ctx.newPage();
    for (const path of [`/en/app/crm/contacts?q=${tag}`, `/en/app/crm/companies?q=${tag}`]) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await noSideScroll(page);
      const entity = path.includes('companies') ? 'companies' : 'contacts';
      expect((await quick(page, entity, 'owner').boundingBox())!.height).toBeGreaterThanOrEqual(40);
      const btn = quick(page, entity, 'created');
      await btn.click();
      const pop = page.getByTestId(`${entity}-created-filter-menu`);
      await expect(pop).toBeVisible();
      const box = (await pop.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      await noSideScroll(page);
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
    }
    // Tarjeta en el teléfono: el nombre abre la ficha (sin vista previa).
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await row(page, s.nameA).locator('input.row-check').check();
    const bar = page.getByTestId('crm-bulk-bar');
    await expect(bar).toBeVisible();
    const bb = (await bar.boundingBox())!;
    expect(bb.x).toBeGreaterThanOrEqual(0);
    expect(bb.x + bb.width).toBeLessThanOrEqual(PHONE.width);
    await noSideScroll(page);
    await row(page, s.nameA).locator('input.row-check').uncheck();
    await row(page, s.nameA).getByTestId('record-name').click();
    await page.waitForURL(new RegExp(`/app/crm/contacts/${s.a}$`));
    await ctx.close();
  });
});

test.describe('companies index', () => {
  test('logo column, quick filter by lifecycle, bulk assign', async ({ page, request }) => {
    const tag = uid();
    const co = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Pear Co ${tag}`, lifecycleStage: 'customer' } }));
    await json(request.post('/api/crm/companies', { data: { name: `Plum Co ${tag}`, lifecycleStage: 'lead' } }));
    await page.goto(`/en/app/crm/companies?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, `Pear Co ${tag}`).locator('.co-logo')).toBeVisible();
    for (const id of ['owner', 'created', 'activity', 'lifecycle', 'industry']) await expect(quick(page, 'companies', id)).toBeVisible();

    await quick(page, 'companies', 'lifecycle').selectOption('customer');
    await expect(page).toHaveURL(/lifecycle=customer/);
    await expect(rows(page)).toHaveCount(1);

    await row(page, `Pear Co ${tag}`).getByTestId('record-name').click();
    await expect(page.locator('.preview-panel')).toBeVisible();
    await page.keyboard.press('Escape');

    await row(page, `Pear Co ${tag}`).locator('input.row-check').check();
    const bar = page.getByTestId('crm-bulk-bar');
    await bar.getByTestId('bulk-assign').click();
    const done = page.waitForResponse((r) => r.url().includes('/api/crm/companies/bulk'));
    await bar.getByRole('dialog').getByRole('option', { name: 'No owner' }).click();
    expect((await done).ok()).toBe(true);
    await expect.poll(async () => (await json<{ company: { owner_id: string | null } }>(request.get(`/api/crm/companies/${co.id}`))).company.owner_id ?? null).toBeNull();
  });
});

test.describe('record page', () => {
  test('search properties, edit one, associate and remove a company', async ({ page, request }) => {
    const tag = uid();
    const contact = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Sasha', lastName: `Props ${tag}`, email: `sasha-${tag}@p2.example` } }));
    // Nombre que ordena primero: el selector de "asociar" trae las primeras por nombre.
    const company = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: `000 P2 assoc ${tag}` } }));
    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });

    const about = page.getByTestId('record-about');
    const search = about.getByTestId('prop-search');
    await search.fill('job');
    await expect(about.locator('[data-prop="jobTitle"]')).toBeVisible();
    await expect(about.locator('[data-prop="email"]')).toHaveCount(0);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(about.locator('[data-prop="email"]')).toBeVisible();

    // Ocultar vacías: el puesto (vacío) se va, el email queda.
    await about.getByTestId('prop-hide-empty').click();
    await expect(about.locator('[data-prop="jobTitle"]')).toHaveCount(0);
    await expect(about.locator('[data-prop="email"]')).toBeVisible();
    await about.getByTestId('prop-hide-empty').click();

    // Editar una propiedad desde la columna.
    await search.fill('job');
    const job = about.locator('[data-prop="jobTitle"]');
    await job.locator('.prop-btn').click();
    const saved = page.waitForResponse((r) => r.url().includes(`/api/crm/contacts/${contact.id}`) && r.request().method() === 'PATCH');
    await job.locator('input').fill('Head of Ops');
    await job.locator('input').press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect.poll(async () => (await json<{ contact: { job_title: string } }>(request.get(`/api/crm/contacts/${contact.id}`))).contact.job_title).toBe('Head of Ops');

    // Asociar una empresa desde la tarjeta de la derecha, y quitarla.
    const card = page.locator('[data-card="contact.companies"]');
    await card.getByRole('combobox', { name: 'Associate company…' }).selectOption(company.id);
    await expect(card.getByRole('link', { name: `000 P2 assoc ${tag}` })).toBeVisible();
    await card.getByRole('button', { name: `Remove 000 P2 assoc ${tag}` }).click();
    await expect(card.getByRole('link', { name: `000 P2 assoc ${tag}` })).toHaveCount(0);
  });
});
