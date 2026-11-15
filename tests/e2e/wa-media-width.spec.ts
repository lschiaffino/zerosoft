import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Foto con texto largo cuyo archivo no está (el gateway ya no tiene el
 * mensaje: id "gone-" en el WhatsApp falso), en Inbox y en Lines. Como en
 * WhatsApp, la burbuja guarda el ancho de la foto (sus medidas o el lugar
 * estándar) y el texto de abajo se lee en renglones normales, no de a una o
 * dos palabras. Con MW_SHOTS=<carpeta> guarda capturas a 1280 y 390, claro y
 * oscuro.
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

const CAPTION =
  'Te mando la foto del salón para el sábado: entramos por el portón del costado, la mesa larga va contra la ventana y las sillas que sobran quedan en el depósito del fondo hasta el domingo';

type Ev = Record<string, unknown>;

/** Un chat 1:1 con dos fotos que no están (una con medidas de teléfono y texto largo, otra sin medidas) y un video. */
function events(app: 'inbox' | 'lines', phone: string, name: string): { events: Ev[]; tag: string } {
  const tag = uid();
  const chatId = `${phone}@s.whatsapp.net`;
  const t0 = Date.now() - 3_600_000;
  const base = { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: phone, senderName: name };
  const media = (pid: string, type: string, info: Record<string, unknown>) => ({
    url: app === 'lines' ? `evo:${pid}` : '',
    type,
    name: '',
    fetchRef: { providerMessageId: pid, chatId, fromMe: false },
    info,
  });
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  return {
    tag,
    events: [
      { ...base, providerMessageId: `t0-${tag}`, body: 'Hola, ¿cómo va?', timestamp: at(0) },
      { ...base, providerMessageId: `gone-a-${tag}`, body: CAPTION, media: media(`gone-a-${tag}`, 'image/jpeg', { kind: 'image', width: 1080, height: 1920 }), timestamp: at(10) },
      { ...base, providerMessageId: `gone-b-${tag}`, body: 'Y esta otra, la de la entrada con el cartel nuevo', media: media(`gone-b-${tag}`, 'image/jpeg', { kind: 'image' }), timestamp: at(20) },
      { ...base, providerMessageId: `gone-v-${tag}`, body: 'El video del recorrido completo', media: media(`gone-v-${tag}`, 'video/mp4', { kind: 'video', duration: 12 }), timestamp: at(30) },
    ],
  };
}

async function shot(page: Page, name: string, target?: Locator) {
  const dir = process.env.MW_SHOTS;
  if (!dir) return;
  if (target) await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Cada renglón del texto, con cuántas palabras tiene (midiendo los rectángulos de cada palabra). */
async function wordsPerLine(caption: Locator): Promise<number[]> {
  return caption.evaluate((p) => {
    const lines = new Map<number, number>();
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      const re = /\S+/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + 1);
        const top = Math.round(r.getBoundingClientRect().top);
        lines.set(top, (lines.get(top) ?? 0) + 1);
      }
    }
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  });
}

/** Lo que se ve igual en las dos apps. */
async function checkBubbles(thread: Locator, minWidth: number) {
  const photo = thread.locator('.gr-msg', { hasText: 'Te mando la foto del salón' });
  const bubble = photo.locator('.gr-bubble');
  await expect(photo.getByTestId('wa-media-unavailable')).toBeVisible({ timeout: 30_000 });
  await expect(bubble).toHaveClass(/is-media/);
  const bub = (await bubble.boundingBox())!;
  const ph = (await photo.getByTestId('wa-media-unavailable').boundingBox())!;
  expect(bub.width).toBeGreaterThanOrEqual(minWidth);
  // El lugar de la foto ocupa la burbuja de borde a borde, con la proporción de una foto de teléfono.
  expect(Math.abs(ph.width - bub.width)).toBeLessThan(2);
  expect(ph.height).toBeGreaterThan(ph.width);
  // El texto: renglones normales (ninguno de una o dos palabras salvo el último).
  const lines = await wordsPerLine(photo.locator('.wa-text'));
  expect(lines.length).toBeGreaterThan(2);
  expect(Math.min(...lines.slice(0, -1))).toBeGreaterThanOrEqual(4);

  // Sin medidas: el lugar estándar; el video, igual.
  for (const text of ['Y esta otra', 'El video del recorrido']) {
    const msg = thread.locator('.gr-msg', { hasText: text });
    // El video de Inbox se baja al reproducirlo: mientras tanto queda su cuadro, del mismo ancho.
    await expect(msg.locator('[data-testid="wa-media-unavailable"], .wa-video-thumb').first()).toBeVisible();
    expect((await msg.locator('.gr-bubble').boundingBox())!.width).toBeGreaterThanOrEqual(minWidth);
  }

  // El menú de la esquina no tapa el aviso.
  await photo.hover();
  const chevron = photo.locator('.wa-chevron').first();
  if (await chevron.isVisible()) {
    const c = (await chevron.boundingBox())!;
    const note = (await photo.locator('.wa-media-ph-note').boundingBox())!;
    const overlap = c.x < note.x + note.width && note.x < c.x + c.width && c.y < note.y + note.height && note.y < c.y + c.height;
    expect(overlap).toBe(false);
  }
  return photo;
}

async function themesAndSizes(page: Page, context: BrowserContext, baseURL: string, thread: Locator, app: string, open: () => Promise<void>) {
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      await open();
      const photo = thread.locator('.gr-msg', { hasText: 'Te mando la foto del salón' });
      await expect(photo.getByTestId('wa-media-unavailable')).toBeVisible({ timeout: 30_000 });
      // En el teléfono las fotos llegan a 70vw (273 a 390 de ancho).
      expect((await photo.locator('.gr-bubble').boundingBox())!.width).toBeGreaterThanOrEqual(width > 500 ? 280 : 260);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await shot(page, `${app}-${width}-${theme}`, photo);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
}

async function connectInbox(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return acc as { id: string; webhook_secret: string };
}

test('Inbox: una foto con texto que no se pudo bajar mantiene el ancho de la foto', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const acc = await connectInbox(request);
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const name = `Sofía Ancho ${uid()}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: events('inbox', phone, name).events } });
  expect(res.ok(), await res.text()).toBe(true);

  const open = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name })).toBeVisible();
  };
  await open();
  const thread = page.locator('.ib-wa-thread');
  await checkBubbles(thread, 280);
  await themesAndSizes(page, context, baseURL!, thread, 'inbox', open);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: una foto con texto que no se pudo bajar mantiene el ancho de la foto', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Ancho ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const name = `Sofía Ancho ${uid()}`;
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events('lines', phone, name).events } });
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
    await checkBubbles(thread, 280);
    await themesAndSizes(page, context, baseURL!, thread, 'lines', open);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
