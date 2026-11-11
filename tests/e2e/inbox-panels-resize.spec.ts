import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Inbox: la lista cambia de ancho arrastrando el divisor, el ancho queda
 * guardado al recargar, doble clic vuelve al original y en el teléfono no hay
 * divisor. Los mismos divisores que Lines (components/groups/PanelSplitters).
 */

const width = (loc: Locator) => loc.evaluate((el) => el.getBoundingClientRect().width);

async function drag(page: Page, sep: Locator, dx: number) {
  const box = (await sep.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + 30, { steps: 4 });
  await page.mouse.move(x + dx, y + 60, { steps: 4 });
  await page.mouse.up();
}

test('Inbox: la lista cambia de ancho, se guarda y vuelve al original con doble clic', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('zs-inbox-panels:')) localStorage.removeItem(k);
  });
  await page.reload({ waitUntil: 'networkidle' });

  const list = page.locator('.ib-app > .ib-list-pane');
  const sep = page.getByRole('separator', { name: 'Resize the chat list' });
  await expect(sep).toBeVisible({ timeout: 45_000 });
  await expect(sep).toHaveCSS('cursor', 'col-resize');
  const before = await width(list);

  await drag(page, sep, 120);
  await expect.poll(() => width(list)).toBeGreaterThan(before + 100);
  const wide = await width(list);
  // El divisor queda sobre el borde de la lista.
  const box = (await sep.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - wide)).toBeLessThan(12);

  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => width(list)).toBeGreaterThan(wide - 4);

  await sep.dblclick();
  await expect.poll(() => width(list)).toBeLessThan(before + 4);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(sep).toBeHidden();
  expect(errors).toEqual([]);
});
