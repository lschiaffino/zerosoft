import { expect, test, type APIResponse, type Page } from '@playwright/test';

/** Track › Updates (Pulse de Linear): updates de projects e initiatives en un feed. */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function noSideScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
}

test('Para mí y Todos: el update de mi project y el de otro', async ({ page, request }) => {
  const { me } = await ok<{ me: string }>(request.get('/api/track/plans?meta=only'));
  const tag = uid();
  const mine = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Mine ${tag}`, leadId: me, status: 'in_progress' } }));
  const other = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Other ${tag}`, status: 'in_progress' } }));
  // Por si quien crea queda siguiendo el project: lo dejo de seguir para que no sea "para mí".
  await ok(request.put(`/api/track/plans/${other.id}/follow`, { data: { following: false } }));
  await ok(request.post(`/api/track/plans/${mine.id}/updates`, { data: { health: 'on_track', body: `Shipped beta ${tag}` } }));
  await ok(request.post(`/api/track/plans/${other.id}/updates`, { data: { health: 'at_risk', body: `Vendor late ${tag}` } }));

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/track/updates', { waitUntil: 'networkidle' });
  const feed = page.getByTestId('tp-pulse-feed');
  const item = (body: string) => feed.getByTestId('tp-pulse-item').filter({ hasText: body });
  await expect(page.getByTestId('tp-pulse-tab-for_me')).toHaveAttribute('aria-selected', 'true');
  await expect(item(`Shipped beta ${tag}`)).toHaveCount(1);
  await expect(item(`Vendor late ${tag}`)).toHaveCount(0);

  // Flecha a la derecha pasa a Todos y queda en la URL.
  await page.getByTestId('tp-pulse-tab-for_me').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tp-pulse-tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tp-pulse-tab-all')).toBeFocused();
  await expect(page).toHaveURL(/tab=all/);
  await expect(item(`Vendor late ${tag}`)).toHaveCount(1);
  await expect(item(`Shipped beta ${tag}`)).toHaveCount(1);

  // El nombre del project lleva a su pestaña de updates.
  await expect(item(`Vendor late ${tag}`).getByTestId('tp-pulse-parent')).toHaveAttribute('href', new RegExp(`/app/track/projects/${other.id}\\?tab=updates$`));

  // La pestaña queda al recargar.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-pulse-tab-all')).toHaveAttribute('aria-selected', 'true');
});

test('Updates a 390 px en oscuro, sin scroll lateral', async ({ page, request }) => {
  const { me } = await ok<{ me: string }>(request.get('/api/track/plans?meta=only'));
  const plan = await ok<{ id: string }>(
    request.post('/api/track/plans', { data: { name: `A project with a long name to check that the header wraps ${uid()}`, leadId: me, status: 'in_progress' } }),
  );
  await ok(
    request.post(`/api/track/plans/${plan.id}/updates`, {
      data: { health: 'off_track', body: 'A long update body with a very-long-unbroken-token-that-should-wrap-inside-the-card-without-pushing-the-page-sideways and a list:\n\n- one\n- two' },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/track/updates', { waitUntil: 'networkidle' });
  await page.context().addCookies([{ name: 'zs_theme', value: 'dark', url: page.url() }]);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-pulse-item').first()).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: process.env.PULSE_SHOT || 'test-results/track-updates-390-dark.png', fullPage: true });
});
