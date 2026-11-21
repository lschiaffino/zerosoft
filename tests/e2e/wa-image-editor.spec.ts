import { expect, test, type Locator, type Page } from '@playwright/test';
import { deflateSync } from 'zlib';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Editar una foto antes de mandarla, como en WhatsApp, en Lines e Inbox (components/groups/wa/ImageEditor.tsx),
 * contra el WhatsApp falso: se pega una imagen en el campo, se dibuja, se escribe un texto, se pone un emoji,
 * se deshace, se recorta y se manda con Enter. Lo que llega al chat es la foto editada (más chica por el
 * recorte). Con EDITOR_SHOTS=<carpeta> guarda capturas a 1280 y 390, en claro y oscuro.
 */

test.setTimeout(240_000);
const uid = () => Math.random().toString(36).slice(2, 8);
const W = 800;
const H = 600;

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
  const dir = process.env.EDITOR_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

/** PNG de w×h con una franja de cada color (para ver la foto en las capturas), sin archivos del repo. */
function png(w: number, h: number): Buffer {
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
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const colors = [[0x3b, 0x82, 0xf6], [0x22, 0xc5, 0x5e], [0xf5, 0x9e, 0x0b], [0xef, 0x44, 0x44]];
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const [r, g, b] = colors[Math.floor((y / h) * colors.length)];
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const chatEvents = (chatId: string, tag: string, chatName: string) => [
  { type: 'message', chatId, isGroup: true, fromMe: false, senderPhone: '15550001002', senderName: 'Beto Prueba', chatName, providerMessageId: `t-${tag}`, body: 'Hola', timestamp: new Date(Date.now() - 30_000).toISOString() },
];

/** Pega una imagen en el campo (como ⌘V con una captura). */
async function pasteImage(input: Locator) {
  const b64 = png(W, H).toString('base64');
  await input.evaluate((el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    (el as HTMLElement).focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
}

/** Arrastra el mouse sobre el canvas, de a pasos (un trazo o un movimiento). */
async function dragOn(page: Page, el: Locator, from: [number, number], to: [number, number]) {
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

/** El color (r, g, b) de la vista del editor en un punto relativo (0..1). */
async function pixel(canvas: Locator, at: readonly [number, number]): Promise<number[]> {
  return canvas.evaluate((c, [fx, fy]) => {
    const el = c as HTMLCanvasElement;
    const d = el.getContext('2d')!.getImageData(Math.floor(el.width * fx), Math.floor(el.height * fy), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, at as [number, number]);
}
const colorDistance = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
/** Cuánto se separan los canales (0 = gris). */
const spread = (c: number[]) => Math.max(...c) - Math.min(...c);

/** Lo de WhatsApp: dibujar, texto, emoji, deshacer, desenfocar, filtro, recortar, y mandar con Enter. */
async function editAndSend(page: Page, input: Locator, thread: Locator, app: string) {
  const before = await thread.locator('.gr-msg-out img').count();
  await pasteImage(input);
  const pane = page.locator('.wa-attach-pane');
  const canvas = pane.getByTestId('edit-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => canvas.evaluate((c) => (c as HTMLCanvasElement).width)).toBeGreaterThan(50);
  const undo = pane.getByTestId('edit-undo');
  await expect(undo).toBeDisabled();

  // Lápiz: un trazo con otro color y grosor.
  await pane.getByTestId('edit-draw').click();
  await expect(pane.getByTestId('edit-draw')).toHaveAttribute('aria-pressed', 'true');
  await pane.locator('.wa-edit-colors [role="radio"]').nth(4).click();
  await pane.locator('.wa-edit-brushes [role="radio"]').nth(2).click();
  await dragOn(page, canvas, [0.2, 0.3], [0.7, 0.6]);
  await expect(undo).toBeEnabled();
  await pane.getByTestId('edit-draw').click();

  // Texto: T, escribir y Enter (no manda: termina el texto).
  await pane.getByTestId('edit-text').click();
  const typing = pane.getByTestId('edit-text-input');
  await expect(typing).toBeFocused();
  await typing.fill('Hola');
  await pane.locator('.wa-edit-colors [role="radio"]').nth(2).click();
  await typing.press('Enter');
  await expect(typing).toHaveCount(0);
  await expect(pane).toBeVisible();

  // Emoji encima y deshacer lo último (vuelve a quedar solo el texto y el trazo).
  await pane.getByTestId('edit-sticker').click();
  await page.locator('.wa-edit-emoji-wrap .wa-emoji-grid button[data-emoji]').first().click();
  await expect(pane.locator('.wa-edit-sel')).toHaveCount(1);
  await shot(page, `${app}-editor-1280`);
  await undo.click();

  // Desenfoque: una pasada sobre el borde entre dos franjas las mezcla (sin color: el pixel deja de ser liso).
  const probe = [0.85, 0.47] as const;
  const plain = await pixel(canvas, probe);
  await pane.getByTestId('edit-blur').click();
  await expect(pane.getByTestId('edit-blur')).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.locator('.wa-edit-colors')).toHaveCount(0);
  await pane.locator('.wa-edit-brushes [role="radio"]').nth(2).click();
  await dragOn(page, canvas, [0.76, 0.5], [0.95, 0.5]);
  await expect.poll(async () => colorDistance(await pixel(canvas, probe), plain)).toBeGreaterThan(20);
  await shot(page, `${app}-editor-blur-1280`);
  await pane.getByTestId('edit-blur').click();

  // Filtros: la tira con Original y cinco más; B&N deja la foto en gris.
  await pane.getByTestId('edit-filters').click();
  const strip = pane.getByTestId('edit-filter-strip');
  await expect(strip.getByRole('radio')).toHaveCount(6);
  await expect(strip.locator('[data-filter="none"]')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => strip.locator('[data-ready]').count()).toBe(6);
  await strip.locator('[data-filter="bw"]').click();
  await expect(strip.locator('[data-filter="bw"]')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => spread(await pixel(canvas, [0.05, 0.05]))).toBeLessThan(4);
  await shot(page, `${app}-editor-filters-1280`);
  // Esc cierra la tira (el filtro queda).
  await page.keyboard.press('Escape');
  await expect(strip).toHaveCount(0);
  await expect(pane).toBeVisible();

  // Recortar: achicar desde la esquina de abajo a la derecha, rotar y listo.
  await pane.getByTestId('edit-crop').click();
  const handle = pane.locator('.wa-edit-handle.is-se');
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 120, hb.y - 80, { steps: 6 });
  await page.mouse.up();
  await shot(page, `${app}-editor-crop-1280`);
  await pane.getByTestId('edit-crop-done').click();
  await expect(handle).toHaveCount(0);

  // Comentario y Enter: sale la foto editada.
  await pane.locator('.wa-attach-caption textarea').fill('Editada');
  await pane.locator('.wa-attach-caption textarea').press('Enter');
  await expect(pane).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => thread.locator('.gr-msg-out img').count(), { timeout: 30_000 }).toBeGreaterThan(before);
  const img = thread.locator('.gr-msg-out img').last();
  await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  const size = await img.evaluate((i) => ({ w: (i as HTMLImageElement).naturalWidth, h: (i as HTMLImageElement).naturalHeight }));
  // Recortada: más chica que la original en los dos lados.
  expect(size.w).toBeLessThan(W);
  expect(size.h).toBeLessThan(H);
  // Y en blanco y negro (la esquina de arriba, azul en la original, sale gris).
  const corner = await img.evaluate((i) => {
    const im = i as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(im, 0, 0);
    return Array.from(ctx.getImageData(4, 4, 1, 1).data.slice(0, 3));
  });
  expect(spread(corner)).toBeLessThan(8);
  await shot(page, `${app}-editor-sent-1280`);
}

/** Esc cierra la herramienta primero y después la vista previa. */
async function escapes(page: Page, input: Locator) {
  await pasteImage(input);
  const pane = page.locator('.wa-attach-pane');
  await expect(pane.getByTestId('edit-canvas')).toBeVisible({ timeout: 20_000 });
  await pane.getByTestId('edit-crop').click();
  await expect(pane.locator('.wa-edit-crop-box')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pane.locator('.wa-edit-crop-box')).toHaveCount(0);
  await expect(pane).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
}

async function moreShots(page: Page, input: Locator, app: string, baseURL: string, reopen: () => Promise<void>) {
  if (!process.env.EDITOR_SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await page.context().addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await reopen();
      await pasteImage(input);
      const pane = page.locator('.wa-attach-pane');
      await expect(pane.getByTestId('edit-canvas')).toBeVisible({ timeout: 20_000 });
      await pane.getByTestId('edit-draw').click();
      await dragOn(page, pane.getByTestId('edit-canvas'), [0.2, 0.2], [0.8, 0.7]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${app}-editor-${width}-${theme}`);
      await pane.getByTestId('edit-draw').click();
      await pane.getByTestId('edit-crop').click();
      await shot(page, `${app}-editor-crop-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await pane.getByTestId('edit-blur').click();
      await dragOn(page, pane.getByTestId('edit-canvas'), [0.3, 0.5], [0.7, 0.5]);
      await shot(page, `${app}-editor-blur-${width}-${theme}`);
      await pane.getByTestId('edit-filters').click();
      await expect.poll(() => pane.getByTestId('edit-filter-strip').locator('[data-ready]').count()).toBe(6);
      await pane.getByTestId('edit-filter-strip').locator('[data-filter="film"]').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${app}-editor-filters-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(pane).toHaveCount(0);
    }
  }
  await page.context().clearCookies({ name: 'zs_theme' });
  await page.setViewportSize({ width: 1280, height: 800 });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Lines: editar una foto pegada (dibujar, texto, emoji, recortar) y mandarla', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Edit ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: chatEvents(gid, tag, `Edit ${tag}`) } });
  expect(res.ok(), await res.text()).toBe(true);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]);
  const reopen = async () => {
    await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-thread .gr-thread-head').first()).toBeVisible({ timeout: 90_000 });
  };
  await reopen();
  const thread = page.locator('.gr-thread').first();
  const input = thread.locator('.wa-bar textarea.wa-input');

  await escapes(page, input);
  await editAndSend(page, input, thread, 'lines');
  // Sale por detrás: se espera a que quede guardado.
  await expect
    .poll(async () => (await sql("SELECT media_type, body FROM groups_messages WHERE chat_id = ? AND direction = 'out' ORDER BY created_at DESC LIMIT 1", [String(chat.id)]))[0] ?? null, { timeout: 90_000 })
    .toMatchObject({ media_type: expect.stringMatching(/^image\//), body: 'Editada' });

  await moreShots(page, input, 'lines', baseURL!, reopen);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: editar una foto pegada (dibujar, texto, emoji, recortar) y mandarla', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const name = `Edit ${tag}`;
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
  const input = thread.locator('.wa-bar textarea.wa-input');

  await escapes(page, input);
  await editAndSend(page, input, thread, 'inbox');
  await expect
    .poll(
      async () =>
        (await sql('SELECT m.media_type, m.body FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.external_id = ? AND m.from_me = 1 ORDER BY m.rowid DESC LIMIT 1', [gid]))[0] ?? null,
      { timeout: 90_000 },
    )
    .toMatchObject({ media_type: 'image', body: 'Editada' });

  await moreShots(page, input, 'inbox', baseURL!, reopen);
  expect(errors, errors.join('\n')).toEqual([]);
});
