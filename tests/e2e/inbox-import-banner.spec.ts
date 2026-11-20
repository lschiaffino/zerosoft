import { expect, test } from '@playwright/test';

/**
 * Inbox: el avance de la importación aparece arriba de la lista, como en Lines.
 * Al terminar avisa y se va solo; si está frenada lo dice; en cualquier estado
 * se cierra y lo cerrado no vuelve al recargar.
 */

const job = (id: string, status: string, chatsDone: number, finishedAt: string | null, error = '') => ({
  id,
  kind: 'whatsapp',
  status,
  sourceName: '',
  progress: { chats: 178, chatsDone, messages: 900 },
  error,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  finishedAt,
  idle: false,
});

test('Inbox: avance de la importación en la lista; al terminar se va solo; una frenada se cierra y no vuelve', async ({ page }) => {
  test.setTimeout(120_000);
  let current = [job('imp_e2e_banner', 'running', 82, null)];
  await page.route('**/api/inbox/import', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { imports: current, upload: { mode: 'server' } } }) : route.continue(),
  );
  const read = () => page.waitForResponse((r) => r.url().endsWith('/api/inbox/import') && r.request().method() === 'GET', { timeout: 45_000 });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const banner = page.getByTestId('inbox-import-banner');
  await expect(banner).toBeVisible({ timeout: 45_000 });
  await expect(banner).toHaveAttribute('data-kind', 'progress');
  await expect(banner.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '46');
  // Mientras corre también se puede cerrar.
  await expect(banner.getByRole('button', { name: 'Close this notice' })).toBeVisible();

  // Terminó: lo dice y se va solo, sin tocar nada.
  current = [job('imp_e2e_banner', 'done', 178, new Date().toISOString())];
  await expect(banner).toHaveAttribute('data-kind', 'done', { timeout: 15_000 });
  await expect(banner).toContainText('178 chats');
  await expect(banner.getByRole('progressbar')).toHaveCount(0);
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
  // Tras recargar no vuelve aunque la lista de importaciones lo traiga.
  // Se espera esa respuesta (no la lista de chats, que depende de lo que haya en la base).
  let got = read();
  await page.reload({ waitUntil: 'networkidle' });
  await got;
  await expect(page.locator('.ib-list-pane')).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Otra importación, frenada con todos los chats contados (WhatsApp desconectado): lo dice, sin barra llena.
  current = [job('imp_e2e_banner_2', 'waiting', 178, null, 'not_connected')];
  got = read();
  await page.reload({ waitUntil: 'networkidle' });
  await got;
  await expect(banner).toHaveAttribute('data-kind', 'paused', { timeout: 45_000 });
  await expect(banner.getByRole('progressbar')).toHaveCount(0);
  await expect(banner).not.toContainText('178 of 178');
  // Se cierra con el teclado y queda cerrado al recargar.
  const close = banner.getByRole('button', { name: 'Close this notice' });
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner).toHaveCount(0);
  got = read();
  await page.reload({ waitUntil: 'networkidle' });
  await got;
  await expect(page.locator('.ib-list-pane')).toBeVisible();
  await expect(banner).toHaveCount(0);

  // En el teléfono: una que se cortó, sin scroll lateral.
  current = [job('imp_e2e_banner_3', 'failed', 60, new Date().toISOString(), 'whatsapp_unreachable')];
  await page.setViewportSize({ width: 390, height: 844 });
  got = read();
  await page.reload({ waitUntil: 'networkidle' });
  await got;
  await expect(banner).toHaveAttribute('data-kind', 'failed', { timeout: 45_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
