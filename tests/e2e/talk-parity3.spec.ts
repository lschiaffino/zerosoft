import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Talk, ronda 3: marcadores del canal, cámara en huddles (y pantalla desde quien
 * entró primero), clips de audio y video, /ask y recap diario. La IA corre
 * contra el modelo falso (TALK_AI_FAKE); los dispositivos son simulados (ver fakeMedia).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function newChannel(request: APIRequestContext, kind: 'public' | 'private' = 'public') {
  return ok<{ id: string; name: string }>(request.post('/api/talk/channels', { data: { name: `p3-${uid()}`, kind } }));
}

async function openChannel(page: Page, id: string) {
  await page.goto(`/en/app/talk/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.talk-channel')).toBeVisible();
}

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/**
 * Dispositivos simulados por script: en máquinas sin servicio de audio (como
 * los agentes de esta Mac) getUserMedia y hasta new AudioContext() cuelgan la
 * página, con o sin --use-fake-device-for-media-stream. WebRTC, MediaRecorder y
 * la subida son los reales; el video sale de un canvas y no hay micrófono.
 */
const fakeMedia = () => {
  const video = (w = 320, h = 180) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    let n = 0;
    setInterval(() => {
      g.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`;
      g.fillRect(0, 0, w, h);
    }, 66);
    return c.captureStream(15).getVideoTracks()[0];
  };
  const noAudio = class {
    constructor() {
      throw new Error('no audio');
    }
  };
  (window as unknown as { AudioContext: unknown }).AudioContext = noAudio;
  // __gum: pedidos y tracks entregados; __gumDelay simula el diálogo de permiso del navegador.
  const w = window as unknown as { __gum: { calls: number; tracks: MediaStreamTrack[] }; __gumDelay: number };
  w.__gum = { calls: 0, tracks: [] };
  w.__gumDelay = 0;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c?.video) throw new DOMException('no mic', 'NotAllowedError');
    w.__gum.calls++;
    await new Promise((r) => setTimeout(r, w.__gumDelay));
    const track = video();
    w.__gum.tracks.push(track);
    return new MediaStream([track]);
  };
  navigator.mediaDevices.getDisplayMedia = async () => new MediaStream([video(640, 360)]);
};

test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(fakeMedia);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.describe('marcadores', () => {
  test('agregar, ver en otra pestaña, editar, buscar con ⌘K y borrar con confirmación', async ({ page, context, request }) => {
    const ch = await newChannel(request);
    await openChannel(page, ch.id);
    const other = await context.newPage();
    await other.setViewportSize({ width: 1280, height: 800 });
    await openChannel(other, ch.id);

    await page.getByTestId('talk-bookmark-add').click();
    await page.getByTestId('talk-bookmark-url').fill('javascript:alert(1)');
    await page.getByTestId('talk-bookmark-save').click();
    await expect(page.getByRole('alert').filter({ hasText: 'full web link' })).toBeVisible();
    const word = `Plan${uid()}`;
    await page.getByTestId('talk-bookmark-url').fill('example.com/plan');
    await page.getByTestId('talk-bookmark-name').fill(word);
    await page.keyboard.press('Enter');
    const link = page.getByTestId('talk-bookmarks').getByRole('link', { name: word });
    await expect(link).toHaveAttribute('href', 'https://example.com/plan');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // La otra pestaña lo recibe sin recargar.
    await expect(other.getByTestId('talk-bookmarks').getByRole('link', { name: word })).toBeVisible({ timeout: 10_000 });

    const found = await ok<{ items: Array<{ group: string; href: string }> }>(request.get(`/api/search?q=${word}`));
    expect(found.items.some((i) => i.group === 'talkBookmarks' && i.href.includes(ch.id))).toBe(true);

    await page.getByRole('button', { name: `Options for ${word}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const renamed = `${word}b`;
    await page.getByTestId('talk-bookmark-name').fill(renamed);
    await page.getByTestId('talk-bookmark-save').click();
    await expect(page.getByTestId('talk-bookmarks').getByRole('link', { name: renamed })).toBeVisible();
    await expect(other.getByTestId('talk-bookmarks').getByRole('link', { name: renamed })).toBeVisible({ timeout: 10_000 });

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `Options for ${renamed}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Esc cancela: sigue ahí.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('talk-bookmarks').getByRole('link', { name: renamed })).toBeVisible();
    await page.getByRole('button', { name: `Options for ${renamed}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByTestId('talk-bookmark-confirm-delete').click();
    await expect(page.getByTestId('talk-bookmarks').getByRole('link', { name: renamed })).toHaveCount(0);
    await expect(other.getByTestId('talk-bookmarks').getByRole('link', { name: renamed })).toHaveCount(0, { timeout: 10_000 });
    await other.close();
  });

  test('quien sale de un público lee pero no edita; quien sale de un privado no ve nada', async ({ page, request }) => {
    const pub = await newChannel(request);
    const priv = await newChannel(request, 'private');
    const word = `Oculto${uid()}`;
    await ok(request.post(`/api/talk/channels/${pub.id}/bookmarks`, { data: { url: 'https://example.com/a', title: `${word}pub` } }));
    await ok(request.post(`/api/talk/channels/${priv.id}/bookmarks`, { data: { url: 'https://example.com/b', title: `${word}priv` } }));
    // Otro miembro queda en el privado: si no, sacar al último no representa el caso real.
    await ok(request.delete(`/api/talk/channels/${pub.id}/members`));
    await ok(request.delete(`/api/talk/channels/${priv.id}/members`));

    await openChannel(page, pub.id);
    await expect(page.getByTestId('talk-bookmarks').getByRole('link', { name: `${word}pub` })).toBeVisible();
    await expect(page.getByTestId('talk-bookmark-add')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Options for ${word}pub` })).toHaveCount(0);
    expect((await request.post(`/api/talk/channels/${pub.id}/bookmarks`, { data: { url: 'https://example.com/c' } })).status()).toBe(403);
    expect((await request.get(`/api/talk/channels/${priv.id}/bookmarks`)).status()).toBe(404);
    expect((await request.post(`/api/talk/channels/${priv.id}/bookmarks`, { data: { url: 'https://example.com/c' } })).status()).toBe(404);
  });

  test('los que no entran van a "Más", "+ Add" queda visible y el menú se maneja con teclado', async ({ page, request }) => {
    const ch = await newChannel(request);
    for (let i = 0; i < 12; i++) await ok(request.post(`/api/talk/channels/${ch.id}/bookmarks`, { data: { url: `https://example.com/${i}`, title: `Marcador largo número ${i}` } }));
    await page.setViewportSize({ width: 390, height: 800 });
    await openChannel(page, ch.id);
    await expect(page.getByTestId('talk-bookmark-add')).toBeInViewport();
    const moreBtn = page.getByTestId('talk-bookmark-overflow-btn');
    await expect(moreBtn).toBeInViewport();
    await moreBtn.click();
    const extra = page.getByTestId('talk-bookmark-overflow');
    await expect(extra.getByRole('link', { name: 'Marcador largo número 11' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(extra).toHaveCount(0);
    await expect(moreBtn).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 800 });
    const opts = page.getByRole('button', { name: 'Options for Marcador largo número 0' });
    await opts.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(opts).toBeFocused();
  });

  test('"Más": el menú de un marcador no pierde el foco, Tab afuera lo cierra y al cambiar el ancho se cierra sin perder el foco', async ({ page, request }) => {
    const ch = await newChannel(request);
    for (let i = 0; i < 12; i++) await ok(request.post(`/api/talk/channels/${ch.id}/bookmarks`, { data: { url: `https://example.com/${i}`, title: `Marcador largo número ${i}` } }));
    await page.setViewportSize({ width: 390, height: 800 });
    await openChannel(page, ch.id);
    const moreBtn = page.getByTestId('talk-bookmark-overflow-btn');
    await moreBtn.click();
    const extra = page.getByTestId('talk-bookmark-overflow');
    await expect(extra.getByRole('link').first()).toBeFocused();
    // Opciones de un marcador de adentro de "Más": el foco queda en el menú (antes volvía al primer link).
    await extra.getByRole('button', { name: 'Options for Marcador largo número 11' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Sigue abierto con el foco en el marcador; Tab hasta salir de "Más" lo cierra.
    await expect(extra).toBeVisible();
    for (let i = 0; i < 40 && (await extra.count()); i++) await page.keyboard.press('Tab');
    await expect(extra).toHaveCount(0);
    // Cambiar el ancho con el menú abierto lo cierra y el foco vuelve a "Más".
    await moreBtn.click();
    await expect(extra.getByRole('link').first()).toBeFocused();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(extra).toHaveCount(0);
    await expect(moreBtn).toBeFocused();
  });

  test('390 px y oscuro sin scroll horizontal', async ({ page, request }) => {
    const ch = await newChannel(request);
    for (let i = 0; i < 6; i++) await ok(request.post(`/api/talk/channels/${ch.id}/bookmarks`, { data: { url: `https://example.com/${i}`, title: `Marcador largo número ${i}` } }));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openChannel(page, ch.id);
    await expect(page.getByTestId('talk-bookmarks')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    if (process.env.TALK_SHOTS) await page.screenshot({ path: `${process.env.TALK_SHOTS}/bookmarks-390-dark.png` });
    await page.getByTestId('talk-clip-open').click();
    await expect(page.getByTestId('talk-clip-dialog')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    if (process.env.TALK_SHOTS) await page.screenshot({ path: `${process.env.TALK_SHOTS}/clip-dialog-390-dark.png` });
    await page.keyboard.press('Escape');
    await page.goto('/en/app/talk?view=recap', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('talk-recap-daily')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    if (process.env.TALK_SHOTS) await page.screenshot({ path: `${process.env.TALK_SHOTS}/recap-390-dark.png` });
  });
});

/** El video de otra pestaña está llegando de verdad (con cuadros). */
async function hasFrames(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.locator(selector).evaluateAll((els) => els.some((e) => (e as HTMLVideoElement).videoWidth > 0 && (e as HTMLVideoElement).currentTime > 0)), { timeout: 30_000 })
    .toBe(true);
}

const gum = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __gum: { calls: number; tracks: MediaStreamTrack[] } }).__gum;
    return { calls: g.calls, live: g.tracks.filter((t) => t.readyState === 'live').length };
  });
const slowGum = (page: Page, ms: number) => page.evaluate((v) => void ((window as unknown as { __gumDelay: number }).__gumDelay = v), ms);

test('huddle: doble clic en cámara pide una vez; apagar y salir no dejan nada prendido', async ({ page, request }) => {
  test.setTimeout(120_000);
  const ch = await newChannel(request);
  await openChannel(page, ch.id);
  await page.getByTestId('talk-huddle-button').click();
  await expect(page.getByTestId('talk-huddle')).toContainText("You're the only one here");
  await slowGum(page, 800);
  const cam = page.getByTestId('talk-huddle-camera');
  await cam.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(cam).toBeDisabled();
  await expect(cam).toHaveAttribute('aria-pressed', 'true');
  expect(await gum(page)).toMatchObject({ calls: 1, live: 1 });
  await cam.click();
  await expect(cam).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await gum(page)).live).toBe(0);
  // Salir con la cámara prendida, y salir con el pedido todavía pendiente.
  await slowGum(page, 0);
  await cam.click();
  await expect(cam).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('talk-huddle').getByRole('button', { name: 'Leave' }).click();
  await expect.poll(async () => (await gum(page)).live).toBe(0);
  await page.getByTestId('talk-huddle-button').click();
  await expect(page.getByTestId('talk-huddle')).toContainText("You're the only one here");
  await slowGum(page, 800);
  await page.getByTestId('talk-huddle-camera').click();
  await page.getByTestId('talk-huddle').getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByTestId('talk-huddle')).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect((await gum(page)).live).toBe(0);
});

test('huddle: la cámara va y vuelve entre quien entró primero y quien entró después', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const ch = await newChannel(request);
  const ctx = await browser.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT) || 3210}`, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(fakeMedia);
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  await openChannel(a, ch.id);
  await a.getByTestId('talk-huddle-button').click();
  await expect(a.getByTestId('talk-huddle')).toContainText("You're the only one here");
  await openChannel(b, ch.id);
  await b.getByTestId('talk-huddle-button').click();
  await expect(b.getByTestId('talk-huddle')).toContainText('2 people in the huddle', { timeout: 30_000 });
  await expect(a.getByTestId('talk-huddle')).toContainText('2 people in the huddle', { timeout: 30_000 });

  // A entró primero (responde la oferta): antes su video nunca llegaba a los que entraban después.
  await a.getByTestId('talk-huddle-camera').click();
  await expect(a.getByTestId('talk-huddle-camera')).toHaveAttribute('aria-pressed', 'true');
  await hasFrames(b, '[data-testid="talk-huddle-cameras"] video');
  // Y la cámara de B llega a A.
  await b.getByTestId('talk-huddle-camera').click();
  await expect.poll(() => a.locator('[data-testid="talk-huddle-cameras"] video').count(), { timeout: 30_000 }).toBe(2);
  await hasFrames(a, '[data-testid="talk-huddle-cameras"] figure:not(.is-mirrored) video');
  if (process.env.TALK_SHOTS) await a.screenshot({ path: `${process.env.TALK_SHOTS}/huddle-camera.png` });

  // Apagar: desaparece del otro lado y se libera el dispositivo.
  await a.getByTestId('talk-huddle-camera').click();
  await expect(a.getByTestId('talk-huddle-camera')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => b.locator('[data-testid="talk-huddle-cameras"] figure:not(.is-mirrored) video').count(), { timeout: 30_000 }).toBe(0);

  // La pantalla de quien entró primero también llega.
  await a.getByRole('button', { name: 'Share screen' }).click();
  await hasFrames(b, '.talk-huddle-stage > figure video');
  await ctx.close();
});

test.describe('clips', () => {
  test('grabar video, adjuntar, mandar y reproducir en el mensaje', async ({ page, request }) => {
    const ch = await newChannel(request);
    await openChannel(page, ch.id);
    await page.getByTestId('talk-clip-open').click();
    await expect(page.getByTestId('talk-clip-dialog')).toBeVisible();
    await page.getByTestId('talk-clip-video').click();
    await expect(page.getByTestId('talk-clip-time')).toContainText('Recording');
    await page.waitForTimeout(2500);
    await page.getByTestId('talk-clip-stop').click();
    await page.getByTestId('talk-clip-attach').click();
    await expect(page.getByTestId('talk-clip-dialog')).toHaveCount(0);
    await expect(page.locator('.talk-attachment-name')).toContainText('.webm', { timeout: 20_000 });
    await expect(page.locator('.talk-attachment-name')).not.toContainText(/uploading/i, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const player = page.getByTestId('talk-clip-file').locator('video');
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((el) => (el as HTMLMediaElement).readyState), { timeout: 20_000 }).toBeGreaterThan(0);
    const ranged = await page.request.get((await player.getAttribute('src'))!, { headers: { range: 'bytes=0-99' } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()['content-type']).toMatch(/^video\/webm/);
    expect(ranged.headers()['x-content-type-options']).toBe('nosniff');
    if (process.env.TALK_SHOTS) await page.screenshot({ path: `${process.env.TALK_SHOTS}/clip-video.png` });
  });

  test('cerrar el diálogo con el permiso pendiente no deja el dispositivo prendido', async ({ page, request }) => {
    const ch = await newChannel(request);
    await openChannel(page, ch.id);
    await slowGum(page, 800);
    await page.getByTestId('talk-clip-open').click();
    // El foco arranca en la primera opción.
    await expect(page.getByTestId('talk-clip-audio')).toBeFocused();
    await page.getByTestId('talk-clip-video').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('talk-clip-dialog')).toHaveCount(0);
    await page.waitForTimeout(1200);
    expect(await gum(page)).toMatchObject({ calls: 1, live: 0 });
  });

  test('sin micrófono avisa; un audio adjunto se muestra con reproductor', async ({ page, request }) => {
    const ch = await newChannel(request);
    await openChannel(page, ch.id);
    await page.getByTestId('talk-clip-open').click();
    await page.getByTestId('talk-clip-audio').click();
    await expect(page.getByTestId('talk-clip-dialog').getByRole('alert')).toContainText('No microphone access');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('talk-clip-dialog')).toHaveCount(0);
    const form = { file: { name: 'clip.weba', mimeType: 'audio/webm', buffer: Buffer.from('1a45dfa3', 'hex') }, channelId: ch.id };
    const file = await ok<{ id: string }>(page.request.post('/api/talk/files', { multipart: form }));
    await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'audio', fileIds: [file.id] } }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('talk-clip-file').locator('audio')).toBeVisible();
  });

  test('sin acceso al canal no se puede leer el clip', async ({ page, request }) => {
    const ch = await newChannel(request, 'private');
    const form = { file: { name: 'clip.weba', mimeType: 'audio/webm', buffer: Buffer.from('1a45dfa3', 'hex') }, channelId: ch.id };
    const file = await ok<{ id: string; url: string }>(page.request.post('/api/talk/files', { multipart: form }));
    await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'clip', fileIds: [file.id] } }));
    expect((await request.get(file.url)).status()).toBe(200);
    await ok(request.delete(`/api/talk/channels/${ch.id}/members`));
    expect((await request.get(file.url)).status()).toBe(404);
  });
});

test.describe('/ask', () => {
  test('publica la pregunta y responde en el hilo; sin IA no publica nada', async ({ page, request, context }) => {
    const ch = await newChannel(request);
    await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'La demo es el viernes' } }));
    await openChannel(page, ch.id);
    const box = page.locator('.talk-channel textarea').first();
    await box.fill('/ask ¿cuándo es la demo?');
    await box.press('Enter');
    await expect(page.locator('.talk-scroll [data-testid="talk-message"]', { hasText: '¿cuándo es la demo?' }).first()).toBeVisible();
    await expect(page.locator('.talk-thread, [data-testid="talk-thread"]').getByText('Talk AI').first()).toBeVisible({ timeout: 20_000 });

    await context.addCookies([{ name: 'talk_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
    await box.fill('/ask pregunta sin ia');
    await box.press('Enter');
    await expect(page.getByText("AI isn't available in this workspace right now.")).toBeVisible();
    await expect(page.locator('[data-testid="talk-message"]', { hasText: 'pregunta sin ia' })).toHaveCount(0);
    await expect(box).toHaveValue('/ask pregunta sin ia');
    await context.clearCookies({ name: 'talk_ai_fake' });
  });

  test('respuesta perdida: reintentar recupera; otra pregunta no queda trabada; un error no la traba', async ({ page, request }) => {
    const ch = await newChannel(request);
    await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'contexto' } }));
    await openChannel(page, ch.id);
    const box = page.locator('.talk-channel textarea').first();
    // El servidor lo hace pero la respuesta no llega.
    await page.route('**/api/talk/ai', async (route) => {
      await route.fetch();
      await route.abort('failed');
    }, { times: 1 });
    await box.fill('/ask primera pregunta');
    const lost = page.waitForEvent('requestfailed', (r) => r.url().includes('/api/talk/ai'));
    await box.press('Enter');
    await lost;
    await expect(box).toBeEnabled();
    await expect(box).toHaveValue('/ask primera pregunta');
    await page.waitForTimeout(300);
    await box.press('Enter');
    await expect(box).toHaveValue('');
    const n = await sql("SELECT COUNT(*) AS n FROM talk_messages WHERE channel_id = ? AND body = 'primera pregunta'", [ch.id]);
    expect(Number(n[0].n)).toBe(1);
    // Se perdió de nuevo y la persona escribe otra cosa: clave nueva, no un 409.
    await page.route('**/api/talk/ai', (route) => route.abort('failed'), { times: 1 });
    await box.fill('/ask segunda sin salir');
    const lost2 = page.waitForEvent('requestfailed', (r) => r.url().includes('/api/talk/ai'));
    await box.press('Enter');
    await lost2;
    await expect(box).toHaveValue('/ask segunda sin salir');
    await page.waitForTimeout(300);
    await box.fill('/ask tercera pregunta');
    await box.press('Enter');
    await expect(box).toHaveValue('');
    await expect(page.locator('.talk-scroll [data-testid="talk-message"]', { hasText: 'tercera pregunta' }).first()).toBeVisible();
  });

  test('misma clave no publica dos veces; fuera del canal se rechaza', async ({ request }) => {
    const ch = await newChannel(request, 'private');
    const key = `e2e-${uid()}-key`;
    const data = { kind: 'agent', channelId: ch.id, question: 'hola?', key };
    const first = await ok<{ message: { id: string } }>(request.post('/api/talk/ai', { data }));
    const again = await ok<{ message: { id: string } }>(request.post('/api/talk/ai', { data }));
    expect(again.message.id).toBe(first.message.id);
    const rows = await sql("SELECT COUNT(*) AS n FROM talk_messages WHERE channel_id = ? AND body = 'hola?'", [ch.id]);
    expect(Number(rows[0].n)).toBe(1);
    await ok(request.delete(`/api/talk/channels/${ch.id}/members`));
    expect((await request.post('/api/talk/ai', { data: { ...data, key: `${key}2` } })).status()).toBe(404);
  });
});

test('recap diario: se activa, el cron lo arma una sola vez y avisa', async ({ page, request }) => {
  const ch = await newChannel(request);
  await ok(request.post(`/api/talk/channels/${ch.id}/messages`, { data: { body: 'novedad para el recap' } }));
  await page.goto('/en/app/talk?view=recap', { waitUntil: 'networkidle' });
  const box = page.getByTestId('talk-recap-daily');
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(async () => (await sql('SELECT recap_tz AS z FROM talk_prefs WHERE recap_daily = 1 LIMIT 1'))[0]?.z).toBeTruthy();
  await expect.poll(async () => Number((await sql('SELECT recap_daily AS d FROM talk_prefs WHERE recap_daily = 1 LIMIT 1'))[0]?.d ?? 0)).toBe(1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('talk-recap-daily')).toBeChecked();
  await sql('UPDATE talk_prefs SET recap_next_at = ? WHERE recap_daily = 1', ['2020-01-01T00:00:00.000Z']);
  const before = Number((await sql("SELECT COUNT(*) AS n FROM notifications WHERE type = 'talk_recap'"))[0].n);
  await ok(request.get('/api/cron/minute', { headers: { authorization: 'Bearer e2e-cron' } }));
  await ok(request.get('/api/cron/minute', { headers: { authorization: 'Bearer e2e-cron' } }));
  expect(Number((await sql("SELECT COUNT(*) AS n FROM notifications WHERE type = 'talk_recap'"))[0].n)).toBe(before + 1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('talk-recap')).toBeVisible();
  // Apagar deja de programarlo.
  await page.getByTestId('talk-recap-daily').uncheck();
  await expect.poll(async () => Number((await sql('SELECT COUNT(*) AS n FROM talk_prefs WHERE recap_daily = 1'))[0].n)).toBe(0);
});
