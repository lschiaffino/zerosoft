import { expect, test, type APIResponse } from '@playwright/test';

/** Track: la plantilla por defecto del proyecto se precarga en el alta rápida. */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

test('alta rápida: la plantilla por defecto llega cargada', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Tpl ${uid()}` } }));
  const prefix = `Bug ${uid()}:`;
  await ok(request.post(`/api/track/projects/${project.id}/templates`, { data: { name: 'Otra', title: 'Otra:' } }));
  const def = await ok<{ id: string; is_default: number }>(
    request.post(`/api/track/projects/${project.id}/templates`, { data: { name: 'Bug', title: prefix, priority: 'high', isDefault: true } }),
  );
  expect(def.is_default).toBe(1);

  await page.goto(`/en/app/track/team/${project.id}`);
  await page.waitForLoadState('networkidle');
  const dialog = page.getByRole('dialog', { name: /New issue/ });
  await expect(async () => {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('c');
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });

  await expect(dialog.locator('.track-qc-title')).toHaveValue(prefix);
  await expect(page.getByTestId('track-qc-priority')).toContainText('High');
});

test('ajustes: la casilla Por defecto marca una sola plantilla y se ve bien en oscuro a 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Tpl UI ${uid()}` } }));
  const first = await ok<{ id: string }>(
    request.post(`/api/track/projects/${project.id}/templates`, { data: { name: 'Primera', isDefault: true } }),
  );
  await page.goto(`/en/app/track/team/${project.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-project-settings').click();
  await page.getByTestId('track-settings-tab-templates').click();
  await expect(page.getByTestId('track-template').filter({ hasText: 'Default' })).toHaveCount(1);

  await page.getByTestId('track-new-template').first().click();
  const form = page.getByTestId('track-template-form');
  await form.getByLabel('Template name').fill('Segunda');
  await form.getByTestId('track-template-default').check();
  await form.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByTestId('track-template').filter({ hasText: 'Segunda' })).toContainText('Default');
  await expect(page.getByTestId('track-template').filter({ hasText: 'Primera' })).not.toContainText('Default');
  const rows = await ok<{ rows: Array<{ id: string; is_default: number }> }>(request.get(`/api/track/projects/${project.id}/templates`));
  expect(rows.rows.filter((r) => r.is_default === 1)).toHaveLength(1);
  expect(rows.rows.find((r) => r.id === first.id)?.is_default).toBe(0);

  await page.context().addCookies([{ name: 'zs_theme', value: 'dark', url: page.url() }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/track/team/${project.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-project-settings').click();
  await page.getByTestId('track-settings-tab-templates').click();
  await page.getByTestId('track-template').first().getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('track-template-default')).toBeVisible();
  await page.screenshot({ path: process.env.TPL_SHOT || 'test-results/tpl-default-dark.png' });
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});
