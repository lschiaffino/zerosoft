import { e2eDb } from './helpers/db';
import { expect, test, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * División VIP en Inbox y en Lines (WhatsApp falso), a 1280 y a 390: el ⋯ de
 * un chat 1:1 marca a la persona como VIP, la pestaña VIP lista sus chats (en
 * Lines, también el de otra línea) y no los de los demás; quitarla deja la
 * pestaña vacía. Sin scroll lateral. Nombres y números inventados.
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

for (const width of [1280, 390]) {
  test.describe(`a ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: 800 });
    });

    test('Inbox: marcar a una persona como VIP la trae a la pestaña VIP', async ({ page, request }) => {
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp', waLinkIp());
      await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const tag = uid();
      const vip = { jid: `${phone()}@s.whatsapp.net`, name: `Vera ${tag}` };
      const other = { jid: `${phone()}@s.whatsapp.net`, name: `Otro ${tag}` };
      expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [message(vip.jid, `hola ${tag}`, vip.name), message(other.jid, `che ${tag}`, other.name)] } })).ok()).toBe(true);
      const [thread] = await sql('SELECT id, handle FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), vip.jid]);
      const threadId = String(thread.id);

      await page.goto(`/en/app/inbox?t=${threadId}`, { waitUntil: 'networkidle' });
      const conv = page.locator('.ib-wa-thread');
      await expect(conv.locator('.gr-thread-head')).toContainText(vip.name, { timeout: FIRST_MS });
      await conv.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
      await page.getByTestId('menu-vip').click();
      await expect.poll(async () => (await sql('SELECT COUNT(*) AS n FROM inbox_vips WHERE handle = ?', [String(thread.handle)]))[0].n, { timeout: FIRST_MS }).toBe(1);

      await page.goto('/en/app/inbox/v/vip', { waitUntil: 'networkidle' });
      await expect(page.getByTestId('inbox-tab-vip')).toHaveAttribute('aria-current', 'page', { timeout: FIRST_MS });
      const row = page.locator('.ib-item', { hasText: vip.name });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await expect(page.locator('.ib-item', { hasText: other.name })).toHaveCount(0);
      await noSideScroll(page);

      // Quitar de VIP desde el chat: sale de la pestaña.
      await page.goto(`/en/app/inbox/v/vip?t=${threadId}`, { waitUntil: 'networkidle' });
      await expect(conv.locator('.gr-thread-head')).toContainText(vip.name, { timeout: FIRST_MS });
      await conv.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
      await page.getByTestId('menu-vip').click();
      await expect(page.locator('.ib-item', { hasText: vip.name })).toHaveCount(0, { timeout: FIRST_MS });
      expect((await sql('SELECT COUNT(*) AS n FROM inbox_vips WHERE handle = ?', [String(thread.handle)]))[0].n).toBe(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: marcar a una persona como VIP trae sus chats de todas las líneas a la pestaña VIP', async ({ page, request }) => {
      const errors = watchErrors(page);
      const line = async () => {
        const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `VIP ${uid()}` } });
        const id = ((await created.json()) as { id: string }).id;
        await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
        await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
        const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
        return { id, hook: new URL(info.webhookUrl).pathname };
      };
      const one = await line();
      const two = await line();
      const tag = uid();
      const vip = { jid: `${phone()}@s.whatsapp.net`, name: `Vera ${tag}` };
      const other = { jid: `${phone()}@s.whatsapp.net`, name: `Otro ${tag}` };
      expect((await request.post(one.hook, { data: { events: [message(vip.jid, `hola ${tag}`, vip.name), message(other.jid, `che ${tag}`, other.name)] } })).ok()).toBe(true);
      expect((await request.post(two.hook, { data: { events: [message(vip.jid, `por la otra ${tag}`, vip.name)] } })).ok()).toBe(true);
      const [chat] = await sql('SELECT id, phone FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [one.id, vip.jid]);
      const chatId = String(chat.id);

      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 2, name: vip.name })).toBeVisible({ timeout: FIRST_MS });
      await page.getByRole('button', { name: 'More chat actions' }).click();
      await page.getByTestId('menu-vip').click();
      await expect.poll(async () => (await sql('SELECT COUNT(*) AS n FROM groups_vips WHERE phone = ?', [String(chat.phone)]))[0].n, { timeout: FIRST_MS }).toBe(1);

      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      const tab = page.getByTestId('lines-tab-vip');
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      // El mismo chat en las dos líneas se lista una vez (con las dos líneas); el otro contacto no.
      await expect(page.getByTestId('chat-row').filter({ hasText: vip.name })).toHaveCount(1, { timeout: FIRST_MS });
      await expect(page.getByTestId('chat-row').filter({ hasText: other.name })).toHaveCount(0);
      await noSideScroll(page);

      expect((await request.patch(`/api/groups/chats/${chatId}`, { data: { vip: false } })).ok()).toBe(true);
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTestId('lines-tab-vip').click();
      await expect(page.getByTestId('chat-row').filter({ hasText: vip.name })).toHaveCount(0, { timeout: FIRST_MS });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
