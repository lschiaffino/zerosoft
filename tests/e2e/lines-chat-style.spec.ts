import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines comparte con Inbox el estilo de chats (WhatsApp o zerosoft): se
 * elige en Ajustes › Estilo de chats, se guarda por persona y la bandeja lo
 * pone en data-chat-style. Claro y oscuro, 1280 y 390.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const uid = () => Math.random().toString(36).slice(2, 8);

/** Un número falso conectado, con un chat que manda un link. Devuelve el nombre del chat. */
async function chatWithLink(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Estilo ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Nora ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `ln-${uid()}`, body: 'Mirá esto https://example.test/nota', timestamp: new Date().toISOString() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  return name;
}

test('Lines: estilo de chats WhatsApp o zerosoft desde Ajustes, compartido con Inbox, y vista previa de links', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp' } });
  const name = await chatWithLink(request);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  // La vista previa la lee el servidor (lector falso en e2e).
  await expect(page.locator('.wa-linkcard', { hasText: 'example.test page' })).toBeVisible({ timeout: 45_000 });
  await page.goto('/en/app/lines/settings?tab=appearance', { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: /zerosoft/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await expect(page.locator('.gr-inbox')).toHaveAttribute('data-chat-style', 'zerosoft');
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
  }
  // El mismo ajuste vale en Inbox.
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-app')).toHaveAttribute('data-chat-style', 'zerosoft');
  await request.put('/api/chat-style', { data: { style: 'whatsapp' } });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-inbox')).toHaveAttribute('data-chat-style', 'whatsapp');
  expect(errors, errors.join('\n')).toEqual([]);
});
