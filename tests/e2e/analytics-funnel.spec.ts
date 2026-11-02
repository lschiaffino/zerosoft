import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Embudos de punta a punta en el editor: orden, ventana, exclusión, evento
 * alternativo, primera vez, apertura con atribución, sesiones, tiempo hasta
 * convertir y tendencia histórica. Los números se pueden sacar a mano de los
 * eventos de abajo.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.ANALYTICS_SHOTS_DIR;
const MIN = 60_000;
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
  const res = await request.post('/api/analytics/projects', { data: { name: `Funnel ${uid()}` } });
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  // ana: directo, en Chrome y paga en Firefox, 10 minutos.
  await send(request, 'view', 'ana', 2 * DAY, { $browser: 'Chrome', $session_id: 's-ana' });
  await send(request, 'buy', 'ana', 2 * DAY - 10 * MIN, { $browser: 'Firefox', $session_id: 's-ana' });
  // bob: mira algo más en el medio, 30 minutos.
  await send(request, 'view', 'bob', DAY, { $browser: 'Chrome', $session_id: 's-bob' });
  await send(request, 'browse', 'bob', DAY - 5 * MIN, { $browser: 'Chrome', $session_id: 's-bob' });
  await send(request, 'buy', 'bob', DAY - 30 * MIN, { $browser: 'Chrome', $session_id: 's-bob' });
  // carla: pide devolución en el medio, una exclusión.
  await send(request, 'view', 'carla', DAY, { $browser: 'Safari', $session_id: 's-carla' });
  await send(request, 'refund', 'carla', DAY - 2 * MIN, { $browser: 'Safari', $session_id: 's-carla' });
  await send(request, 'buy', 'carla', DAY - 4 * MIN, { $browser: 'Safari', $session_id: 's-carla' });
  // dan: compra por otro evento, y al día siguiente vuelve en otra sesión sin comprar.
  await send(request, 'view', 'dan', 3 * DAY, { $browser: 'Chrome', $session_id: 's-dan' });
  await send(request, 'purchase', 'dan', 3 * DAY - MIN, { $browser: 'Chrome', $session_id: 's-dan' });
  await send(request, 'view', 'dan', 1000, { $browser: 'Chrome', $session_id: 's-dan-2' });
  // eva: se queda en el primer paso.
  await send(request, 'view', 'eva', 1000, { $browser: 'Safari', $session_id: 's-eva' });
});

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
  await page.goto('/en/app/analytics/insights/new?kind=funnel', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Funnel' }).click();
  await page.getByLabel('Step 1', { exact: true }).fill('view');
  await page.getByLabel('Step 2', { exact: true }).fill('buy');
}

const result = (page: Page) => page.getByTestId('an-result');
const steps = (page: Page) => page.locator('.an-funnel-step');

test('orden, ventana, exclusión y evento alternativo cambian los números', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  // Cinco entran; ana, bob y carla compran.
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });

  // Estricto: bob y carla tienen otro evento en el medio.
  await page.getByLabel('Step order').selectOption('strict');
  await expect(page.locator('.an-funnel-total')).toContainText('1 of 5', { timeout: 15_000 });

  // Cualquier orden habla de pasos completados.
  await page.getByLabel('Step order').selectOption('unordered');
  await expect(steps(page).nth(1)).toContainText('Completed 2 steps', { timeout: 15_000 });
  await page.getByLabel('Step order').selectOption('ordered');
  await expect(steps(page).nth(1)).toContainText('buy', { timeout: 15_000 });

  // Ventana de 15 minutos: bob tardó 30.
  await page.getByLabel('Conversion window').fill('15');
  await page.getByLabel('Window unit').selectOption('minute');
  await expect(page.locator('.an-funnel-total')).toContainText('2 of 5', { timeout: 15_000 });
  await page.getByLabel('Window unit').selectOption('day');
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });

  // Exclusión: carla sale de todo el embudo.
  await page.locator('summary', { hasText: 'Exclusion steps' }).click();
  await page.getByRole('button', { name: 'Add exclusion' }).click();
  await page.getByLabel('Event to exclude').fill('refund');
  await expect(page.locator('.an-funnel-total')).toContainText('2 of 4', { timeout: 15_000 });
  // Si el evento ya es un paso, se avisa y no se usa.
  await page.getByLabel('Event to exclude').fill('buy');
  await expect(page.getByRole('alert').filter({ hasText: 'already a step' })).toBeVisible();
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  // O: "purchase" también vale como compra, así que dan convierte.
  await page.getByRole('button', { name: 'Or another event' }).nth(1).click();
  await page.getByLabel('Alternative event for step 2').fill('purchase');
  await expect(page.locator('.an-funnel-total')).toContainText('4 of 5', { timeout: 15_000 });
  await expect(steps(page).nth(1)).toContainText('buy / purchase');

  // Los que convirtieron también se listan y de ahí se guardan como cohorte.
  await steps(page).nth(1).locator('.an-funnel-count a').click();
  await expect(page).toHaveURL(/persons\?ids=/);
  for (const who of ['ana', 'bob', 'carla', 'dan']) await expect(page.getByRole('link', { name: who, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'eva', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save as cohort' })).toBeVisible();
});

test('primera vez, sesiones, apertura, tiempo hasta convertir e histórico', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, baseURL!);
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });

  // Sesiones: dan tiene dos.
  await page.getByLabel('Count by').selectOption('session');
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 6 sessions', { timeout: 15_000 });
  // Los que abandonaron son personas, no sesiones.
  await page.getByLabel('Count by').selectOption('person');
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });

  // Apertura por navegador: ana entra por Chrome y paga en Firefox.
  await page.getByLabel('Breakdown property').fill('$browser');
  const table = page.locator('.an-funnel-breakdown');
  await expect(table.getByRole('row', { name: /Chrome 3 2/ })).toBeVisible({ timeout: 15_000 });
  await expect(table.getByRole('row', { name: /Safari 2 1/ })).toBeVisible();
  await page.getByLabel('Attribution', { exact: true }).selectOption('last');
  await expect(table.getByRole('row', { name: /Firefox 1 1/ })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Attribution', { exact: true }).selectOption('all');
  // Con ana en los dos: Chrome solo el primer paso de ella, Firefox nunca abrió el embudo.
  await expect(table.getByRole('row', { name: /Chrome 3 1/ })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Attribution', { exact: true }).selectOption('step');
  await page.getByLabel('Attribution step').selectOption('1');
  // Paso 2: solo quien llegó y con el valor de ese momento.
  await expect(table.getByRole('row', { name: /Firefox 1 1/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 3', { timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/funnel-breakdown.png`, fullPage: true });
  await page.getByLabel('Breakdown property').fill('');

  // Tiempo hasta convertir: 10, 30 y 4 minutos; promedio 14 y 40 segundos.
  await page.getByLabel('Graph').selectOption('time');
  const times = page.locator('.an-funnel-times');
  await expect(times).toContainText('3 converted', { timeout: 15_000 });
  await expect(times).toContainText('Median 10m', { ignoreCase: true });
  await expect(page.locator('.an-hist-row').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/funnel-time.png`, fullPage: true });

  // Histórico: cuatro entradas con compra en tres días, y sin los días incompletos.
  await page.getByLabel('Graph').selectOption('trends');
  await expect(times.locator('table')).toBeVisible({ timeout: 15_000 });
  const incomplete = times.locator('tr', { hasText: 'incomplete' });
  await expect(incomplete.first()).toBeVisible();
  const before = await incomplete.count();
  expect(before).toBeGreaterThan(0);
  await page.getByLabel('Hide incomplete periods').check();
  await expect(incomplete).toHaveCount(0);
  await page.getByLabel('Hide incomplete periods').uncheck();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/funnel-trends.png`, fullPage: true });
  await page.getByLabel('Graph').selectOption('steps');

  // Primera vez: el primer "view" de dan fue hace tres días; sigue contando, pero solo esa vez.
  await page.getByLabel('Which occurrence counts in step 1').selectOption('ever');
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });

  // Cada cosa se guarda y vuelve igual.
  await page.getByLabel('Step order').selectOption('strict');
  await expect(page.locator('.an-funnel-total')).toContainText('1 of 5', { timeout: 15_000 });
  expect(errors).toEqual([]);
  await expect(result(page)).toBeVisible();
});

test('de un paso del embudo a sus caminos, y de un camino a su embudo', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await expect(page.locator('.an-funnel-total')).toContainText('3 of 5', { timeout: 15_000 });
  const step = steps(page).nth(1);
  await step.locator('summary', { hasText: 'Explore paths' }).click();
  await step.getByRole('link', { name: 'Paths between step 1 and 2' }).click();
  await expect(page).toHaveURL(/insights\/new\?query=/);
  await expect(page.getByTestId('an-paths-funnel')).toContainText('between step 1');
  // bob pasó por "browse" y carla por "refund" entre medio.
  const table = result(page).locator('table').last();
  await expect(table).toContainText('view → browse → buy', { timeout: 15_000 });
  await expect(table).toContainText('view → refund → buy');
  await expect(result(page)).not.toContainText('purchase');

  // Vuelta: abrir el embudo de ese camino.
  await table.getByRole('row', { name: /view → browse → buy/ }).getByRole('link', { name: 'View funnel' }).click();
  await expect(page).toHaveURL(/insights\/new\?query=/);
  await expect(page.getByRole('tab', { name: 'Funnel' })).toHaveAttribute('aria-selected', 'true');
  // Solo bob hizo los tres, en ese orden.
  await expect(page.locator('.an-funnel-total')).toContainText('1 of 5', { timeout: 15_000 });
  await expect(steps(page)).toHaveCount(3);
});

test('a 390px no hay scroll horizontal con todas las opciones abiertas', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, baseURL!);
  await page.getByLabel('Breakdown property').fill('$browser');
  await page.locator('summary', { hasText: 'Exclusion steps' }).click();
  await page.getByRole('button', { name: 'Add exclusion' }).click();
  for (const g of ['steps', 'time', 'trends']) {
    await page.getByLabel('Graph').selectOption(g);
    await page.waitForLoadState('networkidle');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, g).toBeLessThanOrEqual(1);
  }
});
