import { createClient } from '@libsql/client';
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
  // El ⌘K abierto desde "Buscar" del switcher devuelve el foco al botón del switcher.
  await expect(page.locator('.band-product')).toBeFocused();
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

test('Tareas del CRM: mías por defecto y todas con un clic', async ({ page }) => {
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  const block = page.getByTestId('home-crm-tasks');
  await expect(block.getByRole('link', { name: 'Mías' })).toHaveAttribute('aria-current', 'true');
  await block.getByRole('link', { name: 'Todas' }).click();
  await expect(page).toHaveURL(/\/es\/app\?tasks=all$/);
  await expect(page.getByTestId('home-crm-tasks').getByRole('link', { name: 'Todas' })).toHaveAttribute('aria-current', 'true');
});

test('sidebar del inicio: las apps de la última categoría entran en 900px', async ({ page }) => {
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  const line = page.locator('.side-line');
  for (const name of ['Docs', 'Notes', 'Cal']) {
    await expect(line.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
});

test('switcher en el teléfono: ←/→ cruzan entre columnas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  await page.locator('.band-product').click();
  const menu = page.getByRole('menu', { name: 'Cambiar de app' });
  const crm = menu.getByRole('menuitem', { name: 'CRM' });
  await expect(crm).toBeFocused();
  const before = (await crm.boundingBox())!;
  await page.keyboard.press('ArrowRight');
  const after = (await page.locator(':focus').boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 40);
  expect(Math.abs(after.y - before.y)).toBeLessThan(8);
  await page.keyboard.press('ArrowLeft');
  await expect(crm).toBeFocused();
});

test('Link: sin clics, el top link muestra un estado vacío', async ({ page }) => {
  await page.goto('/es/app/links/overview', { waitUntil: 'networkidle' });
  const card = page.locator('.stat-card').nth(3);
  // Con clics muestra el slug; sin clics, el vacío. Nunca un "0" suelto.
  await expect(card.locator('.stat-num')).not.toHaveText('0');
});

test('Link: copy de clics consistente y en pt el título coincide con el nav', async ({ page }) => {
  await page.goto('/es/app/links/overview', { waitUntil: 'networkidle' });
  await expect(page.locator('.stat-card').nth(1)).toContainText('Clics totales');
  await expect(page.getByText(/[Cc]licks/)).toHaveCount(0);
  await page.goto('/pt/app/links/overview', { waitUntil: 'networkidle' });
  const nav = (await page.locator('.side-line [aria-current="page"]').innerText()).trim();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(nav);
});

test('pie del sidebar: la ayuda se llama Ayuda (no Docs, que es una app)', async ({ page }) => {
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  const help = page.getByTestId('side-help');
  await expect(help).toHaveText('Ayuda');
  await expect(help).toHaveAttribute('href', '/es/docs');
});

test('con un equipo activo, el sidebar del inicio a 1280×900 deja ver Notes y el equipo va en el pie', async ({ page }) => {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const demo = String((await db.execute("SELECT id FROM users WHERE email = 'demo@zerosoft.ai'")).rows[0].id);
  const suffix = Math.random().toString(36).slice(2, 8);
  const boss = `ph-boss-${suffix}`;
  const team = `ph-team-${suffix}`;
  await db.execute({ sql: 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', args: [boss, `${boss}@test.local`, 'Boss'] });
  await db.execute({ sql: 'INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)', args: [team, 'Ventas Norte', boss] });
  await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', args: [team, boss, 'owner'] });
  await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', args: [team, demo, 'member'] });
  await db.execute({ sql: 'UPDATE users SET active_team_id = ? WHERE id = ?', args: [team, demo] });
  try {
    await page.goto('/es/app', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('side-team')).toHaveText('Equipo: Ventas Norte');
    const line = page.locator('.side-line');
    for (const name of ['Docs', 'Notes', 'Cal']) {
      await expect(line.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
  } finally {
    await db.execute({ sql: 'UPDATE users SET active_team_id = NULL WHERE id = ?', args: [demo] });
    db.close();
  }
});
