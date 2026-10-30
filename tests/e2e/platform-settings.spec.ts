import { expect, test, type Page } from '@playwright/test';

/**
 * Ajustes de la plataforma: nav lateral en dos grupos (Cuenta y workspace,
 * Productos), una ruta por sección, anchors viejos que caen en la sección
 * nueva, ⌘K que encuentra cada sección, shell neutro, select a 390px y los
 * ajustes de cada app con el link de vuelta a la plataforma.
 */

const SECTIONS: Array<[string, string]> = [
  ['/app/settings', 'Profile'],
  ['/app/settings/workspace', 'Workspace'],
  ['/app/settings/members', 'Members'],
  ['/app/settings/teams', 'Teams'],
  ['/app/settings/billing', 'Plan and usage'],
  ['/app/settings/api', 'API and webhooks'],
  ['/app/settings/connections', 'Connections'],
  ['/app/settings/import', 'Import'],
  ['/app/settings/security', 'Security'],
  ['/app/settings/notifications', 'Notifications'],
];

/** Ajustes de cada app (Chat: la lista de widgets; /app/chat/settings redirige ahí). */
const APP_SETTINGS = [
  '/app/crm/settings',
  '/app/chat/widgets',
  '/app/groups/settings',
  '/app/agents/settings',
  '/app/flow/settings',
  '/app/robots/settings',
  '/app/track/settings',
  '/app/links/settings',
  '/app/docs/settings',
  '/app/notes/settings',
  '/app/calendar/settings',
  '/app/board/settings',
];

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test('la nav tiene dos grupos y marca la sección abierta en cada ruta', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const nav = page.getByRole('navigation', { name: 'Settings' });
  for (const [path, label] of SECTIONS) {
    await page.goto(`/en${path}`, { waitUntil: 'load' });
    await expect(nav.getByRole('link', { name: label, exact: true }), path).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]'), path).toHaveCount(1);
  }
  await expect(nav.getByRole('group', { name: 'Account and workspace' })).toBeVisible();
  const products = nav.getByRole('group', { name: 'Products' });
  await expect(products.getByRole('link')).toHaveCount(19);

  // Productos lleva a los ajustes de la app, y de ahí se vuelve a la plataforma.
  await products.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/app\/docs\/settings$/);
  await expect(page.getByRole('heading', { name: 'Docs settings', level: 1 })).toBeVisible();
  // Docs ya tiene ajustes propios: General, Teamspaces y, para admins, Site y Audit log.
  const docsTabs = page.getByRole('navigation', { name: 'Docs settings' });
  for (const name of ['General', 'Teamspaces', 'Site', 'Audit log']) await expect(docsTabs.getByRole('link', { name, exact: true })).toBeVisible();
  await page.getByTestId('platform-settings-link').click();
  await expect(page).toHaveURL(/\/en\/app\/settings$/);
});

test('el shell va neutro en Ajustes y vuelve al color de la app afuera', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/settings/api', { waitUntil: 'load' });
  await expect(page.locator('.band-product-name')).toHaveText('zerosoft');
  const accent = await page.evaluate(() => {
    const frame = getComputedStyle(document.querySelector('.app-frame')!);
    return { accent: frame.getPropertyValue('--accent').trim(), ink: frame.getPropertyValue('--ink').trim() };
  });
  expect(accent.accent).toBe(accent.ink);
  await expect(page.locator('.side-line').getByRole('link', { name: 'Home' })).toBeVisible();

  await page.goto('/en/app/links/settings', { waitUntil: 'load' });
  await expect(page.locator('.band-product-name')).toHaveText('Link');
});

test('los anchors viejos de /app/settings/workspace caen en la sección nueva', async ({ page }) => {
  await page.goto('/en/app/settings/workspace#api', { waitUntil: 'load' });
  await expect(page).toHaveURL(/\/en\/app\/settings\/api#api-keys$/);
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();

  await page.goto('/en/app/settings/workspace#ai', { waitUntil: 'load' });
  await expect(page).toHaveURL(/\/en\/app\/settings\/billing#ai$/);

  await page.goto('/en/app/settings/workspace#credentials', { waitUntil: 'load' });
  await expect(page).toHaveURL(/\/en\/app\/settings\/connections#credentials$/);

  // Sin anchor, Workspace es su propia sección.
  await page.goto('/en/app/settings/workspace', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible();
});

test('⌘K encuentra las secciones de Ajustes y los ajustes de cada app', async ({ page }) => {
  // Contexto nuevo: networkidle espera a que ⌘K esté hidratado.
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  const input = page.getByRole('combobox', { name: 'Search' });
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass();
  await input.fill('members');
  const option = page.getByRole('option', { name: 'Settings: Members' });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/settings\/members$/);
  await expect(page.getByRole('heading', { name: /^Members \(/ })).toBeVisible();

  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass();
  await input.fill('board settings');
  await page.getByRole('option', { name: 'Board settings' }).click();
  await expect(page).toHaveURL(/\/en\/app\/board\/settings$/);
});

test('Link: dominios, importar y exportar son pestañas de sus ajustes', async ({ page }) => {
  await page.goto('/en/app/links/settings', { waitUntil: 'load' });
  const tabs = page.getByRole('navigation', { name: 'Link settings' });
  await expect(tabs.getByRole('link', { name: 'Domains' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Domain', { exact: true })).toBeVisible();
  await tabs.getByRole('link', { name: 'Export links' }).click();
  await expect(page.getByRole('link', { name: 'Download CSV' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Import links' }).click();
  await expect(page).toHaveURL(/tab=import/);
  // El sidebar de Link marca Ajustes de la app.
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/en\/app\/links\/settings$/);
});

test('cada app tiene ajustes con el link a los de la plataforma', async ({ page }) => {
  test.setTimeout(180_000);
  for (const path of APP_SETTINGS) {
    await page.goto(`/en${path}`, { waitUntil: 'load' });
    await expect(page.getByTestId('platform-settings-link'), path).toHaveAttribute('href', /\/en\/app\/settings$/);
  }
});

test('390px: la nav pasa a un select, sin scroll horizontal, en claro y oscuro', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [path] of SECTIONS) {
      await page.goto(`/en${path}`, { waitUntil: 'load' });
      await noHorizontalScroll(page, `${scheme} ${path}`);
    }
    for (const path of ['/app/links/settings', '/app/docs/settings', '/app/robots/settings']) {
      await page.goto(`/en${path}`, { waitUntil: 'load' });
      await noHorizontalScroll(page, `${scheme} ${path}`);
    }
  }
  await page.goto('/en/app/settings', { waitUntil: 'load' });
  await expect(page.getByRole('navigation', { name: 'Settings' })).toBeHidden();
  const select = page.getByLabel('Settings section');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('profile');
  // El select navega cuando la página ya hidrató.
  await expect(async () => {
    await select.selectOption('security');
    await expect(page).toHaveURL(/\/en\/app\/settings\/security$/, { timeout: 2000 });
  }).toPass();
  await expect(page.getByLabel('Settings section')).toHaveValue('security');
});

test('teclado: Tab llega a la nav con foco visible y Enter abre la sección', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/settings', { waitUntil: 'load' });
  const link = page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Security', exact: true });
  await link.focus();
  await expect(link).toBeFocused();
  const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/settings\/security$/);
});
