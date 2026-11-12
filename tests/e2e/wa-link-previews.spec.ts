import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Vista previa de links en los chats de WhatsApp (Lines e Inbox), como en
 * WhatsApp: la imagen grande arriba, la compacta con logos, solo texto sin
 * imagen; la vista previa mientras se escribe (con X para mandar sin ella) y
 * la "Visualización" de cada persona aplicada al instante. Lector de links
 * falso (DOCS_UNFURL_FAKE): /logo da un logo, /no-image nada, /gallery dos
 * imágenes, /long un título largo. Con LP_SHOTS=<carpeta> guarda capturas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string, locator?: ReturnType<Page['locator']>) {
  const dir = process.env.LP_SHOTS;
  if (!dir) return;
  if (locator) await locator.screenshot({ path: `${dir}/lp-${name}.png` });
  else await page.screenshot({ path: `${dir}/lp-${name}.png` });
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

const DEFAULTS = { textSize: 'default', density: 'comfortable', linkPreviews: 'large', mediaSize: 'default', bubbleWidth: 'default', wallpaper: 'pattern', groupAvatars: true };

/** Un número falso de Lines conectado con un chat que manda varios links. Devuelve el nombre del chat. */
async function linesChatWithLinks(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Links ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Lucía ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const t0 = Date.now() - 60_000;
  const bodies = [
    'Mirá la nota https://example.test/nota',
    'El logo https://brand.test/logo',
    'Sin imagen https://plain.test/no-image',
    'Dos fotos https://photos.test/gallery',
    'Y esta https://news.test/long-read',
  ];
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: bodies.map((body, i) => ({
        type: 'message',
        chatId: `${phone}@s.whatsapp.net`,
        isGroup: false,
        fromMe: false,
        senderPhone: phone,
        senderName: name,
        providerMessageId: `lp-${uid()}-${i}`,
        body,
        timestamp: new Date(t0 + i * 1000).toISOString(),
      })),
    },
  });
  expect(res.ok()).toBe(true);
  return name;
}

/** Abre el chat por su link (la URL del chat; más firme que un clic mientras la página hidrata). */
async function openChat(page: Page, name: string) {
  const link = page.getByRole('link', { name: new RegExp(name) }).first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await page.goto((await link.getAttribute('href'))!, { waitUntil: 'networkidle' });
}

test.describe.configure({ timeout: 240_000 });

test.afterEach(async ({ request }) => {
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
});

test('Lines: tarjeta grande, compacta y de texto; vista previa al escribir y mandar sin ella', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
  const name = await linesChatWithLinks(request);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await openChat(page, name);
  const msgs = page.locator('.wa-messages');

  // Grande: la imagen arriba, servida desde nuestro dominio, título, descripción y dominio con el ícono.
  const big = msgs.locator('.gr-msg', { hasText: 'Mirá la nota' }).locator('.wa-linkcard');
  await expect(big).toHaveAttribute('data-layout', 'large', { timeout: 45_000 });
  await expect(big.locator('.wa-linkcard-media img')).toHaveAttribute('src', /^\/api\/wa\/link-preview\/image\?url=/);
  await big.scrollIntoViewIfNeeded();
  await expect.poll(() => big.locator('.wa-linkcard-media img').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBe(1200);
  await expect(big.locator('strong')).toHaveText('example.test page');
  await expect(big.locator('.wa-linkcard-domain')).toHaveText('example.test');
  await expect(big.locator('.wa-linkcard-fav')).toBeVisible();
  await expect(big).toHaveAttribute('href', 'https://example.test/nota');
  await expect(big).toHaveAttribute('rel', /noopener/);
  // Compacta con un logo, solo texto sin imagen, grilla de dos y título largo recortado.
  await expect(msgs.locator('.gr-msg', { hasText: 'El logo' }).locator('.wa-linkcard')).toHaveAttribute('data-layout', 'compact');
  await expect(msgs.locator('.gr-msg', { hasText: 'Sin imagen' }).locator('.wa-linkcard')).toHaveAttribute('data-layout', 'text');
  await expect(msgs.locator('.gr-msg', { hasText: 'Dos fotos' }).locator('.wa-linkcard-media.is-grid img')).toHaveCount(2);
  const long = msgs.locator('.gr-msg', { hasText: 'Y esta' }).locator('.wa-linkcard');
  await expect(long).toHaveAttribute('data-layout', 'large');
  const box = await long.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(331);

  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      await page.reload({ waitUntil: 'networkidle' });
      await expect(msgs.locator('.gr-msg', { hasText: 'Mirá la nota' }).locator('.wa-linkcard.is-large')).toBeVisible({ timeout: 20_000 });
      await msgs.locator('.gr-msg', { hasText: 'Mirá la nota' }).scrollIntoViewIfNeeded();
      await noHorizontalScroll(page);
      await shot(page, `bubble-${width}-${theme}`);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.reload({ waitUntil: 'networkidle' });

  // Al escribir: la vista previa arriba del campo; con la X se manda sin ella.
  const field = page.locator('.gr-composer textarea');
  await field.fill('Te paso https://shop.test/oferta');
  const card = page.getByTestId('composer-link-preview');
  await expect(card).toContainText('shop.test page');
  await expect(card.locator('img')).toBeVisible();
  await shot(page, 'composer-1280-light', page.locator('.gr-composer'));
  await card.getByRole('button', { name: 'Send without preview' }).click();
  await expect(card).toHaveCount(0);
  await field.press('Enter');
  const sentBare = msgs.locator('.gr-msg-out', { hasText: 'Te paso https://shop.test/oferta' });
  await expect(sentBare).toBeVisible();
  await expect(sentBare.locator('.wa-linkcard')).toHaveCount(0);
  // Sin sacarla: sale con la vista previa.
  await field.fill('Y esta otra https://shop.test/nueva');
  await expect(card).toContainText('shop.test page');
  await field.press('Enter');
  await expect(card).toHaveCount(0);
  await expect(msgs.locator('.gr-msg-out', { hasText: 'Y esta otra' }).locator('.wa-linkcard')).toBeVisible();
  // Lo que quedó guardado: el mensaje sin vista previa lleva noPreview (y el reintento la respeta).
  const db = e2eDb();
  try {
    const rows = (await db.execute({ sql: "SELECT body, meta FROM groups_messages WHERE body LIKE '%shop.test/%' AND direction = 'out'", args: [] })).rows;
    const bare = rows.find((r) => String(r.body).includes('oferta'));
    const kept = rows.find((r) => String(r.body).includes('nueva'));
    expect(JSON.parse(String(bare?.meta || '{}')).noPreview).toBe(true);
    expect(JSON.parse(String(kept?.meta || '{}')).noPreview).toBeUndefined();
  } finally {
    db.close();
  }

  // 390: la vista previa del campo entra sin scroll horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    await page.reload({ waitUntil: 'networkidle' });
    await field.fill('Mirá https://news.test/long-story');
    await expect(card).toContainText('news.test page');
    await noHorizontalScroll(page);
    await shot(page, `composer-390-${theme}`);
    if (theme === 'dark') await shot(page, 'composer-1280-dark-crop', page.locator('.gr-composer'));
    await field.fill('');
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Visualización: se elige en Ajustes de Lines e Inbox y se ve al instante en los chats', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
  const name = await linesChatWithLinks(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/lines/settings?tab=appearance', { waitUntil: 'networkidle' });
  const section = page.locator('#chat-display');
  await expect(section.getByRole('heading', { name: 'Display' })).toBeVisible();
  // Texto grande: el ejemplo cambia al instante y queda guardado.
  const sampleText = section.locator('.wa-display-sample .gr-msg-in .wa-text');
  const before = await sampleText.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await section.locator('[data-option="textSize-large"]').click();
  await expect(section.getByRole('status')).toHaveText(/Saved/);
  await expect.poll(() => sampleText.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(before + 1);
  // Vista previa compacta: también en el ejemplo.
  await section.locator('[data-option="linkPreviews-compact"]').click();
  await expect(section.locator('.wa-display-sample .wa-linkcard')).toHaveAttribute('data-layout', 'compact');
  await section.locator('[data-option="linkPreviews-large"]').click();
  await expect(section.locator('.wa-display-sample .wa-linkcard')).toHaveAttribute('data-layout', 'large');
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await page.reload({ waitUntil: 'networkidle' });
      await expect(section).toBeVisible();
      await noHorizontalScroll(page);
      await section.scrollIntoViewIfNeeded();
      await shot(page, `settings-${width}-${theme}`, width > 500 ? undefined : section);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  await page.setViewportSize({ width: 1280, height: 860 });

  // En el chat: el texto grande y las vistas previas compactas, sin recargar nada más.
  await request.put('/api/chat-style', { data: { display: { linkPreviews: 'compact', textSize: 'large', groupAvatars: false } } });
  const saved = (await (await request.get('/api/chat-style')).json()) as { display: Record<string, unknown> };
  expect(saved.display).toMatchObject({ linkPreviews: 'compact', textSize: 'large', groupAvatars: false, mediaSize: 'default' });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await openChat(page, name);
  const big = page.locator('.wa-messages .gr-msg', { hasText: 'Mirá la nota' });
  await expect(big.locator('.wa-linkcard')).toHaveAttribute('data-layout', 'compact', { timeout: 45_000 });
  expect(await big.locator('.wa-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(15);
  // Sin vista previa: ni en las burbujas ni al escribir.
  await request.put('/api/chat-style', { data: { display: { linkPreviews: 'off' } } });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.wa-messages .gr-msg', { hasText: 'Mirá la nota' })).toBeVisible();
  await expect(page.locator('.wa-messages .wa-linkcard')).toHaveCount(0);
  await page.locator('.gr-composer textarea').fill('https://example.test/otra');
  await page.waitForTimeout(800);
  await expect(page.getByTestId('composer-link-preview')).toHaveCount(0);
  await page.locator('.gr-composer textarea').fill('');
  // Inválido: 400 y nada cambia.
  expect((await request.put('/api/chat-style', { data: { display: 'large' } })).status()).toBe(400);

  // Inbox tiene la misma sección (el mismo ajuste).
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const inboxSection = page.locator('#chat-display');
  await expect(inboxSection.getByRole('heading', { name: 'Display' })).toBeVisible();
  await expect(inboxSection.locator('[data-option="linkPreviews-off"]')).toHaveAttribute('aria-pressed', 'true');
  await inboxSection.getByRole('button', { name: 'Reset to default' }).click();
  await expect(inboxSection.getByRole('status')).toHaveText(/Saved/);
  await expect(inboxSection.locator('[data-option="linkPreviews-large"]')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'settings-inbox-1280-light', inboxSection);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: vista previa al escribir; con la X sale sin vista previa y la burbuja tampoco la muestra', async ({ page, request }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'", args: [] })).rows;
    const tag = uid();
    const phone = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
      data: { events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: `Ana ${tag}`, providerMessageId: `in-${tag}`, body: 'Mirá https://example.test/inbox-nota', timestamp: new Date().toISOString() }] },
    });
    expect(res.ok()).toBe(true);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: `Ana ${tag}` }).locator('.ib-row-btn').click();
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.locator('.wa-linkcard.is-large', { hasText: 'example.test page' })).toBeVisible({ timeout: 45_000 });
    const field = thread.locator('.ib-wa-composer textarea');
    await field.fill(`Gracias https://shop.test/inbox-${tag}`);
    const card = page.getByTestId('composer-link-preview');
    await expect(card).toContainText('shop.test page');
    await shot(page, 'composer-inbox-1280-light');
    await card.getByRole('button', { name: 'Send without preview' }).click();
    await expect(card).toHaveCount(0);
    await field.press('Enter');
    const sent = thread.locator('.gr-msg-out', { hasText: `shop.test/inbox-${tag}` });
    await expect(sent).toBeVisible();
    await expect(sent.locator('.wa-linkcard')).toHaveCount(0);
    // La burbuja aparece antes de que el servidor lo guarde (envío optimista): se espera la fila.
    await expect
      .poll(
        async () => {
          const [row] = (await db.execute({ sql: 'SELECT meta FROM inbox_messages WHERE body LIKE ? AND from_me = 1', args: [`%inbox-${tag}%`] })).rows;
          return row ? JSON.parse(String(row.meta || '{}')).noPreview : undefined;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    // Ya guardado, la burbuja sigue sin vista previa.
    await expect(sent).toHaveCount(1);
    await expect(sent.locator('.wa-linkcard')).toHaveCount(0);
  } finally {
    db.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
