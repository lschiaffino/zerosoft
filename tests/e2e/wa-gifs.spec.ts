import { expect, test, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Pestaña GIFs del panel de emojis, como en WhatsApp, en Lines y en Inbox, con
 * el buscador falso (GROUPS_GIFS_FAKE=1: GIFs de prueba, lib/wa-gifs.ts) y el
 * WhatsApp falso (GROUPS_FAKE=1): tendencias al abrir, categorías, búsqueda,
 * más resultados al bajar, y un clic manda el GIF como video con gifPlayback
 * (la burbuja lo muestra con la marca GIF). Con la cookie wa_gifs_fake=off se
 * ve el estado sin clave. Con GIF_SHOTS=<carpeta> guarda capturas a 1280 y
 * 390, en claro y oscuro.
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
  const dir = process.env.GIF_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Un grupo con un mensaje, para tener el chat. */
function chatEvents(chatId: string, tag: string, chatName: string) {
  return [
    {
      type: 'message',
      chatId,
      isGroup: true,
      fromMe: false,
      senderPhone: '15550001002',
      senderName: 'Beto Prueba',
      chatName,
      providerMessageId: `t-${tag}`,
      body: '¿Alguien tiene un GIF para esto?',
      timestamp: new Date(Date.now() - 30_000).toISOString(),
    },
  ];
}

async function openGifs(page: Page, composer: Locator): Promise<Locator> {
  // Clic del DOM: en desarrollo el botón de Next tapa la esquina del campo a 390.
  await composer.getByRole('button', { name: 'Emoji', exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  const panel = page.locator('.wa-emoji');
  await panel.getByRole('tab', { name: 'GIFs' }).click();
  return panel;
}

/** Las vistas previas cargaron (no solo el lugar). */
async function previewsLoaded(panel: Locator) {
  await expect.poll(() => panel.locator('.wa-gif-tile img').first().evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
}

/** Tendencias, categorías, búsqueda, más al bajar y mandar el primero; el panel se cierra y el GIF queda en el chat. */
async function browseAndSend(page: Page, composer: Locator, thread: Locator, app: string) {
  const panel = await openGifs(page, composer);
  // Tendencias: la categoría marcada y una página de GIFs, con la atribución.
  await expect(panel.getByRole('button', { name: 'Trending' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.wa-gif-tile')).toHaveCount(24, { timeout: 60_000 });
  await expect(panel.getByText('Sample GIFs (demo mode)')).toBeVisible();
  await expect(panel.getByRole('searchbox')).toBeFocused();
  await previewsLoaded(panel);
  await shot(page, `${app}-gifs-trending-1280`);

  // Al bajar llegan más.
  await panel.locator('.wa-gif-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(panel.locator('.wa-gif-tile')).toHaveCount(48, { timeout: 20_000 });

  // Una categoría busca su término.
  await panel.getByRole('button', { name: 'Sad' }).click();
  await expect(panel.getByRole('searchbox')).toHaveValue('sad');
  await expect(panel.getByRole('button', { name: 'Sad' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.wa-gif-tile').first()).toHaveAttribute('title', 'sad 1', { timeout: 20_000 });

  // Búsqueda escrita.
  await panel.getByRole('searchbox').fill('cats');
  await expect(panel.locator('.wa-gif-tile').first()).toHaveAttribute('title', 'cats 1', { timeout: 20_000 });
  await expect(panel.getByRole('button', { name: 'Trending' })).toHaveAttribute('aria-pressed', 'false');
  await previewsLoaded(panel);
  await shot(page, `${app}-gifs-search-1280`);
  await panel.getByRole('searchbox').fill('nothing');
  await expect(panel.getByText('No GIFs found for "nothing".')).toBeVisible({ timeout: 20_000 });
  await panel.getByRole('searchbox').fill('cats');

  const before = await thread.locator('.gr-msg-out .wa-gif').count();
  await panel.getByRole('button', { name: 'Send GIF: cats 1', exact: true }).click();
  await expect(panel).toHaveCount(0, { timeout: 20_000 });
  const gif = thread.locator('.gr-msg-out .wa-gif').last();
  await expect(thread.locator('.gr-msg-out .wa-gif')).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(gif.locator('.wa-gif-badge')).toHaveText('GIF');
  await expect(gif.locator('video')).toHaveAttribute('loop', '');
  await expect(gif.locator('video')).toHaveJSProperty('muted', true);
  // El MP4 se reproduce (es un video de verdad, no la vista previa).
  await expect.poll(() => gif.locator('video').evaluate((v) => (v as HTMLVideoElement).readyState), { timeout: 20_000 }).toBeGreaterThan(1);
  await shot(page, `${app}-gif-sent-1280`);

  // La pestaña queda recordada.
  await composer.getByRole('button', { name: 'Emoji', exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.locator('.wa-emoji').getByRole('tab', { name: 'GIFs' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.wa-emoji')).toHaveCount(0);
}

/** Sin clave: el estado que lo explica (y Emoji sigue andando). */
async function notSetUp(page: Page, composer: Locator, app: string, baseURL: string) {
  await page.context().addCookies([{ name: 'wa_gifs_fake', value: 'off', url: baseURL }]);
  const panel = await openGifs(page, composer);
  // La primera vez: en desarrollo la ruta se compila al pedirla.
  await expect(panel.getByText("GIF search isn't set up")).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText(/An admin adds a GIPHY or Tenor key/)).toBeVisible();
  await expect(panel.locator('.wa-gif-tile')).toHaveCount(0);
  await shot(page, `${app}-gifs-unset-1280`);
  await panel.getByRole('tab', { name: 'Emoji' }).click();
  await expect(panel.locator('.wa-emoji-grid button').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.context().clearCookies({ name: 'wa_gifs_fake' });
}

/** Capturas extra (solo con GIF_SHOTS): 390 y oscuro. */
async function moreShots(page: Page, composer: Locator, thread: Locator, app: string, baseURL: string, reopen: () => Promise<void>) {
  if (!process.env.GIF_SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await page.context().addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await reopen();
      await expect(thread.locator('.gr-msg-out .wa-gif').last()).toBeVisible({ timeout: 30_000 });
      await thread.locator('.gr-msg-out .wa-gif').last().scrollIntoViewIfNeeded();
      await shot(page, `${app}-gif-sent-${width}-${theme}`);
      const panel = await openGifs(page, composer);
      await expect(panel.locator('.wa-gif-tile').first()).toBeVisible({ timeout: 20_000 });
      await previewsLoaded(panel);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${app}-gifs-trending-${width}-${theme}`);
      await panel.getByRole('searchbox').fill('party');
      await expect(panel.locator('.wa-gif-tile').first()).toHaveAttribute('title', 'party 1', { timeout: 20_000 });
      await previewsLoaded(panel);
      await shot(page, `${app}-gifs-search-${width}-${theme}`);
      await page.context().addCookies([{ name: 'wa_gifs_fake', value: 'off', url: baseURL }]);
      await panel.getByRole('tab', { name: 'Emoji' }).click();
      await panel.getByRole('tab', { name: 'GIFs' }).click();
      await expect(panel.getByText("GIF search isn't set up")).toBeVisible({ timeout: 20_000 });
      await shot(page, `${app}-gifs-unset-${width}-${theme}`);
      await page.context().clearCookies({ name: 'wa_gifs_fake' });
      await page.keyboard.press('Escape');
    }
  }
  await page.context().clearCookies({ name: 'zs_theme' });
}

test.setTimeout(240_000);

test.beforeEach(async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // En desarrollo cada ruta se compila al primer pedido: se piden antes de abrir el panel.
  await request.get('/api/groups/gifs?q=&pos=&locale=en', { timeout: 120_000 }).catch(() => null);
  await request.get('/api/inbox/gifs?q=&pos=&locale=en', { timeout: 120_000 }).catch(() => null);
});

test('Lines: pestaña GIFs, buscar y mandar un GIF (video con gifPlayback)', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Gif ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: chatEvents(gid, tag, `GIFs ${tag}`) } });
  expect(res.ok(), await res.text()).toBe(true);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]);

  const reopen = async () => {
    await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-thread .gr-thread-head').first()).toBeVisible({ timeout: 60_000 });
  };
  await reopen();
  const thread = page.locator('.gr-thread').first();
  const composer = thread.locator('.wa-bar');
  await notSetUp(page, composer, 'lines', baseURL!);
  await browseAndSend(page, composer, thread, 'lines');

  // Salió como video con gifPlayback (el WhatsApp falso le da un id "gif-") y quedó guardado como GIF.
  const [sent] = await sql("SELECT media_type, media_url, provider_message_id, meta FROM groups_messages WHERE chat_id = ? AND direction = 'out' ORDER BY created_at DESC LIMIT 1", [String(chat.id)]);
  expect(String(sent.media_type)).toBe('video/mp4');
  expect(String(sent.provider_message_id)).toMatch(/^gif-/);
  expect(JSON.parse(String(sent.meta)).media).toMatchObject({ kind: 'video', animated: true });

  await moreShots(page, composer, thread, 'lines', baseURL!, reopen);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: pestaña GIFs, buscar y mandar un GIF (video con gifPlayback)', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const name = `GIFs ${tag}`;
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: chatEvents(gid, tag, name) } });
  expect(res.ok()).toBe(true);

  const thread = page.locator('.ib-wa-thread');
  const reopen = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const item = page.locator('.ib-item', { hasText: name });
    await expect(item).toBeVisible({ timeout: 20_000 });
    await item.locator('.ib-row-btn').click();
    // En desarrollo, la primera carga del chat puede pasar el tiempo de la pantalla mientras compila: se reintenta.
    await expect(async () => {
      const retry = page.getByRole('alert').getByRole('button', { name: 'Try again' });
      if (await retry.isVisible()) await retry.click();
      await expect(thread.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 120_000 });
  };
  await reopen();
  const composer = thread.locator('.wa-bar');
  await notSetUp(page, composer, 'inbox', baseURL!);
  await browseAndSend(page, composer, thread, 'inbox');

  const [sent] = await sql(
    "SELECT m.media_type, m.external_id, m.meta FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.external_id = ? AND m.from_me = 1 ORDER BY m.rowid DESC LIMIT 1",
    [gid],
  );
  expect(String(sent.media_type)).toBe('video');
  expect(String(sent.external_id)).toMatch(/^gif-/);
  expect(JSON.parse(String(sent.meta))).toMatchObject({ animated: true, mime: 'video/mp4' });

  await moreShots(page, composer, thread, 'inbox', baseURL!, reopen);
  expect(errors, errors.join('\n')).toEqual([]);
});
