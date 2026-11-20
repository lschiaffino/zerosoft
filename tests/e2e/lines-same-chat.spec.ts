import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: el mismo chat en dos líneas (proveedor falso, GROUPS_FAKE=1). La
 * bandeja lo lista una vez, con los no leídos de las dos; al abrirlo, el hilo
 * junta los mensajes de las dos líneas sin repetir el que llegó por ambas, y
 * cada mensaje deja ver por qué línea entró. Nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

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

async function events(request: APIRequestContext, n: NumberInfo, list: unknown[]) {
  const res = await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

function message(chatId: string, over: Record<string, unknown> = {}) {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message',
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: group ? '5491100009999' : chatId.replace(/@.*/, ''),
    senderName: 'Contacto Demo',
    providerMessageId: `e2e-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Dos líneas en el mismo grupo y con el mismo contacto. */
async function twoLines(request: APIRequestContext) {
  const tag = uid();
  const a = await fakeNumber(request, `Ventas ${tag}`);
  const b = await fakeNumber(request, `Soporte ${tag}`);
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const groupName = `Grupo ${tag}`;
  const t0 = Date.now() - 60_000;
  const when = (s: number) => new Date(t0 + s * 1000).toISOString();
  // El mismo mensaje llega por las dos líneas (mismo id de WhatsApp); otro solo por la segunda.
  const shared = message(gid, { chatName: groupName, providerMessageId: `e2e-g-${tag}`, body: `primero ${tag}`, timestamp: when(1) });
  await events(request, a, [shared]);
  await events(request, b, [shared]);
  await events(request, b, [message(gid, { chatName: groupName, body: `segundo ${tag}`, timestamp: when(2) })]);
  // El mismo contacto escribe a las dos líneas.
  const p = phone();
  const dmName = `Cliente ${tag}`;
  await events(request, a, [message(`${p}@c.us`, { senderName: dmName, chatName: dmName, body: `por ventas ${tag}`, timestamp: when(3) })]);
  await events(request, b, [message(`${p}@c.us`, { senderName: dmName, chatName: dmName, body: `por soporte ${tag}`, timestamp: when(4) })]);
  return { tag, a, b, groupName, dmName };
}

test('el mismo grupo y el mismo contacto en dos líneas: una fila y el hilo unido', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const w = await twoLines(request);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });

  const groupRow = page.getByTestId('chat-row').filter({ hasText: w.groupName });
  await expect(groupRow).toHaveCount(1, { timeout: 60_000 });
  await expect(groupRow).toHaveAttribute('data-lines', '2');
  const dmRow = page.getByTestId('chat-row').filter({ hasText: w.dmName });
  await expect(dmRow).toHaveCount(1);
  await expect(dmRow).toHaveAttribute('data-lines', '2');

  // El grupo: el mensaje que llegó por las dos líneas, una sola vez.
  await groupRow.getByRole('link').click();
  const msgs = page.getByTestId('wa-message');
  await expect(msgs.filter({ hasText: `primero ${w.tag}` })).toHaveCount(1, { timeout: 30_000 });
  await expect(msgs.filter({ hasText: `segundo ${w.tag}` })).toHaveCount(1);
  await expect(groupRow.getByRole('link')).toHaveAttribute('aria-current', 'page');

  // El 1:1: los mensajes de las dos líneas, cada uno con la línea por la que entró.
  const first = msgs.filter({ hasText: `por ventas ${w.tag}` });
  const second = msgs.filter({ hasText: `por soporte ${w.tag}` });
  // La lista se pone al día al abrir el grupo (queda leído): el clic se repite si cayó mientras se redibujaba.
  await expect(async () => {
    await dmRow.getByRole('link').click();
    await expect(first).toHaveCount(1, { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await expect(second).toHaveCount(1);
  await expect(first.getByTestId('msg-line')).toHaveCount(1);
  await expect(second.getByTestId('msg-line')).toHaveCount(1);
  expect(await first.getAttribute('data-line')).not.toBe(await second.getAttribute('data-line'));
  // Abrirlo lo deja leído en las dos líneas.
  await expect(dmRow.locator('.gr-unread')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a 390 px el hilo de dos líneas no tiene scroll lateral', async ({ page, request }) => {
  test.setTimeout(120_000);
  const w = await twoLines(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByTestId('chat-row').filter({ hasText: w.dmName }).getByRole('link').click();
  await expect(page.getByTestId('msg-line').first()).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Responder desde: por defecto la línea del último mensaje; elegir otra manda por esa', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const w = await twoLines(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const dmRow = page.getByTestId('chat-row').filter({ hasText: w.dmName });
  await expect(dmRow).toHaveCount(1, { timeout: 60_000 });
  await dmRow.getByRole('link').click();
  const msgs = page.getByTestId('wa-message');
  const first = msgs.filter({ hasText: `por ventas ${w.tag}` });
  const last = msgs.filter({ hasText: `por soporte ${w.tag}` });
  await expect(last).toHaveCount(1, { timeout: 30_000 });
  const ventasChat = (await first.getAttribute('data-line'))!;
  const soporteChat = (await last.getAttribute('data-line'))!;
  // Por defecto: la línea por la que llegó el último mensaje.
  const from = page.getByTestId('reply-from').getByRole('combobox');
  await expect(from).toHaveValue(soporteChat);
  // Compacto, como el resto de la barra del compositor: no el alto ni el borde de un campo de formulario.
  const box = await from.boundingBox();
  expect(box && box.height).toBeLessThanOrEqual(30);
  expect(await from.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
  // Con aire respecto de la caja del mensaje: no se pegan.
  const input = await page.getByTestId('composer-input').boundingBox();
  expect(box && input && input.y - (box.y + box.height)).toBeGreaterThanOrEqual(8);
  // Elegir la otra y mandar: el mensaje sale por esa línea.
  await from.selectOption(ventasChat);
  const field = page.getByTestId('composer-input');
  await field.fill(`respuesta ${w.tag}`);
  await field.press('Enter');
  const sent = msgs.filter({ hasText: `respuesta ${w.tag}` });
  await expect(sent).toHaveAttribute('data-line', ventasChat, { timeout: 30_000 });
  await expect(sent).toHaveAttribute('data-status', /sent|delivered|read/, { timeout: 30_000 });
  // La línea elegida sigue elegida para la próxima respuesta.
  await expect(from).toHaveValue(ventasChat);
  expect(errors).toEqual([]);
});
