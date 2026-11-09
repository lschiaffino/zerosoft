import { expect, test, type Page } from '@playwright/test';

/**
 * Ajustes completos: la caja que filtra secciones (teclado incluido),
 * Apariencia, Sin conexión (ajustes del dispositivo que el service worker
 * aplica), la sección App de escritorio, el aviso de versión nueva dentro de
 * la app y el modo embebido de la ventana de Ajustes del escritorio (user
 * agent zerosoft-settings/): sin el chrome de la app, con las secciones
 * nativas en Este dispositivo.
 */

const EMBED_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 zerosoft-settings/0.3.2';

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test('la búsqueda filtra secciones por nombre o palabra clave y se maneja con teclado', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Settings' });
  const box = page.getByRole('searchbox', { name: 'Search settings' });
  await box.fill('dark mode');
  await expect(nav.getByRole('link')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Appearance' })).toBeVisible();
  // Sin tildes y por producto.
  await box.fill('crm');
  await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toBeVisible();
  await box.fill('zzzz');
  await expect(nav.getByText('No settings match “zzzz”')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toHaveValue('');
  await expect(nav.getByRole('link', { name: 'Members and permissions' })).toBeVisible();
  // Flecha abajo entra a la lista; Enter con texto abre la primera.
  await box.fill('offline');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/settings\/offline$/);
  await expect(page.getByTestId('offline-settings')).toBeVisible();
});

test('Apariencia: el modo de color se aplica al momento', async ({ page }) => {
  await page.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
  const group = page.getByTestId('appearance-theme');
  await group.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await group.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await group.getByText('System', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Change it in Profile' })).toHaveAttribute('href', /\/en\/app\/settings$/);
});

test('Sin conexión: prendido por defecto, apps, tamaño y días se guardan en el dispositivo', async ({ page }) => {
  await page.goto('/en/app/settings/offline', { waitUntil: 'networkidle' });
  const sw = page.getByRole('switch', { name: 'Keep apps available offline' });
  await expect(sw).toBeChecked();
  await expect(page.getByLabel('Normal')).toBeChecked();
  await expect(page.getByLabel('Keep saved pages for')).toHaveValue('30');
  await expect(page.getByTestId('offline-pending')).toContainText('0');
  await page.getByLabel('Docs').uncheck();
  await page.getByLabel('Light').check();
  await page.getByLabel('Keep saved pages for').selectOption('7');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('zs-offline-prefs') ?? 'null'));
  expect(stored).toMatchObject({ enabled: true, size: 'light', days: 7, apps: { docs: false, crm: true } });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Docs')).not.toBeChecked();
  await expect(page.getByLabel('Light')).toBeChecked();
  // Uso medido y borrar datos guardados.
  await expect(page.getByTestId('offline-usage')).toBeVisible();
  await page.getByRole('button', { name: 'Clear offline data now' }).click();
  await expect(page.getByText('Offline data cleared')).toBeVisible();
  // Apagado (sin cambios pendientes, sin pedir confirmar): las opciones quedan deshabilitadas.
  await sw.uncheck();
  await expect(page.getByText('Offline mode is off. Saved pages were deleted.')).toBeVisible();
  await expect(page.getByLabel('Track')).toBeDisabled();
  await sw.check();
  await expect(page.getByLabel('Track')).toBeEnabled();
});

test('Sin conexión: con cambios esperando, apagar pide confirmar', async ({ page }) => {
  await page.goto('/en/app/settings/offline', { waitUntil: 'networkidle' });
  // Un borrador de Docs de esta persona (la clave la arma components/app/OfflineStatus.tsx).
  // persona:workspace (components/app/OfflineIdentity.tsx lo guarda al abrir la app).
  const owner = await page.evaluate(() => localStorage.getItem('zs-identity'));
  test.skip(!owner, 'sin la identidad offline guardada en este navegador');
  await page.evaluate((o) => localStorage.setItem(`zs-docs-draft:${o}|p1`, '{}'), owner);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('offline-pending')).toContainText('1');
  await page.getByRole('switch', { name: 'Keep apps available offline' }).uncheck();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('1 change is waiting to be sent');
  await dialog.getByRole('button', { name: 'Keep it on' }).click();
  await expect(page.getByRole('switch', { name: 'Keep apps available offline' })).toBeChecked();
  await page.evaluate((o) => localStorage.removeItem(`zs-docs-draft:${o}|p1`), owner);
});

test('App de escritorio: fuera de la app lleva a la descarga; dentro, avisa la versión nueva', async ({ page }) => {
  await page.goto('/en/app/settings/desktop', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('desktop-app-settings')).toContainText('Not in the app');
  await expect(page.getByRole('link', { name: 'Download the app' })).toHaveAttribute('href', '/download');
  for (const name of ['Permissions', 'Updates', 'Meetings']) await expect(page.getByTestId('desktop-app-settings').getByText(name, { exact: true })).toBeVisible();

  // Dentro de una versión vieja de la app (0.2.1, sin updater): aviso arriba de la página.
  await page.route('**/api/desktop/update/latest.json', (r) => r.fulfill({ json: { version: '0.3.2' } }));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'zerosoftDesktop', {
      value: { version: '0.2.1', platform: 'darwin', systemAudio: false, dictation: true, startLogin: () => {}, openSettings: () => {} },
    });
  });
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  const banner = page.getByTestId('desktop-update-banner');
  await expect(banner).toContainText('zerosoft 0.3.2 for desktop is available.');
  await expect(banner).toContainText('You have 0.2.1, which cannot update itself and may not recognize the Accessibility permission');
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toBeHidden();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('desktop-update-banner')).toBeHidden();
});

test('la nav para la ventana del escritorio sale de /api/settings/nav', async ({ request }) => {
  const res = await request.get('/api/settings/nav?locale=es&desktop=1');
  expect(res.status()).toBe(200);
  const { groups } = (await res.json()) as { groups: Array<{ key: string; label: string; items: Array<{ key: string; href: string; native?: string }> }> };
  expect(groups.map((g) => g.key)).toEqual(['device', 'account', 'workspace', 'products']);
  expect(groups[0].label).toBe('Este dispositivo');
  expect(groups[0].items.filter((i) => i.native).map((i) => i.native)).toEqual(['start', 'general', 'meetings', 'voice', 'dictionary', 'history', 'permissions', 'updates', 'account']);
  expect(groups[0].items.at(-1)?.href).toBe('/app/settings/offline');
});

test.describe('ventana de Ajustes del escritorio (modo embebido)', () => {
  test.use({ userAgent: EMBED_UA });

  test('sin el chrome de la app; Este dispositivo primero; productos marcados', async ({ page }) => {
    await page.setViewportSize({ width: 860, height: 640 });
    await page.goto('/en/app/settings/offline', { waitUntil: 'networkidle' });
    await expect(page.locator('.st-embed')).toBeVisible();
    await expect(page.locator('.app-frame')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Settings' });
    const groups = nav.getByRole('group');
    await expect(groups.first()).toHaveAccessibleName('This device');
    await expect(nav.getByRole('link', { name: 'Permissions' })).toHaveAttribute('href', '/app/settings/desktop/permissions');
    await expect(nav.getByRole('link', { name: 'Offline' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('offline-settings')).toBeVisible();
    // Ajustes de un producto: la misma nav, con el producto marcado.
    await nav.getByRole('link', { name: 'Track', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/app\/track\/settings/);
    await expect(nav.getByRole('link', { name: 'Track', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.app-frame')).toHaveCount(0);
  });

  test('claro, oscuro y 390px sin scroll horizontal', async ({ page }) => {
    for (const [w, h] of [
      [860, 640],
      [390, 760],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const path of ['/app/settings', '/app/settings/offline', '/app/settings/members', '/app/crm/settings']) {
          await page.goto(`/en${path}`, { waitUntil: 'load' });
          await noHorizontalScroll(page, `${w} ${scheme} ${path}`);
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
    await expect(page.getByLabel('Settings section')).toBeVisible();
  });
});

test('390px y oscuro: Apariencia, Sin conexión y App de escritorio sin scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/app/settings/appearance', '/app/settings/offline', '/app/settings/desktop']) {
      await page.goto(`/en${path}`, { waitUntil: 'load' });
      await noHorizontalScroll(page, `${scheme} ${path}`);
    }
  }
});
