import path from 'path';
import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Posponer archiva el chat y al volver lo desarchiva (WhatsApp falso), en Inbox y en Lines, en 1280 y en 390:
 * - al posponer, el chat sale de la lista principal al instante y aparece en Archivados (y en Pospuestos en Inbox),
 *   con la marca de pospuesto, y el archivado sale a WhatsApp;
 * - cuando vence (el cron del minuto), vuelve a la lista principal, sale de Archivados y el desarchivado sale a WhatsApp.
 * Nombres y números inventados. Con SNOOZE_SHOTS=<carpeta> deja capturas.
 */

const FIRST_MS = 60_000;
/** Lo que espera al servidor (guardar, el cron, el aviso en vivo). Local, con `next dev` cargado por el cron, tarda. */
const SERVER_MS = 45_000;
const SHOTS = process.env.SNOOZE_SHOTS;

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
  // Lo que la consola marca como error (el aviso de Next en desarrollo): se muestra en el log, sin fallar el test.
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console.error] ${msg.text().slice(0, 400)}`);
  });
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
  const [row] = await sql('SELECT archived, done_at, sent_count FROM wa_archive_push WHERE app = ? AND chat_id = ?', [app, chatId]);
  return row;
}

async function cron(request: APIRequestContext) {
  expect((await request.get('/api/cron/minute', { headers: { authorization: 'Bearer e2e-cron' } })).ok()).toBe(true);
}

async function shot(page: Page, name: string, width: number) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`) });
}

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: 800 });
    });

    test('Inbox: posponer archiva (Archivados y Pospuestos, no la bandeja) y al vencer vuelve a la bandeja', async ({ page, request }) => {
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp', waLinkIp());
      await expect
        .poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
        .toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const tag = uid();
      const name = `Valeria ${tag}`;
      const jid = `${phone()}@s.whatsapp.net`;
      const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [message(jid, `hola ${tag}`, name)] } });
      expect(res.ok()).toBe(true);
      const [thread] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), jid]);
      const threadId = String(thread.id);

      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      const row = page.locator('.ib-item', { hasText: name });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await shot(page, 'inbox-1-before', width);
      await row.locator('.ib-row-btn').focus();
      await page.keyboard.press('h');
      const dialog = page.getByRole('dialog', { name: 'Snooze until' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('3');
      // Sale de la bandeja al instante y la entrada de Archivados aparece.
      await expect(row).toHaveCount(0);
      await expect(page.getByTestId('inbox-archived-entry')).toBeVisible();
      await expect.poll(async () => (await sql('SELECT archived_at, snoozed_until FROM inbox_threads WHERE id = ?', [threadId]))[0], { timeout: SERVER_MS }).toMatchObject({
        archived_at: expect.any(String),
        snoozed_until: expect.any(String),
      });
      await expect.poll(async () => (await pushRow('inbox', threadId))?.sent_count, { timeout: SERVER_MS }).toBe(1);
      await shot(page, 'inbox-2-snoozed', width);

      await page.getByTestId('inbox-archived-entry').click();
      await expect(page.locator('.ib-list')).toHaveAttribute('data-list', 'v:archived|', { timeout: FIRST_MS });
      await expect(row).toBeVisible();
      await expect(row.getByTestId('inbox-row-snoozed')).toBeVisible();
      await shot(page, 'inbox-3-archived', width);
      await page.goto('/en/app/inbox/v/snoozed', { waitUntil: 'networkidle' });
      await expect(row).toBeVisible({ timeout: FIRST_MS });

      // Vence: el cron lo devuelve a la bandeja y lo desarchiva en WhatsApp.
      await sql('UPDATE inbox_threads SET snoozed_until = ? WHERE id = ?', [new Date(Date.now() - 60_000).toISOString(), threadId]);
      await cron(request);
      await expect.poll(async () => (await pushRow('inbox', threadId))?.archived, { timeout: SERVER_MS }).toBe(0);
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await shot(page, 'inbox-4-woke', width);
      // Archivados: el chat ya no está (la vista puede quedar vacía: se espera el "volver a la bandeja" de esa vista).
      await page.goto('/en/app/inbox/v/archived', { waitUntil: 'networkidle' });
      await expect(page.getByTestId('inbox-archived-back')).toBeVisible({ timeout: FIRST_MS });
      await expect(row).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: posponer archiva (Archivados con la marca, no la lista) y al vencer vuelve a la lista', async ({ page, request }) => {
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Pospuesto ${uid()}` } });
      expect(created.ok()).toBe(true);
      const { id: numberId } = (await created.json()) as { id: string };
      await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
      await expect
        .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
        .toBe('connected');
      const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
      const tag = uid();
      const name = `Esteban ${tag}`;
      const jid = `${phone()}@s.whatsapp.net`;
      const res = await request.post(new URL(webhookUrl).pathname, { data: { events: [message(jid, `buenas ${tag}`, name)] } });
      expect(res.ok(), await res.text()).toBe(true);
      const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]);
      const chatId = String(chat.id);

      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      const row = page.locator('.gr-rows .gr-row', { hasText: name });
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await shot(page, 'lines-1-before', width);
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Snooze chat' }).click();
      const dialog = page.getByRole('dialog', { name: 'Snooze until' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('3');
      await expect(dialog).toBeHidden();
      // Sale de la lista al instante; la fila de Archivados está.
      await expect(row).toHaveCount(0);
      await expect(page.locator('.ui-toast', { hasText: 'Snoozed until' })).toBeVisible({ timeout: SERVER_MS });
      const archivedRow = page.locator('.wa-archived-row');
      await expect(archivedRow).toBeVisible();
      await expect.poll(async () => (await pushRow('lines', chatId))?.sent_count, { timeout: SERVER_MS }).toBe(1);
      await shot(page, 'lines-2-snoozed', width);

      await archivedRow.click();
      await expect(page.locator('.wa-archived-head')).toBeVisible();
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await expect(row.getByTestId('lines-row-snoozed')).toBeVisible();
      await shot(page, 'lines-3-archived', width);

      // Vence: el cron lo devuelve a la lista y lo desarchiva en WhatsApp.
      await sql('UPDATE groups_chats SET snoozed_until = ? WHERE id = ?', [new Date(Date.now() - 60_000).toISOString(), chatId]);
      await cron(request);
      await expect.poll(async () => (await sql('SELECT archived_at FROM groups_chats WHERE id = ?', [chatId]))[0].archived_at, { timeout: SERVER_MS }).toBeNull();
      await expect.poll(async () => (await pushRow('lines', chatId))?.archived, { timeout: SERVER_MS }).toBe(0);
      // En Archivados ya no está (la pantalla abierta se entera sola).
      await expect(row).toHaveCount(0, { timeout: SERVER_MS });
      await page.locator('.wa-archived-head button').click();
      await expect(row).toBeVisible({ timeout: FIRST_MS });
      await shot(page, 'lines-4-woke', width);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
