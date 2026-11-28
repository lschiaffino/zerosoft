import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM Dashboards (P3): selector, agregar un reporte de la biblioteca, filtro
 * del dashboard, drill-down hasta la vista previa del registro, reordenar
 * tiles y la grilla a 390px. Cada prueba arma su propio dashboard y su
 * pipeline (la base es compartida con otras pruebas).
 */
const uid = () => Math.random().toString(36).slice(2, 8);

test.describe.configure({ timeout: 150_000 });

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

async function dashboard(request: APIRequestContext, body: Record<string, unknown> = {}) {
  const res = await request.post('/api/crm/dashboards', { data: { name: `E2E dash ${uid()}`, ...body } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; name: string; widgets: Array<{ id: string; config: string }> };
}

async function addTile(request: APIRequestContext, dashboardId: string, reportKey: string, size?: string) {
  const res = await request.post(`/api/crm/dashboards/${dashboardId}/widgets`, { data: { type: 'library', config: { reportKey }, ...(size ? { size } : {}) } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string };
}

async function pipelineWithDeal(request: APIRequestContext, dealName: string) {
  const p = await (await request.post('/api/crm/pipelines', { data: { name: `Dash ${uid()}` } })).json();
  const stage = (await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: 'Negotiation', probability: 60 } })).json()) as { id: string };
  const deal = await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: stage.id, name: dealName, amount: 4200 } });
  expect(deal.ok(), await deal.text()).toBe(true);
  return { pipelineId: p.id as string, stageId: stage.id };
}

const open = (page: Page, id: string) => page.goto(`/en/app/crm/dashboards?d=${id}`, { waitUntil: 'networkidle' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('selector: crear un dashboard, cambiar de uno a otro y Esc cierra la lista', async ({ page, request }) => {
  const errors = watchErrors(page);
  const first = await dashboard(request, { template: 'blank' });
  await open(page, first.id);
  await expect(page.getByTestId('cdb-switcher')).toContainText(first.name);

  // Crear desde el selector, con la plantilla de ventas.
  await page.getByTestId('cdb-switcher').click();
  const panel = page.getByTestId('cdb-switcher-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /Create dashboard/ }).click();
  const create = page.getByTestId('cdb-create');
  const name = `Created ${uid()}`;
  await create.getByLabel('Name').fill(name);
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('cdb-switcher')).toContainText(name);
  await expect(page.getByTestId('cdb-tile')).toHaveCount(12);
  await expect(page).toHaveURL(/\?d=/);

  // Volver al primero buscando por nombre; Esc cierra sin elegir.
  await page.getByTestId('cdb-switcher').click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('cdb-switcher')).toBeFocused();
  await page.getByTestId('cdb-switcher').click();
  await panel.getByRole('textbox').fill(first.name);
  await panel.getByRole('button', { name: new RegExp(first.name) }).click();
  await expect(page.getByTestId('cdb-switcher')).toContainText(first.name);
  // Un clic afuera también cierra.
  await page.getByTestId('cdb-switcher').click();
  await page.locator('h1').click();
  await expect(panel).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('agregar un reporte de la biblioteca y quitarlo desde el menú del tile', async ({ page, request }) => {
  const errors = watchErrors(page);
  const d = await dashboard(request, { template: 'blank' });
  await open(page, d.id);
  await page.getByTestId('cdb-add-report').first().click();
  const library = page.getByTestId('cdb-library');
  await expect(library).toBeVisible();
  await library.getByRole('textbox').fill('velocity');
  const item = library.locator('[data-report="sales_velocity"]');
  await expect(item).toBeVisible();
  await expect(library.getByTestId('cdb-lib-item')).toHaveCount(1);
  await item.getByRole('button', { name: /Add/ }).click();
  await expect(item.getByRole('button')).toContainText('Added');
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();

  const tile = page.getByTestId('cdb-tile').filter({ hasText: 'Sales velocity' });
  await expect(tile).toBeVisible();
  await expect(tile.getByTestId('cdb-kpi-value')).toBeVisible();

  // Menú del tile: Esc cierra; "Remove from dashboard" lo quita.
  await tile.getByTestId('cdb-tile-menu').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await tile.getByTestId('cdb-tile-menu').click();
  await page.getByRole('menuitem', { name: 'Remove from dashboard' }).click();
  await expect(page.getByTestId('cdb-tile')).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('cdb-tile')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('el filtro de fechas del dashboard cambia todos los tiles y se puede guardar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const d = await dashboard(request, { template: 'blank' });
  await addTile(request, d.id, 'deals_created_kpi', 'small');
  await addTile(request, d.id, 'deals_created');
  await open(page, d.id);
  const subs = page.getByTestId('cdb-tile').locator('.cdb-tile-sub');
  await expect(subs).toHaveText(['Last 30 days', 'Last 30 days']);

  const data = page.waitForResponse((r) => r.url().includes('/api/crm/dashboards/data') && r.request().method() === 'POST');
  await page.getByTestId('cdb-filter-range').click();
  await page.getByRole('option', { name: 'This quarter' }).click();
  const body = (await data).request().postDataJSON() as { filters: { range: string } };
  expect(body.filters.range).toBe('this_quarter');
  await expect(subs).toHaveText(['This quarter', 'This quarter']);

  await page.getByRole('button', { name: 'Save filters' }).click();
  await expect(page.getByText('Filters saved')).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(subs).toHaveText(['This quarter', 'This quarter']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('drill-down: de una barra a sus registros y de ahí a la vista previa', async ({ page, request }) => {
  const errors = watchErrors(page);
  const dealName = `Drill deal ${uid()}`;
  const p = await pipelineWithDeal(request, dealName);
  const d = await dashboard(request, { template: 'blank' });
  await addTile(request, d.id, 'pipeline_by_stage');
  await request.patch(`/api/crm/dashboards/${d.id}`, { data: { filters: { range: 'last_30', pipelineId: p.pipelineId } } });
  await open(page, d.id);

  const tile = page.getByTestId('cdb-tile').filter({ hasText: 'Pipeline by stage' });
  await tile.getByRole('button', { name: /Negotiation/ }).click();
  const drill = page.getByTestId('cdb-drill');
  await expect(drill).toBeVisible();
  await expect(drill.getByTestId('cdb-drill-count')).toContainText('1 record');
  await drill.getByRole('button', { name: dealName }).click();
  await expect(page.locator('.preview-panel')).toBeVisible();
  await expect(page.locator('.preview-panel')).toContainText(dealName);

  // Esc cierra primero la vista previa y después el panel de registros.
  await page.keyboard.press('Escape');
  await expect(page.locator('.preview-panel')).toBeHidden();
  await expect(drill).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drill).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reordenar tiles arrastrando y con el teclado; el orden queda guardado', async ({ page, request }) => {
  const errors = watchErrors(page);
  const d = await dashboard(request, { template: 'blank' });
  await addTile(request, d.id, 'deals_created_kpi', 'small');
  await addTile(request, d.id, 'win_rate_kpi', 'small');
  await addTile(request, d.id, 'new_contacts_kpi', 'small');
  await open(page, d.id);
  const titles = page.getByTestId('cdb-tile').locator('h2');
  await expect(titles).toHaveText(['Deals created', 'Win rate', 'New contacts']);

  // Arrastrar el primero hasta después del tercero.
  const tiles = page.getByTestId('cdb-tile');
  await tiles.nth(0).hover();
  const grip = tiles.nth(0).getByTestId('cdb-grip');
  const from = (await grip.boundingBox())!;
  const to = (await tiles.nth(2).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x + to.width - 10, to.y + to.height / 2, { steps: 8 });
  const saved = page.waitForResponse((r) => r.url().includes(`/api/crm/dashboards/${d.id}`) && r.request().method() === 'PATCH');
  await page.mouse.up();
  await saved;
  await expect(titles).toHaveText(['Win rate', 'New contacts', 'Deals created']);

  // Teclado: flecha a la izquierda sobre el asa mueve uno antes.
  await tiles.nth(2).getByTestId('cdb-grip').focus();
  // La espera del guardado se arma antes de la tecla: si no, la respuesta puede llegar antes y la espera se queda colgada.
  const keySaved = page.waitForResponse((r) => r.url().includes(`/api/crm/dashboards/${d.id}`) && r.request().method() === 'PATCH');
  await page.keyboard.press('ArrowLeft');
  await expect(titles).toHaveText(['Win rate', 'Deals created', 'New contacts']);
  await keySaved;
  await page.reload({ waitUntil: 'networkidle' });
  await expect(titles).toHaveText(['Win rate', 'Deals created', 'New contacts']);

  // Tamaño desde el menú del tile.
  await tiles.nth(0).getByTestId('cdb-tile-menu').click();
  // Submenú con el teclado: Enter lo abre y enfoca el primero (Small).
  await page.getByRole('menuitem', { name: 'Size' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /Small/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(tiles.nth(0)).toHaveAttribute('data-size', 'wide');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('390px: una columna, sin scroll lateral y con objetivos de 40px', async ({ page, request }) => {
  const d = await dashboard(request, { template: 'sales' });
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  await open(page, d.id);
  const tiles = page.getByTestId('cdb-tile');
  await expect(tiles).toHaveCount(12);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Los KPI chicos van de a dos; el resto, a lo ancho y alineados.
  const boxes = await tiles.evaluateAll((els) =>
    els.map((el) => ({ ...(el.getBoundingClientRect().toJSON() as DOMRect), kpi: el.classList.contains('cdb-tile-kpi') })),
  );
  const full = boxes.filter((b) => !b.kpi);
  const kpis = boxes.filter((b) => b.kpi);
  expect(kpis).toHaveLength(4);
  for (const b of full) {
    expect(Math.abs(b.left - full[0].left)).toBeLessThan(2);
    expect(Math.abs(b.width - full[0].width)).toBeLessThan(2);
  }
  expect(Math.abs(kpis[0].top - kpis[1].top)).toBeLessThan(2);
  expect(kpis[0].width).toBeLessThan(full[0].width / 2 + 2);
  for (const b of boxes) expect(b.right).toBeLessThanOrEqual(390);
  const menuBtn = tiles.first().getByTestId('cdb-tile-menu');
  const mb = (await menuBtn.boundingBox())!;
  expect(mb.width).toBeGreaterThanOrEqual(40);
  expect(mb.height).toBeGreaterThanOrEqual(40);
  const sw = (await page.getByTestId('cdb-switcher').boundingBox())!;
  expect(sw.height).toBeGreaterThanOrEqual(40);
  // La biblioteca entra en la pantalla.
  await page.getByTestId('cdb-add-report').click();
  await expect(page.getByTestId('cdb-library')).toBeVisible();
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('encabezado en una fila, filtros de owner y equipo visibles, KPI con la comparación y embudo con conversión', async ({ page, request }) => {
  const errors = watchErrors(page);
  const d = await dashboard(request, { template: 'blank' });
  await addTile(request, d.id, 'revenue_won_kpi', 'small');
  await addTile(request, d.id, 'conversion_funnel');
  await addTile(request, d.id, 'deals_won_lost_by_owner');
  await open(page, d.id);

  // Nombre del dashboard, visibilidad y acciones en la misma fila.
  const sw = (await page.getByTestId('cdb-switcher').boundingBox())!;
  const meta = (await page.getByTestId('cdb-meta').boundingBox())!;
  const add = (await page.getByTestId('cdb-add-report').boundingBox())!;
  expect(Math.abs(sw.y + sw.height / 2 - (meta.y + meta.height / 2))).toBeLessThan(6);
  expect(Math.abs(sw.y + sw.height / 2 - (add.y + add.height / 2))).toBeLessThan(6);
  await expect(page.getByTestId('cdb-filter-owner')).toBeVisible();
  await expect(page.getByTestId('cdb-filter-team')).toBeVisible();

  // La visibilidad abre el diálogo de compartir; Esc lo cierra.
  await page.getByTestId('cdb-visibility').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // KPI: la línea de comparación siempre está (cambio o "sin datos antes").
  const kpi = page.getByTestId('cdb-tile').filter({ hasText: 'Revenue won' });
  await expect(kpi.getByTestId('cdb-delta')).toBeVisible();

  // Embudo: alineado a la izquierda (todas las barras arrancan en el mismo x).
  const funnel = page.getByTestId('cdb-tile').filter({ hasText: 'Deal conversion funnel' });
  const tracks = await funnel.locator('.cdb-funnel-track').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
  expect(new Set(tracks).size).toBe(1);

  // Tiles de una misma fila con el mismo alto.
  const heights = await page.getByTestId('cdb-tile').filter({ hasNot: page.locator('.cdb-kpi') }).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reporte propio: ver como tabla y drill sobre el objeto asociado', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const p = await (await request.post('/api/crm/pipelines', { data: { name: `Assoc ${tag}` } })).json();
  const stage = (await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: 'Demo', probability: 40 } })).json()) as { id: string };
  const industry = `Ind${tag}`;
  const company = (await (await request.post('/api/crm/companies', { data: { name: `Assoc Co ${tag}`, industry } })).json()) as { id: string };
  const deal = await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: stage.id, name: `Assoc deal ${tag}`, amount: 900, companyId: company.id } });
  expect(deal.ok(), await deal.text()).toBe(true);
  const rep = await request.post('/api/crm/custom-reports', {
    data: { name: `By industry ${tag}`, config: { source: 'deals', dimensions: [{ field: 'company.industry' }], metric: { agg: 'count' }, viz: 'bar', filters: [{ f: 'deal.pipeline', o: 'is', v: p.id }] } },
  });
  expect(rep.ok(), await rep.text()).toBe(true);
  const report = (await rep.json()) as { id: string };
  const d = await dashboard(request, { template: 'blank' });
  expect((await request.post(`/api/crm/dashboards/${d.id}/widgets`, { data: { type: 'custom_report', config: { reportId: report.id } } })).ok()).toBe(true);
  await open(page, d.id);
  const tile = page.getByTestId('cdb-tile').first();
  await expect(tile.getByTestId('cdb-mark').first()).toBeVisible();

  // Ver como tabla y volver al gráfico.
  await tile.getByTestId('cdb-tile-menu').click();
  await page.getByTestId('context-menu').locator('[data-key="table"]').click();
  await expect(tile.getByTestId('rb-table')).toBeVisible();

  // Drill desde la tabla: los deals, y el selector pasa a sus empresas.
  await tile.getByTestId('rb-drill').first().click();
  const drill = page.getByTestId('cdb-drill');
  await expect(drill.getByRole('button', { name: `Assoc deal ${tag}` })).toBeVisible();
  const objects = drill.getByTestId('cdb-drill-objects');
  await expect(objects.getByTestId('cdb-drill-object-deal')).toHaveAttribute('aria-pressed', 'true');
  await objects.getByTestId('cdb-drill-object-company').click();
  await expect(drill.getByRole('button', { name: `Assoc Co ${tag}` })).toBeVisible();
  await expect(objects.getByTestId('cdb-drill-object-company')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(drill).toBeHidden();

  await tile.getByTestId('cdb-tile-menu').click();
  await page.getByTestId('context-menu').locator('[data-key="table"]').click();
  await expect(tile.getByTestId('rb-table')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('drill-down de un reporte propio desde su tile', async ({ page, request }) => {
  const errors = watchErrors(page);
  const dealName = `Custom drill ${uid()}`;
  const p = await pipelineWithDeal(request, dealName);
  const rep = await request.post('/api/crm/custom-reports', {
    data: { name: `By stage ${uid()}`, config: { source: 'deals', dimensions: [{ field: 'deal.stage' }], metric: { agg: 'count' }, viz: 'bar', filters: [{ f: 'deal.pipeline', o: 'is', v: p.pipelineId }] } },
  });
  expect(rep.ok(), await rep.text()).toBe(true);
  const report = (await rep.json()) as { id: string };
  const d = await dashboard(request, { template: 'blank' });
  const w = await request.post(`/api/crm/dashboards/${d.id}/widgets`, { data: { type: 'custom_report', config: { reportId: report.id } } });
  expect(w.ok(), await w.text()).toBe(true);
  await open(page, d.id);
  const tile = page.getByTestId('cdb-tile').first();
  // El reporte agrupa por etapa (sin fecha): "Todas las fechas".
  await expect(tile.locator('.cdb-tile-sub')).toHaveText('All dates');
  await tile.getByTestId('cdb-mark').first().click();
  const drill = page.getByTestId('cdb-drill');
  await expect(drill).toBeVisible();
  await expect(drill.getByTestId('cdb-drill-count')).toContainText('1 record');
  await expect(drill.getByRole('button', { name: dealName })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drill).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
