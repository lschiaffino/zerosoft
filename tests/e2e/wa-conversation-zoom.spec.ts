import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Lines e Inbox: pellizcar en el trackpad agranda solo los mensajes de la
 * conversación (hasta 200%, nunca menos de 100%), no la app entera. Sobre la
 * lista, el encabezado o cualquier otro panel el pellizco no hace nada. El
 * nivel se recuerda en el navegador y vuelve a 100% pellizcando hacia afuera o
 * con Ctrl/Cmd+0 con el foco en los mensajes.
 *
 * En Chromium un pellizco del trackpad es un `wheel` con ctrlKey y deltas
 * chicos: eso es lo que se manda acá. Con ZOOM_SHOTS=<carpeta> guarda capturas
 * a 100% y con zoom.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 420_000 });

const uid = () => Math.random().toString(36).slice(2, 8);
const LONG = 'Te paso el detalle del pedido para el jueves: tres cajas medianas, dos grandes y el sobre con los papeles, todo a nombre del depósito y con entrega por la tarde si se puede';

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

type Ev = Record<string, unknown>;

/** Un chat 1:1 con texto corto, texto largo y una foto (sin archivo: queda el lugar de la foto). */
function chatEvents(app: 'inbox' | 'lines', phone: string, name: string): Ev[] {
  const tag = uid();
  const chatId = `${phone}@s.whatsapp.net`;
  const t0 = Date.now() - 3_600_000;
  const base = { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: phone, senderName: name };
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const pid = `gone-z-${tag}`;
  return [
    { ...base, providerMessageId: `z0-${tag}`, body: 'Hola, ¿cómo va?', timestamp: at(0) },
    { ...base, providerMessageId: `z1-${tag}`, body: LONG, timestamp: at(10) },
    {
      ...base,
      providerMessageId: pid,
      body: 'La foto del remito',
      media: { url: app === 'lines' ? `evo:${pid}` : '', type: 'image/jpeg', name: '', fetchRef: { providerMessageId: pid, chatId, fromMe: false }, info: { kind: 'image', width: 1200, height: 900 } },
      timestamp: at(20),
    },
    { ...base, fromMe: true, providerMessageId: `z3-${tag}`, body: 'Perfecto, lo dejo anotado y te confirmo mañana a primera hora', timestamp: at(30) },
  ];
}

async function seedInbox(request: APIRequestContext, name: string) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const phone = `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const res = await request.post(`/api/inbox/webhook/${row.id}/${row.webhook_secret}`, { data: { events: chatEvents('inbox', phone, name) } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function seedLines(request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Zoom ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: chatEvents('lines', phone, name) } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Un pellizco (wheel con ctrlKey) en el centro de ese elemento. Devuelve si la página lo frenó. */
async function wheel(target: Locator, deltaY: number, times = 1): Promise<boolean> {
  return target.evaluate(
    (el, [dy, n]) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + Math.min(r.height / 2, 200);
      let prevented = true;
      for (let i = 0; i < n; i++) {
        const ev = new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y });
        el.dispatchEvent(ev);
        prevented = prevented && ev.defaultPrevented;
      }
      return prevented;
    },
    [deltaY, times] as const,
  );
}

const fontPx = (loc: Locator) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const zoomAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-wa-zoom'));
const stored = (page: Page) => page.evaluate(() => window.localStorage.getItem('zs:conversation-zoom'));

async function shot(page: Page, name: string) {
  const dir = process.env.ZOOM_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

interface Parts {
  app: 'inbox' | 'lines';
  /** Abre el chat sembrado. */
  open: () => Promise<void>;
  /** Un texto de la lista de chats y uno del encabezado de la conversación: no cambian nunca. */
  listText: Locator;
  headText: Locator;
  list: Locator;
}

async function checkZoom(page: Page, p: Parts) {
  await page.evaluate(() => window.localStorage.removeItem('zs:conversation-zoom'));
  await p.open();
  const pane = page.locator('.wa-messages');
  const text = pane.locator('.gr-msg', { hasText: 'tres cajas medianas' }).first();
  await expect(text).toBeVisible({ timeout: 120_000 });
  const bubble = text.locator('.gr-bubble').first();
  const base = await fontPx(bubble);
  const listBase = await fontPx(p.listText);
  const headBase = await fontPx(p.headText);
  const mediaBase = (await pane.locator('.gr-msg', { hasText: 'La foto del remito' }).first().boundingBox())!.width;
  expect(await zoomAttr(page)).toBeNull();
  await shot(page, `${p.app}-100`);

  // Sobre la lista de chats: se frena (la página no se agranda) y no cambia nada.
  expect(await wheel(p.list, -20, 5)).toBe(true);
  expect(await zoomAttr(page)).toBeNull();
  expect(await fontPx(bubble)).toBeCloseTo(base, 1);
  // Sobre el encabezado de la conversación, igual.
  expect(await wheel(p.headText, -20, 5)).toBe(true);
  expect(await zoomAttr(page)).toBeNull();

  // Sobre los mensajes: agranda solo la conversación.
  expect(await wheel(pane, -10, 4)).toBe(true);
  await expect.poll(() => fontPx(bubble)).toBeGreaterThan(base * 1.3);
  expect(await fontPx(bubble)).toBeLessThan(base * 1.7);
  expect(await fontPx(p.listText)).toBeCloseTo(listBase, 1);
  expect(await fontPx(p.headText)).toBeCloseTo(headBase, 1);

  // Tope en 200%: el texto al doble, la foto nunca más chica, y sin scroll lateral ni en el panel ni en la página.
  await wheel(pane, -20, 12);
  await expect.poll(() => zoomAttr(page)).toBe('200');
  expect(await fontPx(bubble)).toBeCloseTo(base * 2, 0);
  expect((await pane.locator('.gr-msg', { hasText: 'La foto del remito' }).first().boundingBox())!.width).toBeGreaterThanOrEqual(mediaBase - 1);
  expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // El lugar de la foto entra entero en su burbuja (no queda cortado).
  expect(
    await pane.locator('.gr-msg', { hasText: 'La foto del remito' }).first().evaluate((msg) => {
      const ph = msg.querySelector('.wa-media-ph');
      return !ph || ph.getBoundingClientRect().right <= msg.getBoundingClientRect().right + 1;
    }),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await fontPx(p.listText)).toBeCloseTo(listBase, 1);
  await shot(page, `${p.app}-200`);

  // Ctrl + rueda del mouse (saltos grandes) es el zoom del navegador: no se toca.
  expect(await wheel(pane, 100)).toBe(false);
  expect(await zoomAttr(page)).toBe('200');

  // Se recuerda en este navegador.
  await expect.poll(() => stored(page)).toBe('2');
  await page.reload({ waitUntil: 'networkidle' });
  await p.open();
  await expect(text).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => zoomAttr(page)).toBe('200');
  expect(await fontPx(bubble)).toBeCloseTo(base * 2, 0);

  // Ctrl+0 con el puntero (o el foco) en los mensajes vuelve a 100%.
  await pane.hover();
  await page.keyboard.press('Control+0');
  await expect.poll(() => zoomAttr(page)).toBeNull();
  expect(await fontPx(bubble)).toBeCloseTo(base, 1);
  await expect.poll(() => stored(page)).toBeNull();

  // Pellizcar hacia afuera vuelve a 100% y ahí se queda: nunca achica.
  await wheel(pane, -10, 3);
  await expect.poll(() => fontPx(bubble)).toBeGreaterThan(base * 1.2);
  await wheel(pane, 20, 12);
  await expect.poll(() => zoomAttr(page)).toBeNull();
  expect(await fontPx(bubble)).toBeCloseTo(base, 1);
  await expect.poll(() => stored(page)).toBeNull();
}

test('Inbox: el pellizco agranda solo la conversación, con tope, y se recuerda', async ({ page, request }) => {
  const name = `Zulema ${uid()}`;
  await seedInbox(request, name);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('[data-chat-row]', { hasText: name });
  await checkZoom(page, {
    app: 'inbox',
    open: async () => {
      await expect(row).toBeVisible({ timeout: 45_000 });
      await row.locator('.ib-row-btn').click();
    },
    listText: row.locator('.ib-row-btn'),
    headText: page.locator('.wa-head').getByText(name).first(),
    list: page.locator('.ib-list-pane'),
  });
});

test('Lines: el pellizco agranda solo la conversación, con tope, y se recuerda', async ({ page, request }) => {
  const name = `Zacarías ${uid()}`;
  await seedLines(request, name);
  // La línea elegida se guarda por persona: otra prueba pudo dejar una que no es la de este chat.
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('[data-chat-row]', { hasText: name });
  await checkZoom(page, {
    app: 'lines',
    open: async () => {
      await expect(row).toBeVisible({ timeout: 45_000 });
      await row.getByRole('link').first().click();
    },
    listText: row.getByRole('link').first(),
    headText: page.locator('.wa-head').getByText(name).first(),
    list: page.locator('.gr-list'),
  });
});
