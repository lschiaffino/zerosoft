import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox y Lines con el WhatsApp falso (GROUPS_FAKE=1): desvincular y volver a
 * vincular el mismo número no duplica chats ni mensajes. Al volver a vincular,
 * el historial llega otra vez y la misma persona puede venir por su lid
 * ("<lid>@lid") en lugar de su teléfono: queda un solo chat, el del teléfono,
 * con cada mensaje una vez. Números y lids inventados.
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
    providerMessageId: `rl-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

/** El historial de antes, el que vuelve al re-vincular (el recibido llega por lid) y uno nuevo en vivo por lid. */
function script(p: { phone: string; lid: string }) {
  const pn = `${p.phone}@s.whatsapp.net`;
  const lid = `${p.lid}@lid`;
  const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const a = message(pn, { providerMessageId: `rl-a-${uid()}`, body: 'turno', timestamp: t(30), history: true });
  const b = message(pn, { providerMessageId: `rl-b-${uid()}`, fromMe: true, senderPhone: '', body: 'confirmado', timestamp: t(29), status: 'read', history: true });
  const before = [a, b];
  const again = [{ ...a, chatId: lid, senderPhone: '', senderLid: p.lid }, b, message(pn, { providerMessageId: `rl-c-${uid()}`, body: 'gracias', timestamp: t(28), history: true })];
  const live = [message(lid, { providerMessageId: `rl-d-${uid()}`, senderLid: p.lid, body: 'nos vemos', timestamp: t(1) })];
  return { pn, lid, before, again, live };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Inbox: desvincular y volver a vincular el mismo número no duplica chats ni mensajes', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const hook = async (list: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const p = person();
  const s = script(p);
  await hook(s.before);

  // Desvincular y volver a vincular desde Ajustes.
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const card = page.getByTestId('inbox-wa-card');
  await card.getByTestId('inbox-wa-unlink').click();
  await page.getByTestId('inbox-wa-unlink-yes').click();
  const waStatus = async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status;
  await expect.poll(waStatus, { timeout: 20_000 }).toBe('disconnected');
  await expect(card.getByTestId('inbox-wa-link')).toBeVisible({ timeout: 20_000 });
  await card.getByTestId('inbox-wa-link').click();
  await expect(page.getByRole('dialog').getByRole('status')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('inbox-wa-unlink')).toBeVisible({ timeout: 20_000 });

  // Vuelve el historial (el recibido por lid), dos veces, y un mensaje nuevo por lid.
  await hook(s.again);
  await hook(s.again);
  await hook(s.live);

  const [same] = await sql("SELECT a.id FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  expect(same.id).toBe(acc.id);
  const threads = await sql('SELECT id, external_id FROM inbox_threads WHERE account_id = ? AND external_id IN (?, ?)', [String(acc.id), s.pn, s.lid]);
  expect(threads.map((t) => t.external_id)).toEqual([s.pn]);
  const msgs = await sql('SELECT external_id FROM inbox_messages WHERE thread_id = ?', [String(threads[0].id)]);
  expect(msgs).toHaveLength(4);
  expect(new Set(msgs.map((m) => m.external_id)).size).toBe(4);

  // En la lista, una sola fila; abierta, los cuatro mensajes.
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator(`[data-thread-id="${String(threads[0].id)}"]`);
  await expect(row).toHaveCount(1);
  await row.locator('.ib-row-btn').click();
  await expect(page.locator('.ib-wa-thread .gr-msg')).toHaveCount(4);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: desconectar y volver a conectar la misma línea no duplica chats ni mensajes', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Relink ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  const status = async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status;
  await expect.poll(status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const hook = async (list: unknown[]) => {
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const p = person();
  const s = script(p);
  await hook(s.before);

  // Desconectar y volver a conectar desde Ajustes › Números.
  await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
  const card = page.locator(`[data-number-id="${id}"]`);
  await card.getByTestId('line-disconnect-btn').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect.poll(status, { timeout: 20_000 }).toBe('disconnected');
  await expect(card.getByTestId('line-disconnect-btn')).toHaveCount(0, { timeout: 20_000 });
  await card.getByTestId('line-connect-btn').click();
  await expect.poll(status, { timeout: 20_000 }).toBe('connected');
  await page.keyboard.press('Escape');

  await hook(s.again);
  await hook(s.again);
  await hook(s.live);

  const numbers = await sql('SELECT id FROM groups_numbers WHERE id = ?', [id]);
  expect(numbers).toHaveLength(1);
  const chats = await sql('SELECT id, provider_chat_id FROM groups_chats WHERE number_id = ? AND provider_chat_id IN (?, ?)', [id, s.pn, s.lid]);
  expect(chats.map((c) => c.provider_chat_id)).toEqual([s.pn]);
  const msgs = await sql('SELECT provider_message_id FROM groups_messages WHERE chat_id = ?', [String(chats[0].id)]);
  expect(msgs).toHaveLength(4);
  expect(new Set(msgs.map((m) => m.provider_message_id)).size).toBe(4);

  // En la bandeja, una sola fila; abierta, los cuatro mensajes.
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator(`a.gr-row[href*="/app/lines/inbox/${String(chats[0].id)}"]`);
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.click();
  await expect(page.locator('.gr-msg')).toHaveCount(4, { timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
