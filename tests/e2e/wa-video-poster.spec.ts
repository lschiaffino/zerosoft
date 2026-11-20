import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Video recibido, en Inbox y en Lines: como en WhatsApp, la burbuja muestra el
 * primer cuadro del video (nítido) en una caja con la proporción real del
 * video, sin bandas negras; la miniatura de WhatsApp queda solo de lugar. El
 * botón de reproducir al centro, la cámara con la duración abajo a la
 * izquierda, y un clic lo reproduce en el visor.
 *
 * El video es el de prueba del WhatsApp falso (id "mov-": un WebM de 360x480).
 * Uno trae sus medidas en el mensaje; el otro no (las lee el navegador).
 * Con VP_SHOTS=<carpeta> guarda capturas a 1280 y 390 (claro y oscuro) y en el
 * aspecto Retro oscuro. Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 240_000 });

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Miniatura de WhatsApp de prueba: un JPEG de 12x16 de un solo color (como el jpegThumbnail, que se ve borroso). */
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACBAQExATFhYWFhYWGhgaGxsbGhoaGhsbGx0dHSIiIh0dHRsbHR0gICIiJSYlIyMiIyYmKCgoMDAuLjg4OkVFU//EAEsAAQEAAAAAAAAAAAAAAAAAAAAFAQEAAAAAAAAAAAAAAAAAAAAFEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAEAAMAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AggCiL//Z';

type Ev = Record<string, unknown>;

function events(app: 'inbox' | 'lines', phone: string, name: string): Ev[] {
  const tag = uid();
  const chatId = `${phone}@s.whatsapp.net`;
  const t0 = Date.now() - 3_600_000;
  const base = { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: phone, senderName: name };
  const media = (pid: string, info: Record<string, unknown>) => ({
    url: app === 'lines' ? `evo:${pid}` : '',
    type: 'video/webm',
    name: '',
    fetchRef: { providerMessageId: pid, chatId, fromMe: false },
    info: { kind: 'video', thumbnail: THUMB, ...info },
  });
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  return [
    { ...base, providerMessageId: `t0-${tag}`, body: 'Te paso los videos de la obra', timestamp: at(0) },
    { ...base, providerMessageId: `mov-a-${tag}`, body: 'Así quedó el pasillo', media: media(`mov-a-${tag}`, { width: 360, height: 480, duration: 20 }), timestamp: at(10) },
    { ...base, providerMessageId: `mov-b-${tag}`, body: 'Y la terraza', media: media(`mov-b-${tag}`, { duration: 2 }), timestamp: at(20) },
  ];
}

async function shot(page: Page, name: string, target: Locator) {
  const dir = process.env.VP_SHOTS;
  if (!dir) return;
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${name}.png` });
}

/** La burbuja de un video: primer cuadro, sin bandas, con la proporción del video. */
async function checkVideo(thread: Locator, text: string) {
  const msg = thread.locator('.gr-msg', { hasText: text });
  const btn = msg.locator('.wa-video-thumb');
  await btn.scrollIntoViewIfNeeded();
  const poster = btn.locator('.wa-poster');
  // De la miniatura borrosa al primer cuadro, cuando el navegador lo dibujó.
  await expect(poster).toHaveAttribute('data-poster', 'frame', { timeout: 60_000 });
  await expect(poster.locator('img.wa-thumb')).toHaveCount(0);
  const video = poster.locator('video');
  await expect(video).toHaveAttribute('preload', 'metadata');
  expect(await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight])).toEqual([360, 480]);
  // Todas las medidas de una vez (el chat se puede mover mientras cargan otras cosas).
  const rects = () =>
    btn.evaluate((el) => {
      const r = (e: Element | null) => {
        const x = e!.getBoundingClientRect();
        return { x: x.x, y: x.y, w: x.width, h: x.height };
      };
      return { b: r(el), v: r(el.querySelector('.wa-poster video')), play: r(el.querySelector('.wa-video-play')), len: r(el.querySelector('.wa-video-len')), bubble: r(el.closest('.gr-bubble')) };
    });
  // La caja tiene la proporción del video (3:4): alto = ancho * 4/3.
  await expect.poll(async () => {
    const { b } = await rects();
    return Math.abs(b.h - (b.w * 480) / 360);
  }).toBeLessThan(2);
  const { b, v, play, len, bubble } = await rects();
  // El cuadro llena la caja de borde a borde: sin bandas negras arriba y abajo.
  expect(Math.abs(v.h - b.h)).toBeLessThan(2);
  expect(Math.abs(v.w - b.w)).toBeLessThan(2);
  expect(Math.abs(v.y - b.y)).toBeLessThan(2);
  // La burbuja es del ancho del video (el texto va debajo, en renglones normales).
  expect(Math.abs(bubble.w - b.w)).toBeLessThan(12);
  // Reproducir al centro; cámara y duración abajo a la izquierda.
  expect(Math.abs(play.x + play.w / 2 - (b.x + b.w / 2))).toBeLessThan(2);
  expect(Math.abs(play.y + play.h / 2 - (b.y + b.h / 2))).toBeLessThan(2);
  expect(len.x - b.x).toBeLessThan(20);
  expect(b.y + b.h - (len.y + len.h)).toBeLessThan(20);
  await expect(btn.locator('.wa-video-len svg')).toHaveCount(1);
  return msg;
}

async function checkAll(page: Page, thread: Locator, width: number) {
  const a = await checkVideo(thread, 'Así quedó el pasillo');
  await expect(a.locator('.wa-video-len')).toHaveText('0:20');
  await checkVideo(thread, 'Y la terraza');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // En el teléfono la media llega a 70vw.
  expect((await a.locator('.wa-video-thumb').boundingBox())!.width).toBeGreaterThanOrEqual(width > 500 ? 290 : 260);
  return a;
}

/** Un clic abre el visor y el video se reproduce; Esc lo cierra. */
async function checkPlays(page: Page, msg: Locator) {
  await msg.locator('.wa-video-thumb').click();
  const viewer = page.getByRole('dialog');
  const v = viewer.locator('.wa-viewer-stage video');
  await expect(v).toBeVisible();
  await v.evaluate((el: HTMLVideoElement) => {
    el.muted = true;
    return el.play().catch(() => undefined);
  });
  await expect.poll(() => v.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
}

async function setLook(request: APIRequestContext, look: 'current' | 'retro') {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function sizesAndThemes(page: Page, context: BrowserContext, request: APIRequestContext, baseURL: string, thread: Locator, app: string, open: () => Promise<void>) {
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      await open();
      const a = await checkAll(page, thread, width);
      await shot(page, `${app}-${width}-${theme}`, a);
    }
  }
  // El aspecto es de la cuenta (compartida entre tests): Retro solo para las capturas, y se deja como estaba.
  if (process.env.VP_SHOTS) {
    await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL }]);
    await setLook(request, 'retro');
    try {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
        await open();
        const a = await checkAll(page, thread, width);
        await shot(page, `${app}-${width}-retro-dark`, a);
      }
    } finally {
      await setLook(request, 'current');
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
}

async function connectInbox(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return acc as { id: string; webhook_secret: string };
}

test('Inbox: un video muestra su primer cuadro con su proporción y se reproduce', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const acc = await connectInbox(request);
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const name = `Marta Video ${uid()}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: events('inbox', phone, name) } });
  expect(res.ok(), await res.text()).toBe(true);
  const [th] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), `${phone}@s.whatsapp.net`]);
  const open = async () => {
    // Volver a la misma URL puede cortarse (ERR_ABORTED) si la app la reemplaza al cargar: se espera el chat igual.
    await page.goto(`/en/app/inbox?t=${String(th.id)}`, { waitUntil: 'domcontentloaded' }).catch(() => page.goto(`/en/app/inbox?t=${String(th.id)}`, { waitUntil: 'domcontentloaded' }));
    await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  };
  await open();
  const thread = page.locator('.ib-wa-thread');
  const a = await checkAll(page, thread, 1280);
  await checkPlays(page, a);
  await sizesAndThemes(page, context, request, baseURL!, thread, 'inbox', open);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: un video muestra su primer cuadro con su proporción y se reproduce', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Video ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const name = `Marta Video ${uid()}`;
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events('lines', phone, name) } });
    expect(res.ok(), await res.text()).toBe(true);
    let chatId = '';
    await expect
      .poll(async () => {
        chatId = String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, `${phone}@s.whatsapp.net`]))[0]?.id ?? '');
        return chatId;
      })
      .not.toBe('');
    const open = async () => {
      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.wa-thread .gr-msg', { hasText: 'Así quedó el pasillo' })).toBeVisible({ timeout: 30_000 });
    };
    await open();
    const thread = page.locator('.wa-thread');
    const a = await checkAll(page, thread, 1280);
    await checkPlays(page, a);
    await sizesAndThemes(page, context, request, baseURL!, thread, 'lines', open);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
