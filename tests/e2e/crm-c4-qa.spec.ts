import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM, arreglos de QA del bloque C4:
 * - KPI del dashboard: el número de cada tile a la misma altura en una fila, el período visible en el
 *   teléfono y, cargando, el alto de un KPI (no el de un gráfico);
 * - Selector de dashboards con la letra de la app e íconos;
 * - Filtro de fechas con Desde y Hasta que entran enteros;
 * - "Agregar empresa" de la vista previa con el campo de la app (un borde, con margen);
 * - "Agregar etapa" de 40 px; pestaña de feedback que no tapa los listados en el teléfono;
 * - Pestaña de vista activa sin cortar y el ícono de filtros rápidos junto a Filtros avanzados a 390.
 */
const PHONE = { width: 390, height: 844 };

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

async function noSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

const kpiTiles = (page: Page) => page.locator('[data-testid="cdb-tile"][data-shape="kpi"]');
const uid = () => Math.random().toString(36).slice(2, 8);

/** Un dashboard propio con cuatro KPI chicos y un gráfico (el "Sales" de la cuenta demo lo tocan otros tests). */
async function kpiDashboard(request: APIRequestContext) {
  const res = await request.post('/api/crm/dashboards', { data: { name: `QA KPIs ${uid()}`, template: 'blank' } });
  expect(res.ok(), await res.text()).toBe(true);
  const d = (await res.json()) as { id: string };
  for (const reportKey of ['revenue_won_kpi', 'deals_created_kpi', 'win_rate_kpi', 'sales_velocity', 'deals_created']) {
    const w = await request.post(`/api/crm/dashboards/${d.id}/widgets`, { data: { type: 'library', config: { reportKey }, ...(reportKey.endsWith('kpi') || reportKey === 'sales_velocity' ? { size: 'small' } : {}) } });
    expect(w.ok(), await w.text()).toBe(true);
  }
  return d.id;
}

/** Sin la pestaña flotante, el feedback se manda desde el menú de la cuenta y abre el mismo panel. */
async function feedbackFromMenu(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  await page.locator('.band-menu').click();
  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('side-feedback').click();
  const panel = page.locator('.fl-root .fl-panel');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
}

test.describe('dashboards', () => {
  // El service worker de la app (build de producción) atiende los fetch: page.route no los vería.
  test.use({ serviceWorkers: 'block' });

  test('KPI values line up in a row, KPI height while loading; switcher uses the app font and icons (1280)', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const id = await kpiDashboard(request);
    await page.goto(`/en/app/crm/dashboards?d=${id}`, { waitUntil: 'networkidle' });
    await expect(kpiTiles(page)).toHaveCount(4);
    await expect(kpiTiles(page).first().locator('.cdb-kpi-value')).toBeVisible();
    const rows = await kpiTiles(page).evaluateAll((tiles) =>
      tiles.map((el) => ({ top: Math.round(el.getBoundingClientRect().top), value: Math.round(el.querySelector('.cdb-kpi-value')?.getBoundingClientRect().top ?? -1) })),
    );
    const byRow = new Map<number, number[]>();
    for (const r of rows) byRow.set(r.top, [...(byRow.get(r.top) ?? []), r.value]);
    for (const values of byRow.values()) expect(Math.max(...values) - Math.min(...values), JSON.stringify(rows)).toBeLessThanOrEqual(1);

    // Cargando (otro período): los KPI tienen el alto de un KPI, no el de un gráfico.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    // La ruta queda puesta: después de soltarla, los pedidos pasan sin esperar.
    await page.route('**/api/crm/dashboards/data', async (route) => {
      await held;
      await route.continue().catch(() => {});
    });
    try {
      await page.getByTestId('cdb-filter-range').click();
      await page.getByRole('option', { name: 'This quarter' }).click();
      const loading = page.locator('.cdb-tile-loading[data-shape="kpi"]');
      await expect(loading).toHaveCount(4);
      const heights = await loading.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeLessThan(220);
    } finally {
      release();
    }
    await expect(page.locator('.cdb-tile-loading')).toHaveCount(0);

    await page.getByTestId('cdb-switcher').click();
    const panel = page.getByTestId('cdb-switcher-panel');
    await expect(panel).toBeVisible();
    const fonts = await panel.evaluate((el) => {
      const body = getComputedStyle(document.body).fontFamily;
      const item = el.querySelector('.cdb-switcher-item');
      const create = el.querySelector('.cdb-switcher-create');
      return { body, item: item ? getComputedStyle(item).fontFamily : '', create: create ? getComputedStyle(create).fontFamily : '', svg: el.querySelectorAll('.cdb-switcher-create svg, .cdb-switcher-check svg').length };
    });
    expect(fonts.item).toBe(fonts.body);
    expect(fonts.create).toBe(fonts.body);
    expect(fonts.svg).toBeGreaterThanOrEqual(2);
    await expect(panel).not.toContainText('✓');
    await page.keyboard.press('Escape');
  });

  test('KPI tiles at 390: period visible, two per row, no feedback tab over them (feedback from the menu)', async ({ browser, baseURL, request }) => {
    const id = await kpiDashboard(request);
    const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    try {
      const page = await ctx.newPage();
      await page.goto(`/en/app/crm/dashboards?d=${id}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.fl-root')).toBeHidden();
      await expect(kpiTiles(page).first().locator('.cdb-kpi-value')).toBeVisible();
      await expect(kpiTiles(page).first().locator('.cdb-tile-sub')).toBeVisible();
      const [a, b] = await kpiTiles(page).evaluateAll((els) => els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(a).toBe(b);
      await noSideScroll(page);
      await page.screenshot({ path: 'test-results/crm-c4-qa-dashboards-390.png' });
      await feedbackFromMenu(page);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('lists', () => {
  test('date filter inputs fit; preview Add company uses the app field (1280)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/en/app/crm/contacts?sv=all', { waitUntil: 'networkidle' });
    await page.getByTestId('contacts-created-filter').click();
    const menu = page.getByTestId('contacts-created-filter-menu');
    await expect(menu).toBeVisible();
    const inputs = menu.locator('input[type="date"]');
    await expect(inputs).toHaveCount(2);
    for (const i of [0, 1]) {
      const fits = await inputs.nth(i).evaluate((el) => el.getBoundingClientRect().width);
      expect(fits).toBeGreaterThanOrEqual(140);
    }
    await page.keyboard.press('Escape');

    await page.locator('.crm-table tbody tr').first().getByTestId('record-name').click();
    const add = page.getByTestId('preview-assoc-companies-add');
    await add.scrollIntoViewIfNeeded();
    await add.click();
    const input = page.getByTestId('preview-assoc-companies-search').getByRole('combobox');
    await expect(input).toBeFocused();
    const style = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, pad: parseFloat(s.paddingLeft), outline: s.outlineStyle };
    });
    expect(style.border).toBe('1px');
    expect(style.pad).toBeGreaterThanOrEqual(8);
    await expect(input).toHaveClass(/\binput\b/);
  });

  test('390: add stage is 40 px, the active view tab is not cut, the quick filter icon is not alone, no feedback tab', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    try {
    const page = await ctx.newPage();
    await page.goto('/en/app/crm/deals', { waitUntil: 'networkidle' });
    await expect(page.locator('.fl-root')).toBeHidden();
    const addStage = page.getByTestId('kb-add-stage');
    await addStage.scrollIntoViewIfNeeded();
    expect((await addStage.boundingBox())!.height).toBeGreaterThanOrEqual(40);

    await page.goto('/en/app/crm/contacts?sv=all', { waitUntil: 'networkidle' });
    await expect(page.locator('.fl-root')).toBeHidden();
    const name = page.locator('.view-tab.active .view-tab-name');
    const cut = await name.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(cut).toBe(false);
    const centers = await page.getByTestId('quick-filters').evaluate((row) => {
      const mid = (el: Element | null) => (el ? el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 : -100);
      return { adv: mid(row.querySelector('[data-testid="adv-filters-open"]')), picker: mid(row.querySelector('[data-testid="quick-filter-picker"]')) };
    });
    expect(Math.abs(centers.picker - centers.adv)).toBeLessThanOrEqual(1);
    await noSideScroll(page);
    await page.screenshot({ path: 'test-results/crm-c4-qa-contacts-390.png' });
    } finally {
      await ctx.close();
    }
  });
});

test.describe('record page', () => {
  test('390: no feedback tab over the record; the automatic lifecycle line has a dot, not an arrow', async ({ browser, baseURL, request }) => {
    const tag = uid();
    const created = await request.post('/api/crm/contacts', { data: { firstName: 'Auto', lastName: `Life ${tag}`, lifecycleStage: 'lead' } });
    expect(created.ok(), await created.text()).toBe(true);
    const contact = (await created.json()) as { id: string };
    const { rows: pipelines } = (await (await request.get('/api/crm/pipelines')).json()) as { rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> };
    const p = pipelines.find((x) => x.stages.some((s) => !s.is_won && !s.is_lost))!;
    const stage = p.stages.find((s) => !s.is_won && !s.is_lost)!;
    const deal = await request.post('/api/crm/deals', { data: { name: `Auto deal ${tag}`, pipelineId: p.id, stageId: stage.id, amount: 100, contactIds: [contact.id] } });
    expect(deal.ok(), await deal.text()).toBe(true);
    const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.fl-root')).toBeHidden();
      await page.getByTestId('record-tab-activity').click();
      const line = page.getByTestId('crm-timeline-change').first();
      await expect(line).toBeVisible();
      await expect(line.locator('.atl-icon svg')).toHaveCount(0);
      expect(await line.locator('.atl-icon').evaluate((el) => getComputedStyle(el, '::after').width)).toBe('6px');
      // La hora entra entera en la pantalla.
      const when = (await line.locator('time').boundingBox())!;
      expect(when.x + when.width).toBeLessThanOrEqual(PHONE.width);
      await noSideScroll(page);
    } finally {
      await ctx.close();
    }
  });
});
