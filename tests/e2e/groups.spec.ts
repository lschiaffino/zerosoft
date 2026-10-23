import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Groups de punta a punta contra el proveedor falso (GROUPS_FAKE=1): conectar
 * un número con QR, recibir mensajes por el webhook, responder, ticket desde
 * un mensaje, crear grupos (uno y en lote), agregar miembros en lote y un
 * envío masivo. Nada sale a WhatsApp.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

/** Un número falso conectado (por API, para los tests que no prueban la conexión). */
async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `E2E ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

/** Lo que mandaría el proveedor: un mensaje entrante (formato del falso). */
async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, senderName = 'Ana') {
  const path = new URL(n.webhookUrl).pathname;
  const res = await request.post(path, {
    data: {
      events: [
        {
          type: 'message',
          chatId,
          isGroup: chatId.endsWith('@g.us'),
          chatName: chatId.endsWith('@g.us') ? `Cliente ${senderName}` : undefined,
          fromMe: false,
          senderPhone: '5491155550000',
          senderName,
          providerMessageId: `e2e-${uid()}`,
          body,
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test('conectar un número por QR desde Ajustes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/groups/settings?tab=numbers&new=1', { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog', { name: 'Add a WhatsApp number' });
  await expect(dialog).toBeVisible();
  // El modo puente avisa el riesgo; el oficial, sus límites con grupos.
  await expect(dialog.getByText(/unofficial WhatsApp Web session/)).toBeVisible();
  await dialog.getByLabel(/WhatsApp Cloud API \(official\)/).check();
  await expect(dialog.getByText(/does not create groups/)).toBeVisible();
  await dialog.getByLabel(/Demo number/).check();
  const name = `QR line ${uid()}`;
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Save and connect' }).click();
  const connect = page.getByRole('dialog', { name: `Connect ${name}` });
  await expect(connect.getByRole('img', { name: 'QR code to link WhatsApp' })).toBeVisible();
  await expect(connect.getByText(/^Connected/)).toBeVisible({ timeout: 15_000 });
  await expect(connect.getByLabel('Webhook URL')).toHaveValue(/\/api\/groups\/webhook\//);
  await connect.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.gr-number', { hasText: name }).getByText('Connected', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('bandeja: llega un mensaje, se responde, nota interna y ticket desde el mensaje', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const gid = `120363${Date.now()}@g.us`;
  const who = `Ana${uid()}`;
  const invoice = `Invoice ${uid()} did not arrive`;
  await inbound(request, n, gid, invoice, who);

  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-row', { hasText: `Cliente ${who}` });
  await expect(row).toBeVisible();
  await expect(row.getByText(/Waiting/)).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { level: 2, name: `Cliente ${who}` })).toBeVisible();
  await expect(page.locator('.gr-messages').getByText(invoice)).toBeVisible();

  // Responder con Enter.
  const composer = page.getByLabel('WhatsApp', { exact: true });
  await composer.fill('Hi Ana, resending it now.');
  await composer.press('Enter');
  await expect(page.locator('.gr-msg-out', { hasText: 'Hi Ana, resending it now.' }).getByText('Sent')).toBeVisible();
  // Ya no espera respuesta.
  await expect(page.locator('.gr-row', { hasText: `Cliente ${who}` }).getByText(/Waiting/)).toHaveCount(0, { timeout: 10_000 });

  // Nota interna con N.
  await page.locator('.gr-messages').click();
  await page.keyboard.press('n');
  const note = page.getByLabel('Internal note', { exact: true });
  await expect(note).toBeFocused();
  await note.fill('Billing already knows');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.gr-msg-note', { hasText: 'Billing already knows' })).toBeVisible();

  // Ticket desde el mensaje.
  const msg = page.locator('.gr-msg-in', { hasText: invoice });
  await msg.hover();
  await msg.getByRole('button', { name: 'Ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Priority').selectOption('high');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.getByText(/Ticket #\d+ created/)).toBeVisible();
  await expect(msg.getByRole('link', { name: 'Ticket' })).toBeVisible();

  await page.goto('/en/app/groups/tickets', { waitUntil: 'networkidle' });
  const ticketRow = page.locator('tr', { hasText: invoice });
  await expect(ticketRow).toBeVisible();
  await expect(ticketRow.getByLabel('Priority')).toHaveValue('high');
  await ticketRow.getByLabel('Status').selectOption('resolved');
  await page.getByLabel('Status').first().selectOption('resolved');
  await expect(page.locator('tr', { hasText: invoice })).toBeVisible();
  expect(errors).toEqual([]);
});

test('ticket por reacción con el emoji desde el teléfono', async ({ request }) => {
  const n = await fakeNumber(request);
  const gid = `120363${Date.now()}9@g.us`;
  const path = new URL(n.webhookUrl).pathname;
  const msgId = `react-${uid()}`;
  const body = `Broken export ${uid()}`;
  await request.post(path, {
    data: { events: [{ type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: '5491155550001', senderName: 'Leo', providerMessageId: msgId, body }] },
  });
  const reaction = { type: 'reaction', chatId: gid, targetProviderMessageId: msgId, emoji: '🎫', senderPhone: '', senderName: '', fromMe: true };
  await request.post(path, { data: { events: [reaction] } });
  // El webhook repetido no duplica.
  await request.post(path, { data: { events: [reaction] } });
  const res = (await (await request.get('/api/groups/tickets?status=all')).json()) as { tickets: Array<{ title: string; source: string }> };
  expect(res.tickets.filter((t) => t.title === body)).toEqual([expect.objectContaining({ source: 'reaction' })]);
});

test('grupos: crear uno, varios desde CSV y agregar miembros en lote', async ({ page, request }) => {
  const errors = watchErrors(page);
  await fakeNumber(request);
  await page.goto('/en/app/groups/list', { waitUntil: 'networkidle' });

  const single = `Acme ${uid()}`;
  await page.keyboard.press('c');
  const create = page.getByRole('dialog', { name: 'New WhatsApp group' });
  await create.getByLabel('Group name').fill(single);
  await create.getByLabel('Participants').fill('+1 555 000 1001, +15550001099');
  await create.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: single })).toBeVisible();
  // El que bloquea altas no entra: 2 miembros (el número y uno).
  await expect(page.getByText('2 members').first()).toBeVisible();
  await page.getByRole('button', { name: 'Get invite link' }).click();
  await expect(page.getByLabel('Invite link')).toHaveValue(/chat\.whatsapp\.com/);

  await page.goto('/en/app/groups/list', { waitUntil: 'networkidle' });
  const a = `Batch A ${uid()}`;
  const b = `Batch B ${uid()}`;
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const csv = page.getByRole('dialog', { name: 'Create groups from a CSV' });
  await csv.getByLabel('Or paste it').fill(`name,participants\n${a},+15550002001\n${b},+15550002002 +15550002003`);
  await csv.getByRole('button', { name: 'Check file' }).click();
  await expect(csv.getByText('2 groups ready to create')).toBeVisible();
  await csv.getByRole('button', { name: 'Create 2 groups' }).click();
  await expect(csv.getByText('2 of 2 groups created.')).toBeVisible({ timeout: 20_000 });
  await csv.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('link', { name: a })).toBeVisible();
  await page.getByLabel(`Select ${a}`).check();
  await page.getByLabel(`Select ${b}`).check();
  await expect(page.getByText('2 groups selected')).toBeVisible();
  await page.getByRole('button', { name: 'Add members' }).click();
  const bulk = page.getByRole('dialog', { name: 'Add members to 2 groups' });
  await bulk.getByLabel('Phones').fill('+15550003001\n+15550003099');
  await bulk.getByRole('button', { name: 'Apply' }).click();
  await expect(bulk.getByText('2 of 2 groups updated. 2 phones failed.')).toBeVisible();
  await bulk.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('envío masivo a varios chats con estado por destinatario', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  await inbound(request, n, `54911${Date.now().toString().slice(-8)}@c.us`, 'hola', `Bea${tag}`);
  await inbound(request, n, `54912${Date.now().toString().slice(-8)}@c.us`, 'hola', `Cami${tag}`);

  await page.goto('/en/app/groups/broadcasts/new', { waitUntil: 'networkidle' });
  if ((await page.getByLabel('From number').count()) > 0) await page.getByLabel('From number').selectOption(n.id);
  await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
  await page.getByRole('button', { name: /Select 2 shown/ }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Hi {{first_name}}, the new release is live.');
  await expect(page.locator('.gr-preview').getByText(/Hi (Bea|Cami)/)).toBeVisible();
  await page.getByRole('button', { name: 'Send to 2 chats' }).click();
  await expect(page).toHaveURL(/\/groups\/broadcasts\/[\w-]+$/);
  await expect(page.locator('.badge', { hasText: 'Sent' })).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText('Done')).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('390px: la bandeja muestra una columna por vez y sin scroll horizontal', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const who = `Mobi${uid()}`;
  await inbound(request, n, `120363${Date.now()}7@g.us`, 'hola desde el teléfono', who);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: `Cliente ${who}` }).click();
  await expect(page.getByRole('link', { name: 'Chats' })).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});
