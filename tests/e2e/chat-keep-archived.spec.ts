import path from 'path';
import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * "Mantener archivado" por chat, en Inbox y en Lines (WhatsApp falso), a 1280 y a 390:
 * - se prende desde el panel de info del chat; el chat queda en Archivados con la marca en la fila;
 * - un mensaje que llega y uno que se manda desde acá no lo sacan de Archivados;
 * - el ⋯ del chat lo ofrece apagar y cierra con Esc y con un clic afuera;
 * - desarchivar a mano lo saca y apaga la marca;
 * - sin scroll lateral.
 * Nombres y números inventados. Con KEEP_ARCHIVED_SHOTS=<carpeta> deja capturas.
 */

const LIVE_MS = 30_000;
/** La primera vez que se abre una vista o un chat (local, con `next dev`, se compila en ese momento). */
const FIRST_MS = 60_000;
const SHOTS = process.env.KEEP_ARCHIVED_SHOTS;

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

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  await noSideScroll(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

for (const width of [1280, 390]) {
  test.describe(`a ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: 800 });
    });

    test('Inbox: mantener archivado desde la info del chat; los mensajes no lo sacan; desarchivar lo apaga', async ({ page, request }) => {
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp', waLinkIp());
      await expect
        .poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
        .toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const events = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
      const tag = uid();
      const name = `Paula ${tag}`;
      const jid = `${phone()}@s.whatsapp.net`;
      await events([message(jid, `hola ${tag}`, name)]);
      const [thread] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), jid]);
      const threadId = String(thread.id);
      const state = async () => {
        const [t] = await sql('SELECT archived_at, done_at, keep_archived FROM inbox_threads WHERE id = ?', [threadId]);
        return { archived: !!t.archived_at || !!t.done_at, keep: Number(t.keep_archived) === 1 };
      };

      // Se abre el chat por su link y se prende desde la info del contacto.
      await page.goto(`/en/app/inbox?t=${threadId}`, { waitUntil: 'networkidle' });
      const conv = page.locator('.ib-wa-thread');
      await expect(conv.locator('.gr-thread-head')).toContainText(name, { timeout: FIRST_MS });
      await conv.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Contact info' }).click();
      const keep = page.getByTestId('keep-archived');
      await expect(keep).toBeVisible({ timeout: FIRST_MS });
      await expect(keep).not.toBeChecked();
      await shot(page, `inbox-${width}-panel`);
      await keep.click();
      await expect(page.locator('.ib-toast', { hasText: 'Kept archived' })).toBeVisible({ timeout: FIRST_MS });
      await expect(keep).toBeChecked();
      await expect.poll(state).toEqual({ archived: true, keep: true });

      // Llega un mensaje y se manda otro: sigue archivado.
      await events([message(jid, `sigo acá ${tag}`, name)]);
      await page.keyboard.press('Escape');
      const field = page.getByRole('textbox', { name: 'Message' });
      await field.fill(`respuesta ${tag}`);
      await field.press('Enter');
      await expect(conv.getByText(`respuesta ${tag}`)).toBeVisible();
      await expect.poll(async () => (await sql("SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND from_me = 1", [threadId]))[0].n).toBe(1);
      expect(await state()).toEqual({ archived: true, keep: true });
      await expect(page.locator('.ib-toast', { hasText: 'Unarchived' })).toHaveCount(0);

      // En Archivados, con la marca.
      await page.goto('/en/app/inbox/v/archived', { waitUntil: 'networkidle' });
      const row = page.locator('.ib-item', { hasText: name });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await expect(row.getByRole('img', { name: 'Kept archived' })).toBeVisible();
      await shot(page, `inbox-${width}-archived`);

      // El ⋯ del chat ofrece apagarlo; cierra con Esc y con un clic afuera.
      await expect(async () => {
        await row.locator('.ib-row-btn').click();
        await expect(conv.locator('.gr-thread-head')).toContainText(name, { timeout: 5_000 });
      }).toPass({ timeout: FIRST_MS });
      const more = conv.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' });
      await more.click();
      const off = page.getByRole('menuitem', { name: 'Stop keeping archived' });
      await expect(off).toBeVisible();
      await shot(page, `inbox-${width}-menu`);
      await page.keyboard.press('Escape');
      await expect(off).toHaveCount(0);
      await more.click();
      await expect(off).toBeVisible();
      await page.mouse.click(5, 790);
      await expect(off).toHaveCount(0);

      // Desarchivar a mano: sale de Archivados y la marca se apaga.
      await more.click();
      await page.getByRole('menuitem', { name: 'Unarchive', exact: true }).click();
      await expect(row).toHaveCount(0, { timeout: LIVE_MS });
      await expect.poll(state).toEqual({ archived: false, keep: false });
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: mantener archivado desde los detalles del chat; los mensajes no lo sacan; desarchivar lo apaga', async ({ page, request }) => {
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Archivo ${uid()}` } });
      const { id: numberId } = (await created.json()) as { id: string };
      await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
      await expect
        .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
        .toBe('connected');
      const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
      const events = async (list: unknown[]) => expect((await request.post(new URL(webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
      const tag = uid();
      const name = `Ramiro ${tag}`;
      const jid = `${phone()}@s.whatsapp.net`;
      await events([message(jid, `buenas ${tag}`, name)]);
      const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]);
      const chatId = String(chat.id);
      const state = async () => {
        const [c] = await sql('SELECT archived_at, keep_archived FROM groups_chats WHERE id = ?', [chatId]);
        return { archived: !!c.archived_at, keep: Number(c.keep_archived) === 1 };
      };

      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: FIRST_MS });
      const more = page.getByRole('button', { name: 'More chat actions' });
      await more.click();
      await page.getByRole('menuitem', { name: 'Contact info' }).click();
      const keep = page.getByTestId('keep-archived');
      await expect(keep).toBeVisible({ timeout: FIRST_MS });
      await keep.scrollIntoViewIfNeeded();
      await expect(keep).not.toBeChecked();
      await shot(page, `lines-${width}-panel`);
      await keep.click();
      await expect(page.locator('.ui-toast', { hasText: 'Kept archived' })).toBeVisible({ timeout: FIRST_MS });
      await expect(keep).toBeChecked();
      await expect.poll(state).toEqual({ archived: true, keep: true });
      await page.keyboard.press('Escape');

      // Llega un mensaje y se manda otro: sigue archivado.
      await events([message(jid, `sigo acá ${tag}`, name)]);
      const composer = page.getByLabel('WhatsApp', { exact: true });
      await composer.fill(`respuesta ${tag}`);
      await composer.press('Enter');
      await expect(page.locator('.gr-msg-out', { hasText: `respuesta ${tag}` })).toBeVisible();
      await expect.poll(async () => (await sql("SELECT status FROM groups_messages WHERE chat_id = ? AND direction = 'out'", [chatId]))[0]?.status, { timeout: FIRST_MS }).toBe('sent');
      expect(await state()).toEqual({ archived: true, keep: true });
      await expect(page.locator('.ui-toast', { hasText: 'Chat unarchived' })).toHaveCount(0);

      // En Archivados, con la marca.
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.wa-archived-row').click({ timeout: FIRST_MS });
      const row = page.locator('.gr-rows .gr-row', { hasText: name });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await expect(row.getByRole('img', { name: 'Kept archived' })).toBeVisible();
      await shot(page, `lines-${width}-archived`);

      // El ⋯ del chat ofrece apagarlo; cierra con Esc y con un clic afuera.
      await row.click();
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: FIRST_MS });
      await more.click();
      const off = page.getByRole('menuitem', { name: 'Stop keeping archived' });
      await expect(off).toBeVisible();
      await shot(page, `lines-${width}-menu`);
      await page.keyboard.press('Escape');
      await expect(off).toHaveCount(0);
      await more.click();
      await expect(off).toBeVisible();
      await page.mouse.click(5, 790);
      await expect(off).toHaveCount(0);

      // Desarchivar a mano (desde la lista de Archivados): sale y la marca se apaga.
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.wa-archived-row').click();
      await page.getByRole('button', { name: `Options for ${name}` }).click();
      await page.getByRole('menuitem', { name: 'Unarchive chat' }).click();
      await expect(row).toHaveCount(0, { timeout: LIVE_MS });
      await expect.poll(state).toEqual({ archived: false, keep: false });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
