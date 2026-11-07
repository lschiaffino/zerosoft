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
