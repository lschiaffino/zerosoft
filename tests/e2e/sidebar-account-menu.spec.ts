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

test('colapsado, "+ Nuevo" abre al lado del riel sin correrlo de pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/en/app/notes', { waitUntil: 'load' });
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  const frame = page.locator('.app-frame');
  const newBtn = page.getByTestId('side-new');
  await expect(newBtn).toBeVisible();
  if (!(await frame.getAttribute('class'))?.includes('sidebar-collapsed')) await page.locator('.side-handle').click();
  await expect(frame).toHaveClass(/sidebar-collapsed/);
  await expect(newBtn).toHaveAttribute('aria-haspopup', 'menu');
  await newBtn.click();
  const menu = page.locator('.side-new [role="menu"]');
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  // Antes el menú quedaba adentro del riel: lo recortaba y, al enfocar el primer
  // ítem, el riel se corría de costado y el botón se iba de pantalla.
  expect(await page.locator('.side').evaluate((el) => el.scrollLeft)).toBe(0);
  const btn = (await newBtn.boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(btn.x).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(btn.x + btn.width);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  // El ítem se ve entero, no recortado por el riel.
  const item = (await menu.getByRole('menuitem').first().boundingBox())!;
  expect(item.x).toBeGreaterThanOrEqual(box.x);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/new-collapsed.png` });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
