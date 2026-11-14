import { expect, test } from '@playwright/test';

/**
 * Track: detalles de diseño que encontró la pasada de QA (gauntlet) usando la app.
 * - Lista: con varias etiquetas, la fila queda en una línea (antes las etiquetas
 *   pasaban a dos renglones y el título se cortaba con lugar libre).
 * - Resumen a 390px: las columnas de números entran enteras.
 * - Initiatives: la columna "Active projects" cuenta los activos sobre el total.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

test('lista: un issue con varias etiquetas ocupa una sola línea', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const team = (await (await request.post('/api/track/projects', { data: { name: `Layout ${uid()}` } })).json()) as { id: string };
  const title = 'Offline sync for the mobile app';
  const res = await request.post(`/api/track/projects/${team.id}/issues`, {
    data: {
      title,
      labels: [
        { name: `Feature ${uid()}`, color: '#8b5cf6' },
        { name: `Performance ${uid()}`, color: '#3b82f6' },
        { name: `Customer ${uid()}`, color: '#ef4444' },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const issue = (await res.json()) as { id: string };
  await page.goto(`/en/app/track/team/${team.id}`);
  const row = page.locator(`[data-issue-key="${issue.id}"]`).first();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(44);
  // El título entra entero: hay lugar para él antes que para las etiquetas.
  const titleEl = row.locator('.track-issue-title').first();
  const fits = await titleEl.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
});

test('resumen a 390px: Vencidos y Triage se ven enteros', async ({ page, request }) => {
  await request.post('/api/track/projects', { data: { name: `Mobile ${uid()}` } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/track');
  const table = page.locator('.track-overview table').first();
  await expect(table).toBeVisible();
  const header = table.locator('th').nth(3);
  await expect(header).toBeVisible();
  const right = await header.evaluate((el) => el.getBoundingClientRect().right);
  const wrapRight = await page.locator('.track-overview').first().evaluate((el) => el.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(wrapRight + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('initiatives: la columna de projects activos dice cuántos de cuántos', async ({ page, request }) => {
  const name = `Launch ${uid()}`;
  const ini = (await (await request.post('/api/track/initiatives', { data: { name } })).json()) as { id: string };
  const a = (await (await request.post('/api/track/plans', { data: { name: `Active ${uid()}`, status: 'in_progress' } })).json()) as { id: string };
  const b = (await (await request.post('/api/track/plans', { data: { name: `Planned ${uid()}`, status: 'planned' } })).json()) as { id: string };
  expect((await request.patch(`/api/track/initiatives/${ini.id}`, { data: { planIds: [a.id, b.id] } })).ok()).toBe(true);
  await page.goto('/en/app/track/initiatives');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('1 of 2 projects');
});

test('⌘K: Enter antes de que lleguen los resultados abre el issue buscado (no un issue nuevo vacío)', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const team = (await (await request.post('/api/track/projects', { data: { name: `Cmdk ${uid()}` } })).json()) as { id: string };
  const title = `Zebra ${uid()} search target`;
  const issue = (await (await request.post(`/api/track/projects/${team.id}/issues`, { data: { title } })).json()) as { id: string };
  await page.goto(`/en/app/track/team/${team.id}`);
  await expect(page.locator(`[data-issue-key="${issue.id}"]`).first()).toBeVisible();
  // La búsqueda tarda: Enter llega antes que los resultados.
  await page.route('**/api/search?**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox').first();
  await expect(input).toBeFocused();
  await page.keyboard.type(title.slice(0, 12));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/app/track/(issue|issues)/`), { timeout: 30_000 });
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByTestId('track-qc-chips')).toHaveCount(0);
});

test('Filter: el texto de cada propiedad va pegado a su ícono', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const team = (await (await request.post('/api/track/projects', { data: { name: `Filter ${uid()}` } })).json()) as { id: string };
  await request.post(`/api/track/projects/${team.id}/issues`, { data: { title: 'Uno' } });
  await page.goto(`/en/app/track/team/${team.id}`);
  await expect(page.locator('[data-issue-row]').first()).toBeVisible();
  await page.locator('[data-issue-row]').first().hover();
  await page.keyboard.press('f');
  const item = page.getByRole('menuitem', { name: 'Priority' }).first();
  await expect(item).toBeVisible();
  const gap = await item.evaluate((el) => {
    const icon = el.querySelector('.track-keymenu-icon')!.getBoundingClientRect();
    const label = el.querySelector('.track-keymenu-label')!.getBoundingClientRect();
    return label.left - icon.right;
  });
  expect(gap).toBeLessThanOrEqual(12);
});
