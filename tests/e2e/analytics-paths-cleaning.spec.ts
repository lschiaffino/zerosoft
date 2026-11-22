import { expect, test } from '@playwright/test';

/**
 * Caminos de Pulse con pasos salteados y páginas agrupadas: se cargan desde el
 * formulario, el resultado cambia y se guardan con el insight.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

test('caminos: saltear /admin/* y agrupar /blog/* desde el formulario', async ({ page, request, baseURL }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Paths ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  const t0 = Date.now() - 3_600_000;
  const visits: Array<[string, string[]]> = [
    [`s1-${uid()}`, ['/', '/admin/x', '/blog/a', '/pricing']],
    [`s2-${uid()}`, ['/', '/blog/b', '/admin/y', '/pricing']],
  ];
  const batch = visits.flatMap(([session, pages]) =>
    pages.map((p, i) => ({ event: '$pageview', distinct_id: session, timestamp: new Date(t0 + i * 1000).toISOString(), properties: { $session_id: session, $current_url: `http://shop.test${p}`, $pathname: p } })),
  );
  expect((await request.post('/api/ingest/batch', { headers: { origin: 'http://shop.test' }, data: { api_key: project.publicKey, batch } })).status()).toBeLessThan(300);

  await page.context().addCookies([{ name: 'zs_analytics_project', value: project.id, url: baseURL! }]);
  await page.goto(`/en/app/pulse/insights/new?query=${encodeURIComponent(JSON.stringify({ kind: 'paths', dateRange: { from: '-1d' } }))}`, { waitUntil: 'networkidle' });
  const result = page.getByTestId('an-result');
  await expect(result.locator('.an-path-from').first()).toBeVisible({ timeout: 15_000 });

  const exclude = page.getByTestId('an-paths-exclude');
  await exclude.getByRole('textbox').fill('/admin/*');
  await exclude.getByRole('textbox').press('Enter');
  await expect(exclude.getByRole('group').getByRole('button')).toHaveCount(1);
  const groups = page.getByTestId('an-paths-groups');
  await groups.getByRole('textbox').fill('/blog/*');
  await groups.getByRole('button').first().click();
  await expect(groups.getByRole('group').getByRole('button')).toHaveCount(1);

  // Sin /admin y con el blog en un paso: un solo camino / → /blog/* → /pricing.
  await expect(result.locator('.an-path-from, .an-path-to').filter({ hasText: '/admin' })).toHaveCount(0, { timeout: 15_000 });
  await expect(result.locator('.an-path-to').filter({ hasText: '/blog/*' }).first()).toBeVisible();

  // Sacar el grupo vuelve a mostrar las páginas sueltas.
  await groups.getByRole('group').getByRole('button').click();
  await expect(groups.getByRole('group')).toHaveCount(0);
  await expect(result.locator('.an-path-to').filter({ hasText: '/blog/a' }).first()).toBeVisible({ timeout: 15_000 });
});
