import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Teléfono, como WhatsApp: al abrirse el teclado el chat queda del alto que se ve, con los últimos
 * mensajes a la vista (components/app/KeyboardViewport.tsx). El teclado se simula con un
 * visualViewport falso (Chromium de escritorio no tiene teclado en pantalla).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeLine(request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return info.webhookUrl;
}

test('Lines en el teléfono: con el teclado abierto el chat entra en lo que se ve y sigue al final', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  // visualViewport falso: alto controlable desde el test.
  await page.addInitScript(() => {
    const target = new EventTarget() as EventTarget & { height: number; width: number; offsetTop: number; scale: number };
    target.height = window.innerHeight;
    target.width = window.innerWidth;
    target.offsetTop = 0;
    target.scale = 1;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => target });
    (window as unknown as { __kb: (h: number) => void }).__kb = (h: number) => {
      target.height = h;
      target.dispatchEvent(new Event('resize'));
    };
  });
  const tag = uid();
  const url = await fakeLine(request, `Teclado ${tag}`);
  const chatId = `54911${Math.floor(Math.random() * 1e7)}@c.us`;
  for (let i = 0; i < 15; i++) {
    await request.post(new URL(url).pathname, {
      data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: '5491155550000', senderName: `Tecla ${tag}`, providerMessageId: `kb-${tag}-${i}`, body: `mensaje ${i}` }] },
    });
  }
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('[data-chat-row]', { hasText: `Tecla ${tag}` }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  const box = page.locator('.wa-messages');
  // exact: con la hora pegada, la burbuja de "mensaje 1" a las 4:xx también dice "mensaje 14:xx".
  await expect(box.getByText('mensaje 14', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Con muchos sin leer abre en el separador (como WhatsApp): se baja al final antes de abrir el teclado.
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => box.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  // Se abre el teclado: quedan 450 px visibles.
  await page.evaluate(() => (window as unknown as { __kb: (h: number) => void }).__kb(450));
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh'))).toBe('450px');
  const inbox = await page.locator('.gr-inbox').boundingBox();
  expect(inbox!.y + inbox!.height).toBeLessThanOrEqual(452);
  // El campo queda a la vista, pegado arriba del teclado, y el último mensaje sigue visible.
  const field = await page.locator('textarea.gr-input').boundingBox();
  expect(field!.y + field!.height).toBeLessThanOrEqual(452);
  await expect.poll(() => box.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);

  // Se cierra: vuelve al alto completo.
  await page.evaluate(() => (window as unknown as { __kb: (h: number) => void }).__kb(800));
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh'))).toBe('');
});
