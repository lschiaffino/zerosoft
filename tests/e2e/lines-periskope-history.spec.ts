import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines › Ajustes › Migrar de Periskope › Historial de mensajes, con la cuenta
 * simulada (GROUPS_PERISKOPE_FAKE): clave rechazada, correr en segundo plano
 * con progreso, repetir sin duplicar, y 390 oscuro sin scroll horizontal.
 * Datos inventados; nada sale a internet.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function seedChat(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Hist ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: 'Hist', providerMessageId: `hist-${uid()}`, body: 'hola', timestamp: Date.now() }],
    },
  });
  expect(res.ok()).toBe(true);
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function start(page: Page, key: string) {
  await page.getByTestId('periskope-history-key').fill(key);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/groups/periskope') && r.request().method() === 'POST'),
    page.getByTestId('periskope-history-start').click(),
  ]);
}

test('historial: clave rechazada, corre en segundo plano, y repetir no duplica', async ({ page, request }) => {
  test.slow();
  await seedChat(request);
  await page.goto('/en/app/lines/settings?tab=migrate', { waitUntil: 'networkidle' });
  const panel = page.getByTestId('periskope-history');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('periskope-history-key')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('periskope-history-start')).toBeDisabled();

  await start(page, 'invalid-key');
  await expect(panel.getByRole('alert')).toBeVisible();

  const key = `hist-${uid()}`;
  await start(page, key);
  const status = page.getByTestId('periskope-history-status');
  await expect(status).toHaveAttribute('data-status', 'done', { timeout: 90_000 });
  // Un chat con 4 mensajes simulados (uno puede ser el de WhatsApp): al menos 3 nuevos.
  await expect(status).toHaveAttribute('data-messages', /^[3-9]|\d{2,}$/);
  await expect(status).not.toContainText('periskope.app');
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // La misma cuenta otra vez: nada nuevo.
  await start(page, key);
  await expect(status).toHaveAttribute('data-status', 'done', { timeout: 90_000 });
  await expect(status).toHaveAttribute('data-messages', '0');

  // 390 oscuro, sin scroll horizontal y con el botón tocable.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(panel).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const box = await page.getByTestId('periskope-history-start').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
});
