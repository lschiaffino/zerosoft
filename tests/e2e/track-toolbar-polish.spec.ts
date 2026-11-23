import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Pulido de Track: con un filtro puesto, la búsqueda sigue en la primera
 * línea de la barra (como Linear); y en el panel del issue, Tiempo en el
 * estado y Agente van con ícono y valor como las demás propiedades.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
});

for (const width of [1100, 1280]) {
  test(`${width}: los filtros no bajan la búsqueda a otra línea`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Bar ${uid()}` } }));
    await ok(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: 'Uno', priority: 'high' } }));
    const rules = [
      { field: 'priority', op: 'is', values: ['high', 'urgent', 'medium', 'low'] },
      { field: 'priority', op: 'is_not', values: ['none'] },
    ];
    const filter = encodeURIComponent(JSON.stringify({ match: 'and', rules }));
    await page.goto(`/en/app/track/team/${team.id}?filter=${filter}`, { waitUntil: 'networkidle' });
    const add = page.getByTestId('track-filter-add');
    const search = page.getByTestId('track-search');
    await expect(search).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('track-filter-chip').first()).toBeVisible();
    const a = (await add.boundingBox())!;
    const b = (await search.boundingBox())!;
    expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(12);
    // Nada se sale de la barra ni de la página.
    const tools = page.locator('.track-list-tools');
    expect(await tools.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('1280: Tiempo en el estado y Agente con ícono, como las demás propiedades', async ({ page, request }) => {
  const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Side ${uid()}` } }));
  const issue = await ok<{ id: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: 'Dos' } }));
  await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
  const extras = page.getByTestId('track-side-extras');
  await expect(extras).toBeVisible({ timeout: 120_000 });
  const dts = await extras.locator('dt').all();
  expect(dts.length).toBeGreaterThanOrEqual(1);
  await expect(extras.getByText('Agent', { exact: true })).toHaveCount(1);
  for (const dt of dts) {
    await expect(dt.locator('svg')).toBeVisible();
    // El nombre queda para lectores de pantalla y en el tooltip.
    expect(await dt.getAttribute('title')).toBeTruthy();
  }
});
