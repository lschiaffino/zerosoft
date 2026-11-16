import { e2eDb } from './helpers/db';
import { expect, test, type Page } from '@playwright/test';

/**
 * Un mensaje que llega a un chat archivado lo desarchiva, en Inbox y en Lines (WhatsApp falso), a 1280 y a 390:
 * mirando Archivados, el chat sale de ahí sin recargar y aparece en la lista principal; en Inbox también silenciado.
 * Un chat con "Mantener archivado" se queda. Nombres y números inventados.
 */

const LIVE_MS = 30_000;
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
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 800 });
    });

    test('Inbox: llega un mensaje y el chat sale de Archivados (también silenciado); uno con Mantener archivado se queda', async ({ page, request }) => {
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp');
      await expect
        .poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
        .toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const events = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
      const tag = uid();
      const [muted, kept] = [`Muda ${tag}`, `Guardada ${tag}`];
      const [jm, jk] = [`${phone()}@s.whatsapp.net`, `${phone()}@s.whatsapp.net`];
      await events([message(jm, `hola ${tag}`, muted), message(jk, `hola ${tag}`, kept)]);
      const idOf = async (jid: string) => String((await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), jid]))[0].id);
      const [im, ik] = [await idOf(jm), await idOf(jk)];
      const post = async (data: Record<string, unknown>) => expect((await request.post('/api/inbox/threads', { data })).ok()).toBe(true);
      await post({ ids: [im], action: 'mute', until: new Date(Date.now() + 86_400_000).toISOString() });
      await post({ ids: [im], action: 'archive' });
      await post({ ids: [ik], action: 'keepArchived', on: true });

      await page.goto('/en/app/inbox/v/archived', { waitUntil: 'networkidle' });
      const rowM = page.locator('.ib-item', { hasText: muted });
      const rowK = page.locator('.ib-item', { hasText: kept });
      await expect(rowM).toBeVisible({ timeout: FIRST_MS });
      await expect(rowK).toBeVisible();

      await events([message(jm, `volví ${tag}`, muted), message(jk, `volví ${tag}`, kept)]);
      await expect(rowM).toHaveCount(0, { timeout: LIVE_MS });
      await expect(rowK).toContainText(`volví ${tag}`, { timeout: LIVE_MS });
      await noSideScroll(page);

      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(rowM).toBeVisible({ timeout: FIRST_MS });
      await expect(rowK).toHaveCount(0);
      await noSideScroll(page);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: llega un mensaje y el chat sale de Archivados; uno con Mantener archivado se queda', async ({ page, request }) => {
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Llega ${uid()}` } });
      const { id: numberId } = (await created.json()) as { id: string };
      await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
      await expect
        .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
        .toBe('connected');
      const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
      const events = async (list: unknown[]) => expect((await request.post(new URL(webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
      const tag = uid();
      const [back, kept] = [`Vuelve ${tag}`, `Queda ${tag}`];
      const [jb, jk] = [`${phone()}@s.whatsapp.net`, `${phone()}@s.whatsapp.net`];
      await events([message(jb, `hola ${tag}`, back), message(jk, `hola ${tag}`, kept)]);
      const idOf = async (jid: string) => String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]))[0].id);
      const [ib, ik] = [await idOf(jb), await idOf(jk)];
      expect((await request.patch(`/api/groups/chats/${ib}`, { data: { archived: true } })).ok()).toBe(true);
      expect((await request.patch(`/api/groups/chats/${ik}`, { data: { keepArchived: true } })).ok()).toBe(true);

      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.wa-archived-row').click({ timeout: FIRST_MS });
      const rowB = page.locator('.gr-rows .gr-row', { hasText: back });
      const rowK = page.locator('.gr-rows .gr-row', { hasText: kept });
      await expect(rowB).toBeVisible({ timeout: FIRST_MS });
      await expect(rowK).toBeVisible();

      await events([message(jb, `volví ${tag}`, back), message(jk, `volví ${tag}`, kept)]);
      await expect(rowB).toHaveCount(0, { timeout: LIVE_MS });
      await expect(rowK).toContainText(`volví ${tag}`, { timeout: LIVE_MS });
      await noSideScroll(page);

      await page.locator('.wa-archived-head button').click();
      await expect(rowB).toBeVisible({ timeout: LIVE_MS });
      await expect(rowK).toHaveCount(0);
      await noSideScroll(page);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
