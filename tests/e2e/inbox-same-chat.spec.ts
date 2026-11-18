import { randomBytes } from 'crypto';
import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox: el mismo chat en dos cuentas de WhatsApp de la persona (proveedor
 * falso). La bandeja lo lista una vez, con los no leídos de las dos; al
 * abrirlo, la conversación junta los mensajes de las dos cuentas sin repetir
 * el que llegó por ambas, y cada mensaje deja ver por qué cuenta entró.
 * Nombres y números inventados.
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
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

type Acc = { id: string; secret: string; owner: string };

async function linkWhatsapp(request: APIRequestContext): Promise<Acc> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql(
    "SELECT a.id, a.webhook_secret, a.owner_id FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai' ORDER BY a.created_at LIMIT 1",
  );
  return { id: String(row.id), secret: String(row.webhook_secret), owner: String(row.owner_id) };
}

/** Una segunda cuenta de WhatsApp de la misma persona, ya conectada (la pantalla vincula una; la base admite varias). */
async function secondAccount(owner: string, label: string): Promise<Acc> {
  const id = `iba_e2e_${uid()}${uid()}`;
  const secret = randomBytes(24).toString('hex');
  // Fecha de alta lejana: la cuenta que usa la pantalla (y los otros tests) sigue siendo la vinculada.
  const now = '2999-01-01T00:00:00.000Z';
  await sql(
    `INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, webhook_secret, created_at, updated_at)
     VALUES (?, ?, 'whatsapp', 'fake', ?, '', 'connected', ?, ?, ?)`,
    [id, owner, label, secret, now, now],
  );
  return { id, secret, owner };
}

async function events(request: APIRequestContext, acc: Acc, list: Array<Record<string, unknown>>) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

function message(chatId: string, over: Record<string, unknown> = {}) {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message',
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: group ? '5491100009999' : chatId.replace(/@.*/, ''),
    senderName: '',
    providerMessageId: `in-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function twoAccounts(request: APIRequestContext) {
  const tag = uid();
  const a = await linkWhatsapp(request);
  const b = await secondAccount(a.owner, `Trabajo ${tag}`);
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const groupName = `Grupo ${tag}`;
  const t0 = Date.now() - 60_000;
  const when = (s: number) => new Date(t0 + s * 1000).toISOString();
  const shared = message(gid, { chatName: groupName, providerMessageId: `in-g-${tag}`, body: `primero ${tag}`, timestamp: when(1) });
  await events(request, a, [shared]);
  await events(request, b, [shared]);
  await events(request, b, [message(gid, { chatName: groupName, body: `segundo ${tag}`, timestamp: when(2) })]);
  const p = phone();
  const dmName = `Cliente ${tag}`;
  await events(request, a, [message(`${p}@s.whatsapp.net`, { senderName: dmName, body: `por personal ${tag}`, timestamp: when(3) })]);
  await events(request, b, [message(`${p}@s.whatsapp.net`, { senderName: dmName, body: `por trabajo ${tag}`, timestamp: when(4) })]);
  return { tag, a, b, groupName, dmName };
}

test.afterEach(async () => {
  await sql("DELETE FROM inbox_messages WHERE thread_id IN (SELECT id FROM inbox_threads WHERE account_id LIKE 'iba_e2e_%')");
  await sql("DELETE FROM inbox_threads WHERE account_id LIKE 'iba_e2e_%'");
  await sql("DELETE FROM inbox_accounts WHERE id LIKE 'iba_e2e_%'");
});

test('el mismo grupo y el mismo contacto en dos cuentas: una fila y la conversación unida', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const w = await twoAccounts(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });

  const groupRow = page.getByTestId('inbox-row').filter({ hasText: w.groupName });
  await expect(groupRow).toHaveCount(1, { timeout: 60_000 });
  await expect(groupRow).toHaveAttribute('data-lines', '2');
  const dmRow = page.getByTestId('inbox-row').filter({ hasText: w.dmName });
  await expect(dmRow).toHaveCount(1);
  await expect(dmRow).toHaveAttribute('data-lines', '2');

  await groupRow.locator('.ib-row-btn').click();
  const msgs = page.getByTestId('wa-message');
  await expect(msgs.filter({ hasText: `primero ${w.tag}` })).toHaveCount(1, { timeout: 30_000 });
  await expect(msgs.filter({ hasText: `segundo ${w.tag}` })).toHaveCount(1);

  await dmRow.locator('.ib-row-btn').click();
  const first = msgs.filter({ hasText: `por personal ${w.tag}` });
  const second = msgs.filter({ hasText: `por trabajo ${w.tag}` });
  await expect(first).toHaveCount(1, { timeout: 30_000 });
  await expect(second).toHaveCount(1);
  await expect(first.getByTestId('msg-line')).toHaveCount(1);
  await expect(second.getByTestId('msg-line')).toHaveCount(1);
  expect(await first.getAttribute('data-line')).not.toBe(await second.getAttribute('data-line'));
  await expect(dmRow.locator('.ib-row-btn')).toHaveAttribute('aria-current', 'true');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a 390 px la conversación de dos cuentas no tiene scroll lateral', async ({ page, request }) => {
  test.setTimeout(120_000);
  const w = await twoAccounts(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.getByTestId('inbox-row').filter({ hasText: w.dmName }).locator('.ib-row-btn').click();
  await expect(page.getByTestId('msg-line').first()).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
