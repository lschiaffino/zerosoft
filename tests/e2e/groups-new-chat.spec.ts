import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines, "Chat nuevo" (el "+" de la bandeja) contra el proveedor falso
 * (GROUPS_FAKE=1): buscar un contacto que ya tiene chat, escribirle a un
 * número nuevo, y los errores en el diálogo. Nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Nuevo ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

/** Un teléfono inventado de 13 dígitos que no termina en ceros (el proveedor falso dice que esos no tienen WhatsApp). */
const phone = () => `549${Date.now().toString().slice(-8)}${1 + Math.floor(Math.random() * 9)}${1 + Math.floor(Math.random() * 9)}`;

async function inbound(request: APIRequestContext, n: NumberInfo, from: string, body: string, senderName: string) {
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: `${from}@c.us`, isGroup: false, fromMe: false, senderPhone: from, senderName, providerMessageId: `e2e-${uid()}`, body }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Los chats de la línea que están en la bandeja (por la API: la lista en pantalla puede estar en otra línea). */
async function lineChats(request: APIRequestContext, n: NumberInfo) {
  const res = await request.get(`/api/groups/chats?number=${n.id}&meta=0`);
  expect(res.ok()).toBe(true);
  const { rows } = (await res.json()) as { rows: Array<{ phone: string; lastMessagePreview: string }> };
  return rows.map((r) => ({ phone: r.phone, preview: r.lastMessagePreview }));
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Abre el diálogo y elige la línea del test (el workspace de los e2e tiene varias). */
async function openDialog(page: Page, n: NumberInfo) {
  await page.getByRole('button', { name: 'New chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'New chat' });
  await expect(dialog).toBeVisible();
  const from = dialog.getByLabel('From line');
  await expect(dialog.getByLabel('Name or phone number')).toBeVisible();
  // Las líneas llegan al abrir: recién entonces se sabe si hay selector.
  await expect(dialog.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
  if (await from.count()) await from.selectOption(n.id);
  return dialog;
}

test('chat nuevo: un contacto que ya tiene chat abre ese chat', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const name = `Ana Prueba ${uid()}`;
  const from = phone();
  await inbound(request, n, from, 'Hi, I have a question', name);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const dialog = await openDialog(page, n);
  await dialog.getByLabel('Name or phone number').fill(name);
  const row = dialog.getByRole('button', { name: new RegExp(name) });
  await expect(row).toContainText(`+${from}`);
  await row.click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?#]+/);
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.getByText('Hi, I have a question').first()).toBeVisible();
  // El mismo número escrito a mano lleva al mismo chat: no se crea otro.
  const url = page.url();
  const again = await openDialog(page, n);
  await again.getByLabel('Name or phone number').fill(`+${from.slice(0, 2)} ${from.slice(2, 5)} ${from.slice(5)}`);
  await again.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(url);
  expect(errors).toEqual([]);
});

test('chat nuevo: un número que no está en la libreta crea el chat, con el campo de mensaje listo', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const to = phone();

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const dialog = await openDialog(page, n);
  const search = dialog.getByLabel('Name or phone number');

  // Un número imposible: aviso en el diálogo y nada para elegir.
  await search.fill('123 45');
  await expect(dialog.getByText('That number is too short.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Message \+/ })).toHaveCount(0);
  await search.fill('+1234567890123456');
  await expect(dialog.getByRole('alert').filter({ hasText: 'That number is too long.' })).toBeVisible();

  // Un número que WhatsApp no conoce: lo dice y no crea el chat.
  await search.fill('+54 9 11 2000-0000');
  await dialog.getByRole('button', { name: 'Message +5491120000000' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'That number is not on WhatsApp.' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/lines\/inbox$/);

  // Con espacios, guiones y paréntesis: se ofrece el número normalizado.
  await search.fill(`+${to.slice(0, 2)} (${to.slice(2, 5)}) ${to.slice(5, 9)}-${to.slice(9)}`);
  await dialog.getByRole('button', { name: `Message +${to}` }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?#]+/);
  await expect(page.getByRole('heading', { level: 2, name: `+${to}` })).toBeVisible();
  const composer = page.getByLabel('WhatsApp', { exact: true });
  await expect(composer).toBeFocused();
  // Hasta que se escribe, el chat no está en la bandeja (como en WhatsApp).
  expect(await lineChats(request, n)).toEqual([]);

  await composer.fill('Hello from the new chat');
  await composer.press('Enter');
  await expect(page.locator('.gr-msg-out', { hasText: 'Hello from the new chat' }).getByText('Sent')).toBeVisible();
  // Con el primer mensaje entra a la bandeja.
  await expect.poll(() => lineChats(request, n), { timeout: 10_000 }).toEqual([{ phone: to, preview: 'Hello from the new chat' }]);
  expect(errors).toEqual([]);
});

test('chat nuevo: Esc cierra y "New group" lleva a crear un grupo', async ({ page, request }) => {
  const n = await fakeNumber(request);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const dialog = await openDialog(page, n);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const again = await openDialog(page, n);
  await again.getByRole('link', { name: 'New group' }).click();
  await expect(page).toHaveURL(/\/app\/lines\/list\?new=1/);
});
