import { e2eDb } from './helpers/db';
import { devices, expect, test, type APIRequestContext, type CDPSession, type Locator, type Page } from '@playwright/test';

/**
 * El chat con el dedo, como WhatsApp en el teléfono (Inbox y Lines): mantener apretado un mensaje lo marca y
 * abre la barra de reacciones y la hoja de acciones (components/groups/wa/TouchMessageMenu.tsx); tocar otro lo
 * suma a la selección; deslizar a la derecha responde; "atrás" cierra primero la selección y el menú, y después
 * el chat (components/groups/wa/backLayer.ts). Toques reales por CDP (touchStart/touchMove/touchEnd).
 */

// Alto de un teléfono grande: con la hoja abierta tienen que verse el mensaje marcado y otro más arriba.
test.use({ ...devices['Pixel 7'], viewport: { width: 390, height: 932 } });

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function touchAt(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
}

async function point(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const b = (await target.boundingBox())!;
  return { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 };
}

/** Mantener apretado hasta que aparece el menú (sin soltar antes de tiempo). */
async function hold(page: Page, cdp: CDPSession, target: Locator) {
  const p = await point(target);
  await touchAt(cdp, 'touchStart', p.x, p.y);
  await expect(page.getByTestId('touch-menu')).toBeVisible();
  await touchAt(cdp, 'touchEnd', p.x, p.y);
}

/** Un toque donde está ahora (sin mover el chat: con el menú abierto, la barra de reacciones sigue al mensaje). */
async function tap(cdp: CDPSession, target: Locator) {
  const b = (await target.boundingBox())!;
  const p = { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 };
  await touchAt(cdp, 'touchStart', p.x, p.y);
  await touchAt(cdp, 'touchEnd', p.x, p.y);
}

async function swipeRight(cdp: CDPSession, target: Locator) {
  const p = await point(target);
  await touchAt(cdp, 'touchStart', p.x, p.y);
  for (let i = 1; i <= 5; i++) await touchAt(cdp, 'touchMove', p.x + i * 18, p.y + 1);
  await touchAt(cdp, 'touchEnd', p.x + 90, p.y + 1);
}

async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
}

/**
 * Lo mismo en las dos apps, con el chat ya abierto y tres mensajes recibidos (`a` arriba, `b` el último). La
 * barra de reacciones tapa el mensaje de justo arriba del marcado: se toca `a`, que queda más arriba.
 */
async function gestures(page: Page, cdp: CDPSession, a: string, b: string) {
  const box = page.locator('.wa-messages');
  const first = box.locator('.gr-msg', { hasText: a });
  const second = box.locator('.gr-msg', { hasText: b });
  await expect(second).toBeVisible();
  await noSideScroll(page);

  // Toque largo: queda marcado, con las reacciones y la hoja de acciones (las del menú de la flecha).
  await hold(page, cdp, second.locator('.gr-bubble'));
  await expect(second).toHaveClass(/is-selected/);
  const menu = page.getByTestId('touch-menu');
  await expect(menu.getByRole('group')).toBeVisible();
  await expect(menu.getByRole('menu').getByRole('menuitem').first()).toBeVisible();
  // El clic que el navegador manda al soltar no elige nada de la hoja.
  await sleep(500);
  await expect(menu).toBeVisible();
  await noSideScroll(page);

  // Tocar otro mensaje lo suma: la barra de selección reemplaza al campo.
  await tap(cdp, first.locator('.gr-bubble'));
  await expect(menu).toHaveCount(0);
  const bar = page.getByTestId('selection-bar');
  await expect(bar).toBeVisible();
  await expect(box.locator('.gr-msg.is-selected')).toHaveCount(2);
  await expect(bar.locator('[data-action="copy"]')).toBeEnabled();

  // Atrás: sale de la selección y el chat sigue abierto.
  await page.goBack();
  await expect(bar).toHaveCount(0);
  await expect(box).toBeVisible();

  // Toque largo y atrás: se cierra el menú, el chat sigue.
  await hold(page, cdp, second.locator('.gr-bubble'));
  await page.goBack();
  await expect(menu).toHaveCount(0);
  await expect(box.locator('.gr-msg.is-selected')).toHaveCount(0);
  await expect(box).toBeVisible();

  // Deslizar a la derecha: responder a ese mensaje.
  await swipeRight(cdp, second.locator('.gr-bubble'));
  await expect(page.locator('.wa-replying .gr-quote, .gr-replying .gr-quote').first()).toContainText(b);
}

test('Inbox en el teléfono: toque largo, selección, deslizar para responder y "atrás"', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const dm = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}7@s.whatsapp.net`;
  const at = (s: number) => new Date(Date.now() - 600_000 + s * 1000).toISOString();
  const msg = (body: string, s: number) => ({ type: 'message', chatId: dm, isGroup: false, fromMe: false, senderPhone: dm.replace(/@.*/, ''), senderName: `Tacto ${tag}`, providerMessageId: `t-${tag}-${s}`, body, timestamp: at(s) });
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [msg(`primero ${tag}`, 1), msg(`medio ${tag}`, 2), msg(`segundo ${tag}`, 3)] } });
  expect(res.ok()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const cdp = await context.newCDPSession(page);
  await page.locator('.ib-item', { hasText: `Tacto ${tag}` }).locator('.ib-row-btn').click();
  await gestures(page, cdp, `primero ${tag}`, `segundo ${tag}`);

  // Atrás cierra el chat (un panel por vez) y deja la bandeja a la vista, sin salir de Inbox.
  await page.goBack();
  await expect(page.locator('.ib-wa-thread')).toHaveCount(0);
  await expect(page.locator('.ib-item', { hasText: `Tacto ${tag}` })).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/\/app\/inbox$/);
  expect(new URL(page.url()).searchParams.has('t')).toBe(false);
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

test('Lines en el teléfono: toque largo, selección, deslizar para responder y "atrás"', async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const tag = uid();
  const url = await fakeLine(request, `Tacto ${tag}`);
  const chatId = `54911${Math.floor(Math.random() * 1e7)}@c.us`;
  for (const [i, body] of [`primero ${tag}`, `medio ${tag}`, `segundo ${tag}`].entries()) {
    await request.post(new URL(url).pathname, {
      data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: '5491155550000', senderName: `Tacto ${tag}`, providerMessageId: `lt-${tag}-${i}`, body }] },
    });
  }
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const cdp = await context.newCDPSession(page);
  await page.locator('[data-chat-row]', { hasText: `Tacto ${tag}` }).first().click();
  await page.locator('.wa-messages').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await gestures(page, cdp, `primero ${tag}`, `segundo ${tag}`);

  // Atrás vuelve a la lista de chats de Lines.
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/lines\/inbox(\?|$)/);
  await expect(page.locator('[data-chat-row]', { hasText: `Tacto ${tag}` }).first()).toBeVisible();
});
