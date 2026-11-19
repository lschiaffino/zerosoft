import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: el aviso de importación arriba de la lista de chats. Mientras trae
 * mensajes muestra el avance; con todos los chats contados deja de decir
 * "importando mensajes"; al terminar avisa y se va solo; si está frenada lo
 * dice. En cualquier estado se cierra, y lo cerrado no vuelve al recargar.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

/** Un número falso conectado con un chat. Devuelve el id del número. */
async function seedLine(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Aviso ${uid()}` } });
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
      events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: `Persona ${uid()}`, providerMessageId: `ib-${uid()}`, body: 'Mensaje de prueba', timestamp: Date.now() }],
    },
  });
  expect(res.ok()).toBe(true);
  return id;
}

type Import = Record<string, unknown>;

/** La lista de chats real, con las importaciones que diga el test (la bandeja las lee de ahí). */
async function mockImports(page: Page, current: () => Import[]) {
  await page.route('**/api/groups/chats?*', async (route) => {
    if (route.request().method() !== 'GET' || route.request().url().includes('meta=0')) return route.continue();
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    const res = await route.fetch({ headers });
    const json = (await res.json()) as Record<string, unknown>;
    const out = { ...res.headers() };
    delete out.etag;
    await route.fulfill({ status: 200, headers: out, json: { ...json, imports: current() } });
  });
}

/**
 * Espera a que el aviso esté en ese estado. La bandeja vuelve a pedir la lista al volver a la ventana (y descarta un
 * segundo "volví" pegado al anterior): se le avisa hasta que la respuesta nueva llega a la pantalla.
 */
async function showing(page: Page, kind: string) {
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('lines-import-banner')).toHaveAttribute('data-kind', kind, { timeout: 1500 });
  }).toPass({ timeout: 30_000 });
}

// La línea elegida no queda puesta para las pruebas que siguen.
test.afterEach(async ({ request }) => {
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
});

test('Lines: el aviso de importación dice en qué anda, se va solo al terminar y lo cerrado no vuelve', async ({ page, request }) => {
  test.setTimeout(300_000);
  const numberId = await seedLine(request);
  // La línea elegida se guarda por persona y la bandeja solo avisa de las importaciones de esa línea: se elige la de esta prueba.
  await request.put('/api/groups/prefs', { data: { line: numberId } });
  const im = (patch: Import): Import => ({
    numberId,
    status: 'running',
    phase: 'messages',
    chatsTotal: 20,
    chatsDone: 7,
    messages: 140,
    perChat: 0,
    error: '',
    startedAt: '2026-11-19T10:00:00.000Z',
    finishedAt: null,
    idle: false,
    ...patch,
  });
  let current: Import[] = [im({})];
  await mockImports(page, () => current);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const banner = page.getByTestId('lines-import-banner');

  // Trayendo mensajes: avance con barra, y ya se puede cerrar.
  await expect(banner).toBeVisible({ timeout: 90_000 });
  await expect(banner).toHaveAttribute('data-kind', 'progress');
  await expect(banner.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35');
  await expect(banner.getByRole('button', { name: 'Close this notice' })).toBeVisible();

  // Todos los chats contados y la importación sigue (fotos y miembros): ya no es "importando mensajes: 20 de 20" con la barra llena.
  current = [im({ phase: 'pictures', chatsDone: 20 })];
  await showing(page, 'finishing');
  await expect(banner.getByRole('progressbar')).toHaveCount(0);
  await expect(banner).not.toContainText('20 of 20');

  // Terminó: lo dice y se va solo, sin tocar nada.
  current = [im({ status: 'done', phase: 'done', chatsDone: 20, finishedAt: new Date().toISOString() })];
  await showing(page, 'done');
  await expect(banner).toContainText('20 chats');
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
  // El servidor la sigue informando un rato: al recargar no vuelve.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.gr-rows')).toBeVisible({ timeout: 45_000 });
  await expect(banner).toHaveCount(0);

  // Otra importación de la misma línea avisa de nuevo. Está frenada (línea desconectada) con todo contado: lo dice.
  current = [im({ startedAt: '2026-11-19T11:00:00.000Z', phase: 'pictures', chatsDone: 20, error: 'not_connected' })];
  await showing(page, 'paused');
  await expect(banner.getByRole('progressbar')).toHaveCount(0);
  await expect(banner).toContainText('paused');
  // Se cierra con el teclado.
  const close = banner.getByRole('button', { name: 'Close this notice' });
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner).toHaveCount(0);
  // Y queda cerrado al recargar aunque siga frenada.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.gr-rows')).toBeVisible({ timeout: 45_000 });
  await expect(banner).toHaveCount(0);

  // En el teléfono: una que no avanza hace rato, sin scroll lateral.
  current = [im({ startedAt: '2026-11-19T12:00:00.000Z', idle: true })];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(banner).toHaveAttribute('data-kind', 'stalled', { timeout: 45_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await banner.getByRole('button', { name: 'Close this notice' }).boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(390);
});
