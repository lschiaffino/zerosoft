import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * Salir de un grupo de WhatsApp, en Inbox y en Lines, con el WhatsApp falso.
 * Como en WhatsApp: el chat queda como historial, con el aviso "Saliste" y el
 * campo de mensaje cambiado por "No podés enviar mensajes a este grupo porque
 * ya no sos miembro". El servidor tampoco deja mandar (group_left). Que te
 * saquen desde el teléfono hace lo mismo; que te vuelvan a agregar lo abre.
 * A 1280 y 390.
 *
 * Nombres y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

ownWorkspace('wa-leave-group');

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

function groupEvents(gid: string, title: string, tag: string) {
  return Array.from({ length: 2 }, (_, i) => ({
    type: 'message',
    chatId: gid,
    isGroup: true,
    chatName: title,
    fromMe: false,
    senderPhone: `1555000${1200 + i}`,
    senderName: `Persona ${i} ${tag}`,
    providerMessageId: `lv${i}-${tag}`,
    body: `Mensaje ${i} ${tag}`,
    timestamp: new Date(Date.now() - (2 - i) * 60_000).toISOString(),
  }));
}

async function inboxAccount(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const { account } = (await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } };
  const [acc] = await sql('SELECT id, webhook_secret, address FROM inbox_accounts WHERE id = ?', [account.id]);
  const post = async (events: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  return { post, address: String(acc.address ?? '').replace(/\D/g, '') || '15550000001' };
}

async function inboxGroup(request: APIRequestContext) {
  const acc = await inboxAccount(request);
  const tag = uid();
  const gid = `1203632${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Grupo para salir ${tag}`;
  await acc.post(groupEvents(gid, title, tag));
  const [thread] = await sql('SELECT id FROM inbox_threads WHERE external_id = ? ORDER BY created_at DESC LIMIT 1', [gid]);
  return { ...acc, gid, title, tag, threadId: String(thread.id) };
}

async function openInboxChat(page: Page, title: string) {
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: title });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
  return thread;
}

for (const size of [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Inbox: salir del grupo deja el chat de solo lectura (${size.name})`, async ({ page, request }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    const g = await inboxGroup(request);
    const thread = await openInboxChat(page, g.title);
    await expect(thread.locator('textarea.wa-input')).toBeVisible();
    await expect(thread.getByTestId('wa-left-bar')).toHaveCount(0);

    // Info del grupo › Salir del grupo › confirmar.
    await thread.locator('.wa-head-who').click();
    const panel = page.locator('.ib-wa-details');
    await expect(panel).toBeVisible();
    await panel.getByTestId('group-exit').click();
    await panel.getByTestId('group-exit-confirm').click();
    await expect(panel.getByTestId('group-left-note')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('group-exit')).toHaveCount(0);

    // La conversación: el aviso en lugar del campo y la línea "Saliste" en el chat.
    if (size.width < 720) await panel.locator('.ib-wa-details-bar button').first().click();
    await expect(thread.getByTestId('wa-left-bar')).toBeVisible();
    await expect(thread.locator('textarea.wa-input')).toHaveCount(0);
    await expect.poll(async () => (await sql("SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND media_type = 'system' AND meta LIKE '%\"leave\"%'", [g.threadId]))[0].n).toBe(1);
    await expect(thread.getByTestId('wa-group-event').last()).toBeVisible({ timeout: 30_000 });
    if (size.width < 720) expect(await noSideScroll(page)).toBeLessThanOrEqual(0);

    // El servidor tampoco deja mandar, y salir dos veces dice group_left.
    const send = await request.post(`/api/inbox/threads/${g.threadId}/messages`, { data: { body: 'hola' } });
    expect(send.status()).toBe(409);
    expect(((await send.json()) as { error: string }).error).toBe('group_left');
    const again = await request.post(`/api/inbox/threads/${g.threadId}/wa`, { data: { action: 'leave' } });
    expect(again.status()).toBe(409);

    // Que te vuelvan a agregar desde el teléfono abre el chat otra vez.
    await g.post([{ type: 'participants', chatId: g.gid, action: 'add', phones: [g.address], author: '15550001200' }]);
    await expect.poll(async () => (await sql('SELECT left_at FROM inbox_threads WHERE id = ?', [g.threadId]))[0].left_at, { timeout: 15_000 }).toBeNull();
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('Inbox: que te saquen del grupo desde el teléfono también lo deja de solo lectura', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const g = await inboxGroup(request);
  await g.post([{ type: 'participants', chatId: g.gid, action: 'remove', phones: [g.address], author: '15550001200' }]);
  await expect.poll(async () => (await sql('SELECT left_at FROM inbox_threads WHERE id = ?', [g.threadId]))[0].left_at, { timeout: 15_000 }).not.toBeNull();
  const thread = await openInboxChat(page, g.title);
  await expect(thread.getByTestId('wa-left-bar')).toBeVisible();
  await thread.locator('.wa-head-who').click();
  await expect(page.locator('.ib-wa-details').getByTestId('group-left-note')).toBeVisible();
  // LG_SHOTS=<carpeta>: captura para mirar a mano.
  if (process.env.LG_SHOTS) await page.screenshot({ path: `${process.env.LG_SHOTS}/inbox-left-1280.png` });
});

async function linesGroup(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const gid = `1203633${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Grupo Lines ${tag}`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: groupEvents(gid, title, tag) } });
  expect(res.ok(), await res.text()).toBe(true);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, gid]);
  return { numberId, chatId: String(chat.id), title };
}

for (const size of [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Lines: un grupo del que la línea salió muestra el aviso y deja la nota interna (${size.name})`, async ({ page, request }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    const { numberId, chatId, title } = await linesGroup(request);
    try {
      const left = await request.post(`/api/groups/chats/${chatId}/group`, { data: { action: 'leave' } });
      expect(left.ok(), await left.text()).toBe(true);
      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.wa-thread');
      await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
      await expect(thread.getByTestId('wa-left-bar')).toBeVisible();
      if (process.env.LG_SHOTS) await page.screenshot({ path: `${process.env.LG_SHOTS}/lines-left-${size.width}.png` });
      await expect.poll(async () => (await sql("SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ? AND direction = 'system' AND meta LIKE '%\"leave\"%'", [chatId]))[0].n).toBe(1);
      await expect(thread.getByTestId('wa-group-event').last()).toBeVisible({ timeout: 30_000 });
      // La nota interna sigue: la solapa cambia el aviso por el campo.
      await expect(async () => {
        await thread.locator('.wa-mode-note').click();
        await expect(thread.getByTestId('wa-left-bar')).toHaveCount(0, { timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
      await expect(thread.locator('textarea').first()).toBeVisible();
      await thread.locator('.wa-mode-reply').click();
      await expect(thread.getByTestId('wa-left-bar')).toBeVisible();
      if (size.width < 720) expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
    }
  });
}
