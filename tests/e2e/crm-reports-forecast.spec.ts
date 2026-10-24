import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM tanda C4: constructor de reportes propios (guardar, CSV, dashboard,
 * renombrar, borrar), forecast (envío con historial y categoría por deal) y
 * recorrido de deals, en escritorio, oscuro y a 390px.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner + 1);
}

async function pipeline(request: APIRequestContext) {
  const p = await (await request.post('/api/crm/pipelines', { data: { name: `C4 ${uid()}` } })).json();
  const mk = async (name: string, probability: number) =>
    (await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name, probability } })).json()) as { id: string };
  const lead = await mk('Lead', 10);
  const nego = await mk('Negotiation', 80);
  const won = await mk('Won', 100);
  const lost = await mk('Lost', 0);
  await request.patch(`/api/crm/stages/${won.id}`, { data: { isWon: true } });
  await request.patch(`/api/crm/stages/${lost.id}`, { data: { isLost: true } });
  return { id: p.id as string, lead, nego, won, lost };
}

// Varias páginas con networkidle (el shell precarga muchas rutas): más tiempo que el default.
test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('reporte propio: armar, guardar, CSV, dashboard, renombrar y borrar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const p = await pipeline(request);
  await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: p.nego.id, name: `Rep ${uid()}`, amount: 500 } });
  // El dashboard por defecto se crea al abrir Dashboards la primera vez.
  await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });

  await page.goto('/en/app/crm/reports/custom', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'New report' }).first().click();
  await expect(page).toHaveURL(/\/reports\/custom\/new/);
  // Tabla de registros por defecto.
  await expect(page.getByTestId('rb-table')).toBeVisible();

  // Barras: deals agrupados por etapa con la suma del monto.
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByRole('button', { name: '+ Add grouping' }).click();
  await page.getByLabel('Group 1').selectOption('deal.stage');
  await page.getByLabel('Metric', { exact: true }).selectOption('sum');
  await expect(page.getByTestId('rb-bars')).toBeVisible();
  await expect(page.getByTestId('rb-bars')).toContainText('Negotiation');

  const name = `Pipeline by stage ${uid()}`;
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/custom\/[0-9a-f-]{36}/);
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);

  // CSV.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);

  // Agregar al dashboard.
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('menu').getByRole('menuitem').first().click();
  await expect(page.getByText('Added to the dashboard')).toBeVisible();
  await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });
  await expect(page.locator('.dash-widget-title', { hasText: name })).toBeVisible();

  // Renombrar y borrar desde la lista.
  await page.goto('/en/app/crm/reports/custom', { waitUntil: 'networkidle' });
  const row = page.getByTestId('custom-report-row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Rename' }).click();
  const renamed = `${name} v2`;
  const input = page.getByRole('textbox', { name: 'Rename' });
  await input.fill(renamed);
  await input.press('Enter');
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();

  // ⌘K lo encuentra.
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill(renamed);
  await expect(dialog.getByRole('option', { name: new RegExp(renamed) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  const row2 = page.getByTestId('custom-report-row').filter({ hasText: renamed });
  await row2.getByRole('button', { name: 'Delete' }).click();
  await row2.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('custom-report-row').filter({ hasText: renamed })).toHaveCount(0);
  await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });
  await expect(page.locator('.dash-widget-title', { hasText: renamed })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reporte propio entre objetos con KPI y error de campo inexistente', async ({ page, request }) => {
  const res = await request.post('/api/crm/custom-reports/run', {
    data: { config: { source: 'contacts', objects: ['company'], dimensions: [{ field: 'company.industry' }], viz: 'pie' } },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).kind).toBe('aggregate');
  const bad = await request.post('/api/crm/custom-reports/run', { data: { config: { source: 'deals', columns: ['deal.custom:nope'] } } });
  expect(bad.status()).toBe(400);

  await page.goto('/en/app/crm/reports/custom/new', { waitUntil: 'networkidle' });
  await page.getByLabel('Data source').selectOption('contacts');
  await page.getByRole('button', { name: 'KPI', exact: true }).click();
  await expect(page.getByTestId('rb-kpi')).toBeVisible();
  await expect(page.getByTestId('rb-kpi')).toContainText('Count of contacts');
});

test('forecast: categorías, envío con historial y cambio de categoría', async ({ page, request }) => {
  const errors = watchErrors(page);
  const p = await pipeline(request);
  const now = new Date();
  const closeDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-28`;
  const dealName = `FC ${uid()}`;
  await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: p.lead.id, name: dealName, amount: 1234, closeDate } });

  await page.goto('/en/app/crm/forecast', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Forecast' })).toBeVisible();
  await expect(page.getByTestId('fc-table')).toBeVisible();
  const dealRow = page.getByTestId('fc-deals').locator('tr', { hasText: dealName });
  await expect(dealRow).toContainText('Automatic (Pipeline)');

  // Pasa a commit a mano.
  const commitBefore = await page.getByTestId('fc-kpis').locator('.stat-card', { hasText: 'Commit' }).locator('.stat-num').textContent();
  await dealRow.getByLabel('Forecast category').selectOption('commit');
  await expect(page.getByTestId('fc-kpis').locator('.stat-card', { hasText: 'Commit' }).locator('.stat-num')).not.toHaveText(commitBefore ?? '');

  // Envío del número y su historial.
  const row = page.getByTestId('fc-table').locator('tbody tr').first();
  await row.getByRole('button', { name: /^(Submit|Update)$/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Amount').fill('4321');
  await dlg.getByLabel('Note (optional)').fill('Looks good');
  await dlg.getByRole('button', { name: 'Submit' }).click();
  await expect(dlg).toHaveCount(0);
  await row.getByRole('button', { name: /4,321/ }).click();
  await expect(page.getByTestId('fc-history')).toContainText('Looks good');

  // Período siguiente y vuelta.
  const label = await page.getByTestId('fc-period').textContent();
  await page.getByRole('button', { name: 'Next period' }).click();
  await expect(page.getByTestId('fc-period')).not.toHaveText(label ?? '');
  await page.getByRole('button', { name: 'Current period' }).click();
  await expect(page.getByTestId('fc-period')).toHaveText(label ?? '');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('recorrido de deals: conversión, tiempo y caída por etapa', async ({ page, request }) => {
  const p = await pipeline(request);
  const a = await (await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: p.lead.id, name: `J ${uid()}` } })).json();
  const b = await (await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: p.lead.id, name: `J ${uid()}` } })).json();
  await request.post(`/api/crm/deals/${a.id}/move`, { data: { stageId: p.nego.id } });
  await request.post(`/api/crm/deals/${a.id}/move`, { data: { stageId: p.won.id } });
  await request.post(`/api/crm/deals/${b.id}/move`, { data: { stageId: p.lost.id, lostReason: 'Price' } });

  await page.goto(`/en/app/crm/reports?report=journey&pipeline=${p.id}&jrange=all`, { waitUntil: 'networkidle' });
  const table = page.getByTestId('journey-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tr', { hasText: 'Lead' })).toContainText('50%');
  await expect(page.getByText('Most deals are lost at Lead.')).toBeVisible();
  await page.getByRole('button', { name: 'Entered stage' }).click();
  await expect(page).toHaveURL(/jmode=strict/);
  await expect(table).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`reportes, forecast y recorrido sin errores en ${theme} y a 390px`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    const errors = watchErrors(page);
    for (const url of ['/en/app/crm/reports/custom', '/en/app/crm/reports/custom/new', '/en/app/crm/forecast', '/en/app/crm/reports?report=journey&jrange=all']) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url, { waitUntil: 'networkidle' });
      await noHorizontalScroll(page);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
