import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Con el estilo de chats zerosoft, las fechas no tienen fondo; la que queda
 * pegada arriba mientras se desplaza pasa por encima de las burbujas, así que
 * esa sí lleva fondo (si no, su texto se encima con el de los mensajes). En
 * Lines y en Inbox, a 1280 y a 390. El estilo se pone en la página, sin tocar
 * la cuenta demo compartida. Nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Un chat 1:1 con muchos mensajes de hace dos días y uno de hoy: dos fechas, la vieja larga. */
function events(name: string, jid: string, tag: string) {
  // Mediodía UTC de hace dos días: los 30 minutos de mensajes nunca cruzan la medianoche (cerca de las 00 UTC
  // salían tres fechas en vez de dos).
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 2);
  const old = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12);
  const msg = (i: number, at: number) => ({
    type: 'message', chatId: jid, isGroup: false, fromMe: i % 3 === 0, senderPhone: i % 3 === 0 ? '' : jid.replace(/@.*/, ''), senderName: i % 3 === 0 ? '' : name,
    providerMessageId: `day-${tag}-${i}`, body: `Mensaje de prueba número ${i} con algo de texto para ocupar la línea`, timestamp: new Date(at).toISOString(),
  });
  return [...Array.from({ length: 30 }, (_, i) => msg(i, old + i * 60_000)), msg(99, Date.now())];
}

/** Desplaza un poco hacia arriba (la fecha vieja queda pegada) y devuelve el fondo de la fecha pegada y de una suelta. */
async function stuckChip(page: Page) {
  const box = page.locator('.wa-messages').first();
  await expect(box.locator('.wa-day')).toHaveCount(2, { timeout: 30_000 });
  await page.evaluate(() => {
    document.querySelector('.gr-inbox')?.setAttribute('data-chat-style', 'zerosoft');
    const el = document.querySelector<HTMLElement>('.wa-messages')!;
    el.scrollTop = el.scrollHeight;
    el.scrollTop -= 120;
    el.dispatchEvent(new Event('scroll'));
  });
  const stuck = box.locator('.wa-day.is-stuck > span').first();
  await expect(stuck).toBeVisible({ timeout: 10_000 });
  return page.evaluate(() => ({
    stuck: getComputedStyle(document.querySelector('.wa-day.is-stuck > span')!).backgroundColor,
    loose: getComputedStyle(document.querySelector('.wa-day:not(.is-stuck) > span')!).backgroundColor,
  }));
}

const transparent = (c: string) => c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);

async function linesChat(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Fecha ${uid()}` } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const jid = `${phone()}@s.whatsapp.net`;
  expect((await request.post(new URL(webhookUrl).pathname, { data: { events: events(`Dora ${uid()}`, jid, uid()) } })).ok()).toBe(true);
  const db = e2eDb();
  try {
    const [row] = (await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [id, jid] })).rows as unknown as Array<{ id: string }>;
    return String(row.id);
  } finally {
    db.close();
  }
}

async function inboxThread(request: APIRequestContext): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'")).rows as unknown as Array<Record<string, unknown>>;
    const jid = `${phone()}@s.whatsapp.net`;
    expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: events(`Dora ${uid()}`, jid, uid()) } })).ok()).toBe(true);
    const [thread] = (await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), jid] })).rows as unknown as Array<{ id: string }>;
    return String(thread.id);
  } finally {
    db.close();
  }
}

for (const width of [1280, 390]) {
  test.describe(`a ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 700 });
    });

    test('Lines: con el estilo zerosoft la fecha pegada arriba tiene fondo', async ({ page, request }) => {
      const errors = watchErrors(page);
      const chatId = await linesChat(request);
      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      const bg = await stuckChip(page);
      expect(transparent(bg.stuck), bg.stuck).toBe(false);
      expect(transparent(bg.loose), bg.loose).toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Inbox: con el estilo zerosoft la fecha pegada arriba tiene fondo', async ({ page, request }) => {
      const errors = watchErrors(page);
      const threadId = await inboxThread(request);
      await page.goto(`/en/app/inbox?t=${threadId}`, { waitUntil: 'networkidle' });
      const bg = await stuckChip(page);
      expect(transparent(bg.stuck), bg.stuck).toBe(false);
      expect(transparent(bg.loose), bg.loose).toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
