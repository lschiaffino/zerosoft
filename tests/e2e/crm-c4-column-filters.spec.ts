import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM, bloque C4: "Filtrar por esta columna" desde el menú del encabezado,
 * como en HubSpot. Cada tipo de propiedad trae su control (texto, opciones,
 * fecha entre dos días, número entre dos valores, sin valor). La regla va al
 * filtro avanzado: chip en la barra, marca en el encabezado, se guarda con la
 * vista y se quita desde el mismo menú. Esc y un clic afuera cierran sin
 * aplicar. A 1280 y a 390 (puntero táctil).
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

async function seed(request: APIRequestContext, tag: string) {
  await json(request.post('/api/crm/contacts', { data: { firstName: 'Alma', lastName: `Colf ${tag}`, email: `alma-${tag}@acme.example`, phone: '+1 202 555 0101', lifecycleStage: 'lead' } }));
  await json(request.post('/api/crm/contacts', { data: { firstName: 'Bruno', lastName: `Colf ${tag}`, email: `bruno-${tag}@globex.example`, lifecycleStage: 'customer' } }));
  await json(request.post('/api/crm/contacts', { data: { firstName: 'Cora', lastName: `Colf ${tag}`, email: `cora-${tag}@acme.example`, phone: '+1 202 555 0102', lifecycleStage: 'customer' } }));
}

const rows = (page: Page) => page.locator('.crm-table tbody tr');
const filtersParam = (page: Page) => new URL(page.url()).searchParams.get('filters') ?? '';

async function openFilter(page: Page, col: string) {
  const head = page.locator(`.crm-table thead th[data-col="${col}"]`);
  await head.hover();
  await page.getByTestId(`col-menu-${col}`).click();
  await page.getByTestId(`col-menu-${col}-filter`).click();
}

test.describe('column filters at 1280', () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test('text, options and empty from the header; chip, mark, Esc and outside click', async ({ page, request }) => {
    const tag = uid();
    await seed(request, tag);
    await page.goto(`/en/app/crm/contacts?q=${tag}&cols=name,email,phone,lifecycle,created`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(3);

    // Esc cierra sin aplicar y el foco vuelve al botón del menú; un clic afuera también cierra.
    await openFilter(page, 'email');
    const pop = page.getByTestId('col-filter-email');
    await expect(pop).toBeVisible();
    await expect(pop.getByTestId('adv-filters-value')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.getByTestId('col-menu-email')).toBeFocused();
    await openFilter(page, 'email');
    await page.locator('h1').first().click();
    await expect(pop).toHaveCount(0);
    expect(filtersParam(page)).toBe('');

    // Texto: contiene "acme" (Enter aplica).
    await openFilter(page, 'email');
    await expect(pop.getByTestId('col-filter-op')).toHaveValue('contains');
    await pop.getByTestId('adv-filters-value').fill('acme');
    await pop.getByTestId('adv-filters-value').press('Enter');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/filters=/);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId('adv-filters-chips').getByTestId('adv-filters-chip')).toHaveCount(1);
    await expect(page.getByTestId('col-filtered-email')).toBeVisible();
    await expect(page.getByTestId('adv-filters-count')).toHaveText('1');

    // Opciones: lifecycle es "Customer" (Y con el anterior).
    await openFilter(page, 'lifecycle');
    const life = page.getByTestId('col-filter-lifecycle');
    await life.getByRole('checkbox', { name: 'Customer' }).check();
    await life.getByTestId('col-filter-apply').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`cora-${tag}`);
    await expect(page.getByTestId('adv-filters-chip')).toHaveCount(2);

    // Sin valor: el teléfono está vacío (cambia la regla del email por otra: queda Bruno, si se quita la del email).
    await openFilter(page, 'email');
    await expect(page.getByTestId('col-filter-email').getByTestId('adv-filters-value')).toBeVisible();
    await page.getByTestId('col-filter-email').getByTestId('col-filter-clear').click();
    await expect(page.getByTestId('col-filtered-email')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    await openFilter(page, 'phone');
    const phone = page.getByTestId('col-filter-phone');
    await phone.getByTestId('col-filter-op').selectOption('unknown');
    await expect(phone.getByTestId('adv-filters-value')).toHaveCount(0);
    await phone.getByTestId('col-filter-apply').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`bruno-${tag}`);
    await noSideScroll(page);
    await page.screenshot({ path: 'test-results/crm-c4-col-filter-1280.png' });

    // Un valor incompleto no se aplica: avisa.
    await openFilter(page, 'created');
    const created = page.getByTestId('col-filter-created');
    await created.getByTestId('col-filter-op').selectOption('between');
    await created.getByTestId('col-filter-apply').click();
    await expect(created.getByTestId('col-filter-error')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('date and number ranges; the column filter is saved with the view', async ({ page, request }) => {
    const tag = uid();
    const { rows: pipelines } = await json<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> }>(request.get('/api/crm/pipelines'));
    const p = pipelines[0];
    const stage = p.stages.find((s) => !s.is_won && !s.is_lost)!;
    for (const [name, amount] of [['Small', 50], ['Mid', 300], ['Big', 9000]] as const) {
      await json(request.post('/api/crm/deals', { data: { name: `${name} colf ${tag}`, pipelineId: p.id, stageId: stage.id, amount } }));
    }
    await page.goto(`/en/app/crm/deals?pipeline=${p.id}&view=table&q=${tag}&cols=name,amount,created`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(3);

    // Número entre dos valores.
    await openFilter(page, 'amount');
    const amount = page.getByTestId('col-filter-amount');
    await amount.getByTestId('col-filter-op').selectOption('between');
    await amount.getByTestId('adv-filters-value').fill('100');
    await amount.getByTestId('adv-filters-value-to').fill('1000');
    await amount.getByTestId('col-filter-apply').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`Mid colf ${tag}`);

    // Fecha entre dos días (hoy entra; ayer y mañana como bordes).
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    await openFilter(page, 'created');
    const created = page.getByTestId('col-filter-created');
    await created.getByTestId('col-filter-op').selectOption('between');
    await created.getByTestId('adv-filters-value').fill(day(-2));
    await created.getByTestId('adv-filters-value-to').fill(day(2));
    await created.getByTestId('col-filter-apply').click();
    await expect(page.getByTestId('adv-filters-chip')).toHaveCount(2);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('col-filtered-created')).toBeVisible();

    // El menú ofrece editarla y trae lo aplicado.
    await page.locator('.crm-table thead th[data-col="amount"]').hover();
    await page.getByTestId('col-menu-amount').click();
    await expect(page.getByTestId('col-menu-amount-filter')).toHaveText('Edit column filter');
    await page.getByTestId('col-menu-amount-filter').click();
    await expect(page.getByTestId('col-filter-amount').getByTestId('adv-filters-value')).toHaveValue('100');
    await page.keyboard.press('Escape');

    // Guardar como vista: la regla de la columna queda en la vista.
    const filters = filtersParam(page);
    expect(filters).toContain('"amount"');
    const view = await json<{ id: string; query: Record<string, string> }>(
      request.post('/api/crm/views', { data: { entity: 'deals', name: `Colf ${tag}`, query: { q: tag, filters } } }),
    );
    expect(view.query.filters).toContain('"amount"');
    await page.goto(`/en/app/crm/deals?pipeline=${p.id}&view=table&sv=${view.id}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('col-filtered-amount')).toBeVisible();
    // Quitar la regla desde la columna deja la vista modificada para guardar.
    await openFilter(page, 'amount');
    await page.getByTestId('col-filter-amount').getByTestId('col-filter-clear').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByTestId('view-modified')).toBeVisible();
    await page.getByTestId('view-save').click();
    await expect(page.getByTestId('view-modified')).toHaveCount(0);
    const saved = await json<{ query: Record<string, string> }>(request.get(`/api/crm/views/${view.id}`));
    expect(saved.query.filters ?? '').not.toContain('"amount"');
  });
});

test.describe('column filters at 390 (touch)', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('the name column filters from its header in a bottom sheet', async ({ page, request }) => {
    const tag = uid();
    await seed(request, tag);
    await page.goto(`/en/app/crm/contacts?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(rows(page)).toHaveCount(3);
    await page.getByTestId('col-menu-name').click();
    const item = page.getByTestId('col-menu-name-filter');
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await item.click();
    const pop = page.getByTestId('col-filter-name');
    await expect(pop).toBeVisible();
    const box = (await pop.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    await pop.getByTestId('adv-filters-value').fill('Cora');
    await expect(pop.getByTestId('col-filter-apply')).toBeVisible();
    expect((await pop.getByTestId('col-filter-apply').boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await page.screenshot({ path: 'test-results/crm-c4-col-filter-390.png' });
    await pop.getByTestId('col-filter-apply').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('adv-filters-chip')).toHaveCount(1);
    await noSideScroll(page);

    // Un toque afuera cierra.
    await page.getByTestId('col-menu-name').click();
    await page.getByTestId('col-menu-name-filter').click();
    await expect(pop).toBeVisible();
    await page.locator('h1').first().tap();
    await expect(pop).toHaveCount(0);
  });
});
