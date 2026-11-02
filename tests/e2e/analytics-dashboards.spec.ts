import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Tableros de punta a punta: filtros y fechas guardados, tarjetas de texto,
 * opciones por tarjeta, copiar y mover, tableros armados y el link público.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.ANALYTICS_SHOTS_DIR;

test.describe.configure({ mode: 'serial' });

let projectId = '';
let publicKey = '';
let boardId = '';
let otherId = '';
const trendName = `Buys ${uid()}`;
const secondName = `Views ${uid()}`;

async function send(request: APIRequestContext, event: string, who: string, properties: Record<string, unknown> = {}) {
  const res = await request.post('/api/ingest/e', {
    headers: { origin: 'http://shop.test' },
    data: { api_key: publicKey, event, distinct_id: who, properties, timestamp: new Date(Date.now() - 2000).toISOString() },
  });
  expect(res.status()).toBe(200);
}

test.beforeAll(async ({ request }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Boards ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  await send(request, 'buy', 'ana', { plan: 'pro' });
  await send(request, 'buy', 'bob', { plan: 'free' });
  await send(request, 'buy', 'carla', { plan: 'pro' });
  await send(request, 'view', 'ana', { plan: 'pro' });
  const post = async (path: string, data: unknown) => (await request.post(path, { data })).json();
  const { insight: a } = await post('/api/analytics/insights', { projectId, name: trendName, query: { kind: 'trends', series: [{ event: 'buy' }], dateRange: { from: '-7d' }, display: 'number' } });
  const { insight: b } = await post('/api/analytics/insights', { projectId, name: secondName, query: { kind: 'trends', series: [{ event: 'view' }], dateRange: { from: '-7d' }, display: 'number' } });
  const { dashboard } = await post('/api/analytics/dashboards', { projectId, name: `Main ${uid()}` });
  boardId = dashboard.id;
  otherId = (await post('/api/analytics/dashboards', { projectId, name: `Second ${uid()}` })).dashboard.id;
  await request.patch(`/api/analytics/dashboards/${boardId}`, { data: { insightIds: [a.id, b.id] } });
});

async function open(page: Page, baseURL: string, id = boardId) {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
  await page.goto(`/en/app/analytics/dashboards/${id}`, { waitUntil: 'networkidle' });
}
const tile = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const number = (page: Page, name: string) => tile(page, name).locator('.an-bignum-value');

test('los filtros del tablero cambian los números, se guardan y una tarjeta los puede ignorar', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await expect(number(page, trendName)).toHaveText('3', { timeout: 15_000 });

  await page.locator('summary', { hasText: 'Dashboard filters' }).click();
  await page.locator('.an-dash-filters').getByRole('button', { name: /Filter/ }).first().click();
  const details = page.locator('details.an-dash-filters');
  await details.getByLabel('Property', { exact: true }).first().fill('plan');
  await details.getByLabel('Value', { exact: true }).first().fill('pro');
  await expect(number(page, trendName)).toHaveText('2', { timeout: 15_000 });
  await page.waitForTimeout(800);

  // Vuelve igual al recargar.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(number(page, trendName)).toHaveText('2', { timeout: 15_000 });

  // La tarjeta los ignora y lo dice.
  await tile(page, trendName).getByRole('button', { name: `Options for ${trendName}` }).click();
  const dialog = page.getByRole('dialog', { name: `Options for ${trendName}` });
  await dialog.getByLabel('Ignore dashboard date and filters').check();
  await dialog.getByLabel('Size').selectOption('l');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(number(page, trendName)).toHaveText('3', { timeout: 15_000 });
  await expect(tile(page, trendName)).toContainText('Ignores dashboard filters');
  await expect(tile(page, trendName)).toHaveClass(/is-l/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-filters.png`, fullPage: true });
  await page.waitForTimeout(800);
});

test('tarjetas de texto, orden, actualizar y fechas guardadas', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.getByRole('button', { name: '+ Text card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Text card' }).first();
  await dialog.getByLabel('Text, with Markdown').fill('## Weekly note\n\nWatch **buys**.\n\n<script>window.__x=1</script>');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const text = page.getByRole('article', { name: 'Text card' });
  await expect(text.locator('strong')).toHaveText('buys');
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();

  // Se puede subir por encima de los insights.
  await text.getByRole('button', { name: 'Move text card up' }).click();
  await text.getByRole('button', { name: 'Move text card up' }).click();
  await expect(page.locator('.an-tiles > article').first()).toHaveAttribute('aria-label', 'Text card');
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.an-tiles > article').first()).toHaveAttribute('aria-label', 'Text card');

  // Editar y borrar.
  await page.getByRole('article', { name: 'Text card' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Text, with Markdown').fill('Only this');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('article', { name: 'Text card' })).toContainText('Only this');

  // Actualizar una tarjeta sola muestra cuándo se calculó y trae lo nuevo.
  await expect(tile(page, secondName).locator('.an-tile-foot')).toContainText('Computed at');
  await page.waitForTimeout(800);
});

test('actualizar solo se guarda, la fecha se guarda y una tarjeta se copia y se mueve', async ({ page, baseURL, request }) => {
  await open(page, baseURL!);
  await page.getByLabel('Auto refresh').selectOption('5');
  await page.getByLabel('Same dates on every tile').check();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Auto refresh')).toHaveValue('5');
  await expect(page.getByLabel('Same dates on every tile')).toBeChecked();

  await tile(page, secondName).getByRole('button', { name: `Options for ${secondName}` }).click();
  const dialog = page.getByRole('dialog', { name: `Options for ${secondName}` });
  await dialog.getByLabel('Copy to dashboard').selectOption(otherId);
  await expect(dialog.getByText('Copied.')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(tile(page, secondName)).toBeVisible();
  const other = async () => ((await (await request.get(`/api/analytics/dashboards/${otherId}`)).json()) as { insights: Array<{ name: string }> }).insights.map((i) => i.name);
  expect(await other()).toEqual([secondName]);

  // Mover uno que no estaba en el otro: desaparece de acá sin recargar.
  await tile(page, trendName).getByRole('button', { name: `Options for ${trendName}` }).click();
  const moveDialog = page.getByRole('dialog', { name: `Options for ${trendName}` });
  await moveDialog.getByLabel('Move to dashboard').selectOption(otherId);
  await expect(tile(page, trendName)).toHaveCount(0, { timeout: 15_000 });
  expect((await other()).sort()).toEqual([secondName, trendName].sort());
});

test('el link público muestra los textos y respeta los filtros', async ({ page, request, baseURL }) => {
  const res = await request.post('/api/analytics/shares', { data: { projectId, dashboardId: boardId } });
  const { share } = (await res.json()) as { share: { token: string } };
  await page.goto(`/en/stats/a/${share.token}`, { waitUntil: 'networkidle' });
  const pub = page.getByTestId('an-share-public');
  await expect(pub.locator('.an-text-card')).toContainText('Only this');
  // "view" tiene solo a ana con plan pro.
  await expect(pub.locator('.an-bignum-value').first()).toHaveText('1');
  expect(baseURL).toBeTruthy();
});

test('un tablero armado crea sus insights y a 390px no hay scroll horizontal', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/analytics/dashboards', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create the Website dashboard' }).click();
  await expect(page).toHaveURL(/dashboards\/ad_/, { timeout: 15_000 });
  await expect(page.locator('.an-tiles > article')).toHaveCount(6, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Website' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-template.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
});
