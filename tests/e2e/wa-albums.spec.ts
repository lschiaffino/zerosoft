import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Álbumes de fotos y videos, como WhatsApp, en Lines y en Inbox, con el
 * WhatsApp falso (GROUPS_FAKE=1): un grupo recibe tres tandas de 2, 3 y 5
 * fotos y videos seguidos de la misma persona. Cada tanda es una burbuja con
 * su grilla (2 lado a lado, 3 una alta y dos apiladas, 5 en 2×2 con "+2"),
 * un solo nombre arriba, y tocar una foto abre el visor en esa. El menú de
 * cada foto actúa sobre esa foto. Con ALBUM_SHOTS=<carpeta> guarda capturas
 * a 1280 y a 390.
 *
 * Nombres y números inventados.
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

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.ALBUM_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

type Ev = Record<string, unknown>;

/** Miniatura de un video (un cuadro de color): sin ella el falso no tiene un cuadro que mostrar. */
const videoThumb = (hue: number) =>
  `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="hsl(${hue} 40% 45%)"/></svg>`).toString('base64')}`;

/**
 * El grupo: un texto, un álbum de 2 fotos (Beto), un texto, un álbum de 3
 * (Carla: foto, video, foto), un texto y un álbum de 5 (Beto: con un video y
 * texto en la última). 10 fotos y videos en total, en ese orden.
 */
function albumEvents(gid: string, title: string): { events: Ev[]; tag: string } {
  const tag = uid();
  const t0 = Date.now() - 2 * 3_600_000;
  const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
  const beto = { senderPhone: '15550002002', senderName: 'Beto Álbum' };
  const carla = { senderPhone: '15550002003', senderName: 'Carla Álbum' };
  const ref = (id: string) => ({ providerMessageId: id, chatId: gid, fromMe: false });
  const base = { type: 'message', chatId: gid, isGroup: true, fromMe: false };
  const text = (id: string, who: typeof beto, body: string, sec: number): Ev => ({ ...base, ...who, chatName: title, providerMessageId: `t${id}-${tag}`, body, timestamp: at(sec) });
  // El largo del id cambia el color de la foto falsa: así se distinguen en la grilla.
  const photo = (id: string, who: typeof beto, sec: number, body = ''): Ev => {
    const pid = `img${'x'.repeat(id.length % 5)}-${id}-${tag}`;
    return { ...base, ...who, providerMessageId: pid, body, media: { url: '', type: 'image/png', name: '', fetchRef: ref(pid), info: { kind: 'image', width: 480, height: 320 } }, timestamp: at(sec) };
  };
  const video = (id: string, who: typeof beto, sec: number, seconds: number, hue: number): Ev => {
    // Sin "vid-": el falso manda un PDF para esos ids; así baja una imagen y el tipo queda de video.
    const pid = `mov-${id}-${tag}`;
    return { ...base, ...who, providerMessageId: pid, body: '', media: { url: '', type: 'video/mp4', name: '', fetchRef: ref(pid), info: { kind: 'video', duration: seconds, width: 640, height: 360, thumbnail: videoThumb(hue) } }, timestamp: at(sec) };
  };
  return {
    tag,
    events: [
      text('0', beto, 'Fotos del sábado', 0),
      photo('a1', beto, 10),
      photo('a22', beto, 11),
      text('1', carla, 'Las mías', 100),
      photo('b1', carla, 110),
      video('b2', carla, 111, 7, 200),
      photo('b333', carla, 112),
      text('2', beto, 'Y estas', 200),
      photo('c1', beto, 210),
      photo('c22', beto, 211),
      video('c3', beto, 212, 75, 30),
      photo('c4444', beto, 213),
      photo('c55', beto, 214, 'La terraza al final'),
    ],
  };
}

/** Lo que se ve igual en las dos apps: la grilla de cada álbum, el nombre, el video y el "+2". */
async function checkAlbums(page: Page, thread: Locator) {
  const albums = thread.locator('.wa-album');
  await expect(albums).toHaveCount(3);
  const [two, three, five] = [albums.nth(0), albums.nth(1), albums.nth(2)];
  await expect(two).toHaveClass(/is-two/);
  await expect(three).toHaveClass(/is-three/);
  await expect(five).toHaveClass(/is-grid/);
  await expect(two.locator('.wa-album-tile')).toHaveCount(2);
  await expect(three.locator('.wa-album-tile')).toHaveCount(3);
  await expect(five.locator('.wa-album-tile')).toHaveCount(4);
  await expect(five.locator('.wa-album-more')).toHaveText('+2');
  await expect(five).toHaveAttribute('data-count', '5');

  // Una burbuja por álbum, un solo nombre arriba, una sola hora abajo; el texto de la última, debajo de la grilla.
  for (const a of [two, three, five]) {
    const bubble = thread.locator('.gr-msg', { has: a });
    await expect(bubble).toHaveCount(1);
    await expect(bubble.locator('.gr-msg-author')).toHaveCount(1);
    await expect(bubble.locator('.gr-msg-foot time')).toHaveCount(1);
  }
  await expect(thread.locator('.gr-msg', { has: five }).locator('.wa-text')).toContainText('La terraza al final');
  // Ninguna foto del álbum quedó sola en su burbuja.
  await expect(thread.locator('.wa-image')).toHaveCount(0);

  // Video: cámara y duración abajo a la izquierda, y el botón de reproducir.
  const vid = three.locator('.wa-album-tile').nth(1);
  await expect(vid.locator('.wa-album-video')).toHaveText('0:07');
  await expect(vid.locator('.wa-video-play')).toBeVisible();
  await expect(five.locator('.wa-album-tile').nth(2).locator('.wa-album-video')).toHaveText('1:15');

  // La grilla: 2 lado a lado; 3 con la primera alta y dos apiladas; 2×2.
  const box = async (l: Locator) => (await l.boundingBox())!;
  const [t0, t1] = [await box(two.locator('.wa-album-tile').nth(0)), await box(two.locator('.wa-album-tile').nth(1))];
  expect(Math.abs(t0.y - t1.y)).toBeLessThan(2);
  expect(t1.x).toBeGreaterThan(t0.x + t0.width - 4);
  const [h0, h1, h2] = [await box(three.locator('.wa-album-tile').nth(0)), await box(three.locator('.wa-album-tile').nth(1)), await box(three.locator('.wa-album-tile').nth(2))];
  expect(h0.height).toBeGreaterThan(h1.height * 1.8);
  expect(Math.abs(h1.x - h2.x)).toBeLessThan(2);
  expect(h2.y).toBeGreaterThan(h1.y + h1.height - 4);
  const g = await Promise.all([0, 1, 2, 3].map((i) => box(five.locator('.wa-album-tile').nth(i))));
  expect(Math.abs(g[0].y - g[1].y)).toBeLessThan(2);
  expect(Math.abs(g[2].y - g[3].y)).toBeLessThan(2);
  expect(g[2].y).toBeGreaterThan(g[0].y + g[0].height - 4);

  // Tocar una foto abre el visor en esa; se recorre todo (el álbum y lo demás del chat).
  const viewer = page.locator('.wa-viewer');
  await three.locator('.wa-album-open').nth(2).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.wa-viewer-count')).toHaveText('5 / 10');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  // El "+2" abre la cuarta del álbum y de ahí se sigue a la quinta.
  await five.locator('.wa-album-open').nth(3).click();
  await expect(viewer.locator('.wa-viewer-count')).toHaveText('9 / 10');
  await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('.wa-viewer-count')).toHaveText('10 / 10');
  await expect(viewer.locator('.wa-viewer-caption')).toHaveText('La terraza al final');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  return { two, three, five };
}

test('Inbox: fotos y videos mandados juntos van en un álbum como WhatsApp', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const gid = `1203631${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Álbum Inbox ${uid()}`;
  const { events } = albumEvents(gid, title);
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible();
  const { two, five } = await checkAlbums(page, thread);
  await five.scrollIntoViewIfNeeded();
  await shot(page, 'inbox-1280');

  // Clic derecho en una foto: su propio menú; responder cita esa foto.
  await two.locator('.wa-album-tile').nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Reply' }).click();
  await expect(page.locator('.wa-composer .gr-quote-plain, .ib-wa-thread .gr-quote-plain').first()).toContainText('Photo');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(thread.locator('.wa-album')).toHaveCount(3);
  await five.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'inbox-390');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: fotos y videos mandados juntos van en un álbum; cada foto con su menú y su selección', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Álbumes ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    const info = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const gid = `1203632${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
    const title = `Álbum Lines ${uid()}`;
    const { events } = albumEvents(gid, title);
    const res = await request.post(new URL(info.webhookUrl).pathname, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
    let chatId = '';
    await expect
      .poll(async () => {
        chatId = String((await sql('SELECT id FROM groups_chats WHERE name = ?', [title]))[0]?.id ?? '');
        return chatId;
      })
      .not.toBe('');

    await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
    const thread = page.locator('.wa-thread');
    await expect(thread.locator('.wa-album').first()).toBeVisible({ timeout: 20_000 });
    const { two, three, five } = await checkAlbums(page, thread);
    await five.scrollIntoViewIfNeeded();
    await shot(page, 'lines-1280');

    // Clic derecho en una foto: su menú. "Select" entra en selección con esa foto sola; otra se suma tocándola.
    await three.locator('.wa-album-tile').nth(0).click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Select', exact: true }).click();
    await expect(three.locator('.wa-album-tile.is-selected')).toHaveCount(1);
    await expect(three.locator('.wa-album-tile').nth(0)).toHaveClass(/is-selected/);
    await two.locator('.wa-album-open').nth(1).click();
    await expect(thread.locator('.wa-album-tile.is-selected')).toHaveCount(2);
    await expect(page.getByRole('toolbar', { name: '2 selected' })).toBeVisible();
    // En selección, tocar una foto no abre el visor.
    await expect(page.locator('.wa-viewer')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(thread.locator('.wa-album-tile.is-selected')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(thread.locator('.wa-album')).toHaveCount(3);
    await five.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await shot(page, 'lines-390');
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
