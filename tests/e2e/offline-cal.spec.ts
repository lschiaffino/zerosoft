import { expect, test, type Page } from '@playwright/test';

/**
 * Cal sin conexión, en solo lectura: una vista ya abierta se abre sin red con
 * lo último que se cargó, un aviso lo dice y lo que edita queda deshabilitado.
 * Al volver la red se puede editar de nuevo.
 */

const SHOTS = process.env.E2E_SHOTS_DIR;

async function openAndCache(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) {
          if (!name.includes('-pages-')) continue;
          if (await (await caches.open(name)).match(location.origin + location.pathname, { ignoreSearch: true })) return true;
        }
        return false;
      }),
    )
    .toBe(true);
}

test.describe('Sin conexión: Cal en solo lectura', () => {
  test('sin red aparece el aviso y lo que edita queda deshabilitado; con red vuelve', async ({ page, context }) => {
    await page.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    const scope = page.getByTestId('cal-scope');
    await expect(scope).toBeVisible();
    await expect(page.getByTestId('cal-offline-banner')).toHaveCount(0);
    const firstButton = scope.getByRole('button').first();
    await expect(firstButton).toBeEnabled();

    await context.setOffline(true);
    await expect(page.getByTestId('cal-offline-banner')).toBeVisible();
    await expect(scope).toHaveAttribute('data-readonly', 'true');
    await expect(firstButton).toBeDisabled();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-cal-live.png` });

    await context.setOffline(false);
    await expect(page.getByTestId('cal-offline-banner')).toHaveCount(0);
    await expect(firstButton).toBeEnabled();
  });

  test('una vista ya abierta se abre sin red, en solo lectura', async ({ page, context }) => {
    test.skip(!process.env.CI && !process.env.E2E_SW, 'El service worker solo se registra con el build de producción (CI=1) o NEXT_PUBLIC_SW_DEV=1 (E2E_SW=1).');
    test.setTimeout(180_000);
    await openAndCache(page, '/en/app/calendar/bookings');

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('main[data-zs-offline]')).toHaveCount(0);
    await expect(page.getByTestId('cal-offline-banner')).toBeVisible();
    await expect(page.getByTestId('cal-scope')).toHaveAttribute('data-readonly', 'true');
    await expect(page.getByTestId('offline-status')).toBeVisible({ timeout: 20_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-cal-reload.png` });

    await context.setOffline(false);
    await expect(page.getByTestId('cal-offline-banner')).toHaveCount(0);
  });
});
