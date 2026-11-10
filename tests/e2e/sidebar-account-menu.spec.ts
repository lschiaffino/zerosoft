import { expect, test } from '@playwright/test';

/** Pie del sidebar: una fila; ajustes, ayuda, tema y salir viven en el menú de la cuenta. */
for (const scheme of ['light', 'dark'] as const) {
  test(`menú de la cuenta (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/en/app/track', { waitUntil: 'load' });
    // En next dev, el indicador de Next tapa el avatar.
    await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
    const account = page.getByTestId('workspace-switcher');
    const foot = await page.locator('.side-foot').boundingBox();
    expect(foot?.height).toBeLessThan(60);
    await expect(page.getByTestId('side-settings')).toHaveCount(0);

    await account.click();
    for (const id of ['side-settings', 'side-help', 'side-signout', 'theme-switcher']) await expect(page.getByTestId(id)).toBeVisible();
    // El tema se cambia sin que se cierre el menú.
    await page.locator('[data-theme-pref="dark"]').click();
    await expect(page.getByTestId('side-settings')).toBeVisible();
    await page.locator('[data-theme-pref="system"]').click();
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/acct-open-${scheme}.png` });
    const menu = await page.locator('.ws-switcher-menu').boundingBox();
    expect(menu!.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('side-settings')).toHaveCount(0);
    await expect(account).toBeFocused();

    // Colapsado sigue abriendo, y el menú entra en pantalla.
    await page.locator('.side-handle').click();
    await expect(page.locator('.app-frame')).toHaveClass(/sidebar-collapsed/);
    await page.waitForTimeout(300);
    await account.click();
    await expect(page.getByTestId('side-settings')).toBeVisible();
    const collapsed = await page.locator('.ws-switcher-menu').boundingBox();
    expect(collapsed!.x + collapsed!.width).toBeLessThanOrEqual(1280);
    expect(collapsed!.y).toBeGreaterThanOrEqual(0);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/acct-collapsed-${scheme}.png` });
    await page.keyboard.press('Escape');
    await page.locator('.side-handle').click();
  });
}

test('en el teléfono el menú de la cuenta entra en el drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/track', { waitUntil: 'load' });
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  await page.locator('.band-menu').click();
  await page.getByTestId('workspace-switcher').click();
  await expect(page.getByTestId('side-settings')).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/acct-390.png` });
  const menu = await page.locator('.ws-switcher-menu').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(391);
});
