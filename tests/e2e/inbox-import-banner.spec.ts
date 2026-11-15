import { expect, test } from '@playwright/test';

/** Inbox: el avance de la importación aparece arriba de la lista, como en Lines, y al terminar se puede cerrar. */

const job = (status: string, chatsDone: number, finishedAt: string | null) => ({
  id: 'imp_e2e_banner',
  kind: 'whatsapp',
  status,
  sourceName: '',
  progress: { chats: 178, chatsDone, messages: 900 },
  error: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  finishedAt,
});

test('Inbox: avance de la importación en la lista y aviso final que se cierra', async ({ page }) => {
  let current = job('running', 82, null);
  await page.route('**/api/inbox/import', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { imports: [current], upload: { mode: 'server' } } }) : route.continue(),
  );
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('zs:inbox-import-seen'));
  const banner = page.getByTestId('inbox-import-banner');
  await expect(banner).toBeVisible({ timeout: 45_000 });
  await expect(banner.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '46');

  current = job('done', 178, new Date().toISOString());
  await expect(banner.getByRole('progressbar')).toHaveCount(0, { timeout: 15_000 });
  await banner.getByRole('button', { name: 'Close' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.ib-list')).toBeVisible();
  await expect(page.getByTestId('inbox-import-banner')).toHaveCount(0);

  // En el teléfono también.
  current = job('running', 10, null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('inbox-import-banner')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
