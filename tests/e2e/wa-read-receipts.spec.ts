import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * WhatsApp con las "Confirmaciones de lectura" apagadas en el teléfono
 * (proveedor falso, `fake_privacy`). zerosoft sigue mostrando tildes azules en
 * un 1:1 leído (sabe más que el teléfono) y la explicación lo dice; en un grupo
 * la etiqueta es "Read" como siempre. En Lines y en Inbox. Workspace propio: la
 * privacidad de la cuenta de Inbox no se mezcla con otros archivos.
 * Números inventados.
 */

ownWorkspace('rr');

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
const HIDDEN = /^Read\. Your WhatsApp hides it because your read receipts are off/;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function outgoing(chatId: string, id: string, body: string, chatName?: string) {
  return {
    type: 'message',
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    fromMe: true,
    senderPhone: '',
    senderName: '',
    providerMessageId: id,
    body,
    status: 'sent',
    timestamp: new Date().toISOString(),
    ...(chatName ? { chatName } : {}),
  };
}

async function post(request: APIRequestContext, path: string, list: unknown[]) {
  const res = await request.post(path, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Lines: 1:1 leído con las confirmaciones apagadas sigue azul y explica por qué; el grupo dice "Read"', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Privacidad ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const hook = new URL(((await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string }).webhookUrl).pathname;
  // En el teléfono, las confirmaciones de lectura ya estaban apagadas al vincular.
  await post(request, hook, [{ type: 'fake_privacy', readreceipts: 'none' }]);
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  await expect.poll(async () => (await sql('SELECT read_receipts FROM groups_numbers WHERE id = ?', [id]))[0]?.read_receipts).toBe('none');

  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  await post(request, hook, [outgoing(`${phone()}@s.whatsapp.net`, `dm-${tag}`, `privado ${tag}`), outgoing(gid, `gr-${tag}`, `grupal ${tag}`, `Grupo ${tag}`)]);
  await post(request, hook, [
    { type: 'status', providerMessageId: `dm-${tag}`, status: 'read' },
    { type: 'status', providerMessageId: `gr-${tag}`, status: 'read' },
  ]);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const dmRow = page.locator('.gr-row', { hasText: `privado ${tag}` });
  await expect(dmRow).toBeVisible({ timeout: 20_000 });
  await expect(dmRow.locator('.wa-ticks.is-read')).toHaveAttribute('title', HIDDEN);
  const groupRow = page.locator('.gr-row', { hasText: `grupal ${tag}` });
  await expect(groupRow.locator('.wa-ticks.is-read')).toHaveAttribute('title', 'Read');

  await dmRow.click();
  const dmBubble = page.locator('.gr-msg-out', { hasText: `privado ${tag}` });
  await expect(dmBubble.locator('.wa-ticks.is-read')).toHaveAttribute('title', HIDDEN, { timeout: 20_000 });
  await expect(dmBubble.locator('.wa-ticks .wa-sr')).toHaveText(HIDDEN);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: `grupal ${tag}` }).click();
  const groupBubble = page.locator('.gr-msg-out', { hasText: `grupal ${tag}` });
  await expect(groupBubble.locator('.wa-ticks.is-read')).toHaveAttribute('title', 'Read', { timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: 1:1 leído con las confirmaciones apagadas sigue azul y explica por qué; el grupo dice "Read"', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const accountId = ((await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } }).account.id;
  const [acc] = await sql('SELECT id, webhook_secret FROM inbox_accounts WHERE id = ?', [accountId]);
  const hook = `/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`;
  // Se apagan en el teléfono; sin el dato todavía, el estado de la cuenta lo vuelve a leer.
  await post(request, hook, [{ type: 'fake_privacy', readreceipts: 'none' }]);
  await sql('UPDATE inbox_accounts SET privacy_at = NULL WHERE id = ?', [String(acc.id)]);
  await request.get('/api/inbox/whatsapp');
  await expect.poll(async () => (await sql('SELECT read_receipts FROM inbox_accounts WHERE id = ?', [String(acc.id)]))[0]?.read_receipts).toBe('none');

  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  await post(request, hook, [outgoing(`${phone()}@s.whatsapp.net`, `dm-${tag}`, `privado ${tag}`), outgoing(gid, `gr-${tag}`, `grupal ${tag}`, `Grupo ${tag}`)]);
  await post(request, hook, [
    { type: 'status', providerMessageId: `dm-${tag}`, status: 'read' },
    { type: 'status', providerMessageId: `gr-${tag}`, status: 'read' },
  ]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const dmRow = page.locator('.ib-item', { hasText: `privado ${tag}` });
  await expect(dmRow).toBeVisible({ timeout: 20_000 });
  await expect(dmRow.locator('.wa-ticks.is-read')).toHaveAttribute('title', HIDDEN);
  const groupRow = page.locator('.ib-item', { hasText: `grupal ${tag}` });
  await expect(groupRow.locator('.wa-ticks.is-read')).toHaveAttribute('title', 'Read');

  await dmRow.locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  const dmBubble = thread.locator('.gr-msg-out', { hasText: `privado ${tag}` });
  await expect(dmBubble.locator('.wa-ticks.is-read')).toHaveAttribute('title', HIDDEN, { timeout: 20_000 });

  await groupRow.locator('.ib-row-btn').click();
  const groupBubble = thread.locator('.gr-msg-out', { hasText: `grupal ${tag}` });
  await expect(groupBubble.locator('.wa-ticks.is-read')).toHaveAttribute('title', 'Read', { timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
