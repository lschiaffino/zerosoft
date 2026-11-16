import { e2eDb } from './helpers/db';
import { devices, expect, test, type APIRequestContext, type CDPSession, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * El chat en el teléfono tiene el ancho fijo, como WhatsApp (Inbox y Lines, a 390 y 360): un chat largo y variado
 * (link largo, palabra larga, foto ancha, tarjeta de link, cita, reacciones, código, mensaje propio) no hace que la
 * página ni ningún contenedor se corra de costado. Deslizar de costado sobre la lista no mueve nada; deslizar un
 * mensaje a la derecha sigue respondiendo. También con el teclado abierto (el campo con foco) y a 1280.
 * Con SIDE_SHOTS=<carpeta> guarda capturas. Nombres y números inventados.
 */

test.use({ ...devices['Pixel 7'] });
test.describe.configure({ timeout: 180_000 });

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function shot(page: Page, name: string) {
  const dir = process.env.SIDE_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

const LONG_URL = `https://example.test/${'carpeta-con-un-nombre-bastante-largo/'.repeat(5)}archivo?utm_source=prueba&utm_medium=telefono&id=${'9'.repeat(40)}`;
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(4);
const CODE = '```const resultado = await fetch("https://example.test/api/v1/recursos?pagina=1&tamano=100").then((r) => r.json()); // una línea larga sin cortes```';
const THUMB = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#4a7"/></svg>').toString('base64')}`;
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥', '👏', '💯'];

type Ev = Record<string, unknown>;

/** El chat de prueba: lo mismo en las dos apps. `src` es cómo cada app guarda la foto (Lines: "evo:<id>"; Inbox la baja con fetchRef). */
function chatEvents(chatId: string, tag: string, src: (id: string) => string): Ev[] {
  // Recientes: el chat queda arriba de la lista aunque otras specs del shard hayan dejado muchos chats.
  const t0 = Date.now() - 60_000;
  const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
  const who = { senderPhone: chatId.replace(/@.*/, ''), senderName: `Ancho ${tag}` };
  const base = { type: 'message', chatId, isGroup: false, fromMe: false, ...who };
  const id = (n: string) => `side-${n}-${tag}`;
  const img = id('img');
  return [
    { ...base, providerMessageId: id('url'), body: `Mirá esto ${LONG_URL}`, timestamp: at(1) },
    { ...base, providerMessageId: id('word'), body: LONG_WORD, timestamp: at(2) },
    {
      ...base,
      providerMessageId: img,
      body: '',
      media: { url: src(img), type: 'image/png', name: '', fetchRef: { providerMessageId: img, chatId, fromMe: false }, info: { kind: 'image', width: 2400, height: 400 } },
      timestamp: at(3),
    },
    {
      ...base,
      providerMessageId: id('link'),
      body: `La nota: ${LONG_URL}`,
      link: { url: LONG_URL, title: `Un título larguísimo ${LONG_WORD}`, description: `Bajada ${LONG_WORD}`, thumbnail: THUMB },
      timestamp: at(4),
    },
    { ...base, providerMessageId: id('quote'), body: `Respondo a eso ${tag}`, replyToProviderId: id('url'), timestamp: at(5) },
    { ...base, providerMessageId: id('code'), body: CODE, timestamp: at(6) },
    { ...base, fromMe: true, providerMessageId: id('mine'), body: `Mío: ${LONG_WORD}`, timestamp: at(7) },
    { ...base, providerMessageId: id('last'), body: `último ${tag}`, timestamp: at(8) },
    ...EMOJIS.map((emoji, i) => ({
      type: 'reaction',
      chatId,
      targetProviderMessageId: id('word'),
      emoji,
      senderPhone: `1555000${String(3000 + i)}`,
      senderName: `Persona ${i}`,
      fromMe: false,
    })),
  ];
}

/** Todo lo que se sale de la pantalla o puede correrse de costado (para el mensaje del error). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const root = document.scrollingElement ?? document.documentElement;
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
    // Contenedores que se pueden correr de costado (con scroll horizontal posible y contenido más ancho).
    const scrollers = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.getBoundingClientRect().width > 0;
      })
      // Tiras que scrollean de costado a propósito (chips, pestañas, emojis, la fila de reacciones de una hoja).
      .filter((el) => !el.closest('.ui-filter-chips, .ib-tabs, .gr-filters, .gr-list-views, .wa-tray, .wa-attach-strip, .wa-gif-cats, .wa-emoji, [role="tablist"]'))
      .map((el) => `${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
    // Lo del chat que se sale del ancho de la pantalla.
    const out = [...document.querySelectorAll('.wa-messages .gr-msg, .wa-messages .gr-bubble, .wa-messages .gr-bubble *, .wa-composer, .wa-composer *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .map((el) => `${name(el)} [${Math.round(el.getBoundingClientRect().left)}, ${Math.round(el.getBoundingClientRect().right)}]`);
    return { page: { scroll: root.scrollWidth, inner: vw, x: window.scrollX }, scrollers, out: out.slice(0, 20) };
  });
}

async function fits(page: Page, label: string) {
  const o = await overflow(page);
  expect(o.page.scroll, `${label}: la página es más ancha que la pantalla\n${JSON.stringify(o, null, 1)}`).toBeLessThanOrEqual(o.page.inner);
  expect(o.scrollers, `${label}: contenedores que se corren de costado`).toEqual([]);
  expect(o.out, `${label}: partes del chat fuera de la pantalla`).toEqual([]);
  const list = (await page.locator('.wa-messages').boundingBox())!;
  expect(list.x).toBeGreaterThanOrEqual(-1);
  expect(list.x + list.width).toBeLessThanOrEqual(o.page.inner + 1);
}

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
}

/** Un dedo de costado: `dx` negativo es a la izquierda. */
async function drag(cdp: CDPSession, x: number, y: number, dx: number) {
  await touch(cdp, 'touchStart', x, y);
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', x + (dx * i) / 6, y + 1);
  await touch(cdp, 'touchEnd', x + dx, y + 1);
}

/** Lo que cualquier corrimiento de costado movería: la página y cada contenedor con scroll. */
const sideOffsets = (page: Page) =>
  page.evaluate(() => ({
    page: window.scrollX + (window.visualViewport?.offsetLeft ?? 0),
    inner: [...document.querySelectorAll('body *')].filter((el) => el.scrollLeft > 0 && !el.closest('.ui-filter-chips, .ib-tabs, .gr-filters')).length,
  }));

/** Las comprobaciones, con el chat abierto. `swipe`: deslizar un mensaje a la derecha responde. */
async function checkChat(page: Page, cdp: CDPSession, tag: string, app: string, swipe: boolean) {
  const box = page.locator('.wa-messages');
  await expect(box.locator('.gr-msg', { hasText: `último ${tag}` })).toBeVisible({ timeout: 30_000 });
  await expect(box.locator('.gr-msg img').first()).toBeVisible();
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await box.evaluate((el) => (el.scrollTop = 0));
    await fits(page, `${app} ${width} arriba`);
    await shot(page, `${app}-${width}-top`);
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await fits(page, `${app} ${width} abajo`);
    await shot(page, `${app}-${width}-bottom`);

    // Deslizar de costado sobre la lista (en los dos sentidos): ni la página ni un contenedor se corren.
    const lb = (await box.boundingBox())!;
    const before = lb.x;
    await drag(cdp, lb.x + lb.width - 30, lb.y + lb.height / 2, -220);
    await drag(cdp, lb.x + 30, lb.y + lb.height / 3, 220);
    await page.waitForTimeout(400);
    expect(await sideOffsets(page), `${app} ${width}: corrimiento después de deslizar`).toEqual({ page: 0, inner: 0 });
    expect((await box.boundingBox())!.x).toBe(before);
    // Si el gesto abrió una respuesta, se cierra para la siguiente pasada.
    await page.keyboard.press('Escape');

    // Deslizar a la derecha el mensaje propio (pegado al borde derecho): la burbuja corrida no corre la lista.
    // La lista se vuelve a pintar cuando llega la consulta en vivo: se busca de nuevo hasta tener la burbuja quieta.
    const mine = box.locator('.gr-msg-out', { hasText: 'Mío:' }).locator('.gr-bubble');
    let mb = { x: 0, y: 0, width: 0, height: 0 };
    await expect(async () => {
      await mine.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      mb = (await mine.boundingBox())!;
      expect(mb.width).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
    await drag(cdp, mb.x + 20, mb.y + mb.height / 2, 120);
    await page.waitForTimeout(400);
    expect(await sideOffsets(page), `${app} ${width}: corrimiento después de deslizar un mensaje propio`).toEqual({ page: 0, inner: 0 });
    await page.keyboard.press('Escape');

    // El panel de emojis abierto entra en la pantalla.
    // Un clic del DOM: en `next dev` el botón de las herramientas de Next tapa la esquina del campo.
    await page.locator('.wa-composer').getByRole('button', { name: 'Emoji', exact: true }).evaluate((el: HTMLElement) => el.click());
    await expect(page.locator('.wa-composer .wa-emoji')).toBeVisible();
    const eb = (await page.locator('.wa-composer .wa-emoji').boundingBox())!;
    expect(eb.x).toBeGreaterThanOrEqual(0);
    expect(eb.x + eb.width).toBeLessThanOrEqual(width);
    await fits(page, `${app} ${width} con los emojis`);
    await shot(page, `${app}-${width}-emoji`);
    await page.keyboard.press('Escape');
    await expect(page.locator('.wa-composer .wa-emoji')).toHaveCount(0);

    // Teclado abierto: el campo con foco y algo escrito largo. Con el dedo mide 16px (iOS no agranda la página).
    const input = page.locator('.wa-composer textarea').first();
    await input.click();
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await input.fill(`${LONG_WORD} ${LONG_URL}`);
    await fits(page, `${app} ${width} con el teclado`);
    await shot(page, `${app}-${width}-keyboard`);
    await input.fill('');
    await input.blur();
  }

  if (swipe) {
    const last = box.locator('.gr-msg', { hasText: `último ${tag}` }).locator('.gr-bubble');
    let b = { x: 0, y: 0, width: 0, height: 0 };
    await expect(async () => {
      await last.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      b = (await last.boundingBox())!;
      expect(b.width).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
    await drag(cdp, b.x + 20, b.y + b.height / 2, 110);
    await expect(page.locator('.wa-composer .gr-quote, .gr-replying .gr-quote, .wa-replying .gr-quote').first()).toContainText(`último ${tag}`);
    await fits(page, `${app} respondiendo`);
    await page.keyboard.press('Escape');
  }

  // En la compu nada cambia: el chat entra en la columna y no hay scroll de costado.
  await page.setViewportSize({ width: 1280, height: 860 });
  await expect(box.locator('.gr-msg', { hasText: `último ${tag}` })).toBeVisible();
  const wide = await overflow(page);
  expect(wide.page.scroll, JSON.stringify(wide)).toBeLessThanOrEqual(wide.page.inner);
  expect(wide.scrollers).toEqual([]);
  await shot(page, `${app}-1280`);
}

async function fakeLine(request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  return { id, url: ((await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string }).webhookUrl };
}

async function open(page: Page, row: Locator) {
  // El primer toque puede llegar antes de que la lista termine de cargar: se repite hasta que el chat se abre.
  const box = page.locator('.wa-messages');
  await expect(async () => {
    if (!(await box.isVisible())) await row.click({ timeout: 3_000 });
    await expect(box).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 90_000 });
  await page.locator('.wa-messages').evaluate((el) => (el.scrollTop = el.scrollHeight));
}

test('Inbox en el teléfono: el chat no se corre de costado', async ({ page, request, context }) => {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const chatId = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}8@s.whatsapp.net`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: chatEvents(chatId, tag, () => '') } });
  expect(res.ok(), await res.text()).toBe(true);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const cdp = await context.newCDPSession(page);
  await open(page, page.locator('.ib-item', { hasText: `Ancho ${tag}` }).locator('.ib-row-btn'));
  await checkChat(page, cdp, tag, 'inbox', true);
});

test('Lines en el teléfono: el chat no se corre de costado', async ({ page, request, context }) => {
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const tag = uid();
  const { id: numberId, url } = await fakeLine(request, `Ancho ${tag}`);
  const chatId = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}9@c.us`;
  const res = await request.post(new URL(url).pathname, { data: { events: chatEvents(chatId, tag, (id) => `evo:${id}`) } });
  expect(res.ok(), await res.text()).toBe(true);

  await page.setViewportSize({ width: 390, height: 800 });
  const cdp = await context.newCDPSession(page);
  // El chat se abre por su id (la línea es nueva y tiene solo este chat): buscarlo en la lista dependía de
  // cuántos chats más recientes dejaban las otras specs del shard en la misma base.
  let openId = '';
  await expect
    .poll(async () => (openId = String((await sql('SELECT id FROM groups_chats WHERE number_id = ?', [numberId]))[0]?.id ?? '')), { timeout: 20_000 })
    .not.toBe('');
  await page.goto(`/en/app/lines/inbox/${openId}`, { waitUntil: 'load' });
  await expect(page.locator('.wa-messages')).toBeVisible({ timeout: 60_000 });
  await page.locator('.wa-messages').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await checkChat(page, cdp, tag, 'lines', true);
});
