import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Tendencias de punta a punta en el editor: matemáticas nuevas, evento
 * alternativo, primera vez, opciones del gráfico, vistas y prender o apagar
 * series. Los números salen a mano de los eventos de abajo.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.ANALYTICS_SHOTS_DIR;
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
  const res = await request.post('/api/analytics/projects', { data: { name: `Trends ${uid()}` } });
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  // Dentro de los últimos 7 días: ana 3 veces, bob 1. Fuera: carla hace 20 días.
  await send(request, 'buy', 'ana', DAY, { amount: 10 });
  await send(request, 'buy', 'ana', 2 * DAY, { amount: 20 });
  await send(request, 'buy', 'ana', 3 * DAY, { amount: 30 });
  await send(request, 'buy', 'bob', DAY, { amount: 40 });
  await send(request, 'buy', 'carla', 20 * DAY, { amount: 50 });
  await send(request, 'purchase', 'dan', DAY, { amount: 60 });
});

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
  await page.goto('/en/app/analytics/insights/new', { waitUntil: 'networkidle' });
  await page.getByLabel('Event', { exact: true }).first().fill('buy');
  await expect(totalCell(page, 0)).toHaveText('4', { timeout: 15_000 });
}

const result = (page: Page) => page.getByTestId('an-result');
const totalCell = (page: Page, row: number) => result(page).locator('tbody tr').nth(row).locator('td.num').first();

test('matemáticas, evento alternativo y primera vez cambian los números', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  const math = page.getByLabel('Aggregation').first();

  // Por persona: ana 3, bob 1.
  await math.selectOption('per_user_max');
  await expect(totalCell(page, 0)).toHaveText('3', { timeout: 15_000 });
  await math.selectOption('per_user_min');
  await expect(totalCell(page, 0)).toHaveText('1', { timeout: 15_000 });
  await math.selectOption('per_user_median');
  await expect(totalCell(page, 0)).toHaveText('2', { timeout: 15_000 });

  // Activos por mes: ana, bob y carla, que queda dentro de los 30 días que mira para atrás. Por semana, sin carla.
  await math.selectOption('mau');
  await expect(totalCell(page, 0)).toHaveText('3', { timeout: 15_000 });
  await math.selectOption('wau');
  await expect(totalCell(page, 0)).toHaveText('2', { timeout: 15_000 });
  await math.selectOption('total');
  await expect(totalCell(page, 0)).toHaveText('4', { timeout: 15_000 });

  // "purchase" también cuenta.
  await page.getByRole('button', { name: 'Or another event' }).click();
  await page.getByLabel('Alternative event for series A').fill('purchase');
  await expect(totalCell(page, 0)).toHaveText('5', { timeout: 15_000 });
  await expect(result(page).locator('tbody tr').first()).toContainText('buy / purchase');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(totalCell(page, 0)).toHaveText('4', { timeout: 15_000 });

  // Primera vez: ana y bob adentro; la de carla cae fuera del rango.
  await page.getByLabel('Which occurrence counts in series A').selectOption('ever');
  await expect(totalCell(page, 0)).toHaveText('2', { timeout: 15_000 });
});

test('opciones del gráfico: unidades, meta, ejes, valores, leyenda y suavizado', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.locator('summary', { hasText: 'Chart options' }).click();

  await page.getByLabel('Value unit').selectOption('currency');
  await expect(totalCell(page, 0)).toHaveText('$4.00', { timeout: 15_000 });
  await page.getByLabel('Value unit').selectOption('none');
  await page.getByLabel('Prefix').fill('~');
  await page.getByLabel('Suffix').fill(' sales');
  await expect(totalCell(page, 0)).toHaveText('~4 sales', { timeout: 15_000 });
  await page.getByLabel('Prefix').fill('');
  await page.getByLabel('Suffix').fill('');

  // Línea punteada al final mientras el día corre.
  await expect(result(page).locator('.an-line-incomplete')).toHaveCount(1);

  await page.getByRole('button', { name: 'Goal line' }).click();
  await page.getByLabel('Goal value').fill('2');
  await page.getByLabel('Goal label').fill('Target');
  await expect(result(page).locator('.an-goal-label')).toHaveText('Target', { timeout: 15_000 });

  await page.getByLabel('X axis label').fill('Day');
  await page.getByLabel('Y axis label').fill('Sales');
  await expect(result(page).locator('.an-axis-label')).toHaveCount(2, { timeout: 15_000 });

  await page.getByLabel('Y axis maximum').fill('10');
  await expect(result(page).locator('.chart-ylabel', { hasText: /^10$/ })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Show values on the series').check();
  await expect(result(page).locator('.an-value-label').first()).toBeVisible({ timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/trends-options.png`, fullPage: true });

  // Suavizado: el total sigue siendo el real.
  await page.getByLabel('Smoothing').selectOption('7');
  await expect(totalCell(page, 0)).toHaveText('4', { timeout: 15_000 });

  await page.getByLabel('Hide weekends').check();
  await expect(result(page).getByText('Saturdays and Sundays are hidden.')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Hide weekends').uncheck();

  // Por semana el suavizado y los fines de semana no aplican y se explica por qué.
  await page.getByLabel('Interval').selectOption('week');
  await expect(page.getByLabel('Smoothing')).toBeDisabled();
  await expect(page.getByText('Smoothing and hiding weekends work when grouping by day.')).toBeVisible();
});

test('vistas de totales y series que se prenden y apagan', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.getByRole('button', { name: '+ Series' }).click();
  await page.getByLabel('Event', { exact: true }).nth(1).fill('purchase');
  const rows = result(page).locator('tbody tr');
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  const display = page.getByLabel('Display', { exact: true });

  await display.selectOption('stacked');
  // Un día con compras de las dos series apila dos rectángulos: en la misma columna, uno arriba del otro.
  await expect(result(page).locator('.an-bar')).not.toHaveCount(0, { timeout: 15_000 });
  const stacked = await result(page).locator('.an-bar').evaluateAll((els) => {
    const byX = new Map<string, Array<{ y: number; h: number }>>();
    for (const el of els) {
      const h = Number(el.getAttribute('height'));
      if (h <= 0) continue;
      const x = el.getAttribute('x') ?? '';
      byX.set(x, [...(byX.get(x) ?? []), { y: Number(el.getAttribute('y')), h }]);
    }
    return [...byX.values()].filter((list) => list.length === 2).map(([a, b]) => Math.abs(a.y - (b.y + b.h)) < 0.5);
  });
  expect(stacked).toEqual([true]);

  await display.selectOption('bar_total');
  await expect(result(page).locator('.an-total-bars .an-hist-row')).toHaveCount(2, { timeout: 15_000 });
  await expect(result(page).locator('.an-total-bars')).toContainText('buy');

  await display.selectOption('donut');
  await expect(result(page).locator('.an-pie-svg:not(.is-solid)')).toBeVisible({ timeout: 15_000 });
  await display.selectOption('pie');
  await expect(result(page).locator('.an-pie-svg.is-solid')).toBeVisible({ timeout: 15_000 });
  await display.selectOption('proportion');
  await expect(result(page).locator('.an-proportion-bar span')).toHaveCount(2, { timeout: 15_000 });
  // 4 y 1: 80% y 20%.
  await expect(result(page).locator('.an-pie-legend')).toContainText('80%');

  // Apagar una serie la saca del gráfico y recalcula el reparto.
  await rows.nth(1).getByRole('checkbox').uncheck();
  await expect(result(page).locator('.an-proportion-bar span')).toHaveCount(1);
  await expect(result(page).locator('.an-pie-legend')).toContainText('100%');
  await result(page).getByRole('button', { name: 'Show all' }).click();
  await expect(result(page).locator('.an-proportion-bar span')).toHaveCount(2);
  await rows.nth(0).getByRole('button', { name: /Hide everything except/ }).click();
  await expect(result(page).locator('.an-proportion-bar span')).toHaveCount(1);
  await result(page).getByRole('button', { name: 'Hide all' }).click();
  await expect(result(page).getByText('All series are hidden.')).toBeVisible();
  await result(page).getByRole('button', { name: 'Show all' }).click();

  // Duplicar una serie.
  await page.getByRole('button', { name: 'Duplicate' }).first().click();
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
});

test('a 390px no hay scroll horizontal con opciones abiertas', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, baseURL!);
  await page.locator('summary', { hasText: 'Chart options' }).click();
  await page.getByRole('button', { name: 'Goal line' }).click();
  await page.getByLabel('Value unit').selectOption('currency');
  await page.waitForLoadState('networkidle');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
});
