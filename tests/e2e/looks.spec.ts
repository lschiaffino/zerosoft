import { expect, test, type Page } from '@playwright/test';

/**
 * Aspecto de la interfaz (lib/look.ts): Ajustes › Apariencia cambia
 * <html data-look> al momento, lo guarda en la cuenta (users.look) y en la
 * cookie zs_look, y cada aspecto cambia los tokens (esquinas, sombra de los
 * menús). Una muestra de pantallas por app carga sin errores en cada aspecto.
 * Classic es el default; el sitio público queda siempre en lines.
 */

test.describe.configure({ mode: 'serial' });

const radius = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--radius-1').trim());

async function setLook(page: Page, look: 'lines' | 'classic' | 'liquid' | 'retro') {
  const res = await page.request.put('/api/profile/look', { data: { look } });
  expect(res.ok()).toBe(true);
}

test.afterAll(async ({ request }) => {
  // El usuario demo es compartido: vuelve al aspecto por defecto.
  await request.put('/api/profile/look', { data: { look: 'classic' } });
});

test('Apariencia: el selector cambia el aspecto al momento y lo guarda', async ({ page, context }) => {
  await setLook(page, 'lines');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-look', 'lines');
  expect(await radius(page)).toBe('3px');

  const group = page.getByTestId('appearance-look');
  await group.locator('label[for="look-classic"]').click();
  await expect(html).toHaveAttribute('data-look', 'classic');
  await expect(page.getByTestId('look-classic')).toBeChecked();
  expect(await radius(page)).toBe('6px');
  await expect(page.getByTestId('appearance-look-status')).not.toBeEmpty();
  expect((await context.cookies()).find((c) => c.name === 'zs_look')?.value).toBe('classic');

  // La cuenta manda: sin la cookie (otro navegador), la app vuelve a classic antes de pintar.
  await context.clearCookies({ name: 'zs_look' });
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-look', 'classic');
  expect((await context.cookies()).find((c) => c.name === 'zs_look')?.value).toBe('classic');

  await page.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
  await group.locator('label[for="look-liquid"]').click();
  await expect(html).toHaveAttribute('data-look', 'liquid');
  expect(await radius(page)).toBe('10px');
  const body = await page.request.get('/api/profile/look');
  expect((await body.json()).look).toBe('liquid');

  // El sitio público no cambia de aspecto.
  await page.goto('/en', { waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-look', 'lines');
  expect(await radius(page)).toBe('3px');
});

test('la API rechaza un aspecto desconocido', async ({ page }) => {
  const res = await page.request.put('/api/profile/look', { data: { look: 'neon' } });
  expect(res.status()).toBe(400);
});

const SAMPLE = ['/en/app', '/en/app/crm/contacts', '/en/app/track', '/en/app/docs', '/en/app/calendar', '/en/app/lines', '/en/app/inbox', '/en/app/links', '/en/app/notes', '/en/app/board'];

for (const look of ['lines', 'liquid', 'retro', 'classic'] as const) {
  test(`muestra de apps en ${look}: atributo, tokens y sin errores`, async ({ page }) => {
    test.setTimeout(180_000);
    await setLook(page, look);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${page.url()} ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR/i.test(m.text())) errors.push(`${page.url()} ${m.text()}`);
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of SAMPLE) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      await expect(page.locator('.app-frame')).toBeVisible();
    }
    // ⌘K abre con las esquinas del aspecto.
    await page.goto('/en/app', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    const cmdk = page.locator('.cmdk');
    await expect(cmdk).toBeVisible();
    const r = await cmdk.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(r).toBe({ lines: '3px', classic: '14px', liquid: '22px', retro: '0px' }[look]);
    expect(errors).toEqual([]);
  });
}
