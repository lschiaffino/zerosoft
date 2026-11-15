import { expect, test } from '@playwright/test';

/**
 * Track: updates de initiatives, como en Linear. Se publica con la salud
 * elegida (⌘↵), la salud de la initiative pasa a ser la del último update (en
 * su página y en la lista), el autor lo edita y lo borra con confirmación.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

test('initiative: publicar, editar y borrar un update; la salud sigue al último', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const name = `Launch ${uid()}`;
  const ini = (await (await request.post('/api/track/initiatives', { data: { name } })).json()) as { id: string };

  await page.goto(`/en/app/track/initiatives/${ini.id}`);
  const section = page.getByTestId('tp-initiative-updates');
  await expect(section).toBeVisible();
  await expect(section.getByTestId('tp-ini-update')).toHaveCount(0);

  // Sin texto no publica: lo dice.
  await section.getByTestId('tp-ini-update-post').click();
  await expect(section.getByRole('alert')).toBeVisible();

  // Salud con el radio y ⌘↵ desde el editor.
  await section.getByRole('radio', { name: 'At risk' }).check();
  await section.getByTestId('tp-ini-update-body').click();
  await page.keyboard.type('Billing slipped two weeks. Next: pick the launch date on Friday.');
  await page.keyboard.press('ControlOrMeta+Enter');
  const update = section.getByTestId('tp-ini-update');
  await expect(update).toHaveCount(1);
  await expect(update).toContainText('Billing slipped two weeks');
  await expect(update).toContainText('At risk');
  // El composer queda vacío para el próximo.
  await expect(section.getByTestId('tp-ini-update-body')).toHaveText('');
  // La salud de la initiative es la del update.
  await expect(page.getByTestId('tp-initiative-page').locator('.tp-card').first()).toContainText('At risk');

  // Editar: solo el autor (el demo) ve Editar.
  await update.getByRole('button', { name: /^Edit update by/ }).click();
  await update.getByRole('radio', { name: 'On track' }).check();
  await update.getByRole('button', { name: 'Save' }).click();
  await expect(update).toContainText('On track');
  await expect(update).toContainText('edited');

  // En la lista de initiatives, la salud también.
  await page.goto('/en/app/track/initiatives');
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('On track');

  // Borrar con confirmación.
  await page.goto(`/en/app/track/initiatives/${ini.id}`);
  await page.getByTestId('tp-ini-update').getByRole('button', { name: /^Delete update by/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('tp-ini-update')).toHaveCount(0);
  const rows = (await (await request.get(`/api/track/initiatives/${ini.id}/updates`)).json()) as { rows: unknown[] };
  expect(rows.rows).toHaveLength(0);
});

test('initiative updates a 390px: sin scroll horizontal', async ({ page, request }) => {
  const ini = (await (await request.post('/api/track/initiatives', { data: { name: `Phone ${uid()}` } })).json()) as { id: string };
  expect((await request.post(`/api/track/initiatives/${ini.id}/updates`, { data: { health: 'off_track', body: 'A long update '.repeat(30) } })).status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/track/initiatives/${ini.id}`);
  await expect(page.getByTestId('tp-ini-update')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
