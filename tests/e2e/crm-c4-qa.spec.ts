import { expect as baseExpect, test, type Page } from '@playwright/test';

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

test.describe('dashboards', () => {
  test('KPI values line up in a row; switcher uses the app font and icons (1280)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });
    await expect(kpiTiles(page).first().locator('.cdb-kpi-value')).toBeVisible();
    const rows = await kpiTiles(page).evaluateAll((tiles) =>
      tiles.map((el) => ({ top: Math.round(el.getBoundingClientRect().top), value: Math.round(el.querySelector('.cdb-kpi-value')?.getBoundingClientRect().top ?? -1) })),
    );
    const byRow = new Map<number, number[]>();
    for (const r of rows) byRow.set(r.top, [...(byRow.get(r.top) ?? []), r.value]);
    for (const values of byRow.values()) expect(Math.max(...values) - Math.min(...values), JSON.stringify(rows)).toBeLessThanOrEqual(1);

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

  test('KPI tiles at 390: period visible, no stretched loading tiles, no feedback tab over them', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    // Cargando: los KPI ya tienen el alto de un KPI.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/api/crm/dashboards/data', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/en/app/crm/dashboards', { waitUntil: 'domcontentloaded' });
    await expect(kpiTiles(page).first()).toBeVisible();
    const loadingHeight = await kpiTiles(page).first().evaluate((el) => el.getBoundingClientRect().height);
    expect(loadingHeight).toBeLessThan(260);
    release();
    await expect(kpiTiles(page).first().locator('.cdb-kpi-value')).toBeVisible();
    await expect(kpiTiles(page).first().locator('.cdb-tile-sub')).toBeVisible();
    await expect(page.locator('.fl-root')).toBeHidden();
    await noSideScroll(page);
    await page.screenshot({ path: 'test-results/crm-c4-qa-dashboards-390.png' });
    await ctx.close();
  });
});

test.describe('lists', () => {
  test('date filter inputs fit; preview Add company uses the app field (1280)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
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
    const page = await ctx.newPage();
    await page.goto('/en/app/crm/deals', { waitUntil: 'networkidle' });
    const addStage = page.getByTestId('kb-add-stage');
    await addStage.scrollIntoViewIfNeeded();
    expect((await addStage.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await expect(page.locator('.fl-root')).toBeHidden();

    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    const name = page.locator('.view-tab.active .view-tab-name');
    const cut = await name.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(cut).toBe(false);
    const tops = await page.getByTestId('quick-filters').evaluate((row) => {
      const adv = row.querySelector('[data-testid="adv-filters-open"]');
      const picker = row.querySelector('[data-testid="quick-filter-picker"]');
      return { adv: Math.round(adv?.getBoundingClientRect().top ?? -1), picker: Math.round(picker?.getBoundingClientRect().top ?? -2) };
    });
    expect(tops.picker).toBe(tops.adv);
    await expect(page.locator('.fl-root')).toBeHidden();
    await noSideScroll(page);
    await page.screenshot({ path: 'test-results/crm-c4-qa-contacts-390.png' });
    await ctx.close();
  });
});
