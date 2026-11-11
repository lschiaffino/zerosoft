import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Archivar entre zerosoft y WhatsApp (WhatsApp falso, GROUPS_FAKE=1), en Inbox
 * y en Lines:
 * - archivar acá deja el pedido mandado a WhatsApp con la hora del último
 *   mensaje (en segundos);
 * - un mensaje nuevo en un chat archivado lo devuelve a la lista sin recargar,
 *   en menos de lo que tarda la consulta periódica (Inbox 8 s, Lines 5 s);
 * - archivar o desarchivar desde el teléfono se ve al instante;
 * - el eco del teléfono no genera otro envío.
 * Nombres y números inventados.
 */

/** Menos que la consulta periódica de las listas: lo que llega antes es por el aviso en vivo. */
const LIVE_MS = 4_000;

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(chatId: string, body: string, senderName: string) {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName,
    providerMessageId: `e2e-${uid()}`,
    body,
    timestamp: new Date().toISOString(),
  };
}

async function pushRow(app: 'inbox' | 'lines', chatId: string) {
  const [row] = await sql('SELECT archived, version, done_at, last_error, sent, sent_count FROM wa_archive_push WHERE app = ? AND chat_id = ?', [app, chatId]);
  return row;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.describe('Inbox', () => {
  async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
    await request.post('/api/inbox/whatsapp');
    await expect
      .poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
      .toBe('connected');
    const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    return { id: String(row.id), secret: String(row.webhook_secret) };
  }

  async function events(request: APIRequestContext, acc: { id: string; secret: string }, list: unknown[]) {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
    expect(res.ok()).toBe(true);
  }

  test('archivar sale a WhatsApp; un mensaje nuevo y el teléfono mueven la fila al instante; el eco no rebota', async ({ page, request }) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const tag = uid();
    const name = `Paula ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    await events(request, acc, [message(jid, `hola ${tag}`, name)]);
    const [thread] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [acc.id, jid]);
    const threadId = String(thread.id);

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: name });
    await expect(row).toBeVisible();

    // Archivar (otra pestaña o el atajo): la fila se va sola y el pedido sale a WhatsApp con la hora en segundos.
    expect((await request.post('/api/inbox/threads', { data: { ids: [threadId], action: 'archive' } })).ok()).toBe(true);
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    await expect.poll(async () => (await pushRow('inbox', threadId))?.sent_count, { timeout: 5_000 }).toBe(1);
    const sent = JSON.parse(String((await pushRow('inbox', threadId)).sent)) as { jid: string; archive: boolean; ts: number };
    expect(sent).toMatchObject({ jid, archive: true });
    expect(sent.ts).toBeGreaterThan(1_700_000_000);
    expect(sent.ts).toBeLessThan(Date.now() / 1000 + 5);

    // El eco del teléfono: no cambia nada ni manda otra vez.
    await events(request, acc, [{ type: 'archive', chatId: jid, archived: true }]);
    expect(await pushRow('inbox', threadId)).toMatchObject({ version: 1, sent_count: 1 });

    // Llega un mensaje: vuelve a la bandeja sin recargar.
    await events(request, acc, [message(jid, `volví ${tag}`, name)]);
    await expect(row).toBeVisible({ timeout: LIVE_MS });
    await expect(row).toContainText(`volví ${tag}`);
    // Un mensaje que desarchiva no se manda a WhatsApp (WhatsApp hace lo suyo).
    expect(await pushRow('inbox', threadId)).toMatchObject({ version: 1, sent_count: 1 });

    // Archivar desde el teléfono: se va de la bandeja; desarchivar desde el teléfono: vuelve.
    await events(request, acc, [{ type: 'archive', chatId: jid, archived: true }]);
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    await events(request, acc, [{ type: 'archive', chatId: jid, archived: false }]);
    await expect(row).toBeVisible({ timeout: LIVE_MS });
    expect(await pushRow('inbox', threadId)).toMatchObject({ version: 1, sent_count: 1 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Lines', () => {
  interface NumberInfo {
    id: string;
    webhookUrl: string;
  }

  async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Archivo ${uid()}` } });
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

  test('archivar desde el menú sale a WhatsApp; el teléfono lo devuelve a la lista al instante; sin ida y vuelta', async ({ page, request }) => {
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const tag = uid();
    const name = `Ramiro ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    await events(request, n, [message(jid, `buenas ${tag}`, name)]);
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [n.id, jid]);
    const chatId = String(chat.id);

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const list = page.locator('.gr-rows');
    const row = list.locator('.gr-row', { hasText: name });
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: `Options for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Archive chat' }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await pushRow('lines', chatId))?.sent_count, { timeout: 5_000 }).toBe(1);
    const sent = JSON.parse(String((await pushRow('lines', chatId)).sent)) as { jid: string; archive: boolean; ts: number };
    expect(sent).toMatchObject({ jid, archive: true });
    expect(sent.ts).toBeGreaterThan(1_700_000_000);

    // El eco: nada cambia.
    await events(request, n, [{ type: 'archive', chatId: jid, archived: true }]);
    expect(await pushRow('lines', chatId)).toMatchObject({ version: 1, sent_count: 1 });

    // Desarchivar desde el teléfono: vuelve a la lista sin recargar.
    await events(request, n, [{ type: 'archive', chatId: jid, archived: false }]);
    await expect(row).toBeVisible({ timeout: LIVE_MS });
    // Archivar desde el teléfono: se va.
    await events(request, n, [{ type: 'archive', chatId: jid, archived: true }]);
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    expect(await pushRow('lines', chatId)).toMatchObject({ version: 1, sent_count: 1 });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('un mensaje nuevo en un chat de la lista lo sube sin recargar', async ({ page, request }) => {
    const n = await fakeNumber(request);
    const tag = uid();
    const name = `Sofía ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    await events(request, n, [message(jid, `primero ${tag}`, name)]);
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.gr-rows .gr-row', { hasText: name });
    await expect(row).toBeVisible();
    await events(request, n, [message(jid, `segundo ${tag}`, name)]);
    await expect(row).toContainText(`segundo ${tag}`, { timeout: LIVE_MS });
  });
});
