import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Link con la vista previa grande que manda WhatsApp (como un lugar de Maps),
 * en Inbox y en Lines, con el WhatsApp falso: la imagen grande viene en el
 * mensaje ("/fake-link-thumb/1200x630", sin red), el servidor la baja una vez
 * y la sirve desde la ruta del mensaje. Nuestro lector del link no trae
 * imagen (/no-image): la grande solo puede ser la de WhatsApp. Un link muy
 * largo se corta en cualquier lado sin salirse de la burbuja. Con
 * LB_SHOTS=<carpeta> guarda capturas a 1280 y 390, claro y oscuro.
 *
 * Nombres, números y textos inventados.
 */

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

const PLACE = 'https://maps.test/place/no-image/salon-de-prueba';
const SHORT = `https://short.test/silla-${Math.random().toString(36).slice(2, 7)}`;
const LONG = `https://example.test/no-image/${'segmento-muy-largo-sin-espacios-'.repeat(8)}fin?utm_source=prueba&utm_medium=whatsapp`;

function events(phone: string, name: string): Array<Record<string, unknown>> {
  const chatId = `${phone}@s.whatsapp.net`;
  const base = { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: phone, senderName: name };
  const t0 = Date.now() - 3_600_000;
  const tag = uid();
  return [
    {
      ...base,
      providerMessageId: `lnk-${tag}`,
      body: `Nos vemos acá ${PLACE}`,
      link: {
        url: PLACE,
        title: 'Salón de prueba · Calle Falsa 123',
        description: '★★★★★ · Salón de eventos',
        hq: { directPath: '/fake-link-thumb/1200x630', mediaKey: Buffer.alloc(32, 3).toString('base64'), width: 1200, height: 630 },
      },
      timestamp: new Date(t0).toISOString(),
    },
    { ...base, providerMessageId: `long-${tag}`, body: `El link largo ${LONG}`, timestamp: new Date(t0 + 10_000).toISOString() },
    // Link corto sin vista previa de WhatsApp (o solo con el nombre del sitio): nuestro lector lo sigue hasta el producto.
    { ...base, providerMessageId: `short-${tag}`, body: `Mirá esta silla ${SHORT}`, link: { url: SHORT, title: 'Tienda' }, timestamp: new Date(t0 + 20_000).toISOString() },
  ];
}

async function checkCard(page: Page, thread: Locator, app: 'inbox' | 'groups') {
  const msg = thread.locator('.gr-msg', { hasText: 'Nos vemos acá' });
  const card = msg.locator('.wa-linkcard');
  await expect(card).toHaveAttribute('data-layout', 'large', { timeout: 30_000 });
  const img = card.locator('.wa-linkcard-media img');
  await expect(img).toHaveAttribute('src', new RegExp(`^/api/${app}/media/[A-Za-z0-9_-]+\\?link=1$`));
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBe(1200);
  await expect(card.locator('strong')).toHaveText('Salón de prueba · Calle Falsa 123');
  await expect(card.locator('.wa-linkcard-desc')).toHaveText('★★★★★ · Salón de eventos');
  await expect(card.locator('.wa-linkcard-domain')).toHaveText('maps.test');
  // La imagen arriba a todo el ancho de la tarjeta.
  const [cb, ib] = [(await card.boundingBox())!, (await card.locator('.wa-linkcard-media').boundingBox())!];
  expect(Math.abs(cb.width - ib.width)).toBeLessThan(2);
  expect(ib.y).toBeLessThanOrEqual(cb.y + 1);

  // Link corto: se sigue hasta la página del producto y sale la tarjeta grande con imagen, título y descripción.
  const short = thread.locator('.gr-msg', { hasText: 'Mirá esta silla' }).locator('.wa-linkcard');
  await expect(short).toHaveAttribute('data-layout', 'large', { timeout: 45_000 });
  await expect(short.locator('.wa-linkcard-media img')).toHaveAttribute('src', /^\/api\/wa\/link-preview\/image\?url=/);
  await expect(short.locator('strong')).toHaveText('shop.test page');
  await expect(short.locator('.wa-linkcard-desc')).toHaveText('Preview of shop.test');
  await expect(short.locator('.wa-linkcard-domain')).toContainText('short.test');

  // El link largo no se sale de la burbuja.
  const long = thread.locator('.gr-msg', { hasText: 'El link largo' });
  const [bubble, text] = [(await long.locator('.gr-bubble').boundingBox())!, (await long.locator('.wa-text').boundingBox())!];
  expect(text.x + text.width).toBeLessThanOrEqual(bubble.x + bubble.width + 1);
  expect(await long.locator('.wa-text').evaluate((p) => p.scrollWidth <= p.clientWidth + 1)).toBe(true);
}

async function shots(page: Page, context: BrowserContext, baseURL: string, thread: Locator, app: string, open: () => Promise<void>) {
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      await open();
      const card = thread.locator('.gr-msg', { hasText: 'Nos vemos acá' }).locator('.wa-linkcard.is-large');
      await expect(card).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const dir = process.env.LB_SHOTS;
      if (dir) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${dir}/${app}-${width}-${theme}.png` });
      }
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
}

test('Inbox: un link con la imagen grande de WhatsApp se ve como en WhatsApp', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const name = `Julia Links ${uid()}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: events(phone, name) } });
  expect(res.ok(), await res.text()).toBe(true);
  const open = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  };
  await open();
  const thread = page.locator('.ib-wa-thread');
  await checkCard(page, thread, 'inbox');
  await shots(page, context, baseURL!, thread, 'inbox', open);
});

test('Lines: un link con la imagen grande de WhatsApp se ve como en WhatsApp', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Links grandes ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events(phone, `Julia Links ${uid()}`) } });
    expect(res.ok(), await res.text()).toBe(true);
    let chatId = '';
    await expect
      .poll(async () => {
        chatId = String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, `${phone}@s.whatsapp.net`]))[0]?.id ?? '');
        return chatId;
      })
      .not.toBe('');
    const open = async () => {
      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
    };
    await open();
    const thread = page.locator('.wa-thread');
    await checkCard(page, thread, 'groups');
    await shots(page, context, baseURL!, thread, 'lines', open);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
