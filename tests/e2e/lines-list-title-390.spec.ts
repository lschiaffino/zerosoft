import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lines a 390 px: el título de la lista ("Caixa de entrada", "Bandeja",
 * "Inbox") se lee entero al lado del selector de línea; lo que se corta es el
 * selector. En los tres idiomas, sin scroll de costado. Línea con el WhatsApp falso.
 */

async function fakeLine(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Titulo ${Math.random().toString(36).slice(2, 8)}` } });
  expect(created.ok()).toBe(true);
}

test('Lines: a 390 px el título de la lista no se corta', async ({ page, request }) => {
  await fakeLine(request);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of ['pt', 'es', 'en']) {
    await page.goto(`/${locale}/app/lines/inbox`, { waitUntil: 'networkidle' });
    const bar = page.locator('.gr-list-titlebar');
    const title = bar.getByRole('heading', { level: 1 });
    await expect(title).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('lines-line-select')).toBeVisible();
    // Sin texto escondido: el ancho del título alcanza para todo lo que dice.
    expect(await title.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
});
