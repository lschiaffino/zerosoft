import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/** Retención en el editor: tipos, vuelta, referencia, promedio, apertura, gráfico y celdas. */
const uid = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;

test.describe.configure({ mode: 'serial' });

let projectId = '';
let publicKey = '';

async function send(request: APIRequestContext, event: string, who: string, ago: number, properties: Record<string, unknown> = {}) {
  const res = await request.post('/api/ingest/e', {
    headers: { origin: 'http://shop.test' },
    data: { api_key: publicKey, event, distinct_id: who, properties, timestamp: new Date(Date.now() - ago).toISOString() },
  });
  expect(res.status()).toBe(200);
}

test.beforeAll(async ({ request }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Retention ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  // Hace 3 días entran ana, bob, carla y dan. Mañana (hace 2) vuelve ana; pasado (hace 1), ana y bob.
  for (const who of ['ana', 'bob', 'carla', 'dan']) await send(request, 'open', who, 3 * DAY, { $browser: who === 'dan' ? 'Safari' : 'Chrome' });
  await send(request, 'open', 'ana', 2 * DAY, { $browser: 'Chrome' });
  await send(request, 'open', 'ana', DAY, { $browser: 'Chrome' });
  await send(request, 'open', 'bob', DAY, { $browser: 'Firefox' });
  // old venía de antes.
  await send(request, 'open', 'old', 20 * DAY, { $browser: 'Chrome' });
  await send(request, 'open', 'old', 3 * DAY, { $browser: 'Chrome' });
});

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
  await page.goto('/en/app/pulse/insights/new?kind=retention', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByLabel('First event').first().fill('open');
  await page.getByLabel('Return event').first().fill('open');
  await page.getByLabel('Period', { exact: true }).selectOption('day');
}
const table = (page: Page) => page.getByTestId('an-result').locator('table.an-retention');
const cohort3 = (page: Page) => table(page).locator('tbody tr').filter({ has: page.locator('td', { hasText: /^[45]$/ }) }).nth(1);
const cells = (page: Page) => cohort3(page).locator('td.an-ret-cell');

test('tipos, vuelta acumulada, referencia, etiquetas y promedio', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  // Cinco en la cohorte (con old, cuya primera vez en el rango es esa): día 0 100%, día 1 20% (ana), día 2 40% (ana y bob).
  await expect(cohort3(page).locator('td.num').first()).toHaveText('5', { timeout: 15_000 });
  await expect(cells(page).nth(1)).toHaveText('20%');
  await expect(cells(page).nth(2)).toHaveText('40%');

  // Primera de todas: old queda afuera.
  await page.getByLabel('Who enters a cohort').selectOption('first_ever');
  await expect(cohort3(page).locator('td.num').first()).toHaveText('4', { timeout: 15_000 });
  await expect(cells(page).nth(1)).toHaveText('25%');
  await page.getByLabel('Who enters a cohort').selectOption('first_time');
  await expect(cohort3(page).locator('td.num').first()).toHaveText('5', { timeout: 15_000 });

  // En o después: ana y bob también cuentan el día 1.
  await page.getByLabel('Returning').selectOption('after');
  await expect(cells(page).nth(1)).toHaveText('40%', { timeout: 15_000 });
  await page.getByLabel('Returning').selectOption('on');
  await expect(cells(page).nth(1)).toHaveText('20%', { timeout: 15_000 });

  await page.locator('summary', { hasText: 'Chart options' }).click();
  // Respecto del período anterior: día 2 = 2 de 1 = 200%.
  await page.getByLabel('Percentages relative to').selectOption('previous');
  await expect(cells(page).nth(2)).toHaveText('200%', { timeout: 15_000 });
  await page.getByLabel('Percentages relative to').selectOption('period0');

  await page.getByLabel('Cohort labels start at').selectOption('1');
  await expect(table(page).locator('thead')).toContainText('Day 1', { timeout: 15_000 });
  await expect(table(page).locator('thead')).not.toContainText('Day 0');

  await expect(table(page).locator('.an-ret-mean')).toContainText('Mean');

  // Solo tabla o solo gráfico.
  await page.locator('label', { hasText: /^Show/ }).locator('select').selectOption('graph');
  await expect(table(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('an-result').locator('.an-chart')).toBeVisible();
  await page.locator('label', { hasText: /^Show/ }).locator('select').selectOption('table');
  await expect(page.getByTestId('an-result').locator('.an-chart')).toHaveCount(0, { timeout: 15_000 });
});

test('la celda lleva a las personas que cuenta', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await expect(cells(page).nth(2)).toHaveText('40%', { timeout: 15_000 });
  await cells(page).nth(2).getByRole('button').click();
  await expect(page).toHaveURL(/persons\?ids=/, { timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'ana', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'bob', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'dan', exact: true })).toHaveCount(0);
});

test('apertura: el valor tiene que coincidir y filtra la tabla', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.getByLabel('Breakdown property').fill('$browser');
  const values = page.getByTestId('an-result').locator('table.an-ret-values');
  await expect(values.getByRole('button', { name: 'Chrome' })).toBeVisible({ timeout: 15_000 });
  await values.getByRole('button', { name: 'Chrome' }).click();
  await expect(page.getByText('Cohorts for Chrome.')).toBeVisible();
  // En Chrome: ana, bob, carla y old. Hace un día bob volvió en Firefox: no cuenta; solo ana, 25%.
  const row = table(page).locator('tbody tr').filter({ has: page.locator('td', { hasText: /^4$/ }) }).nth(1);
  await expect(row.locator('td.an-ret-cell').nth(2)).toHaveText('25%', { timeout: 15_000 });
  await values.getByRole('button', { name: 'Chrome' }).click();
  await expect(page.getByText('Cohorts for Chrome.')).toHaveCount(0);
});

test('a 390px no hay scroll horizontal, y por hora y por mes también responde', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, baseURL!);
  await expect(table(page)).toBeVisible({ timeout: 15_000 });
  for (const p of ['hour', 'month', 'week']) {
    await page.getByLabel('Period', { exact: true }).selectOption(p);
    await expect(table(page)).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, p).toBeLessThanOrEqual(1);
  }
});
