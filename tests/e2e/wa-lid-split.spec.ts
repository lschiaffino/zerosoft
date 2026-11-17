import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox y Lines con el WhatsApp falso (GROUPS_FAKE=1): la misma persona por su
 * teléfono y por su lid ("<lid>@lid") queda en un solo chat.
 * - Importado por teléfono y después en vivo por lid (el eco de un mensaje
 *   propio que ya estaba, y un mensaje nuevo de la persona).
 * - Mando yo desde la app al chat del teléfono; la tilde y la respuesta vuelven
 *   por lid. Los dos chats ya tendrían nombre: igual queda uno solo.
 * Números, lids y nombres inventados.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
function person() {
  const n = Math.floor(10_000_000 + Math.random() * 89_999_999);
  return { phone: `54911${n}`, lid: `7${n}${Math.floor(100_000 + Math.random() * 899_999)}` };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.endsWith('@s.whatsapp.net') ? chatId.replace(/@.*/, '') : '',
    senderName: '',
    providerMessageId: `ls-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

async function inboxHook(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const hook = async (list: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  return { accId: String(acc.id), hook };
}

async function lineHook(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Lid ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const hook = async (list: unknown[]) => {
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  return { numberId: id, hook };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Inbox: importado por teléfono y después en vivo por lid, un solo chat', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { accId, hook } = await inboxHook(request);
  const p = person();
  const pn = `${p.phone}@s.whatsapp.net`;
  const lid = `${p.lid}@lid`;
  const mine = `ls-own-${uid()}`;
  const name = `Ana Lid ${uid()}`;
  await hook([
    message(pn, { senderName: name, body: 'hola', timestamp: ago(30), history: true }),
    message(pn, { providerMessageId: mine, fromMe: true, senderPhone: '', body: 'una primera duda', timestamp: ago(20), history: true }),
  ]);
  // En vivo, solo con el lid: el eco de lo mío y un mensaje nuevo de la persona.
  await hook([message(lid, { providerMessageId: mine, fromMe: true, body: 'una primera duda', timestamp: ago(20) })]);
  await hook([message(lid, { senderLid: p.lid, senderName: name, body: 'te respondo por acá', timestamp: ago(1) })]);
  const threads = await sql('SELECT id, external_id FROM inbox_threads WHERE account_id = ? AND external_id IN (?, ?)', [accId, pn, lid]);
  expect(threads.map((t) => t.external_id)).toEqual([pn]);
  expect(await sql('SELECT 1 FROM inbox_messages WHERE thread_id = ?', [String(threads[0].id)])).toHaveLength(3);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: name })).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: mando yo por el teléfono y la respuesta llega por lid, un solo chat', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { accId, hook } = await inboxHook(request);
  const p = person();
  const pn = `${p.phone}@s.whatsapp.net`;
  const lid = `${p.lid}@lid`;
  const name = `Beto Lid ${uid()}`;
  await hook([message(pn, { senderName: name, body: 'consulta', timestamp: ago(10) })]);
  const [thread] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [accId, pn]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator(`[data-thread-id="${String(thread.id)}"]`).locator('.ib-row-btn').click();
  const field = page.getByRole('textbox', { name: 'Message' });
  await field.fill('te paso el precio');
  await field.press('Enter');
  await expect.poll(async () => (await sql('SELECT external_id FROM inbox_messages WHERE thread_id = ? AND from_me = 1', [String(thread.id)])).length, { timeout: 10_000 }).toBe(1);
  const [sent] = await sql('SELECT external_id FROM inbox_messages WHERE thread_id = ? AND from_me = 1', [String(thread.id)]);

  // La tilde de leído vuelve desde el lid, y la respuesta (con nombre) llega solo por lid.
  await hook([{ type: 'status', providerMessageId: String(sent.external_id), status: 'read', chatId: lid }]);
  await hook([message(lid, { senderLid: p.lid, senderName: name, body: 'perfecto, gracias' })]);
  const threads = await sql('SELECT id, external_id FROM inbox_threads WHERE account_id = ? AND external_id IN (?, ?)', [accId, pn, lid]);
  expect(threads.map((t) => t.external_id)).toEqual([pn]);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: name })).toHaveCount(1);
  await expect(page.locator('.ib-wa-thread .gr-msg')).toHaveCount(3);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: importado por teléfono y después en vivo por lid, un solo chat', async ({ request }) => {
  const { numberId, hook } = await lineHook(request);
  const p = person();
  const pn = `${p.phone}@s.whatsapp.net`;
  const lid = `${p.lid}@lid`;
  const mine = `ls-own-${uid()}`;
  await hook([
    message(pn, { senderName: 'Carla Lid', body: 'hola', timestamp: ago(30), history: true }),
    message(pn, { providerMessageId: mine, fromMe: true, senderPhone: '', body: 'una primera duda', timestamp: ago(20), history: true }),
  ]);
  await hook([message(lid, { providerMessageId: mine, fromMe: true, body: 'una primera duda', timestamp: ago(20) })]);
  await hook([message(lid, { senderLid: p.lid, senderName: 'Carla Lid', body: 'te respondo por acá' })]);
  const chats = await sql("SELECT id, provider_chat_id FROM groups_chats WHERE number_id = ? AND kind = 'dm'", [numberId]);
  expect(chats.map((c) => c.provider_chat_id)).toEqual([pn]);
  expect(await sql('SELECT 1 FROM groups_messages WHERE chat_id = ?', [String(chats[0].id)])).toHaveLength(3);
});

test('Lines: mando yo por el teléfono y la respuesta llega por lid, un solo chat', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { numberId, hook } = await lineHook(request);
  const p = person();
  const pn = `${p.phone}@s.whatsapp.net`;
  const lid = `${p.lid}@lid`;
  await hook([message(pn, { senderName: 'Dario Lid', body: 'consulta' })]);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, pn]);

  await page.goto(`/en/app/lines/inbox/${String(chat.id)}`, { waitUntil: 'networkidle' });
  const composer = page.getByLabel('WhatsApp', { exact: true });
  await composer.fill('te paso el precio');
  await composer.press('Enter');
  await expect.poll(async () => (await sql("SELECT 1 FROM groups_messages WHERE chat_id = ? AND direction = 'out' AND provider_message_id IS NOT NULL", [String(chat.id)])).length, { timeout: 10_000 }).toBe(1);
  const [sent] = await sql("SELECT provider_message_id FROM groups_messages WHERE chat_id = ? AND direction = 'out'", [String(chat.id)]);

  await hook([{ type: 'status', providerMessageId: String(sent.provider_message_id), status: 'read', chatId: lid }]);
  await hook([message(lid, { senderLid: p.lid, senderName: 'Dario Lid', body: 'perfecto, gracias' })]);
  const chats = await sql("SELECT provider_chat_id FROM groups_chats WHERE number_id = ? AND kind = 'dm'", [numberId]);
  expect(chats.map((c) => c.provider_chat_id)).toEqual([pn]);
  expect(errors, errors.join('\n')).toEqual([]);
});
