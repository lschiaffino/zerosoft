import { e2eDb } from './helpers/db';
import { devices, expect, test, type APIRequestContext, type CDPSession, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * El teclado del teléfono en el chat, como WhatsApp (Inbox y Lines, con el dedo): el campo mide 16px (iOS no
 * agranda la página), con el teclado abierto el chat ocupa lo que se ve (sin la banda de la app) con el campo
 * arriba del teclado, mandar no cierra el teclado y tocar la conversación sí (styles/wa-mobile.css,
 * components/groups/wa/keyboard.ts). El teclado se simula con un visualViewport falso.
 */

test.use({ ...devices['Pixel 7'], viewport: { width: 390, height: 800 } });

const uid = () => Math.random().toString(36).slice(2, 8);
const KB = 420;

async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    const target = new EventTarget() as EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number };
    target.height = window.innerHeight;
    target.width = window.innerWidth;
    target.offsetTop = 0;
    target.offsetLeft = 0;
    target.scale = 1;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => target });
    (window as unknown as { __kb: (h: number) => void }).__kb = (h: number) => {
      target.height = h;
      target.dispatchEvent(new Event('resize'));
    };
  });
}

async function tap(cdp: CDPSession, target: Locator) {
  const b = (await target.boundingBox())!;
  const x = b.x + Math.min(b.width / 2, 40);
  const y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const activeTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? '');

async function keyboardFlow(page: Page, cdp: CDPSession, lastText: string) {
  const box = page.locator('.wa-messages');
  await expect(box.locator('.gr-msg', { hasText: lastText })).toBeVisible();
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const field = page.locator('.wa-composer textarea').first();
  expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

  await tap(cdp, field);
  await expect.poll(() => activeTag(page)).toBe('TEXTAREA');
  await page.evaluate((h) => (window as unknown as { __kb: (h: number) => void }).__kb(h), KB);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboard ?? '')).toBe('open');
  // Sin la banda de la app: el chat empieza arriba de todo y el campo queda arriba del teclado.
  await expect(page.locator('.app-band')).toBeHidden();
  const f = (await field.boundingBox())!;
  expect(f.y + f.height).toBeLessThanOrEqual(KB + 2);
  await expect.poll(() => box.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Mandar no le saca el foco al campo (el teclado sigue abierto).
  const text = `con teclado ${uid()}`;
  await field.fill(text);
  await tap(cdp, page.locator('.wa-composer .wa-send').first());
  await expect(box.locator('.gr-msg-out', { hasText: text })).toBeVisible();
  await expect(field).toHaveValue('');
  expect(await activeTag(page)).toBe('TEXTAREA');

  // Tocar la conversación cierra el teclado.
  await tap(cdp, box.locator('.wa-day span').last());
  await expect.poll(() => activeTag(page)).not.toBe('TEXTAREA');
  await page.evaluate(() => (window as unknown as { __kb: (h: number) => void }).__kb(800));
  await expect(page.locator('.app-band')).toBeVisible();
}

test('Inbox en el teléfono: el teclado como en WhatsApp', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await fakeKeyboard(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  const [acc] = (await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'")).rows as unknown as Array<Record<string, string>>;
  db.close();
  const tag = uid();
  const dm = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}8@s.whatsapp.net`;
  const events = Array.from({ length: 14 }, (_, i) => ({
    type: 'message', chatId: dm, isGroup: false, fromMe: false, senderPhone: dm.replace(/@.*/, ''), senderName: `Tecla ${tag}`,
    providerMessageId: `kt-${tag}-${i}`, body: `m${i}-${tag}`, timestamp: new Date(Date.now() - (20 - i) * 60_000).toISOString(),
  }));
  expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } })).ok()).toBe(true);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const cdp = await context.newCDPSession(page);
  await page.locator('.ib-item', { hasText: `Tecla ${tag}` }).locator('.ib-row-btn').click();
  await keyboardFlow(page, cdp, `m13-${tag}`);
});

async function fakeLine(request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  return ((await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string }).webhookUrl;
}

test('Lines en el teléfono: el teclado como en WhatsApp', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await fakeKeyboard(page);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const tag = uid();
  const url = await fakeLine(request, `Tecla ${tag}`);
  const chatId = `54911${Math.floor(Math.random() * 1e7)}@c.us`;
  for (let i = 0; i < 14; i++) {
    await request.post(new URL(url).pathname, {
      data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: '5491155550000', senderName: `Tecla ${tag}`, providerMessageId: `lk-${tag}-${i}`, body: `m${i}-${tag}` }] },
    });
  }
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const cdp = await context.newCDPSession(page);
  await page.locator('[data-chat-row]', { hasText: `Tecla ${tag}` }).first().click();
  await keyboardFlow(page, cdp, `m13-${tag}`);
});
