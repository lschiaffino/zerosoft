import { expect, test } from '@playwright/test';

/**
 * Analytics: historial de versiones de una pregunta. Se guardan cambios
 * desde el editor, el historial dice qué cambió y "Volver a esta versión"
 * deja la pregunta como estaba (y suma una versión nueva). En 390 px oscuro
 * el diálogo entra sin scroll lateral.
 */

const tag = Math.random().toString(36).slice(2, 8);

test.describe.configure({ timeout: 120_000 });

test('guardar cambios, ver qué cambió y volver a la primera versión', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const original = `History ${tag}`;
  const { question } = await (await request.post('/api/bi/questions', { data: { name: original, query: { kind: 'sql', sql: 'SELECT COUNT(*) AS n FROM contacts' } } })).json();

  await page.goto(`/en/app/analytics/questions/${question.id}`, { waitUntil: 'networkidle' });
  // La pregunta corre sola al abrir: con el resultado a la vista, el editor ya responde.
  await expect(page.getByTestId('bi-number').or(page.getByTestId('bi-table'))).toBeVisible({ timeout: 60_000 });
  const nameInput = page.getByLabel('Question name');
  await nameInput.fill(`Renamed ${tag}`);
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/bi/questions/${question.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).status()).toBe(200);

  await page.getByTestId('bi-history-open').click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog).toBeVisible();
  const items = dialog.getByTestId('bi-history').getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('data-kind', 'edit');
  await expect(items.nth(1)).toHaveAttribute('data-kind', 'create');
  // La versión actual no se restaura; la vieja sí.
  await expect(items.nth(0).getByTestId('bi-history-restore')).toHaveCount(0);

  await items.nth(1).getByTestId('bi-history-restore').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Question name')).toHaveValue(original, { timeout: 30_000 });

  // Volver a una versión también queda en el historial.
  await page.getByTestId('bi-history-open').click();
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute('data-kind', 'revert');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('bi-history-open')).toBeFocused();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('API: una versión que no existe o una pregunta que no existe dan 404', async ({ request }) => {
  const { question } = await (await request.post('/api/bi/questions', { data: { name: `Api ${tag}`, query: { kind: 'sql', sql: 'SELECT 1 AS n FROM contacts' } } })).json();
  const list = await request.get(`/api/bi/questions/${question.id}/revisions`);
  expect(list.status()).toBe(200);
  expect((await list.json()).revisions).toHaveLength(1);
  const bad = await request.post(`/api/bi/questions/${question.id}/revisions`, { data: { revisionId: 'birev_nope' } });
  expect(bad.status()).toBe(404);
  const missing = await request.get('/api/bi/questions/biq_missing000/revisions');
  expect(missing.status()).toBe(404);
});

test('390 px en oscuro: el historial entra sin scroll lateral', async ({ browser, request }) => {
  const { question } = await (await request.post('/api/bi/questions', { data: { name: `Mobile ${tag}`, query: { kind: 'sql', sql: 'SELECT 1 AS n FROM contacts' } } })).json();
  await request.patch(`/api/bi/questions/${question.id}`, { data: { name: `Mobile ${tag} with a much longer name to wrap on small screens` } });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`/en/app/analytics/questions/${question.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('bi-number').or(page.getByTestId('bi-table'))).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('bi-history-open').click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog.getByTestId('bi-history').getByRole('listitem')).toHaveCount(2);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  await ctx.close();
});
