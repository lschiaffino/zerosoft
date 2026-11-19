import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Stickers como en WhatsApp, en Lines y en Inbox, con el WhatsApp falso
 * (GROUPS_FAKE=1; los mensajes "stk-" y "astk-" bajan un WebP quieto y uno
 * animado): un sticker que llega se ve chico y sin burbuja (no como una foto
 * grande), un GIF se reproduce en la burbuja con la marca GIF, la pestaña
 * Stickers del panel de emojis importa los de los chats y manda uno, y
 * "Agregar a favoritos" desde el menú de un sticker.
 * Y los stickers son por línea: el chat de una línea muestra los de esa línea y
 * no los de otra, y la grilla se dibuja sin esperar a traer lo nuevo de los chats.
 * Con STICKER_SHOTS=<carpeta> guarda capturas a 1280 y 390 (y en retro oscuro).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.STICKER_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Mensajes de un grupo: un sticker animado, uno quieto, un GIF y un texto. */
function stickerEvents(chatId: string, tag: string, chatName?: string) {
  const at = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const ref = (id: string) => ({ providerMessageId: id, chatId, fromMe: false });
  const base = { type: 'message', chatId, isGroup: true, fromMe: false, senderPhone: '15550001002', senderName: 'Beto Prueba', body: '', ...(chatName ? { chatName } : {}) };
  return [
    { ...base, providerMessageId: `t-${tag}`, body: 'Miren esto', timestamp: at(0) },
    { ...base, providerMessageId: `astk-${tag}`, media: { url: `evo:astk-${tag}`, type: 'image/webp', name: '', fetchRef: ref(`astk-${tag}`), info: { kind: 'sticker', animated: true, width: 96, height: 96 } }, timestamp: at(1) },
    { ...base, providerMessageId: `stk-${tag}`, media: { url: `evo:stk-${tag}`, type: 'image/webp', name: '', fetchRef: ref(`stk-${tag}`), info: { kind: 'sticker', width: 96, height: 96 } }, timestamp: at(2) },
    { ...base, providerMessageId: `gif-${tag}`, media: { url: `evo:gif-${tag}`, type: 'video/mp4', name: '', fetchRef: ref(`gif-${tag}`), info: { kind: 'video', animated: true, width: 480, height: 270, duration: 3 } }, timestamp: at(3) },
  ];
}

/** Lo que un sticker recibido tiene que ser: sin burbuja, chico, sin abrir el visor. */
async function expectBareStickers(page: Page, thread: Locator) {
  const stickers = thread.locator('.gr-msg-in.is-bare .wa-image.is-sticker');
  await expect(stickers).toHaveCount(2, { timeout: 30_000 });
  for (const s of await stickers.all()) {
    await expect(s.locator('img.is-loaded')).toBeVisible({ timeout: 20_000 });
    const box = (await s.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(192);
    expect(box.height).toBeLessThanOrEqual(192);
  }
  // Sin la burbuja de foto (con la hora encima): la hora va abajo, en su chip.
  await expect(thread.locator('.gr-msg.is-bare .gr-bubble.is-media')).toHaveCount(0);
  await stickers.first().click();
  await expect(page.locator('.wa-viewer')).toHaveCount(0);
  // El GIF: en la burbuja, con la marca.
  await expect(thread.locator('.wa-gif .wa-gif-badge')).toHaveText('GIF');
  await expect(thread.locator('.wa-gif video')).toHaveAttribute('loop', '');
}

/** Abre la pestaña Stickers, importa los de los chats y manda el primero. */
async function importAndSend(page: Page, composer: Locator, thread: Locator, shotName: string) {
  await composer.getByRole('button', { name: 'Emoji', exact: true }).click();
  const panel = page.locator('.wa-emoji');
  await panel.getByRole('tab', { name: 'Stickers' }).click();
  // Con la colección vacía, la pestaña importa sola los stickers de los chats: dos archivos distintos (el animado y el quieto).
  await expect(panel.locator('section[aria-label="Your stickers"] .wa-stk')).toHaveCount(2, { timeout: 20_000 });
  await expect.poll(() => panel.locator('.wa-stk-send img').last().evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  await shot(page, shotName);
  const before = await thread.locator('.gr-msg-out .wa-image.is-sticker').count();
  await panel.locator('section[aria-label="Your stickers"] .wa-stk-send').first().click();
  await expect(thread.locator('.gr-msg-out .wa-image.is-sticker')).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(panel.locator('section[aria-label="Recent"] .wa-stk')).toHaveCount(1);
  // Recuerda la pestaña.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
}

/** "Agregar a favoritos" desde el menú de un sticker recibido; aparece en Favoritos. */
async function favoriteFromMessage(page: Page, composer: Locator, thread: Locator) {
  const sticker = thread.locator('.gr-msg-in.is-bare').first();
  await sticker.hover();
  await sticker.locator('.wa-chevron').click();
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect(page.getByText('Added to favorite stickers')).toBeVisible();
  await composer.getByRole('button', { name: 'Emoji', exact: true }).click();
  const panel = page.locator('.wa-emoji');
  await expect(panel.getByRole('tab', { name: 'Stickers' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('section[aria-label="Favorites"] .wa-stk')).toHaveCount(1);
  await page.keyboard.press('Escape');
}

// Dos anchos, importar y mandar: más que el tiempo por defecto.
test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Cada intento arranca con la colección vacía ("No stickers yet"): la del intento anterior, o la que dejó otro
  // test con el usuario demo, ya tiene los mismos dos stickers y favoritos.
  // Si este es el primer test de la corrida la app todavía no migró: sin tablas, la colección ya está vacía.
  for (const table of ['wa_stickers', 'wa_sticker_sync', 'wa_sticker_line_sync']) {
    if ((await sql('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?', ['table', table])).length === 0) continue;
    await sql(`DELETE FROM ${table} WHERE user_id IN (SELECT id FROM users WHERE email = 'demo@zerosoft.ai')`);
  }
});

test('Lines: sticker chico y sin burbuja, GIF en burbuja, pestaña Stickers y favoritos', async ({ page, request }) => {
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Stk ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const name = `Stickers ${tag}`;
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: stickerEvents(gid, tag, name) } });
  expect(res.ok(), await res.text()).toBe(true);

  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]);
  await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  const thread = page.locator('.gr-thread').first();
  await expect(thread.locator('.gr-thread-head')).toBeVisible({ timeout: 60_000 });
  await expectBareStickers(page, thread);
  await shot(page, 'lines-received-1280');
  const composer = thread.locator('.wa-bar');
  await importAndSend(page, composer, thread, 'lines-sticker-tab-1280');
  await favoriteFromMessage(page, composer, thread);
  // El sticker que se mandó salió como sticker.
  const sent = await sql("SELECT media_type, meta FROM groups_messages WHERE number_id = ? AND direction = 'out' ORDER BY created_at DESC LIMIT 1", [id]);
  expect(String(sent[0].media_type)).toBe('image/webp');
  expect(JSON.parse(String(sent[0].meta)).media.kind).toBe('sticker');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  await expect(thread.locator('.gr-msg-in.is-bare .wa-image.is-sticker img.is-loaded').first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'lines-received-390');
  // Clic del DOM: en desarrollo el botón de Next tapa la esquina del campo a 390.
  await composer.getByRole('button', { name: 'Emoji', exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.locator('.wa-emoji .wa-stk').first()).toBeVisible();
  await expect.poll(() => page.locator('.wa-emoji .wa-stk-send img').last().evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  await shot(page, 'lines-sticker-tab-390');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: sticker chico y sin burbuja, GIF en burbuja, pestaña Stickers y favoritos', async ({ page, request }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const name = `Stickers ${tag}`;
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: stickerEvents(gid, tag, name) } });
  expect(res.ok()).toBe(true);
  // Se guarda como sticker, no como foto.
  const rows = await sql("SELECT media_type FROM inbox_messages WHERE external_id IN (?, ?)", [`astk-${tag}`, `stk-${tag}`]);
  expect(rows.map((r) => r.media_type)).toEqual(['sticker', 'sticker']);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const item = page.locator('.ib-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  await expect(thread.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  await expectBareStickers(page, thread);
  await shot(page, 'inbox-received-1280');
  const composer = thread.locator('.wa-bar');
  await importAndSend(page, composer, thread, 'inbox-sticker-tab-1280');
  await favoriteFromMessage(page, composer, thread);

  await page.setViewportSize({ width: 390, height: 844 });
  // En el teléfono la lista y el chat son pantallas aparte: se vuelve a abrir.
  if (!(await thread.isVisible())) await item.locator('.ib-row-btn').click();
  await expect(thread.locator('.gr-msg-in.is-bare .wa-image.is-sticker img.is-loaded').first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'inbox-received-390');
  // Clic del DOM: en desarrollo el botón de Next tapa la esquina del campo a 390.
  await composer.getByRole('button', { name: 'Emoji', exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.locator('.wa-emoji .wa-stk').first()).toBeVisible();
  await expect.poll(() => page.locator('.wa-emoji .wa-stk-send img').last().evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  await shot(page, 'inbox-sticker-tab-390');
  expect(errors, errors.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------------------
// Una colección por línea
// ---------------------------------------------------------------------------

type StickerRow = { id: string; line: string; animated: boolean };

/** Un sticker que llega a un chat: "stk-" baja el WebP quieto del WhatsApp falso y "astk-" el animado. */
function oneSticker(chatId: string, id: string, chatName?: string) {
  return {
    type: 'message',
    chatId,
    isGroup: true,
    fromMe: false,
    senderPhone: '15550001002',
    senderName: 'Beto Prueba',
    body: '',
    ...(chatName ? { chatName } : {}),
    providerMessageId: id,
    media: { url: `evo:${id}`, type: 'image/webp', name: '', fetchRef: { providerMessageId: id, chatId, fromMe: false }, info: { kind: 'sticker', width: 96, height: 96 } },
    timestamp: new Date().toISOString(),
  };
}

const newGroupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

/** Un pedido al servidor de pruebas; si el socket en reposo se cortó (ECONNRESET en desarrollo), se repite. */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let out!: T;
  await expect(async () => {
    out = await fn();
  }).toPass({ timeout: 60_000 });
  return out;
}

/** Deja lista la colección de una línea: trae los stickers de sus chats y crea uno propio de un color (distinto en cada línea). */
async function seedLine(request: APIRequestContext, api: string, line: string, color: { r: number; g: number; b: number }): Promise<StickerRow[]> {
  for (let i = 0; i < 10; i++) {
    const res = await retry(() => request.post(api, { ...waLinkIp(), data: { action: 'import', line } }));
    expect(res.ok(), await res.text()).toBe(true);
    if (!((await res.json()) as { more: boolean }).more) break;
  }
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { ...color, alpha: 1 } } })
    .png()
    .toBuffer();
  const created = await retry(() => request.post(api, { ...waLinkIp(), multipart: { line, file: { name: 'propio.png', mimeType: 'image/png', buffer: png } } }));
  expect(created.status(), await created.text()).toBe(201);
  return lineStickers(request, api, line);
}

async function lineStickers(request: APIRequestContext, api: string, line: string): Promise<StickerRow[]> {
  const res = await retry(() => request.get(`${api}?line=${encodeURIComponent(line)}`));
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { stickers: StickerRow[] }).stickers;
}

/** Retiene el pedido que trae lo nuevo de los chats (action 'import') hasta soltarlo: la grilla tiene que verse igual. */
async function holdImport(page: Page, api: string) {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const state = { held: 0, released: false };
  await page.route(`**${api}`, async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && (req.postData() ?? '').includes('"import"')) {
      state.held++;
      await gate;
    }
    await route.continue();
  });
  return {
    state,
    release: () => {
      state.released = true;
      release();
    },
  };
}

async function openStickers(page: Page, thread: Locator): Promise<Locator> {
  // Clic del DOM: en desarrollo el botón de Next tapa la esquina del campo a 390.
  await thread.locator('.wa-bar').getByRole('button', { name: 'Emoji', exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  const panel = page.locator('.wa-emoji');
  await panel.getByRole('tab', { name: 'Stickers' }).click();
  await expect(panel.getByRole('tab', { name: 'Stickers' })).toHaveAttribute('aria-selected', 'true');
  return panel;
}

const shownIds = (panel: Locator) => panel.locator('section[data-section="all"] .wa-stk').evaluateAll((els) => els.map((el) => el.getAttribute('data-sticker') ?? '').sort());
const allLoaded = (panel: Locator) => panel.locator('section[data-section="all"] .wa-stk-send img').evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLImageElement).naturalWidth > 0));

/** La captura de la pestaña, y la misma en retro oscuro (los aspectos y el tema son atributos de <html>). */
async function shotLooks(page: Page, name: string) {
  if (!process.env.STICKER_SHOTS) return;
  await shot(page, name);
  const before = await page.evaluate(() => {
    const h = document.documentElement;
    const was = { look: h.getAttribute('data-look'), theme: h.getAttribute('data-theme') };
    h.setAttribute('data-look', 'retro');
    h.setAttribute('data-theme', 'dark');
    return was;
  });
  await shot(page, `${name}-retro-dark`);
  await page.evaluate((was) => {
    const h = document.documentElement;
    for (const [k, v] of [['data-look', was.look], ['data-theme', was.theme]] as const) {
      if (v === null) h.removeAttribute(k);
      else h.setAttribute(k, v);
    }
  }, before);
}

/**
 * Lo mismo en las dos apps: en el chat de la línea A se ven los stickers de A (todos y solo esos), dibujados mientras
 * el pedido que trae lo nuevo sigue en curso; al soltarlo entra el que había llegado. En el chat de la línea B se ven
 * los de B y ninguno de A.
 */
async function expectPerLine(
  page: Page,
  o: { api: string; open: (chatId: string) => Promise<Locator>; chatA: string; chatB: string; a: StickerRow[]; b: StickerRow[]; lateA: () => Promise<void>; width: number; name: string },
) {
  const idsA = o.a.map((s) => s.id).sort();
  const idsB = o.b.map((s) => s.id).sort();
  expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
  // Llega un sticker nuevo a la línea A después de importar: lo trae el pedido de después, no la lista.
  await o.lateA();
  const gate = await holdImport(page, o.api);

  let thread = await o.open(o.chatA);
  let panel = await openStickers(page, thread);
  await expect.poll(() => shownIds(panel), { timeout: 30_000 }).toEqual(idsA);
  await expect.poll(() => allLoaded(panel), { timeout: 30_000 }).toBe(true);
  // La grilla está dibujada y el pedido de traer lo nuevo todavía no volvió.
  await expect.poll(() => gate.state.held).toBeGreaterThan(0);
  expect(gate.state.released).toBe(false);
  for (const id of idsB) await expect(panel.locator(`[data-sticker="${id}"]`)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shotLooks(page, `${o.name}-line-a-${o.width}`);
  // Al soltarlo, la grilla suma el que había llegado, sin perder los que estaban.
  gate.release();
  await expect(panel.locator('section[data-section="all"] .wa-stk')).toHaveCount(idsA.length + 1, { timeout: 30_000 });
  for (const id of idsA) await expect(panel.locator(`section[data-section="all"] [data-sticker="${id}"]`)).toHaveCount(1);
  // Se maneja con el teclado y Esc lo cierra.
  await panel.locator('.wa-stk-send').first().focus();
  await expect(panel.locator('.wa-stk-send').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  thread = await o.open(o.chatB);
  panel = await openStickers(page, thread);
  await expect.poll(() => shownIds(panel), { timeout: 30_000 }).toEqual(idsB);
  await expect.poll(() => allLoaded(panel), { timeout: 30_000 }).toBe(true);
  for (const id of idsA) await expect(panel.locator(`[data-sticker="${id}"]`)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shotLooks(page, `${o.name}-line-b-${o.width}`);
  // Un clic afuera (la fecha arriba de los mensajes, si el panel no la tapa) lo cierra; si no hay lugar, Esc.
  const over = (await panel.boundingBox())!;
  const day = await thread.locator('.wa-day').first().boundingBox();
  const spot = day ? { x: day.x + day.width / 2, y: day.y + day.height / 2 } : null;
  if (spot && !(spot.x >= over.x && spot.x <= over.x + over.width && spot.y >= over.y && spot.y <= over.y + over.height)) await page.mouse.click(spot.x, spot.y);
  else await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
}

for (const width of [1280, 390]) {
  test(`Lines ${width}px: cada línea muestra sus stickers y la grilla no espera a traer los nuevos`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
    const errors = watchErrors(page);
    const tag = uid();
    const lineOf = async (name: string) => {
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
      expect(created.ok()).toBe(true);
      const { id } = (await created.json()) as { id: string };
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
      const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const gid = newGroupId();
      const send = async (events: unknown[]) => {
        const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
        expect(res.ok(), await res.text()).toBe(true);
        // El archivo se baja después de guardar el mensaje: hasta entonces no se puede importar.
        await expect.poll(async () => Number((await sql("SELECT COUNT(*) AS n FROM groups_messages WHERE number_id = ? AND media_url LIKE 'evo:%'", [id]))[0].n), { timeout: 30_000 }).toBe(0);
      };
      return { id, gid, send, chat: async () => String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]))[0].id) };
    };
    const a = await lineOf(`Ventas ${tag}`);
    const b = await lineOf(`Soporte ${tag}`);
    await a.send([oneSticker(a.gid, `stk-${tag}-a`, `Clientes ${tag}`)]);
    await b.send([oneSticker(b.gid, `astk-${tag}-b`, `Equipo ${tag}`)]);
    const api = '/api/groups/stickers';
    const inA = await seedLine(request, api, a.id, { r: 220, g: 40, b: 40 });
    const inB = await seedLine(request, api, b.id, { r: 40, g: 80, b: 220 });
    expect(inA.map((s) => s.animated).sort()).toEqual([false, false]);
    expect(inB.map((s) => s.animated).sort()).toEqual([false, true]);

    await expectPerLine(page, {
      api,
      name: 'lines',
      width,
      chatA: await a.chat(),
      chatB: await b.chat(),
      a: inA,
      b: inB,
      lateA: () => a.send([oneSticker(a.gid, `astk-${tag}-a-nuevo`)]),
      open: async (chatId) => {
        await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
        const thread = page.locator('.gr-thread').first();
        await expect(thread.locator('.wa-bar')).toBeVisible({ timeout: 60_000 });
        return thread;
      },
    });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`Inbox ${width}px: cada cuenta muestra sus stickers y la grilla no espera a traer los nuevos`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
    const errors = watchErrors(page);
    const tag = uid();
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [linked] = await sql(
      "SELECT a.owner_id FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai' ORDER BY a.created_at LIMIT 1",
    );
    // Dos cuentas de WhatsApp más de la misma persona, ya conectadas y solo de este test (la pantalla vincula una; la
    // base admite varias): lo que tengan no depende de lo que otros tests dejaron en la cuenta compartida.
    const extra = async (label: string) => {
      const acc = { id: `iba_e2e_${uid()}${uid()}`, webhook_secret: randomBytes(24).toString('hex') };
      await sql(
        `INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, webhook_secret, created_at, updated_at)
         VALUES (?, ?, 'whatsapp', 'fake', ?, '', 'connected', ?, '2999-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z')`,
        [acc.id, String(linked.owner_id), label, acc.webhook_secret],
      );
      return acc;
    };
    const first = await extra(`Ventas ${tag}`);
    const second = await extra(`Trabajo ${tag}`);
    const accountOf = (acc: { id: string; webhook_secret: string }) => {
      const gid = newGroupId();
      const send = async (events: unknown[]) => {
        const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
        expect(res.ok(), await res.text()).toBe(true);
      };
      return { id: String(acc.id), gid, send, chat: async () => String((await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), gid]))[0].id) };
    };
    const a = accountOf(first);
    const b = accountOf(second);
    await a.send([oneSticker(a.gid, `stk-${tag}-a`, `Clientes ${tag}`)]);
    await b.send([oneSticker(b.gid, `astk-${tag}-b`, `Equipo ${tag}`)]);
    const api = '/api/inbox/stickers';
    const inA = await seedLine(request, api, a.id, { r: 230, g: 150, b: 30 });
    const inB = await seedLine(request, api, b.id, { r: 30, g: 170, b: 120 });
    // Cada cuenta tiene solo lo suyo: el sticker de su chat y el que se creó ahí.
    expect(inA.map((s) => s.animated).sort()).toEqual([false, false]);
    expect(inB.map((s) => s.animated).sort()).toEqual([false, true]);
    expect(inA.every((s) => s.line === a.id) && inB.every((s) => s.line === b.id)).toBe(true);

    await expectPerLine(page, {
      api,
      name: 'inbox',
      width,
      chatA: await a.chat(),
      chatB: await b.chat(),
      a: inA,
      b: inB,
      lateA: () => a.send([oneSticker(a.gid, `astk-${tag}-a-nuevo`)]),
      open: async (chatId) => {
        await page.goto(`/en/app/inbox?t=${chatId}`, { waitUntil: 'networkidle' });
        const thread = page.locator('.ib-wa-thread');
        await expect(thread.locator('.wa-bar')).toBeVisible({ timeout: 60_000 });
        return thread;
      },
    });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test.afterEach(async () => {
  await sql("DELETE FROM inbox_messages WHERE thread_id IN (SELECT id FROM inbox_threads WHERE account_id LIKE 'iba_e2e_%')");
  await sql("DELETE FROM inbox_threads WHERE account_id LIKE 'iba_e2e_%'");
  await sql("DELETE FROM inbox_accounts WHERE id LIKE 'iba_e2e_%'");
});
