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
  '/en/app/calendar',
  '/en/app/calendar/settings',
  '/en/app/calendar/event-types',
  '/en/app/chat',
  '/en/app/docs',
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
