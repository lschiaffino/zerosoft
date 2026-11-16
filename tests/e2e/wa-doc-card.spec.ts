import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Documento con texto, editado después, en un grupo (Inbox y Lines) con el
 * WhatsApp falso, como en WhatsApp: la tarjeta (hoja con la extensión, nombre
 * en un renglón, "46 kB • html") sin botón redondo, el texto editado debajo
 * con "Editado", y el menú de la esquina sin tapar el número del encabezado.
 * Con DC_SHOTS=<carpeta> guarda capturas a 1280 y 390, claro y oscuro.
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

/** Una "primera página" blanca con renglones (lo que manda WhatsApp como miniatura del PDF). */
const PAGE_THUMB = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="#fff"/><rect x="28" y="32" width="180" height="14" fill="#333"/><rect x="28" y="64" width="264" height="6" fill="#999"/><rect x="28" y="80" width="240" height="6" fill="#999"/><rect x="28" y="96" width="256" height="6" fill="#999"/></svg>',
).toString('base64')}`;

function events(app: 'inbox' | 'lines', gid: string, title: string): Array<Record<string, unknown>> {
  const tag = uid();
  const pid = `doc-${tag}`;
  const who = { senderPhone: '15550003003', senderName: 'Bruna Documento' };
  const base = { type: 'message', chatId: gid, chatName: title, isGroup: true, fromMe: false, ...who };
  const t0 = Date.now() - 3_600_000;
  return [
    { ...base, providerMessageId: `t-${tag}`, body: 'Buenas a todos', timestamp: new Date(t0).toISOString() },
    {
      ...base,
      providerMessageId: pid,
      body: 'Les paso la primera versión de la propuesta',
      media: { url: app === 'lines' ? `evo:${pid}` : '', type: 'text/html', name: 'propuesta-comercial-version-final-revisada.html', fetchRef: { providerMessageId: pid, chatId: gid, fromMe: false }, info: { kind: 'document', size: 46_000 } },
      timestamp: new Date(t0 + 60_000).toISOString(),
    },
    // Un PDF con la miniatura de la primera página que manda WhatsApp.
    {
      ...base,
      providerMessageId: `doc-pdf-${tag}`,
      body: 'Y el presupuesto en PDF',
      media: {
        url: app === 'lines' ? `evo:doc-pdf-${tag}` : '',
        type: 'application/pdf',
        name: 'presupuesto.pdf',
        fetchRef: { providerMessageId: `doc-pdf-${tag}`, chatId: gid, fromMe: false },
        info: { kind: 'document', size: 82_000, pages: 3, thumbnail: PAGE_THUMB },
      },
      timestamp: new Date(t0 + 90_000).toISOString(),
    },
    { type: 'edit', chatId: gid, providerMessageId: pid, body: 'Les paso la primera versión de la propuesta, ya corregida', at: new Date(t0 + 120_000).toISOString() },
  ];
}

async function check(page: Page, thread: Locator) {
  const msg = thread.locator('.gr-msg', { hasText: 'primera versión' });
  // En Inbox el archivo se baja al pedirlo (#378): la tarjeta es un botón que lo busca y lo abre.
  const card = msg.locator('[data-testid="wa-doc"], [data-testid="wa-doc-retry"]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(msg.locator('.wa-text')).toContainText('ya corregida');
  await expect(msg.locator('.wa-edited')).toBeVisible();
  await expect(card.locator('.wa-doc-dl')).toHaveCount(0);
  await expect(card.locator('.wa-doc-icon b')).toHaveText('HTML');
  await expect(card.locator('.wa-doc-meta')).toHaveText(/\d+ k?B • html$/);
  // El nombre en un renglón, cortado en el medio con la extensión a la vista.
  await expect(card.locator('.wa-doc-name')).toHaveText('propuesta-comercial-version-final-revisada.html');
  const [head, tail] = [card.locator('.wa-doc-name-head'), card.locator('.wa-doc-name-tail')];
  await expect(tail).toHaveText(/\.html$/);
  // El principio se achica (con "…") y el final entra entero en la tarjeta.
  expect(await head.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const [tb0, cb0] = [(await tail.boundingBox())!, (await card.boundingBox())!];
  expect(tb0.x + tb0.width).toBeLessThanOrEqual(cb0.x + cb0.width);
  expect((await card.locator('.wa-doc-name').boundingBox())!.height).toBeLessThan(24);
  // El texto debajo de la tarjeta.
  const [cb, tb] = [(await card.boundingBox())!, (await msg.locator('.wa-text').boundingBox())!];
  expect(tb.y).toBeGreaterThan(cb.y + cb.height - 2);
  // PDF: la primera página arriba (recortada), a todo el ancho de la tarjeta, y debajo la fila del archivo.
  const pdf = thread.locator('.gr-msg', { hasText: 'presupuesto en PDF' }).locator('[data-testid="wa-doc"], [data-testid="wa-doc-retry"]');
  const thumb = pdf.getByTestId('wa-doc-thumb');
  await expect(thumb).toBeVisible();
  await expect(pdf.locator('.wa-doc-icon b')).toHaveText('PDF');
  await expect(pdf.locator('.wa-doc-meta')).toHaveText(/3 pages • .* • pdf$/);
  const [pb, tb2, nb] = [(await pdf.boundingBox())!, (await thumb.boundingBox())!, (await pdf.locator('.wa-doc-name').boundingBox())!];
  expect(tb2.width).toBeGreaterThan(pb.width * 0.9);
  expect(nb.y).toBeGreaterThan(tb2.y + tb2.height - 2);
  // El HTML sigue con la tarjeta sola.
  await expect(card.getByTestId('wa-doc-thumb')).toHaveCount(0);

  // El menú de la esquina no tapa el número del encabezado.
  await msg.hover();
  const chevron = msg.locator('.wa-chevron').first();
  const phone = msg.locator('.gr-msg-author .wa-phone');
  if ((await chevron.isVisible()) && (await phone.count())) {
    const [c, p] = [(await chevron.boundingBox())!, (await phone.boundingBox())!];
    expect(p.x + p.width).toBeLessThanOrEqual(c.x + 1);
  }
  return msg;
}

async function shots(page: Page, context: BrowserContext, baseURL: string, thread: Locator, app: string, open: () => Promise<void>) {
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      await open();
      const msg = thread.locator('.gr-msg', { hasText: 'primera versión' });
      await expect(msg.locator('[data-testid="wa-doc"], [data-testid="wa-doc-retry"]')).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const dir = process.env.DC_SHOTS;
      if (dir) {
        await msg.scrollIntoViewIfNeeded();
        await msg.hover();
        await page.screenshot({ path: `${dir}/${app}-${width}-${theme}.png` });
      }
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
}

test('Inbox: documento con texto editado, como la tarjeta de WhatsApp', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const gid = `1203633${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Documentos Inbox ${uid()}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: events('inbox', gid, title) } });
  expect(res.ok(), await res.text()).toBe(true);
  const open = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
  };
  await open();
  const thread = page.locator('.ib-wa-thread');
  await check(page, thread);
  await shots(page, context, baseURL!, thread, 'inbox', open);
});

test('Lines: documento con texto editado, como la tarjeta de WhatsApp', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Documentos ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const gid = `1203634${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
    const title = `Documentos Lines ${uid()}`;
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events('lines', gid, title) } });
    expect(res.ok(), await res.text()).toBe(true);
    let chatId = '';
    await expect
      .poll(async () => {
        chatId = String((await sql('SELECT id FROM groups_chats WHERE name = ?', [title]))[0]?.id ?? '');
        return chatId;
      })
      .not.toBe('');
    const open = async () => {
      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
    };
    await open();
    const thread = page.locator('.wa-thread');
    await check(page, thread);
    await shots(page, context, baseURL!, thread, 'lines', open);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
