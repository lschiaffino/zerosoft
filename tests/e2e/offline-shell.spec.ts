import { expect, test, type Page } from '@playwright/test';

/**
 * Sin conexión, la app entera: con red se guardan solos los inicios de las
 * apps que andan sin red (aunque la persona no los haya abierto); sin red se
 * abren y se navega entre ellos, el selector marca las apps que necesitan
 * conexión y abrirlas muestra una página que lo explica (nunca el error del
 * navegador). Al volver la red esa página se recarga sola.
 */

const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** ¿El worker guardó esta ruta en la caché de vistas de la persona? */
function cached(page: Page, pathname: string) {
  return page.evaluate(async (p) => {
    for (const name of await caches.keys()) {
      if (!name.includes('-pages-')) continue;
      if (await (await caches.open(name)).match(location.origin + p, { ignoreSearch: true })) return true;
    }
    return false;
  }, pathname);
}

test.describe('Sin conexión: abrir la app y navegar', () => {
  test.skip(!process.env.CI && !process.env.E2E_SW, 'El service worker solo se registra con el build de producción (CI=1) o NEXT_PUBLIC_SW_DEV=1 (E2E_SW=1).');
  test.setTimeout(300_000);

  test('los inicios de las apps sin red se guardan solos y las demás dicen que necesitan conexión', async ({ page, context }) => {
    // En un navegador automatizado los inicios se guardan solo si el test lo pide.
    await context.addInitScript(() => localStorage.setItem('zs-e2e-warm-roots', '1'));
    await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload({ waitUntil: 'networkidle' });
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // Track nunca se abrió en este navegador: igual queda guardado (y el inicio de la plataforma).
    await expect.poll(() => cached(page, '/en/app/track'), { timeout: 120_000 }).toBe(true);
    await expect.poll(() => cached(page, '/en/app'), { timeout: 120_000 }).toBe(true);

    await context.setOffline(true);
    await page.goto('/en/app/track');
    await expect(page.locator('main[data-zs-offline]')).toHaveCount(0);
    await expect(page.getByTestId('offline-status')).toContainText('Offline', { timeout: 20_000 });

    // El selector de apps: las que necesitan conexión, marcadas.
    await page.locator('.band-product').click();
    await expect(page.getByTestId('switcher-offline-hint')).toBeVisible();
    await expect(page.locator('.band-switcher-panel [data-needs-network][href*="/app/talk"]')).toHaveCount(1);
    await expect(page.locator('.band-switcher-panel [data-needs-network][href$="/app/docs"]')).toHaveCount(0);
    await shot(page, 'offline-switcher');
    await page.keyboard.press('Escape');

    // Una app que necesita conexión (Talk; Lines e Inbox ya andan sin red): la página que lo explica, con las que sí andan.
    await page.goto('/en/app/talk');
    const offline = page.locator('main[data-zs-offline="online-only"]');
    await expect(offline).toContainText('Talk needs a connection');
    await expect(offline.locator('a[data-app="docs"]')).toBeVisible();
    await shot(page, 'offline-online-only');

    // Desde ahí, a una app que anda sin red.
    await offline.locator('a[data-app="docs"]').click();
    await expect(page).toHaveURL(/\/en\/app\/docs/);
    await expect(page.locator('main[data-zs-offline]')).toHaveCount(0);

    // Al volver la red, la página "necesita conexión" se recarga sola con la app.
    await page.goto('/en/app/talk');
    await expect(page.locator('main[data-zs-offline="online-only"]')).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('main[data-zs-offline]')).toHaveCount(0, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/en\/app\/talk/);
  });
});
