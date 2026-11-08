import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups, ronda WhatsApp 2 contra el proveedor falso (GROUPS_FAKE=1):
 * archivar y la vista "Archivados", eliminar un chat, mandar un contacto
 * desde el menú +, "escribiendo…" en el encabezado y la lista, y el aviso de
 * línea caída con el enlace para escanear el QR de nuevo.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `WA2 ${uid()}` } });
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

const dm = () => `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, senderName: string) {
  await events(request, n, [
    { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `e2e-${uid()}`, body },
  ]);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function rowMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `Options for ${name}` }).click();
}

test('archivar, la vista Archivados y eliminar un chat', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const name = `Arch${tag}`;
  const other = `Keep${tag}`;
  await inbound(request, n, dm(), 'hola', name);
  await inbound(request, n, dm(), 'buenas', other);
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  const list = page.locator('.gr-rows');
  await expect(list.locator('.gr-row', { hasText: name })).toBeVisible();

  await rowMenu(page, name);
  await page.getByRole('menuitem', { name: 'Archive chat' }).click();
  await expect(page.getByText('Chat archived')).toBeVisible();
  await expect(list.locator('.gr-row', { hasText: name })).toHaveCount(0);
  const archivedRow = page.getByRole('button', { name: /^Archived/ });
  await expect(archivedRow).toBeVisible();
  await archivedRow.click();
  await expect(page.getByRole('heading', { name: 'Archived', level: 3 })).toBeVisible();
  await expect(list.locator('.gr-row', { hasText: name })).toBeVisible();
  await expect(list.locator('.gr-row', { hasText: other })).toHaveCount(0);

  await rowMenu(page, name);
  await page.getByRole('menuitem', { name: 'Unarchive chat' }).click();
  await expect(page.getByText('No archived chats.')).toBeVisible();
  await page.locator('.wa-archived-head').getByRole('button', { name: 'Chats' }).click();
  await expect(list.locator('.gr-row', { hasText: name })).toBeVisible();

  await rowMenu(page, other);
  await page.getByRole('menuitem', { name: 'Delete chat' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Delete the chat with ${other}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete chat' }).click();
  await expect(page.getByText('Chat deleted')).toBeVisible();
  await expect(list.locator('.gr-row', { hasText: other })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mandar un contacto desde el menú + y ver "escribiendo…"', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const name = `Card${tag}`;
  const friend = `Friend${tag}`;
  const chatId = dm();
  await inbound(request, n, dm(), 'yo soy el contacto', friend);
  await inbound(request, n, chatId, 'pasame un contacto', name);
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();

  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('menuitem', { name: 'Contact', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send contacts' });
  await dialog.getByRole('searchbox', { name: 'Search chats' }).fill(friend);
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: 'Send contact' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.wa-contact', { hasText: friend }).last()).toBeVisible();

  // Presencia: el contacto escribe (llega por webhook).
  await events(request, n, [{ type: 'presence', chatId, who: '', state: 'composing' }]);
  await expect(page.locator('.wa-head-sub')).toHaveText('typing…', { timeout: 10_000 });
  await expect(page.locator('.gr-row', { hasText: name }).locator('.gr-row-typing')).toHaveText('typing…', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('línea caída: aviso en la bandeja y el QR de nuevo desde Ajustes', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const tag = uid();
  await inbound(request, n, dm(), 'hola', `Drop${tag}`);
  // La sesión se cae (el gateway avisa por webhook).
  await events(request, n, [{ type: 'session', status: 'qr' }]);
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  const banner = page.locator('.wa-dropped').first();
  await expect(banner).toContainText('lost its WhatsApp connection');
  await banner.getByRole('link', { name: 'Scan the QR again' }).click();
  await expect(page).toHaveURL(/tab=numbers&reconnect=/);
  await expect(page.getByRole('dialog').first()).toBeVisible();
});
