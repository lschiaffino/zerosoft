import { expect, test } from '@playwright/test';

/**
 * Ajustes globales: pestañas Cuenta / Workspace / Admin, webhooks con eventos
 * agrupados, API keys con permisos en Avanzado y el kanban del roadmap con
 * panel de edición accesible. DEMO_MODE; ADMIN_EMAILS incluye al usuario demo
 * (playwright.config.ts).
 */

test('las secciones de Ajustes son rutas y marcan la activa', async ({ page }) => {
  await page.goto('/es/app/settings', { waitUntil: 'networkidle' });
  const tabs = page.getByRole('navigation', { name: 'Ajustes' });
  await expect(tabs.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Perfil' })).toBeVisible();

  await tabs.getByRole('link', { name: 'API y webhooks' }).click();
  await expect(page).toHaveURL(/\/es\/app\/settings\/api$/);
  await expect(tabs.getByRole('link', { name: 'API y webhooks' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();

  await tabs.getByRole('link', { name: 'Conexiones' }).click();
  await expect(page).toHaveURL(/\/es\/app\/settings\/connections$/);
  await expect(page.getByRole('heading', { name: 'Credenciales', exact: true })).toBeVisible();

  await page.goto('/es/app/settings/roadmap', { waitUntil: 'networkidle' });
  await expect(tabs.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Administración' }).getByRole('link', { name: 'Roadmap' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('webhooks: el checkbox del grupo elige sus eventos y queda indeterminado si faltan', async ({ page }) => {
  await page.goto('/es/app/settings/api', { waitUntil: 'networkidle' });
  const deals = page.getByRole('group', { name: 'Deals' });
  const groupBox = deals.getByRole('checkbox', { name: 'Deals', exact: true });
  await groupBox.check();
  await expect(groupBox).toBeChecked();
  await expect(deals.locator('.st-event-list input:checked')).toHaveCount(7);
  await expect(page.getByText('7 elegidos')).toBeVisible();

  await deals.getByRole('checkbox', { name: 'Deal ganado' }).uncheck();
  await expect(groupBox).not.toBeChecked();
  expect(await groupBox.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
  await expect(page.getByText('6 elegidos')).toBeVisible();
});

test('API keys: crear con el camino corto muestra la key una vez y la suma a la tabla', async ({ page }) => {
  await page.goto('/es/app/settings/api', { waitUntil: 'networkidle' });
  await expect(page.getByRole('region', { name: 'Permisos' })).toBeHidden();
  await page.getByLabel('Nombre de la key').fill('e2e ajustes');
  await page.getByRole('button', { name: 'Crear key' }).click();
  await expect(page.getByText('Tu nueva API key')).toBeVisible();
  await expect(page.locator('.st-secret').first()).toHaveText(/^zs_/);
  await expect(page.getByRole('cell', { name: 'e2e ajustes' }).first()).toBeVisible();
});

test('roadmap: la tarjeta abre el panel de edición y Esc lo cierra devolviendo el foco', async ({ page }) => {
  await page.goto('/es/app/settings/roadmap', { waitUntil: 'networkidle' });
  await expect(page.locator('dialog.st-kb-drawer')).toBeHidden();
  await page.getByLabel('Título de un ítem nuevo').fill('Ítem e2e de ajustes');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  const card = page.getByRole('button', { name: /Ítem e2e de ajustes/ });
  await expect(card).toBeVisible();
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Editar ítem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Título')).toHaveValue('Ítem e2e de ajustes');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(card).toBeFocused();
});
