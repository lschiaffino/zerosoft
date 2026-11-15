import { expect, test, type Locator, type Page } from '@playwright/test';
import { deflateSync } from 'zlib';
import { e2eDb } from './helpers/db';

/**
 * El menú + de Lines e Inbox, como el de WhatsApp (components/groups/wa/AttachMenu.tsx), contra el WhatsApp
 * falso (GROUPS_FAKE=1): las opciones en el orden de WhatsApp y lo nuestro separado abajo; Cámara (la cámara
 * falsa de Chromium) → la foto a la vista previa → sale; Contacto, Encuesta y Sticker nuevo salen y llegan al
 * chat. Con ATTACH_SHOTS=<carpeta> guarda capturas a 1280 y 390, en claro y oscuro.
 */

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['camera'],
});
test.setTimeout(240_000);

const uid = () => Math.random().toString(36).slice(2, 8);
const WA_ORDER = ['doc', 'photo', 'camera', 'audio', 'contact', 'poll', 'sticker'];

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
  const dir = process.env.ATTACH_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

/** Un PNG de 64×64 de un color (para el sticker nuevo), sin depender de archivos del repo. */
function png(size = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4, Buffer.from([0x25, 0xd3, 0x66, 0xff]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const chatEvents = (chatId: string, tag: string, chatName: string) => [
  { type: 'message', chatId, isGroup: true, fromMe: false, senderPhone: '15550001002', senderName: 'Beto Prueba', chatName, providerMessageId: `t-${tag}`, body: 'Hola', timestamp: new Date(Date.now() - 30_000).toISOString() },
];

async function openMenu(page: Page, composer: Locator): Promise<Locator> {
  // Clic del DOM: en desarrollo el botón de Next tapa la esquina del campo a 390.
  await composer.locator('.wa-attach').evaluate((b) => (b as HTMLButtonElement).click());
  const menu = page.locator('.gr-menu-list.is-attach');
  await expect(menu).toBeVisible();
  return menu;
}

/** Las opciones de WhatsApp, en su orden, y lo nuestro debajo de una línea. */
async function checkOrder(page: Page, composer: Locator, app: string) {
  const menu = await openMenu(page, composer);
  const keys = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
  expect(keys.slice(0, WA_ORDER.length)).toEqual(WA_ORDER);
  const ours = keys.slice(WA_ORDER.length);
  expect(ours).toEqual(expect.arrayContaining(['dictate', 'commands']));
  await expect(menu.locator(`[data-key="${ours[0]}"]`)).toHaveClass(/has-divider/);
  // Los de WhatsApp con su ícono de color; los nuestros con el gris.
  await expect(menu.locator('.gr-menu-icon')).toHaveCount(WA_ORDER.length);
  await expect(menu.locator('.gr-menu-glyph')).toHaveCount(ours.length);
  await shot(page, `${app}-attach-menu-1280`);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

/** Cámara: la foto de la cámara falsa va a la vista previa y sale como imagen. */
async function camera(page: Page, composer: Locator, thread: Locator, app: string) {
  const before = await thread.locator('.gr-msg-out img').count();
  const menu = await openMenu(page, composer);
  await menu.locator('[data-key="camera"]').click();
  const cam = page.locator('.wa-camera[role="dialog"]');
  await expect(cam.getByTestId('camera-snap')).toBeEnabled({ timeout: 20_000 });
  await shot(page, `${app}-camera-live`);
  await cam.getByTestId('camera-snap').click();
  await expect(cam.getByTestId('camera-use')).toBeVisible();
  await cam.getByTestId('camera-use').click();
  await expect(cam).toHaveCount(0);
  const pane = page.locator('.wa-attach-pane');
  await expect(pane).toBeVisible();
  await pane.locator('.wa-attach-send').click();
  await expect(pane).toHaveCount(0);
  await expect.poll(() => thread.locator('.gr-msg-out img').count(), { timeout: 30_000 }).toBeGreaterThan(before);
}

/** Contacto: nombre y número a mano; llega la tarjeta. */
async function contact(page: Page, composer: Locator, thread: Locator, app: string) {
  const before = await thread.locator('.gr-msg-out .wa-contact-card').count();
  const menu = await openMenu(page, composer);
  await menu.locator('[data-key="contact"]').click();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('.wa-contact-manual') });
  await expect(dialog).toBeVisible();
  await dialog.locator('.wa-contact-manual input').first().fill('Ana Prueba');
  await dialog.locator('.wa-contact-manual input[type="tel"]').fill('+1 555 000 1003');
  await shot(page, `${app}-contact-dialog`);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(thread.locator('.gr-msg-out .wa-contact-card')).toHaveCount(before + 1, { timeout: 20_000 });
}

/** Encuesta: pregunta y dos opciones; llega la encuesta. */
async function poll(page: Page, composer: Locator, thread: Locator, app: string, bubble: string) {
  const before = await thread.locator(bubble).count();
  const menu = await openMenu(page, composer);
  await menu.locator('[data-key="poll"]').click();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('.gr-poll-fields') });
  const inputs = dialog.locator('.gr-poll-fields input.input');
  await expect(inputs.first()).toBeVisible();
  await inputs.nth(0).fill('¿Qué día?');
  await inputs.nth(1).fill('Lunes');
  await inputs.nth(2).fill('Martes');
  await shot(page, `${app}-poll-dialog`);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(thread.locator(bubble)).toHaveCount(before + 1, { timeout: 20_000 });
}

/** Sticker nuevo: una imagen se vuelve sticker y sale al chat. */
async function newSticker(page: Page, composer: Locator, thread: Locator) {
  const before = await thread.locator('.gr-msg-out .wa-image.is-sticker').count();
  await composer.locator('input[data-attach="sticker"]').setInputFiles({ name: 'sticker.png', mimeType: 'image/png', buffer: png() });
  await expect(thread.locator('.gr-msg-out .wa-image.is-sticker')).toHaveCount(before + 1, { timeout: 30_000 });
}

async function moreShots(page: Page, composer: Locator, app: string, baseURL: string, reopen: () => Promise<void>) {
  if (!process.env.ATTACH_SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await page.context().addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await reopen();
      // Las fotos del chat terminan de cargar (el chat baja solo y eso cerraría el menú).
      await expect.poll(() => page.evaluate(() => [...document.images].every((i) => i.complete)), { timeout: 30_000 }).toBe(true);
      // Si el chat todavía se acomoda (baja al final), el menú se cierra: se vuelve a abrir hasta que queda abierto.
      await expect(async () => {
        if (!(await page.locator('.gr-menu-list.is-attach').isVisible())) await composer.locator('.wa-attach').evaluate((b) => (b as HTMLButtonElement).click());
        await expect(page.locator('.gr-menu-list.is-attach')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 20_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${app}-attach-menu-${width}-${theme}`);
      await page.keyboard.press('Escape');
    }
  }
  await page.context().clearCookies({ name: 'zs_theme' });
  await page.setViewportSize({ width: 1280, height: 800 });
}

test.beforeEach(async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // En desarrollo cada ruta se compila al primer pedido: las de stickers se piden antes.
  await request.get('/api/groups/stickers', { timeout: 120_000 }).catch(() => null);
  await request.get('/api/inbox/stickers', { timeout: 120_000 }).catch(() => null);
});

test('Lines: menú + como WhatsApp (cámara, contacto, encuesta, sticker nuevo)', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Attach ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: chatEvents(gid, tag, `Attach ${tag}`) } });
  expect(res.ok(), await res.text()).toBe(true);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]);
  const reopen = async () => {
    await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-thread .gr-thread-head').first()).toBeVisible({ timeout: 90_000 });
  };
  await reopen();
  const thread = page.locator('.gr-thread').first();
  const composer = thread.locator('.wa-bar');

  await checkOrder(page, composer, 'lines');
  await camera(page, composer, thread, 'lines');
  await contact(page, composer, thread, 'lines');
  await poll(page, composer, thread, 'lines', '.gr-msg-out .gr-poll');
  await newSticker(page, composer, thread);
  await shot(page, 'lines-attach-sent-1280');

  const sent = await sql("SELECT provider_message_id, poll, meta FROM groups_messages WHERE chat_id = ? AND direction = 'out' ORDER BY created_at", [String(chat.id)]);
  expect(sent.some((m) => String(m.poll ?? '').includes('Lunes'))).toBe(true);
  expect(sent.some((m) => String(m.meta ?? '').includes('15550001003'))).toBe(true);

  await moreShots(page, composer, 'lines', baseURL!, reopen);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: menú + como WhatsApp (cámara, contacto, encuesta, sticker nuevo)', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const name = `Attach ${tag}`;
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: chatEvents(gid, tag, name) } });
  expect(res.ok()).toBe(true);
  const thread = page.locator('.ib-wa-thread');
  const reopen = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const item = page.locator('.ib-item', { hasText: name });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.locator('.ib-row-btn').click();
    await expect(async () => {
      const retry = page.getByRole('alert').getByRole('button', { name: 'Try again' });
      if (await retry.isVisible()) await retry.click();
      await expect(thread.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 150_000 });
  };
  await reopen();
  const composer = thread.locator('.wa-bar');

  await checkOrder(page, composer, 'inbox');
  await camera(page, composer, thread, 'inbox');
  await contact(page, composer, thread, 'inbox');
  await poll(page, composer, thread, 'inbox', '.gr-msg-out .ib-wa-poll');
  await newSticker(page, composer, thread);
  await shot(page, 'inbox-attach-sent-1280');

  const sent = await sql('SELECT m.meta FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.external_id = ? AND m.from_me = 1', [gid]);
  expect(sent.some((m) => String(m.meta ?? '').includes('"poll"'))).toBe(true);
  expect(sent.some((m) => String(m.meta ?? '').includes('15550001003'))).toBe(true);

  await moreShots(page, composer, 'inbox', baseURL!, reopen);
  expect(errors, errors.join('\n')).toEqual([]);
});
