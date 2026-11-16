import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Un grupo nuevo de WhatsApp aparece arriba de la lista aunque no tenga
 * mensajes, con "Creaste el grupo «…»" de vista previa, y al abrirlo se ve la
 * tarjeta del grupo (Inbox y Lines, 1280 y 390, WhatsApp falso). El orden se
 * mira por la API (otros specs pueden dejar chats fijados arriba); la pantalla,
 * con la fila y la tarjeta. Nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `5491${Math.floor(1e9 + Math.random() * 8e9)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function linkInbox(request: APIRequestContext) {
  const status = async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state?: { status: string } }).state?.status;
  if ((await status()) === 'connected') return;
  await request.post('/api/inbox/whatsapp');
  await expect.poll(status, { timeout: 10_000 }).toBe('connected');
}

async function fakeLine(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `NG ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  return id;
}

for (const width of [1280, 390]) {
  test(`Inbox: el grupo nuevo queda arriba con su aviso y abre con la tarjeta (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await linkInbox(request);
    const title = `Asado ${uid()}`;
    const res = await request.post('/api/inbox/groups', { data: { name: title, phones: [phone(), phone()] } });
    expect(res.ok(), await res.text()).toBe(true);
    const { thread } = (await res.json()) as { thread: { id: string } };
    // Primero después de los fijados.
    const list = (await (await request.get('/api/inbox/threads?cursor=')).json()) as { threads: Array<{ id: string }>; pinned: number };
    expect(list.threads.findIndex((t) => t.id === thread.id)).toBe(list.pinned);

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`You created group “${title}”`);
    await expect(row).not.toHaveClass(/is-unread/);
    await row.locator('.ib-row-btn').click();
    const card = page.getByTestId('new-group-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('You created this group');
    await expect(card).toContainText('Group · 3 members');
    expect(await noSideScroll(page)).toBe(true);
    // "Group info" abre el panel del grupo (una acción que existe en Inbox).
    await card.getByRole('button', { name: 'Group info' }).click();
    await expect(card.getByRole('button', { name: 'Group info' })).toBeHidden();
    expect(await noSideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`Lines: el grupo nuevo queda arriba con su aviso y abre con la tarjeta (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const numberId = await fakeLine(request);
    const name = `Clientes ${uid()}`;
    const res = await request.post('/api/groups/create', { data: { numberId, name, phones: [phone()] } });
    expect(res.ok(), await res.text()).toBe(true);
    const chatId = ((await res.json()) as { results: Array<{ chatId: string }> }).results[0].chatId;
    const list = (await (await request.get('/api/groups/chats?cursor=')).json()) as { rows: Array<{ id: string }>; pinned: number };
    expect(list.rows.findIndex((c) => c.id === chatId)).toBe(list.pinned);

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.gr-row', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`You created group “${name}”`);
    await row.click();
    const card = page.getByTestId('new-group-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('You created this group');
    expect(await noSideScroll(page)).toBe(true);
    // "Add members" abre el panel del chat con el campo para agregar listo.
    await card.getByRole('button', { name: 'Add members' }).click();
    await expect(page.locator('[data-focus-target="add-members"]')).toBeFocused();
    expect(await noSideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Lines: me agregan a un grupo que no estaba y aparece con "te agregó"', async ({ page, request }) => {
  const errors = watchErrors(page);
  const numberId = await fakeLine(request);
  const info = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string; phone?: string };
  const me = String(info.phone ?? '15550000001').replace(/\D/g, '') || '15550000001';
  const groupId = `1203630${Date.now()}@g.us`;
  const hook = await request.post(new URL(info.webhookUrl).pathname, {
    data: { events: [{ type: 'participants', chatId: groupId, action: 'add', phones: [me], author: '5491155550000' }] },
  });
  expect(hook.ok(), await hook.text()).toBe(true);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  // El asunto sale de WhatsApp (el falso: "Grupo" y los últimos 4 dígitos).
  const row = page.locator('.gr-row', { hasText: `Grupo ${groupId.replace(/\D/g, '').slice(-4)}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('added you');
  expect(errors).toEqual([]);
});
