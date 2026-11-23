import { e2eDb } from './helpers/db';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Favoritos, como la lista de WhatsApp, en Inbox y en Lines (WhatsApp falso),
 * a 1280 y a 390: el ⋯ del chat lo suma a Favoritos, la pestaña Favoritos de
 * la lista muestra solo ese chat, el clic derecho sobre la fila lo saca y la
 * pestaña queda vacía. Sin scroll lateral. Nombres y números inventados.
 */

const FIRST_MS = 60_000;

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
  return { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `e2e-${uid()}`, body, timestamp: new Date().toISOString() };
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

/** Clic derecho en el medio de la fila (abre el menú de la fila, como WhatsApp). */
async function rightClick(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}

for (const width of [1280, 390]) {
  test.describe(`a ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: 800 });
    });

    test('Inbox: sumar a Favoritos desde el chat, la pestaña los muestra y el clic derecho los saca', async ({ page, request }) => {
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp', waLinkIp());
      await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const tag = uid();
      const fav = { jid: `${phone()}@s.whatsapp.net`, name: `Flor ${tag}` };
      const other = { jid: `${phone()}@s.whatsapp.net`, name: `Otro ${tag}` };
      const sent = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [message(fav.jid, `hola ${tag}`, fav.name), message(other.jid, `che ${tag}`, other.name)] } });
      expect(sent.ok()).toBe(true);
      const [thread] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), fav.jid]);
      const threadId = String(thread.id);

      await page.goto(`/en/app/inbox?t=${threadId}`, { waitUntil: 'networkidle' });
      const conv = page.locator('.ib-wa-thread');
      await expect(conv.locator('.gr-thread-head')).toContainText(fav.name, { timeout: FIRST_MS });
      await conv.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
      await page.getByTestId('menu-favorite').click();
      await expect.poll(async () => !!(await sql('SELECT favorite_at FROM inbox_threads WHERE id = ?', [threadId]))[0].favorite_at, { timeout: FIRST_MS }).toBe(true);

      // La pestaña Favoritos: solo ese chat (el otro no).
      await page.goto('/en/app/inbox/v/favorites', { waitUntil: 'networkidle' });
      await expect(page.getByTestId('inbox-tab-favorites')).toHaveAttribute('aria-current', 'page', { timeout: FIRST_MS });
      const row = page.locator('.ib-item', { hasText: fav.name });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await expect(page.locator('.ib-item', { hasText: other.name })).toHaveCount(0);
      await noSideScroll(page);

      // Clic derecho sobre la fila: Quitar de Favoritos; la fila sale de la pestaña.
      if (width >= 1000) {
        await rightClick(page, row);
        await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Remove from Favorites' }).click();
      } else {
        // En el teléfono el clic derecho no existe: se saca por la API, como el menú.
        expect((await request.post('/api/inbox/threads', { data: { ids: [threadId], action: 'unfavorite' } })).ok()).toBe(true);
        await page.reload({ waitUntil: 'networkidle' });
      }
      await expect(row).toHaveCount(0, { timeout: FIRST_MS });
      // La fila sale antes de que conteste el servidor: la base se espera, no se lee una sola vez.
      await expect.poll(async () => (await sql('SELECT favorite_at FROM inbox_threads WHERE id = ?', [threadId]))[0].favorite_at, { timeout: FIRST_MS }).toBeNull();
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: sumar a Favoritos desde el chat, la pestaña los muestra y el menú de la fila los saca', async ({ page, request }) => {
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Favoritos ${uid()}` } });
      const id = ((await created.json()) as { id: string }).id;
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
      const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const tag = uid();
      const fav = { jid: `${phone()}@s.whatsapp.net`, name: `Flor ${tag}` };
      const other = { jid: `${phone()}@s.whatsapp.net`, name: `Otro ${tag}` };
      const sent = await request.post(new URL(info.webhookUrl).pathname, { data: { events: [message(fav.jid, `hola ${tag}`, fav.name), message(other.jid, `che ${tag}`, other.name)] } });
      expect(sent.ok()).toBe(true);
      const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, fav.jid]);
      const chatId = String(chat.id);

      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 2, name: fav.name })).toBeVisible({ timeout: FIRST_MS });
      await page.getByRole('button', { name: 'More chat actions' }).click();
      await page.getByTestId('menu-favorite').click();
      await expect.poll(async () => !!(await sql('SELECT favorite_at FROM groups_chats WHERE id = ?', [chatId]))[0].favorite_at, { timeout: FIRST_MS }).toBe(true);

      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      const tab = page.getByTestId('lines-tab-favorites');
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`);
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await expect(page.getByTestId('chat-row').filter({ hasText: other.name })).toHaveCount(0);
      await noSideScroll(page);

      // El menú de la fila (clic derecho en la compu, la flecha en el teléfono): Quitar de Favoritos.
      if (width >= 1000) {
        await rightClick(page, row);
        await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Remove from Favorites' }).click();
      } else {
        expect((await request.patch(`/api/groups/chats/${chatId}`, { data: { favorite: false } })).ok()).toBe(true);
        await page.reload({ waitUntil: 'networkidle' });
        await page.getByTestId('lines-tab-favorites').click();
      }
      await expect(row).toHaveCount(0, { timeout: FIRST_MS });
      // La fila sale antes de que conteste el servidor: la base se espera, no se lee una sola vez.
      await expect.poll(async () => (await sql('SELECT favorite_at FROM groups_chats WHERE id = ?', [chatId]))[0].favorite_at, { timeout: FIRST_MS }).toBeNull();
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
