import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lines: la tabla de Ajustes › Números. Cada línea muestra su estado y desde
 * cuándo, la hora de su último mensaje (sin contenido) y sus chats abiertos.
 * En el teléfono las filas se apilan sin scroll lateral. Proveedor falso
 * (GROUPS_FAKE=1), nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

/** Una línea conectada con dos chats nuevos. */
async function lineWithChats(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Tabla ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  for (const p of [phone(), phone()]) {
    const res = await request.post(new URL(webhookUrl).pathname, {
      data: { events: [{ type: 'message', chatId: `${p}@c.us`, isGroup: false, fromMe: false, senderPhone: p, senderName: 'Contacto Demo', providerMessageId: `e2e-nt-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  return id;
}

test('la tabla de Números muestra estado y desde cuándo, último mensaje y chats abiertos', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const id = await lineWithChats(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });

  const table = page.getByTestId('numbers-table');
  await expect(table.getByRole('columnheader')).toHaveCount(5);
  const line = page.locator(`[data-number-id="${id}"]`);
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line.getByTestId('line-status').locator('.badge-ok')).toBeVisible();
  await expect(line.getByTestId('line-status-since')).not.toBeEmpty();
  const last = line.getByTestId('line-last-message').locator('time');
  await expect(last).toBeVisible();
  // Una hora válida de hoy (no el contenido del mensaje).
  const at = await last.getAttribute('datetime');
  expect(Math.abs(Date.now() - new Date(at!).getTime())).toBeLessThan(10 * 60_000);
  await expect(line.getByTestId('line-open-chats')).toHaveText('2');
  // Las acciones siguen en la fila de la línea.
  await expect(line.getByTestId('line-connect-btn')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a 390 px la tabla de Números pasa a filas apiladas sin scroll lateral', async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = await lineWithChats(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
  const line = page.locator(`[data-number-id="${id}"]`);
  await line.scrollIntoViewIfNeeded();
  await expect(line.getByTestId('line-open-chats')).toHaveText('2', { timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Apiladas: cada dato va debajo del nombre, no al lado.
  const name = (await line.getByTestId('line-name').boundingBox())!;
  const status = (await line.getByTestId('line-status').boundingBox())!;
  const chats = (await line.getByTestId('line-open-chats').boundingBox())!;
  expect(status.y).toBeGreaterThan(name.y);
  expect(chats.y).toBeGreaterThan(status.y);
  const box = (await page.getByTestId('numbers-table').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
