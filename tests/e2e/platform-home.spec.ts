import { expect, test } from '@playwright/test';

/**
 * Inicio de la plataforma (/app) y menús: /app ya no es Link, el switcher
 * agrupa por categoría y el sitio también.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('/app es el inicio: saludo, Para hoy, recientes, apps e importar', async ({ page }) => {
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  await expect(page.locator('h1.ui-page-title')).toHaveText(/^(Buen día|Buenas tardes|Buenas noches)/);
  await expect(page.locator('.band-product-name')).toHaveText('zerosoft');
  await expect(page.getByRole('heading', { name: 'Para hoy', level: 2 })).toBeVisible();
  for (const id of ['home-crm-tasks', 'home-track', 'home-cal', 'home-unread']) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(page.getByTestId('home-recent')).toBeVisible();
  // Modo equipo (por defecto): destacadas de equipo, invitar visible.
  await expect(page.getByTestId('home-featured').getByRole('link')).toHaveCount(6);
  await expect(page.getByTestId('home-featured').getByRole('link', { name: 'Abrir CRM' })).toBeVisible();
  await expect(page.getByTestId('home-more').getByRole('heading', { level: 3 }).first()).toBeVisible();
  await expect(page.getByTestId('home-invite').getByRole('link', { name: 'Invitar' })).toHaveAttribute('href', '/es/app/settings/members');
  await expect(page.getByTestId('home-import').getByRole('link', { name: 'Importar' })).toHaveAttribute('href', '/es/app/settings/import');
  // El sidebar del inicio lista las apps por categoría.
  await expect(page.locator('.side-line .side-section').first()).toHaveText('Vender');
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', '/es/app');
});

test('Link vive en /app/links: el switcher y el resumen', async ({ page }) => {
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  await page.locator('.band-product').click();
  await page.getByRole('menuitem', { name: 'Link' }).click();
  await expect(page).toHaveURL(/\/es\/app\/links$/);
  await expect(page.locator('.band-product-name')).toHaveText('Link');
  await page.locator('.side-line').getByRole('link', { name: 'Resumen' }).click();
  await expect(page).toHaveURL(/\/es\/app\/links\/overview$/);
  await expect(page.getByRole('heading', { name: 'Resumen de Link', level: 1 })).toBeVisible();
  await expect(page.locator('.stat-card')).toHaveCount(4);
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', '/es/app/links/overview');
  // El logo de la banda vuelve al inicio, no a Link.
  await page.locator('.band-home').click();
  await expect(page).toHaveURL(/\/es\/app$/);
  await expect(page.getByRole('heading', { name: 'Para hoy', level: 2 })).toBeVisible();
});

test('switcher: inicio, destacadas, más apps por categoría, teclado y ⌘K', async ({ page }) => {
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  await page.locator('.band-product').click();
  const menu = page.getByRole('menu', { name: 'Cambiar de app' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Inicio' })).toHaveAttribute('href', '/es/app');
  await expect(menu.getByRole('group', { name: 'Destacadas' }).getByRole('menuitem')).toHaveCount(6);
  await expect(menu.getByRole('group', { name: 'Automatizar' }).getByRole('menuitem')).not.toHaveCount(0);
  // El foco arranca en la app actual y las flechas lo mueven.
  await expect(menu.getByRole('menuitem', { name: 'CRM' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'CRM' })).not.toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'CRM' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: /Buscar/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Buscar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Buscar' })).toHaveCount(0);
  // Esc cierra el switcher y devuelve el foco al botón.
  await page.locator('.band-product').click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.band-product')).toBeFocused();
});

test('⌘K encuentra las apps por nombre, rival o categoría', async ({ page }) => {
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('hubspot');
  await expect(dialog.getByRole('option', { name: /Open CRM/ })).toBeVisible();
  await dialog.getByRole('combobox').fill('link overview');
  await dialog.getByRole('option', { name: /Link overview/ }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/links\/overview$/);
});

test('390px: inicio y switcher sin scroll horizontal; oscuro sin errores', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.band-product').click();
  const panel = page.locator('.band-switcher-panel');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});

test('sitio: productos por categoría y la nota de equipos y uso personal', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'networkidle' });
  const trigger = page.locator('.site-header .hd-trigger');
  await trigger.click();
  const mega = page.locator('#hd-mega');
  await expect(mega.locator('.hd-group-title')).toHaveText(['Vender', 'Atender', 'Automatizar', 'Construir', 'Trabajo diario']);
  await expect(mega.locator('a.hd-prod')).toHaveCount(12);
  await expect(mega.locator('.hd-mega-note')).toContainText('Para equipos y para uso personal');
  await page.keyboard.press('Escape');
  const suite = page.locator('#productos .suite');
  await expect(suite.locator('.suite-group')).toHaveCount(5);
  await expect(suite.locator('.suite-row')).toHaveCount(12);
  await expect(suite.locator('.suite-audience')).toContainText('Para equipos y para uso personal');
  // Desde el sitio, Dashboard lleva al inicio (no a Link); desde una landing, a esa app.
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveAttribute('href', '/es/app');
  await page.goto('/es/products/notes', { waitUntil: 'networkidle' });
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveAttribute('href', '/es/app/notes');
});
