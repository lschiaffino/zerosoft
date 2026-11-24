import { expect, test, type Locator } from '@playwright/test';

/**
 * Lines e Inbox: las pestañas de filtro arriba de la lista se deslizan de
 * costado. El borde con más pestañas para ver se esfuma (data-more-right /
 * data-more-left + mask-image), así la pestaña cortada no parece texto roto.
 * Al llegar al final se esfuma el otro lado.
 */

async function checkFade(row: Locator) {
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
  await expect(row).toHaveAttribute('data-more-right', '');
  await expect(row).not.toHaveAttribute('data-more-left', /.*/);
  expect(await row.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)).toContain('gradient');
  await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(row).toHaveAttribute('data-more-left', '');
  await expect(row).not.toHaveAttribute('data-more-right', /.*/);
}

test('Inbox: las pestañas de filtro esfuman el borde con más para ver', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('nav.ib-tabs');
  // Angosto a propósito: en 1280 la columna de la lista no entra todas las pestañas.
  await row.evaluate((el) => ((el as HTMLElement).style.maxWidth = '220px'));
  await checkFade(row);
});

test('Lines: las pestañas de filtro esfuman el borde con más para ver', async ({ page, request }) => {
  // Con la bandeja vacía no hay pestañas: un chat de prueba en una línea falsa.
  const uid = Math.random().toString(36).slice(2, 8);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${uid}` } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const chatId = `549${Date.now().toString().slice(-9)}1@c.us`;
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: `Pestañas ${uid}`, providerMessageId: `tf-${uid}`, body: 'hola' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-filters[role="tablist"]');
  await row.evaluate((el) => ((el as HTMLElement).style.maxWidth = '220px'));
  await checkFade(row);
  // Las pestañas se ensanchan sin que cambie la caja de la fila (la letra de la app llega tarde): el borde
  // derecho vuelve a esfumarse en vez de quedar una pestaña cortada.
  await row.evaluate((el) => el.querySelectorAll<HTMLElement>('.gr-filter').forEach((b) => (b.style.letterSpacing = '4px')));
  await expect(row).toHaveAttribute('data-more-right', '');
});
