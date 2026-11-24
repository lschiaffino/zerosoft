import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox y Lines con el WhatsApp falso (GROUPS_FAKE=1): un contacto con su chat
 * por teléfono al que le escribo desde mi teléfono, y ese mensaje llega solo
 * con el id anónimo ("<lid>@lid"). Primero abre un chat aparte ("Contacto de
 * WhatsApp"); en cuanto el servidor da el par lid ↔ teléfono, los dos se juntan
 * y la lista muestra una sola fila, con el mensaje propio. Si el par ya se
 * sabía, el mensaje va directo al chat del teléfono. Nombres y números
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
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const lid = () => `${Math.floor(100_000_000_000_000 + Math.random() * 800_000_000_000_000)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

type Ev = Record<string, unknown>;

function message(chatId: string, over: Ev = {}): Ev {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.endsWith('@s.whatsapp.net') ? chatId.replace(/@.*/, '') : '',
    senderName: '',
    providerMessageId: `tw-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}
const ownViaLid = (l: string, body: string): Ev => message(`${l}@lid`, { fromMe: true, senderPhone: '', senderName: '', body, status: 'sent' });
const pairEvent = (p: string, l: string, name: string): Ev => ({ type: 'contact', chatId: `${p}@s.whatsapp.net`, name, lid: l, phone: p, saved: name });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Inbox: el mensaje propio por lid y el chat del teléfono quedan en una sola fila', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const send = async (list: Ev[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
  const tag = uid();
  const p = phone();
  const l = lid();
  const name = `Ana ${tag}`;
  const twins = async () => (await sql("SELECT id FROM inbox_threads WHERE account_id = ? AND kind = 'dm' AND external_id IN (?, ?)", [String(acc.id), `${p}@s.whatsapp.net`, `${l}@lid`])).length;

  await send([message(`${p}@s.whatsapp.net`, { senderName: name, body: `hola ${tag}` })]);
  await send([ownViaLid(l, `desde el celu ${tag}`)]);
  await expect.poll(twins).toBe(2);
  // El servidor da el par: se juntan.
  await send([pairEvent(p, l, name)]);
  await expect.poll(twins, { timeout: 15_000 }).toBe(1);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const rows = page.locator('.ib-item', { hasText: name });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`desde el celu ${tag}`);
  await expect(page.locator('.ib-item', { hasText: 'WhatsApp contact' })).toHaveCount(0);

  // Con el par ya sabido, un mensaje propio por lid va directo al chat del teléfono.
  await send([ownViaLid(l, `otra vez ${tag}`)]);
  expect(await twins()).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: el mensaje propio por lid y el chat del teléfono quedan en una sola fila', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Twin ${uid()}` } });
  const id = ((await created.json()) as { id: string }).id;
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const hook = new URL(info.webhookUrl).pathname;
  const send = async (list: Ev[]) => expect((await request.post(hook, { data: { events: list } })).ok()).toBe(true);
  const tag = uid();
  const p = phone();
  const l = lid();
  const name = `Ana ${tag}`;
  const twins = async () => (await sql("SELECT id FROM groups_chats WHERE number_id = ? AND kind = 'dm' AND provider_chat_id IN (?, ?)", [id, `${p}@s.whatsapp.net`, `${l}@lid`])).length;

  await send([message(`${p}@s.whatsapp.net`, { senderName: name, body: `hola ${tag}` })]);
  await send([ownViaLid(l, `desde el celu ${tag}`)]);
  await expect.poll(twins).toBe(2);
  await send([pairEvent(p, l, name)]);
  await expect.poll(twins, { timeout: 15_000 }).toBe(1);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const rows = page.locator('.gr-row', { hasText: name });
  await expect(rows).toHaveCount(1, { timeout: 90_000 });
  await expect(rows.first()).toContainText(`desde el celu ${tag}`);
  await expect(page.locator('.gr-row', { hasText: 'WhatsApp contact' })).toHaveCount(0);

  await send([ownViaLid(l, `otra vez ${tag}`)]);
  expect(await twins()).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
