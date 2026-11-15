import path from 'path';
import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Mandar un mensaje desarchiva el chat, como WhatsApp (WhatsApp falso), en Inbox y en Lines:
 * - desde Archivados, el chat sale de la lista al mandar, queda abierto, hay aviso con Deshacer y el contador baja;
 * - a WhatsApp no sale ningún desarchivado (lo hace solo) y la línea no queda con error de archivado;
 * - un programado desarchiva cuando sale, no cuando se programa;
 * - lo mandado desde el teléfono (el eco fromMe del webhook) también.
 * Nombres y números inventados. Con SEND_UNARCHIVE_SHOTS=<carpeta> deja capturas de antes y después (1280 y 390).
 */

const LIVE_MS = 7_000;
/** La primera vez que se abre una vista o un chat (local, con `next dev`, se compila en ese momento). */
const FIRST_MS = 60_000;
const SHOTS = process.env.SEND_UNARCHIVE_SHOTS;

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
const inHour = () => new Date(Date.now() + 3600_000).toISOString();

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(chatId: string, body: string, senderName: string, over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

async function pushRow(app: 'inbox' | 'lines', chatId: string) {
  const [row] = await sql('SELECT archived, done_at, last_error, sent_count FROM wa_archive_push WHERE app = ? AND chat_id = ?', [app, chatId]);
  return row;
}

/** Capturas de antes y después, en escritorio y en teléfono (solo si se pidieron). */
async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}-1280.png`) });
  await page.setViewportSize({ width: 390, height: 800 });
  // Solo para la captura: que termine la transición del cambio de ancho.
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `${name}-390.png`) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  // Un recorrido largo (archivar, mandar, deshacer, programado y teléfono) en un solo test.
  test.setTimeout(240_000);
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

  const archivedState = async (threadId: string) => {
    const [t] = await sql('SELECT archived_at, done_at FROM inbox_threads WHERE id = ?', [threadId]);
    return !!t.archived_at || !!t.done_at;
  };

  test('mandar desde Archivados desarchiva: sale de la lista, queda abierto, con Deshacer; programado y teléfono también', async ({ page, request }) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const tag = uid();
    const name = `Paula ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    await events(request, acc, [message(jid, `hola ${tag}`, name), message(`${phone()}@s.whatsapp.net`, `buenas ${tag}`, `Otro ${tag}`)]);
    const [thread] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [acc.id, jid]);
    const threadId = String(thread.id);
    const archive = async () => expect((await request.post('/api/inbox/threads', { data: { ids: [threadId], action: 'archive' } })).ok()).toBe(true);
    await archive();
    await expect.poll(async () => (await pushRow('inbox', threadId))?.sent_count, { timeout: 5_000 }).toBe(1);

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: name });
    await expect(row).toHaveCount(0);
    const entry = page.getByTestId('inbox-archived-entry');
    const before = Number(await entry.locator('.ib-archived-n').innerText());
    await entry.click();
    // Primera vez en esta vista y en este chat: con `next dev` se compilan recién ahí.
    await expect(page.locator('.ib-list')).toHaveAttribute('data-list', 'v:archived|', { timeout: FIRST_MS });
    await row.locator('.ib-row-btn').click();
    const head = page.locator('.ib-wa-thread .gr-thread-head');
    await expect(head).toContainText(name, { timeout: FIRST_MS });
    await shots(page, 'inbox-before');

    // Mandar: el chat sale de Archivados ya, sigue abierto y hay aviso con Deshacer.
    const field = page.getByRole('textbox', { name: 'Message' });
    await field.fill(`ahí va ${tag}`);
    await field.press('Enter');
    await expect(row).toHaveCount(0);
    const toast = page.locator('.ib-toast', { hasText: 'Unarchived' });
    await expect(toast).toBeVisible();
    await expect(head).toContainText(name);
    await expect(page.locator('.ib-wa-thread').getByText(`ahí va ${tag}`)).toBeVisible();
    await expect.poll(() => archivedState(threadId), { timeout: FIRST_MS }).toBe(false);
    await shots(page, 'inbox-after');
    // A WhatsApp no salió ningún desarchivado: solo el archivado de antes, y la cuenta sin error de archivado.
    expect(await pushRow('inbox', threadId)).toMatchObject({ archived: 0, last_error: 'by_send', sent_count: 1 });
    expect((await sql('SELECT archive_sync_error FROM inbox_accounts WHERE id = ?', [acc.id]))[0].archive_sync_error).toBe('');

    // Deshacer lo vuelve a archivar (eso sí sale a WhatsApp).
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toBeVisible();
    await expect.poll(async () => (await pushRow('inbox', threadId))?.sent_count, { timeout: 8_000 }).toBe(2);
    expect(await archivedState(threadId)).toBe(true);

    // Otra vez: en la bandeja está en la lista y el contador de Archivados bajó.
    await field.fill(`de nuevo ${tag}`);
    await field.press('Enter');
    await expect(row).toHaveCount(0);
    await expect.poll(() => archivedState(threadId), { timeout: FIRST_MS }).toBe(false);
    await page.getByTestId('inbox-archived-back').click();
    await expect(row).toBeVisible({ timeout: FIRST_MS });
    await expect(row).toContainText(`de nuevo ${tag}`);
    await expect(head).toContainText(name);
    if (before > 1) await expect(entry.locator('.ib-archived-n')).toHaveText(String(before - 1));
    else await expect(entry).toHaveCount(0);
    await shots(page, 'inbox-main-list');

    // Un programado: archivado sigue al programarlo y se desarchiva cuando sale.
    await archive();
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    const res = await request.post(`/api/inbox/threads/${threadId}/messages`, { data: { body: `más tarde ${tag}`, sendAt: inHour() } });
    expect(res.status()).toBe(201);
    const { scheduled } = (await res.json()) as { scheduled: { id: string } };
    expect(await archivedState(threadId)).toBe(true);
    expect((await request.post(`/api/inbox/scheduled/${scheduled.id}`)).ok()).toBe(true);
    expect(await archivedState(threadId)).toBe(false);
    await expect(row).toBeVisible({ timeout: LIVE_MS });

    // Mandado desde el teléfono (el eco fromMe): también.
    await archive();
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    await events(request, acc, [message(jid, `desde el teléfono ${tag}`, name, { fromMe: true })]);
    expect(await archivedState(threadId)).toBe(false);
    await expect(row).toBeVisible({ timeout: LIVE_MS });
    // El aviso de desarchivado que manda el teléfono después no cambia nada.
    await events(request, acc, [{ type: 'archive', chatId: jid, archived: false }]);
    expect(await pushRow('inbox', threadId)).toMatchObject({ archived: 0, last_error: 'by_send' });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Lines', () => {
  interface NumberInfo {
    id: string;
    webhookUrl: string;
  }

  async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Envío ${uid()}` } });
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

  const archivedState = async (chatId: string) => !!(await sql('SELECT archived_at FROM groups_chats WHERE id = ?', [chatId]))[0].archived_at;

  test('mandar desde Archivados desarchiva: sale de la lista, queda abierto, con Deshacer; programado y teléfono también', async ({ page, request }) => {
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const tag = uid();
    const name = `Ramiro ${tag}`;
    const jid = `${phone()}@s.whatsapp.net`;
    await events(request, n, [message(jid, `buenas ${tag}`, name), message(`${phone()}@s.whatsapp.net`, `hola ${tag}`, `Otra ${tag}`)]);
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [n.id, jid]);
    const chatId = String(chat.id);
    const archive = async () => expect((await request.patch(`/api/groups/chats/${chatId}`, { data: { archived: true } })).ok()).toBe(true);
    await archive();
    await expect.poll(async () => (await pushRow('lines', chatId))?.sent_count, { timeout: 5_000 }).toBe(1);

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.gr-rows .gr-row', { hasText: name });
    await expect(row).toHaveCount(0);
    const archivedRow = page.locator('.wa-archived-row');
    await archivedRow.click();
    await expect(page.locator('.wa-archived-head')).toBeVisible();
    await row.click();
    const heading = page.getByRole('heading', { level: 2, name });
    await expect(heading).toBeVisible({ timeout: FIRST_MS });
    await expect(page.locator('.wa-archived-head')).toBeVisible();
    await shots(page, 'lines-before');

    // Mandar: el chat sale de Archivados ya, sigue abierto y hay aviso con Deshacer.
    const composer = page.getByLabel('WhatsApp', { exact: true });
    await composer.fill(`ahí va ${tag}`);
    await composer.press('Enter');
    await expect(row).toHaveCount(0);
    const toast = page.locator('.ui-toast', { hasText: 'Chat unarchived' });
    await expect(toast).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(page.locator('.gr-msg-out', { hasText: `ahí va ${tag}` })).toBeVisible();
    await expect.poll(() => archivedState(chatId), { timeout: FIRST_MS }).toBe(false);
    await shots(page, 'lines-after');
    // A WhatsApp no salió ningún desarchivado: solo el archivado de antes, y el número sin error de archivado.
    expect(await pushRow('lines', chatId)).toMatchObject({ archived: 0, last_error: 'by_send', sent_count: 1 });
    expect((await sql('SELECT archive_sync_error FROM groups_numbers WHERE id = ?', [n.id]))[0].archive_sync_error).toBe('');

    // Deshacer lo vuelve a archivar (eso sí sale a WhatsApp).
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toBeVisible();
    await expect.poll(async () => (await pushRow('lines', chatId))?.sent_count, { timeout: 8_000 }).toBe(2);
    expect(await archivedState(chatId)).toBe(true);

    // Otra vez: en la lista principal está el chat y ya no hay fila de Archivados para este número.
    await composer.fill(`de nuevo ${tag}`);
    await composer.press('Enter');
    await expect(row).toHaveCount(0);
    await expect.poll(() => archivedState(chatId), { timeout: FIRST_MS }).toBe(false);
    await page.locator('.wa-archived-head button').click();
    await expect(row).toBeVisible({ timeout: FIRST_MS });
    await expect(row).toContainText(`de nuevo ${tag}`);
    await expect(heading).toBeVisible();
    await shots(page, 'lines-main-list');

    // Un programado: archivado sigue al programarlo y se desarchiva cuando sale.
    await archive();
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    const res = await request.post('/api/groups/broadcasts', { data: { chatIds: [chatId], body: `más tarde ${tag}`, kind: 'scheduled', scheduledAt: inHour() } });
    expect(res.ok(), await res.text()).toBe(true);
    const { id: broadcastId } = (await res.json()) as { id: string };
    expect(await archivedState(chatId)).toBe(true);
    expect((await request.patch(`/api/groups/broadcasts/${broadcastId}`, { data: { action: 'send_now' } })).ok()).toBe(true);
    await expect.poll(() => archivedState(chatId), { timeout: 15_000 }).toBe(false);
    await expect(row).toBeVisible({ timeout: LIVE_MS });

    // Mandado desde el teléfono (el eco fromMe): también.
    await archive();
    await expect(row).toHaveCount(0, { timeout: LIVE_MS });
    await events(request, n, [message(jid, `desde el teléfono ${tag}`, name, { fromMe: true })]);
    expect(await archivedState(chatId)).toBe(false);
    await expect(row).toBeVisible({ timeout: LIVE_MS });
    await events(request, n, [{ type: 'archive', chatId: jid, archived: false }]);
    expect(await pushRow('lines', chatId)).toMatchObject({ archived: 0, last_error: 'by_send' });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
