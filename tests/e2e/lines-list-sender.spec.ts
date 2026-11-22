import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Lista de chats de Lines e Inbox: en un grupo, quién mandó el último mensaje
 * va antes del texto. Un nombre largo se corta con "…" y el mensaje sigue a la
 * vista (antes el nombre empujaba el texto afuera, cortado a la mitad de una
 * letra). En 1280 y 390. Proveedor falso, nombres inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const LONG = 'Carla Prueba con un nombre larguísimo para ver cómo se corta en la lista';

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** El nombre se corta (con "…") dentro de la fila y el texto del mensaje tiene lugar. */
async function expectSenderFits(sender: Locator, text: Locator, row: Locator) {
  await expect(sender).toBeVisible();
  await expect(text).toBeVisible();
  const s = (await sender.boundingBox())!;
  const tx = (await text.boundingBox())!;
  const r = (await row.boundingBox())!;
  expect(tx.width).toBeGreaterThan(20);
  expect(tx.x + tx.width).toBeLessThanOrEqual(r.x + r.width + 1);
  expect(s.x + s.width).toBeLessThanOrEqual(tx.x + 1);
  expect(await sender.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);
}

test('Inbox: el nombre largo de quien mandó en un grupo se corta y el mensaje se ve', async ({ page, request }) => {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const title = `Remitente ${uid()}`;
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
    data: { events: [{ type: 'message', chatId: gid, isGroup: true, chatName: title, fromMe: false, senderPhone: '15550001003', senderName: LONG, providerMessageId: `ls-${uid()}`, body: 'Yo llevo el hielo', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: title });
    await expectSenderFits(row.locator('.wa-row-sender'), row.locator('.wa-row-text').last(), row.locator('.wa-row-preview'));
  }
});

test('Lines: el nombre largo de quien mandó en un grupo se corta y el mensaje se ve', async ({ page, request }) => {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${uid()}` } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const title = `Remitente ${uid()}`;
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: gid, isGroup: true, chatName: title, fromMe: false, senderPhone: '5491100009998', senderName: LONG, providerMessageId: `ls-${uid()}`, body: 'Yo llevo el hielo', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.gr-row', { hasText: title });
    await expectSenderFits(row.locator('.gr-row-sender'), row.locator('.gr-row-preview > :last-child'), row.locator('.gr-row-preview'));
  }
});
