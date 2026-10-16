import { expect, test } from '@playwright/test';

/**
 * Cada pantalla del dashboard carga sin errores de JS en el navegador
 * (hidratación, React, excepciones). Corre en DEMO_MODE con datos de seed.
 */
const SCREENS = [
  '/en',
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

test('"+ Nuevo" crea: la tarea de CRM abre el composer y Docs crea una página', async ({ page }) => {
  await page.goto('/en/app/crm/tasks?new=1', { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Subject').first()).toBeVisible();
  await expect(page).not.toHaveURL(/new=1/);

  await page.goto('/en/app/docs?new=1');
  await page.waitForURL(/\/en\/app\/docs\/[^/?#]+$/);
});
