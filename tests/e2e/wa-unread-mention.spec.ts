import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * El "@" de WhatsApp en la lista de chats, en Lines y en Inbox (WhatsApp falso,
 * GROUPS_FAKE=1): un grupo con un no leído que menciona al número de la línea
 * (o de la cuenta) o que responde a un mensaje nuestro muestra "@" junto al
 * número de no leídos; un grupo con no leídos sin eso, no. Al abrir el chat
 * (leído) el "@" se va. A 1280 y a 390 sin scroll de costado. Nombres y números
 * inventados.
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
const groupJid = () => `1203630${Math.floor(10_000_000 + Math.random() * 89_999_999)}${Math.floor(1000 + Math.random() * 8999)}@g.us`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

type Ev = Record<string, unknown>;

/** Tres grupos: uno que nos menciona, uno que responde a un mensaje nuestro y uno con un no leído cualquiera. */
function groupEvents(me: string, tag: string, jids: { mention: string; reply: string; plain: string }): Ev[] {
  const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const base = (chatId: string, over: Ev): Ev => ({
    type: 'message',
    chatId,
    isGroup: true,
    groupName: `Grupo ${tag}`,
    fromMe: false,
    senderPhone: '15550002002',
    senderName: 'Beto Prueba',
    providerMessageId: `in-${uid()}`,
    body: 'hola',
    timestamp: at(5),
    ...over,
  });
  const ours = `out-${uid()}`;
  return [
    base(jids.mention, { groupName: `Menciona ${tag}`, body: `@${me} mirá esto`, mentions: [me] }),
    base(jids.reply, { groupName: `Responde ${tag}`, fromMe: true, providerMessageId: ours, body: 'te paso el dato', timestamp: at(30) }),
    base(jids.reply, { groupName: `Responde ${tag}`, body: 'gracias', replyToProviderId: ours }),
    base(jids.plain, { groupName: `Nada ${tag}`, body: 'buen día' }),
  ];
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const VIEWS = [
  { label: '1280', viewport: { width: 1280, height: 800 } },
  { label: '390', viewport: { width: 390, height: 844 } },
];

for (const view of VIEWS) {
  test.describe(`@ de mención ${view.label}`, () => {
    test.use({ viewport: view.viewport });

    test('Lines: "@" en los grupos que te mencionan o responden, y se va al leer', async ({ page, request }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Menciones ${uid()}` } });
      const id = ((await created.json()) as { id: string }).id;
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
      const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const [line] = await sql('SELECT phone FROM groups_numbers WHERE id = ?', [id]);
      const me = String(line.phone).replace(/\D/g, '');
      expect(me).toMatch(/^\d{6,}$/);
      const jids = { mention: groupJid(), reply: groupJid(), plain: groupJid() };
      const tag = uid();
      expect((await request.post(new URL(info.webhookUrl).pathname, { data: { events: groupEvents(me, tag, jids) } })).ok()).toBe(true);
      const chatOf = async (jid: string) => String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, jid]))[0].id);
      const ids = { mention: await chatOf(jids.mention), reply: await chatOf(jids.reply), plain: await chatOf(jids.plain) };

      await page.goto(`/en/app/lines/inbox`, { waitUntil: 'domcontentloaded' });
      const row = (chat: string) => page.locator(`[data-testid="chat-row"][data-chat-id="${chat}"]`);
      await expect(row(ids.mention)).toBeVisible({ timeout: 60_000 });
      await expect(row(ids.mention).getByTestId('row-unread-mention')).toBeVisible();
      await expect(row(ids.reply).getByTestId('row-unread-mention')).toBeVisible();
      await expect(row(ids.plain)).toBeVisible();
      await expect(row(ids.plain).getByTestId('row-unread-mention')).toHaveCount(0);
      await expect(row(ids.mention).getByRole('img', { name: /mentioned/i })).toBeVisible();
      await noSideScroll(page);

      // Leído: el "@" se va con el contador.
      await page.goto(`/en/app/lines/inbox/${ids.mention}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.wa-thread .gr-msg').first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => Number((await sql('SELECT unread_count FROM groups_chats WHERE id = ?', [ids.mention]))[0].unread_count), { timeout: 30_000 }).toBe(0);
      await page.goto(`/en/app/lines/inbox`, { waitUntil: 'domcontentloaded' });
      await expect(row(ids.reply).getByTestId('row-unread-mention')).toBeVisible({ timeout: 60_000 });
      await expect(row(ids.mention).getByTestId('row-unread-mention')).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Inbox: "@" en los grupos que te mencionan o responden, y se va al leer', async ({ page, request }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      await request.post('/api/inbox/whatsapp', waLinkIp());
      await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
      const [acc] = await sql("SELECT a.id, a.webhook_secret, a.address FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const me = String(acc.address).replace(/\D/g, '');
      expect(me).toMatch(/^\d{6,}$/);
      const jids = { mention: groupJid(), reply: groupJid(), plain: groupJid() };
      const tag = uid();
      expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: groupEvents(me, tag, jids) } })).ok()).toBe(true);
      const threadOf = async (jid: string) => String((await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), jid]))[0].id);
      const ids = { mention: await threadOf(jids.mention), reply: await threadOf(jids.reply), plain: await threadOf(jids.plain) };

      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      const row = (thread: string) => page.locator(`[data-testid="inbox-row"][data-thread-id="${thread}"]`);
      await expect(row(ids.mention)).toBeVisible({ timeout: 60_000 });
      await expect(row(ids.mention).getByTestId('row-unread-mention')).toBeVisible();
      await expect(row(ids.reply).getByTestId('row-unread-mention')).toBeVisible();
      await expect(row(ids.plain)).toBeVisible();
      await expect(row(ids.plain).getByTestId('row-unread-mention')).toHaveCount(0);
      await expect(row(ids.mention).getByRole('img', { name: /mentioned/i })).toBeVisible();
      await noSideScroll(page);

      await row(ids.mention).locator('.ib-row-btn').click();
      await expect(page.locator('.ib-wa-thread .gr-msg').first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => Number((await sql('SELECT unread FROM inbox_threads WHERE id = ?', [ids.mention]))[0].unread), { timeout: 30_000 }).toBe(0);
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(row(ids.reply).getByTestId('row-unread-mention')).toBeVisible({ timeout: 60_000 });
      await expect(row(ids.mention).getByTestId('row-unread-mention')).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
