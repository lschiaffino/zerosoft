import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Rec, gauntlet contra Loom, de punta a punta con la cámara falsa de Chromium:
 * notas, volver atrás (el archivo final queda corto de verdad), burbuja, lápiz,
 * etiquetas, links sobre el video, subtítulos, responder con video y vista de admin.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-desktop-capture-source=Entire screen'],
  },
  permissions: ['camera', 'microphone'],
});

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** Video de prueba subido por la API, con los bytes mínimos: alcanza para todo lo que no reproduce. */
async function quickVideo(request: APIRequestContext, title: string, space: 'personal' | 'workspace' = 'personal') {
  const body = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);
  const { video } = await ok<{ video: { id: string; shareId: string } }>(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm', space } }));
  await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: body, headers: { 'content-type': 'application/octet-stream' } });
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 30 } }));
  await ok(request.patch(`/api/rec/videos/${video.id}`, { data: { title } }));
  return video;
}

async function waitTranscript(request: APIRequestContext, id: string) {
  await expect
    .poll(async () => ((await (await request.get(`/api/rec/videos/${id}`)).json()) as { video: { transcriptStatus: string } }).video.transcriptStatus, { timeout: 30_000 })
    .toMatch(/done|failed|disabled/);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('volver atrás: lo sacado no queda en el archivo y las notas se ven al grabar', async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Camera only', { exact: true }).click();
  // Sin micrófono: en headless la captura de audio se cuelga en esta máquina.
  await page.getByLabel('Microphone').selectOption('none');
  await page.getByTestId('rec-notes').fill('Hola, esto es lo que voy a decir');
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('rec-notes-live')).toContainText('lo que voy a decir');
  // Graba unos 8 s, vuelve 5 s y graba otros 5 s (2 de margen más 3 hablando).
  await page.waitForTimeout(8000);
  await page.getByTestId('rec-pause').click();
  await expect(page.getByTestId('rec-rewind')).toBeVisible();
  await page.getByTestId('rec-back-15').click();
  await page.getByTestId('rec-back-undo').click();
  await page.getByTestId('rec-back-5').click();
  await page.getByTestId('rec-resume').click();
  await expect(page.getByTestId('rec-lead')).toBeVisible();
  await expect(page.getByTestId('rec-lead')).toBeHidden({ timeout: 6000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('rec-stop').click();

  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}\?created=/, { timeout: 60_000 });
  const id = /rec\/([0-9a-f-]{36})/.exec(page.url())![1];
  const { video } = await ok<{ video: { durationSec: number; hasThumb: boolean; hasGif: boolean; size: number } }>(request.get(`/api/rec/videos/${id}`));
  // Se grabaron más de 13 s y quedan unos 8: el archivo de verdad, no un salto del reproductor.
  expect(video.durationSec).toBeGreaterThan(4);
  expect(video.durationSec).toBeLessThan(11);
  expect(video.hasThumb).toBe(true);
  const dur = await page.getByTestId('rec-video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        const read = () => resolve(v.duration);
        if (Number.isFinite(v.duration) && v.duration > 0) read();
        else v.addEventListener('loadedmetadata', read, { once: true });
      }),
  );
  expect(dur).toBeLessThan(11);
  await waitTranscript(request, id);
});

test('sin volver atrás, una pausa no corta nada ni avisa', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Camera only', { exact: true }).click();
  await page.getByLabel('Microphone').selectOption('none');
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.getByTestId('rec-pause').click();
  await page.getByTestId('rec-resume').click();
  await expect(page.getByTestId('rec-lead')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await page.getByTestId('rec-stop').click();
  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}\?created=/, { timeout: 60_000 });
});

test('la cámara: forma, marco y luz se recuerdan; el desenfoque explica por qué no está', async ({ page }) => {
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Screen and camera', { exact: true }).click();
  await page.getByTestId('rec-shape').selectOption('square');
  await page.getByTestId('rec-frame').selectOption('accent');
  await page.getByTestId('rec-lowlight').check();
  await expect(page.locator('video.rec-cam-square.rec-frame-accent.rec-cam-light')).toBeVisible();
  // La cámara falsa no ofrece desenfoque: la opción no desaparece, se explica.
  await expect(page.getByTestId('rec-blur')).toBeDisabled();
  await expect(page.getByTestId('rec-look-note')).toContainText('Background blur');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Screen and camera', { exact: true }).click();
  await expect(page.getByTestId('rec-shape')).toHaveValue('square');
  await expect(page.getByTestId('rec-frame')).toHaveValue('accent');
});

test('lápiz y puntero con solo pantalla o cámara con más luz: se dibuja sobre la vista previa', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Screen only', { exact: true }).click();
  await page.getByTestId('rec-drawtools').check();
  await page.getByLabel('Microphone').selectOption('none');
  await page.getByTestId('rec-start').click();
  const failed = page.getByRole('alert').filter({ hasText: /Screen sharing|cannot record the screen/ });
  await expect(failed.or(page.getByTestId('rec-countdown'))).toBeVisible({ timeout: 10_000 });
  test.skip(await failed.isVisible(), 'Este Chromium no comparte pantalla sin interacción');
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('rec-tool-pen').click();
  const layer = page.getByTestId('rec-ink-layer');
  await expect(layer).toBeVisible();
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  // El trazo llegó al lienzo: hay píxeles rojos.
  const red = await page.locator('canvas.rec-canvas').evaluate((c: HTMLCanvasElement) => {
    const g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] > 180 && d[i + 1] < 70 && d[i + 2] < 110) n++;
    return n;
  });
  expect(red).toBeGreaterThan(5);
  await page.getByTestId('rec-discard').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
});

test('etiquetas: se agregan, filtran la biblioteca y salen en Cmd+K', async ({ page, request }) => {
  const a = uid();
  const v = await quickVideo(request, `Con etiqueta ${a}`);
  await quickVideo(request, `Sin etiqueta ${a}`);
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('rec-tag-input').fill(`Demo ${a}`);
  await page.getByTestId('rec-tag-input').press('Enter');
  await expect(page.getByTestId('rec-tag')).toHaveText(`#demo-${a}`);

  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  await page.getByTestId('rec-tag-filter').getByRole('button', { name: `#demo-${a}` }).click();
  await expect(page.getByTestId('rec-card').filter({ hasText: `Con etiqueta ${a}` })).toBeVisible();
  await expect(page.getByTestId('rec-card').filter({ hasText: `Sin etiqueta ${a}` })).toHaveCount(0);

  const search = await ok<{ results?: unknown }>(request.get(`/api/rec/videos?scope=mine&q=${encodeURIComponent(`#demo-${a}`)}`));
  expect(JSON.stringify(search)).toContain(`Con etiqueta ${a}`);

  // Sacarla no recarga y el filtro se va con ella.
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: `Remove tag demo-${a}` }).click();
  await expect(page.getByTestId('rec-tag')).toHaveCount(0);
});

test('link sobre el video: se guarda, se ve en la página compartida y rechaza lo que no es web', async ({ page, request, browser, baseURL }) => {
  const v = await quickVideo(request, `Con link ${uid()}`);
  const overlay = { id: 'l1', kind: 'link', start: 0, end: 30, x: 0.1, y: 0.1, w: 0.5, h: 0, text: 'Ver precios', color: '#111111' };
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { overlays: [{ ...overlay, url: 'javascript:alert(1)' }] } }));
  let dto = await ok<{ video: { overlays: unknown[] } }>(request.get(`/api/rec/videos/${v.id}`));
  expect(dto.video.overlays).toEqual([]);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { overlays: [{ ...overlay, url: 'https://zerosoft.ai/precios' }] } }));
  dto = await ok(request.get(`/api/rec/videos/${v.id}`));
  expect(dto.video.overlays).toHaveLength(1);

  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: `watcher-${uid()}@test.local`, url: baseURL! }]);
  const watch = await ctx.newPage();
  await watch.goto(`/en/v/${v.shareId}`, { waitUntil: 'domcontentloaded' });
  const link = watch.getByTestId('rec-overlay-link');
  await expect(link).toHaveAttribute('href', 'https://zerosoft.ai/precios');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await ctx.close();
  await page.goto('about:blank');
});

test('subtítulos: el estilo se guarda y una traducción aparece en el reproductor', async ({ page, request }) => {
  const v = await quickVideo(request, `Subtítulos ${uid()}`);
  await waitTranscript(request, v.id);
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('rec-tab-edit').click();
  const section = page.getByTestId('rec-captions');
  await section.getByTestId('rec-cap-size').selectOption('large');
  await expect(page.getByTestId('rec-toast')).toBeVisible();
  await expect(page.getByTestId('rec-player')).toHaveClass(/cap-large/);
  await section.getByTestId('rec-caption-pick').selectOption('pt');
  await section.getByTestId('rec-caption-translate').click();
  await expect(section.getByTestId('rec-caption-track')).toHaveCount(1);

  // Sirve la pista traducida con la marca del modelo falso y frena un idioma que no se tradujo.
  const vtt = await request.get(`/api/rec/videos/${v.id}/file?kind=captions&lang=pt`);
  expect(vtt.ok()).toBe(true);
  expect(await vtt.text()).toContain('[pt]');
  expect((await request.get(`/api/rec/videos/${v.id}/file?kind=captions&lang=fr`)).status()).toBe(404);
  expect((await request.get(`/api/rec/videos/${v.id}/file?kind=captions&lang=xx`)).status()).toBe(400);

  await page.getByRole('button', { name: 'CC', exact: true }).click();
  await page.getByTestId('rec-caption-lang').selectOption('pt');
  await expect(page.getByTestId('rec-caption-lang')).toHaveValue('pt');

  await section.getByRole('button', { name: 'Remove' }).click();
  await expect(section.getByTestId('rec-caption-track')).toHaveCount(0);
});

test('responder con un video: el botón lleva al grabador y un video ajeno no entra', async ({ page, request }) => {
  const v = await quickVideo(request, `Para responder ${uid()}`, 'workspace');
  await ok(request.post(`/api/rec/v/${v.shareId}/comments`, { data: { kind: 'comment', body: 'Primer comentario' } }));
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-reply-video').first()).toHaveAttribute('href', new RegExp(`replyTo=${v.shareId}`));
  await page.getByTestId('rec-reply-video').first().click();
  await expect(page.getByTestId('rec-reply-note')).toBeVisible();

  const mine = await quickVideo(request, `Mi respuesta ${uid()}`);
  const { comment } = await ok<{ comment: { replyVideo: { shareId: string } | null } }>(
    request.post(`/api/rec/v/${v.shareId}/comments`, { data: { kind: 'comment', body: 'Video reply', replyVideoId: mine.id } }),
  );
  expect(comment.replyVideo?.shareId).toBe(mine.shareId);
  const bad = await request.post(`/api/rec/v/${v.shareId}/comments`, { data: { kind: 'comment', body: 'Video reply', replyVideoId: 'no-existe' } });
  expect(bad.status()).toBe(400);
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-reply-video-link').first()).toHaveAttribute('href', new RegExp(mine.shareId));
});

test('vista de admin: uso y registro en los ajustes; los que no son admin no los pueden pedir', async ({ page, request, browser, baseURL }) => {
  const v = await quickVideo(request, `Registro ${uid()}`);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { privacy: 'workspace' } }));
  await page.goto('/en/app/rec/settings', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-admin-insights')).toBeVisible();
  await expect(page.getByTestId('rec-admin-person').first()).toBeVisible();
  await expect(page.getByTestId('rec-admin-log-row').first()).toContainText('changed who can watch a video');

  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: `solo-${uid()}@test.local`, url: baseURL! }]);
  const res = await ctx.request.get('/api/rec/settings/insights');
  // Otra persona es admin de su propio workspace: ve el suyo, nunca este.
  if (res.ok()) expect(await res.text()).not.toContain(v.id);
  await ctx.close();
});

test('a 390 px la barra del grabador, el filtro de etiquetas y los ajustes no generan scroll horizontal', async ({ page, request }) => {
  const a = uid();
  const v = await quickVideo(request, `Angosto ${a}`);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { tags: Array.from({ length: 12 }, (_, i) => `etiqueta-bastante-larga-${i}-${a}`) } }));
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ['/en/app/rec', '/en/app/rec/new', `/en/app/rec/${v.id}`, '/en/app/rec/settings']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const over = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(over, path).toBeLessThanOrEqual(1);
  }
});
