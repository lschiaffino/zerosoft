import { expect, test } from '@playwright/test';

/** Board: la hoja de atajos propios se abre desde la barra y se cierra con Esc. */
test('Board: la hoja de atajos lista los atajos de Board y se cierra con Esc', async ({ page }) => {
  const res = await page.request.post('/api/boards', { data: { name: 'Atajos' } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/es/app/board/${id}`);

  const button = page.getByTestId('board-shortcuts');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await expect(page.getByTestId('board-shortcuts-sheet')).toBeVisible();
  for (const group of ['stickies', 'canvas', 'present']) {
    await expect(page.getByTestId(`board-shortcuts-${group}`)).toBeVisible();
  }
  await expect(page.getByTestId('board-shortcut-newSticky').locator('kbd')).toHaveText('N');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-shortcuts-sheet')).toBeHidden();
});
