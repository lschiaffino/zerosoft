import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: color por línea. Se elige en Ajustes › Números y la bandeja muestra
 * un punto de ese color en la fila del chat (uno por línea si el chat está en
 * varias). Proveedor falso (GROUPS_FAKE=1), nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext, name: string): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

async function groupMessage(request: APIRequestContext, n: NumberInfo, gid: string, chatName: string, providerMessageId: string) {
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: '5491100009999', senderName: 'Contacto Demo', providerMessageId, body: 'hola', chatName, timestamp: new Date().toISOString() },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Dos líneas con el mismo grupo. */
async function twoLines(request: APIRequestContext) {
  const tag = uid();
  const a = await fakeNumber(request, `Ventas ${tag}`);
  const b = await fakeNumber(request, `Soporte ${tag}`);
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const groupName = `Grupo ${tag}`;
  await groupMessage(request, a, gid, groupName, `e2e-lc-${tag}`);
  await groupMessage(request, b, gid, groupName, `e2e-lc-${tag}`);
  return { a, b, groupName };
}

/** Elige el color número `i` de la paleta (0 = sin color) en la fila de la línea. */
async function pickColor(page: Page, numberId: string, i: number) {
  const row = page.locator(`[data-number-id="${numberId}"]`);
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/groups/numbers/${numberId}`) && r.request().method() === 'PATCH');
  const list = page.getByRole('listbox');
  // El clic puede caer antes de que la página termine de hidratar: se repite hasta que abre la lista.
  await expect(async () => {
    if (!(await list.isVisible())) await row.getByTestId('line-color-select').click();
    await expect(list).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await list.getByRole('option').nth(i).click();
  expect((await saved).ok()).toBe(true);
  await expect(list).toHaveCount(0);
}

function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('elegir el color de cada línea lo muestra como punto en la fila del chat', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const w = await twoLines(request);

  await page.goto(`/en/app/lines/settings?tab=numbers`, { waitUntil: 'networkidle' });
  const rowA = page.locator(`[data-number-id="${w.a.id}"]`);
  await expect(rowA).toBeVisible({ timeout: 30_000 });
  await pickColor(page, w.a.id, 1); // blue
  await expect(rowA.getByTestId('line-name').getByTestId('line-dot')).toHaveAttribute('data-line-color', 'blue');
  await pickColor(page, w.b.id, 3); // orange
  await expect(page.locator(`[data-number-id="${w.b.id}"]`).getByTestId('line-name').getByTestId('line-dot')).toHaveAttribute('data-line-color', 'orange');

  // El menú de colores cierra con Esc y al tocar afuera.
  await rowA.getByTestId('line-color-select').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await rowA.getByTestId('line-color-select').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('listbox')).toHaveCount(0);

  // La bandeja: el grupo (en las dos líneas) lleva un punto por línea.
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const groupRow = page.getByTestId('chat-row').filter({ hasText: w.groupName });
  await expect(groupRow).toHaveCount(1, { timeout: 60_000 });
  const dots = groupRow.getByTestId('row-line-dots').getByTestId('line-dot');
  await expect(dots).toHaveCount(2);
  expect((await dots.evaluateAll((els) => els.map((e) => e.getAttribute('data-line-color')))).sort()).toEqual(['blue', 'orange']);

  // Sin color: el punto de esa línea se va.
  await page.goto(`/en/app/lines/settings?tab=numbers`, { waitUntil: 'networkidle' });
  await pickColor(page, w.b.id, 0);
  await expect(page.locator(`[data-number-id="${w.b.id}"]`).getByTestId('line-name').getByTestId('line-dot')).toHaveCount(0);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await expect(groupRow.getByTestId('row-line-dots').getByTestId('line-dot')).toHaveCount(1, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('un color fuera de la paleta se rechaza', async ({ request }) => {
  const n = await fakeNumber(request, `Linea ${uid()}`);
  const bad = await request.patch(`/api/groups/numbers/${n.id}`, { data: { color: 'url(x)' } });
  expect(bad.status()).toBe(400);
  const ok = await request.patch(`/api/groups/numbers/${n.id}`, { data: { color: 'teal' } });
  expect(((await ok.json()) as { color: string }).color).toBe('teal');
});

test('a 390 px los puntos no rompen la fila ni la pantalla de números', async ({ page, request }) => {
  test.setTimeout(120_000);
  const w = await twoLines(request);
  await request.patch(`/api/groups/numbers/${w.a.id}`, { data: { color: 'purple' } });
  await request.patch(`/api/groups/numbers/${w.b.id}`, { data: { color: 'yellow' } });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const groupRow = page.getByTestId('chat-row').filter({ hasText: w.groupName });
  await expect(groupRow.getByTestId('line-dot')).toHaveCount(2, { timeout: 60_000 });
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  // La hora sigue a la derecha de los puntos, en la misma línea.
  const dotsBox = (await groupRow.getByTestId('row-line-dots').boundingBox())!;
  const timeBox = (await groupRow.locator('.gr-row-time').boundingBox())!;
  expect(dotsBox.x + dotsBox.width).toBeLessThanOrEqual(timeBox.x);
  await page.goto(`/en/app/lines/settings?tab=numbers`, { waitUntil: 'networkidle' });
  await expect(page.locator(`[data-number-id="${w.a.id}"]`).getByTestId('line-color-select')).toBeVisible({ timeout: 30_000 });
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});
