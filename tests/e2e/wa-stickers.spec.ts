import { expect, test, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Stickers como en WhatsApp, en Lines y en Inbox, con el WhatsApp falso
 * (GROUPS_FAKE=1; los mensajes "stk-" y "astk-" bajan un WebP quieto y uno
 * animado): un sticker que llega se ve chico y sin burbuja (no como una foto
 * grande), un GIF se reproduce en la burbuja con la marca GIF, la pestaña
 * Stickers del panel de emojis importa los de los chats y manda uno, y
 * "Agregar a favoritos" desde el menú de un sticker.
 * Con STICKER_SHOTS=<carpeta> guarda capturas a 1280 y 390.
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
  await expect(stickers).toHaveCount(2);
  for (const s of await stickers.all()) {
    await expect(s.locator('img:not(.wa-thumb)')).toBeVisible();
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
  await expect(panel.getByText('No stickers yet')).toBeVisible();
  await panel.getByRole('button', { name: 'Import stickers from my chats' }).click();
  // Dos archivos distintos (el animado y el quieto).
  await expect(panel.locator('section[aria-label="Your stickers"] .wa-stk')).toHaveCount(2, { timeout: 20_000 });
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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
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

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-rows .gr-row', { hasText: name });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  const thread = page.locator('.gr-thread').first();
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
  await expect(thread.locator('.gr-msg-in.is-bare .wa-image.is-sticker').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'lines-received-390');
  await composer.getByRole('button', { name: 'Emoji', exact: true }).click();
  await expect(page.locator('.wa-emoji .wa-stk').first()).toBeVisible();
  await shot(page, 'lines-sticker-tab-390');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: sticker chico y sin burbuja, GIF en burbuja, pestaña Stickers y favoritos', async ({ page, request }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
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
  await expect(thread.getByRole('heading', { level: 2, name })).toBeVisible();
  await expectBareStickers(page, thread);
  await shot(page, 'inbox-received-1280');
  const composer = thread.locator('.wa-bar');
  await importAndSend(page, composer, thread, 'inbox-sticker-tab-1280');
  await favoriteFromMessage(page, composer, thread);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(thread.locator('.gr-msg-in.is-bare .wa-image.is-sticker').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'inbox-received-390');
  await composer.getByRole('button', { name: 'Emoji', exact: true }).click();
  await expect(page.locator('.wa-emoji .wa-stk').first()).toBeVisible();
  await shot(page, 'inbox-sticker-tab-390');
  expect(errors, errors.join('\n')).toEqual([]);
});
