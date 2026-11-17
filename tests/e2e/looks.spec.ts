import { expect, test, type Page } from '@playwright/test';

/**
 * Aspecto de la interfaz (lib/look.ts): Ajustes › Apariencia cambia
 * <html data-look> al momento, lo guarda en la cuenta (users.ui_look) y en la
 * cookie zs_look. Current es el default y no cambia nada: la pantalla con
 * current es idéntica, píxel a píxel, a la misma sin el atributo. El selector
 * se usa con el teclado y en el teléfono. Una muestra de apps carga sin
 * errores en cada aspecto; el sitio público queda siempre en current.
 */

test.describe.configure({ mode: 'serial' });

type LookName = 'current' | 'lines' | 'classic' | 'liquid' | 'retro';

async function setLook(page: Page, look: LookName) {
  const res = await page.request.put('/api/profile/look', { data: { look } });
  expect(res.ok()).toBe(true);
}

const lookCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'zs_look')?.value;

test.afterAll(async ({ request }) => {
  // El usuario demo es compartido: vuelve al aspecto por defecto.
  await request.put('/api/profile/look', { data: { look: 'current' } });
});

test('current es el default y no cambia ni un píxel', async ({ page }) => {
  await setLook(page, 'current');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-look', 'current');
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' });
  const withLook = await page.screenshot();
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  const without = await page.screenshot();
  expect(withLook.equals(without)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--radius-1').trim())).toBe('3px');
});

test('el selector se usa con el teclado, aplica al momento y se guarda en la cuenta', async ({ page, context }) => {
  await setLook(page, 'current');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
  const html = page.locator('html');
  await expect(page.getByTestId('look-current')).toBeChecked();

  await page.getByTestId('look-current').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('look-lines')).toBeChecked();
  await expect(page.getByTestId('look-lines')).toBeFocused();
  await expect(html).toHaveAttribute('data-look', 'lines');
  await expect(page.getByTestId('appearance-look-status')).not.toBeEmpty();
  await page.keyboard.press('ArrowRight');
  await expect(html).toHaveAttribute('data-look', 'classic');
  await expect(page.getByTestId('appearance-look-status')).not.toBeEmpty();
  await expect.poll(() => lookCookie(page)).toBe('classic');
  expect((await (await page.request.get('/api/profile/look')).json()).look).toBe('classic');

  // Recargar lo conserva; sin la cookie (otro navegador), la cuenta manda antes de pintar.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-look', 'classic');
  await context.clearCookies({ name: 'zs_look' });
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-look', 'classic');
  expect(await lookCookie(page)).toBe('classic');

  // El sitio público no cambia de aspecto.
  await page.goto('/en', { waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-look', 'current');
});

test('en el teléfono: opciones de 40px o más, sin scroll de costado, y se elige tocando', async ({ page }) => {
  await setLook(page, 'current');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
  const options = page.getByTestId('appearance-look').locator('label');
  await expect(options).toHaveCount(5);
  for (const box of await options.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.right).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByTestId('appearance-look').locator('label[for="look-retro"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-look', 'retro');
  await expect(page.getByTestId('look-retro')).toBeChecked();
});

test('la API rechaza un aspecto desconocido', async ({ page }) => {
  const res = await page.request.put('/api/profile/look', { data: { look: 'neon' } });
  expect(res.status()).toBe(400);
});

const SAMPLE = ['/en/app/inbox', '/en/app/lines', '/en/app/docs', '/en/app/crm/contacts'];
const CMDK_RADIUS: Record<LookName, string> = { current: '3px', lines: '2px', classic: '14px', liquid: '22px', retro: '0px' };

for (const look of ['current', 'lines', 'classic', 'liquid', 'retro'] as const) {
  test(`muestra de apps en ${look}: atributo, esquinas de ⌘K y sin errores`, async ({ page }) => {
    test.setTimeout(120_000);
    await setLook(page, look);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${page.url()} ${e.message}`));
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of SAMPLE) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      await expect(page.locator('.app-frame')).toBeVisible();
    }
    await page.keyboard.press('ControlOrMeta+k');
    const cmdk = page.locator('.cmdk');
    // ⌘K carga su parte la primera vez: se espera a que aparezca.
    await expect(cmdk).toBeVisible({ timeout: 20_000 });
    expect(await cmdk.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe(CMDK_RADIUS[look]);
    expect(errors).toEqual([]);
  });
}
