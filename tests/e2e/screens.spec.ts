import { expect, test } from '@playwright/test';

/**
 * Cada pantalla del dashboard carga sin errores de JS en el navegador
 * (hidratación, React, excepciones). Corre en DEMO_MODE con datos de seed.
 */
const SCREENS = [
  '/en',
  '/en/app',
  '/es/products',
  '/en/blog',
  '/en/docs',
  '/en/app/links',
  '/en/app/links/bio',
  '/en/app/links/bulk',
  '/en/app/links/analytics',
  '/en/app/settings',
  '/en/app/crm',
  '/en/app/crm/contacts',
  '/en/app/crm/companies',
  '/en/app/crm/deals',
  '/en/app/crm/tasks',
  '/en/app/crm/reports',
  '/en/app/crm/settings',
  '/en/app/track',
  '/en/app/track/issues',
  '/en/app/track/my-tasks',
  '/en/app/track/projects',
  '/en/app/calendar',
  '/en/app/calendar/settings',
  '/en/app/calendar/event-types',
  '/en/app/calendar/bookings',
  '/en/app/calendar/availability',
  '/en/app/calendar/routing',
  '/en/app/chat',
  '/en/app/chat/widgets',
  '/en/app/docs',
  '/en/app/notes/clip',
  '/en/app/robots/recorder',
];

for (const path of SCREENS) {
  test(`pantalla sin errores: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(msg.text());
    });
    const res = await page.goto(path, { waitUntil: 'networkidle' });
    expect(res?.status(), path).toBeLessThan(400);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('el sidebar tiene Ajustes globales en el pie y el colapsar traducido', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  const settings = page.getByTestId('side-settings');
  await expect(settings).toHaveAttribute('href', /\/es\/app\/settings$/);
  await expect(page.locator('.side-handle')).toHaveAttribute('aria-label', 'Contraer barra lateral');
});

test('el shell: banda con switcher de líneas y la estación activa marcada', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/es/app/crm/contacts', { waitUntil: 'networkidle' });
  const active = page.locator('.side-line [aria-current="page"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute('href', /\/es\/app\/crm\/contacts$/);
  await page.locator('.band-product').click();
  await expect(page.getByRole('menuitem')).toHaveCount(11);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(page.locator('.band-product')).toBeFocused();
});

test('mobile: el sidebar es un drawer que cierra con Esc', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  await expect(page.locator('#app-side')).toBeHidden();
  await page.locator('.band-menu').click();
  await expect(page.locator('#app-side')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-side')).toBeHidden();
});

test('"+ Nuevo" crea: la tarea de CRM abre el composer y Docs crea una página', async ({ page }) => {
  await page.goto('/en/app/crm/tasks?new=1', { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Subject').first()).toBeVisible();
  await expect(page).not.toHaveURL(/new=1/);

  await page.goto('/en/app/docs?new=1');
  await page.waitForURL(/\/en\/app\/docs\/[^/?#]+$/);
});
