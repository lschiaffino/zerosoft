import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@libsql/client';

/**
 * Rec (como Loom) de punta a punta: grabar con la cámara falsa de Chromium
 * (sube por partes mientras graba), miniatura, GIF, duración en el header,
 * transcripción y título con la IA falsa (REC_AI_FAKE), biblioteca con
 * carpetas, compartir con contraseña y vencimiento, página pública con
 * comentarios, reacciones y vistas, CTA y recorte, embed, IA apagada y el
 * grabador compartido con los videos 1:1 del CRM.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-desktop-capture-source=Entire screen'],
  },
  permissions: ['camera', 'microphone'],
});

const uid = () => Math.random().toString(36).slice(2, 8);
const db = () => createClient({ url: `file:${process.env.E2E_DB_FILE}` });

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** WebM real de ~2 s (canvas de colores) grabado en el navegador de la prueba. */
async function makeWebm(page: Page, ms = 2200): Promise<Buffer> {
  const b64 = await page.evaluate(async (ms) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    let f = 0;
    const id = setInterval(() => {
      g.fillStyle = `hsl(${(f++ * 25) % 360} 70% 50%)`;
      g.fillRect(0, 0, 320, 180);
    }, 66);
    rec.start(200);
    await new Promise((r) => setTimeout(r, ms));
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    clearInterval(id);
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, ms);
  return Buffer.from(b64, 'base64');
}

/** Sube un video listo por la API, como el grabador sin Blob (partes al servidor). */
async function uploadVideo(request: APIRequestContext, body: Buffer, title: string, durationSec = 2): Promise<{ id: string; shareId: string }> {
  const { video } = await ok<{ video: { id: string; shareId: string } }>(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm' } }));
  const put = await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: body, headers: { 'content-type': 'application/octet-stream' } });
  expect(put.status()).toBe(204);
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec } }));
  await ok(request.patch(`/api/rec/videos/${video.id}`, { data: { title } }));
  return video;
}

/** Copia del video en el workspace de otra persona: así el usuario demo lo mira como alguien de afuera. */
async function foreignCopy(videoId: string, patch: Record<string, string | number | null> = {}): Promise<{ id: string; shareId: string }> {
  const c = db();
  await c.execute("INSERT OR IGNORE INTO users (id, email, name) VALUES ('rec-other', 'rec-other@e2e.dev', 'Otra Persona')");
  const id = crypto.randomUUID();
  const shareId = `ext${uid()}${uid()}`;
  await c.execute({
    sql: `INSERT INTO rec_videos (id, workspace_id, created_by, share_id, title, title_source, mode, status, url, content_type, size, duration_sec, transcript, transcript_status, summary, chapters)
          SELECT ?, 'rec-other', 'rec-other', ?, title, 'user', mode, 'ready', url, content_type, size, duration_sec, transcript, 'done', summary, chapters FROM rec_videos WHERE id = ?`,
    args: [id, shareId, videoId],
  });
  for (const [k, v] of Object.entries(patch)) await c.execute({ sql: `UPDATE rec_videos SET ${k} = ? WHERE id = ?`, args: [v, id] });
  c.close();
  return { id, shareId };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('grabar con la cámara: pausa, sube por partes, miniatura, GIF, duración y transcripción', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  await page.getByTestId('rec-record').click();
  await expect(page).toHaveURL(/\/en\/app\/rec\/new$/);
  await page.getByText('Camera only', { exact: true }).click();
  // Selector de micrófono con los dispositivos del navegador.
  await expect(page.getByLabel('Microphone')).toBeVisible();
  await expect.poll(async () => (await page.getByLabel('Microphone').locator('option').count()) > 2).toBe(true);
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-countdown')).toBeVisible();
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 6_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('rec-pause').click();
  await expect(page.getByRole('status').filter({ hasText: 'Paused' })).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByTestId('rec-resume').click();
  await page.waitForTimeout(1800);
  await page.getByTestId('rec-stop').click();

  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}\?created=/, { timeout: 30_000 });
  const id = /rec\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByTestId('rec-toast')).toContainText('Video ready');
  // La IA falsa transcribe y pone el título (la persona no lo había cambiado).
  await expect(page.getByRole('heading', { level: 1, name: 'Onboarding walkthrough' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('rec-summary')).toHaveValue(/walkthrough/);
  await page.getByTestId('rec-tab-transcript').click();
  await expect(page.getByTestId('rec-transcript')).toContainText('Hi, this is a quick walkthrough');

  // La duración quedó escrita en el header: el reproductor la conoce sin bajar todo.
  const duration = await page.getByTestId('rec-video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        if (Number.isFinite(v.duration) && v.duration > 0) return resolve(v.duration);
        v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
        v.load();
      }),
  );
  expect(Number.isFinite(duration)).toBe(true);
  expect(duration).toBeGreaterThan(2);
  expect(duration).toBeLessThan(8);

  const thumb = await page.request.get(`/api/rec/videos/${id}/file?kind=thumb`);
  expect(thumb.headers()['content-type']).toContain('image/jpeg');
  const gif = await page.request.get(`/api/rec/videos/${id}/file?kind=gif`);
  expect(gif.headers()['content-type']).toContain('image/gif');
  expect((await gif.body()).subarray(0, 6).toString()).toBe('GIF89a');

  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const card = page.getByTestId('rec-card').filter({ hasText: 'Onboarding walkthrough' }).first();
  await expect(card).toBeVisible();
  await expect(card.locator('img').first()).toHaveAttribute('src', /kind=thumb/);
});

test('pantalla y cámara: la burbuja se mueve con el teclado y el video se guarda', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Screen and camera', { exact: true }).click();
  await page.getByTestId('rec-start').click();
  const failed = page.getByRole('alert').filter({ hasText: /Screen sharing|cannot record the screen/ });
  const started = page.getByTestId('rec-countdown');
  await expect(failed.or(started)).toBeVisible({ timeout: 10_000 });
  test.skip(await failed.isVisible(), 'Este Chromium no comparte pantalla sin interacción');
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 6_000 });
  const bubble = page.getByTestId('rec-bubble');
  const before = await bubble.boundingBox();
  await bubble.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  const after = await bubble.boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x);
  expect(after!.width).toBeGreaterThan(before!.width);
  await page.waitForTimeout(2000);
  await page.getByTestId('rec-stop').click();
  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByTestId('rec-player')).toBeVisible();
});

test('biblioteca: carpeta nueva, mover, renombrar y borrar sin recargar; ⌘K', async ({ page }) => {
  const body = await (async () => {
    await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
    return makeWebm(page);
  })();
  const title = `Lib ${uid()}`;
  const v = await uploadVideo(page.request, body, title);
  const folder = `Carpeta ${uid()}`;
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  await page.getByTestId('rec-new-folder').click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Name').fill(folder);
  await dialog.getByLabel('Name').press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/rec\/f\//);
  await expect(page.getByRole('heading', { level: 1, name: folder })).toBeVisible();
  await expect(page.locator('#side-branch').getByRole('link', { name: folder })).toHaveAttribute('aria-current', 'page');

  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const card = page.getByTestId('rec-card').filter({ hasText: title });
  await card.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const move = page.getByRole('dialog', { name: 'Move video' });
  await move.getByText(folder, { exact: true }).click();
  await move.getByTestId('rec-move-submit').click();
  await expect(card).toHaveCount(0);
  await page.locator('#side-branch').getByRole('link', { name: folder }).click();
  const moved = page.getByTestId('rec-card').filter({ hasText: title });
  await expect(moved).toBeVisible();

  const renamed = `Renombrado ${uid()}`;
  await moved.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rn = page.getByRole('dialog', { name: 'Rename video' });
  await rn.getByLabel('Name').fill(renamed);
  await rn.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('rec-card').filter({ hasText: renamed })).toBeVisible();

  // El renombrar refresca la página (caché del router): esperar a que termine antes de abrir ⌘K.
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(async () => {
    await search.getByRole('combobox').fill(renamed);
    await expect(search.getByRole('option', { name: new RegExp(renamed) }).first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await search.getByRole('option', { name: new RegExp(renamed) }).first().click();
  await expect(page).toHaveURL(new RegExp(v.id));

  await page.goBack();
  const again = page.getByTestId('rec-card').filter({ hasText: renamed });
  await again.getByRole('button', { name: `Actions for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(again).toHaveCount(0);
});

test('compartir: contraseña, vencimiento, solo workspace, comentarios, reacciones y vistas', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const v = await uploadVideo(page.request, await makeWebm(page), `Share ${uid()}`);
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('rec-share').click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await expect(share.getByRole('textbox', { name: 'Link', exact: true })).toHaveValue(new RegExp(`/en/v/${v.shareId}$`));
  await expect(share.getByRole('textbox', { name: 'Embed', exact: true })).toHaveValue(new RegExp(`/en/v/${v.shareId}/embed`));
  await share.getByLabel('Password (optional)').fill('secret12');
  await share.getByTestId('rec-share-save').click();
  await expect(share).toBeHidden();
  await expect(page.getByText(/Anyone with the link · Password/)).toBeVisible();

  // Alguien de afuera (otro workspace) abre el link: pide la contraseña.
  const other = await foreignCopy(v.id);
  const c = db();
  const hash = (await c.execute({ sql: 'SELECT password_hash FROM rec_videos WHERE id = ?', args: [v.id] })).rows[0].password_hash as string;
  await c.execute({ sql: 'UPDATE rec_videos SET password_hash = ? WHERE id = ?', args: [hash, other.id] });
  c.close();
  await page.goto(`/en/v/${other.shareId}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'password');
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Watch' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong password' })).toBeVisible();
  await page.getByLabel('Password').fill('secret12');
  await page.getByRole('button', { name: 'Watch' }).click();
  await expect(page.getByTestId('rec-watch')).toBeVisible();
  // La URL del archivo guardado nunca llega al HTML de una página protegida.
  expect(await page.content()).not.toMatch(/uploads\/rec\/|blob\.vercel-storage\.com/);

  // Mirar abre una vista; comentar y reaccionar avisan a la autora.
  const track = page.waitForResponse((r) => r.url().includes(`/api/rec/v/${other.shareId}/track`) && r.ok());
  await page.getByRole('button', { name: 'Play' }).first().click();
  await track;
  // En DEMO_MODE quien mira es el usuario demo (con sesión): comenta con su nombre.
  await page.getByLabel('Add a comment').fill('Falta el paso de import');
  await page.getByTestId('rec-comment-send').click();
  await expect(page.getByTestId('rec-comment').filter({ hasText: 'Falta el paso de import' })).toBeVisible();
  await page.getByRole('button', { name: 'React with 🎉' }).click();
  await expect(page.getByRole('button', { name: 'React with 🎉' })).toContainText('1');
  await expect(page.getByTestId('rec-player').locator('.rec-marker')).toHaveCount(2);
  const c2 = db();
  await expect
    .poll(async () => Number((await c2.execute({ sql: "SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'rec-other' AND source_id = ?", args: [other.id] })).rows[0].n))
    .toBe(2);
  // Comentario y reacción van en un solo aviso agrupado.
  const grouped = (await c2.execute({ sql: "SELECT meta FROM notifications WHERE user_id = 'rec-other' AND source_id = ? AND type = 'rec_comment'", args: [other.id] })).rows;
  expect(JSON.parse(String(grouped[0].meta)).count).toBe(2);
  expect(Number((await c2.execute({ sql: 'SELECT COUNT(*) AS n FROM rec_views WHERE video_id = ?', args: [other.id] })).rows[0].n)).toBe(1);

  // Vencido y solo workspace.
  await c2.execute({ sql: "UPDATE rec_videos SET expires_at = '2000-01-01 00:00:00' WHERE id = ?", args: [other.id] });
  await page.goto(`/en/v/${other.shareId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'This link expired' })).toBeVisible();
  await c2.execute({ sql: "UPDATE rec_videos SET expires_at = NULL, privacy = 'workspace' WHERE id = ?", args: [other.id] });
  await page.goto(`/en/v/${other.shareId}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'forbidden');
  expect((await page.request.get(`/api/rec/v/${other.shareId}/file`)).status()).toBe(403);
  c2.close();
  await page.goto('/en/v/doesnotexist123', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: "This video doesn't exist" })).toBeVisible();
});

test('editar: recorte, llamada a la acción, capítulos; página pública y embed los respetan', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const v = await uploadVideo(page.request, await makeWebm(page, 3200), `Edit ${uid()}`, 90);
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('rec-tab-edit').click();
  await page.getByTestId('rec-trim-start').fill('0:05');
  await page.getByTestId('rec-trim-end').fill('1:00');
  await page.getByTestId('rec-trim-save').click();
  await expect(page.getByText('Viewers see 0:55.')).toBeVisible();
  await page.getByTestId('rec-cta-label').fill('Book a demo');
  await page.getByTestId('rec-cta-url').fill('mailto:x@y.z');
  await page.getByTestId('rec-cta-save').click();
  await expect(page.getByRole('alert').filter({ hasText: 'https://' })).toBeVisible();
  await page.getByTestId('rec-cta-url').fill('cal.com/zerosoft');
  await page.getByTestId('rec-cta-save').click();
  await expect(page.getByTestId('rec-cta')).toHaveAttribute('href', 'https://cal.com/zerosoft');
  await page.getByTestId('rec-tab-details').click();
  await page.getByTestId('rec-chapters').fill('0:00 Intro\n0:30 Demo');
  await page.getByTestId('rec-details-save').click();
  await expect(page.getByRole('button', { name: /0:25\s*Demo/ })).toBeVisible();

  await page.goto(`/en/v/${v.shareId}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-cta')).toHaveText('Book a demo');
  await expect(page.getByRole('heading', { name: 'Chapters' })).toBeVisible();
  await expect(page.getByTestId('rec-player')).toContainText('0:55');
  // Velocidad.
  await page.getByTestId('rec-speed').click();
  await page.getByRole('menuitemradio', { name: '1.5x' }).click();
  expect(await page.getByTestId('rec-video').evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(1.5);

  await page.goto(`/en/v/${v.shareId}/embed`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-embed')).toBeVisible();
  await expect(page.getByTestId('rec-cta')).toBeVisible();
});

test('IA apagada: el detalle explica ai_disabled y deja reintentar', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'rec_ai_fake', value: 'off', url: baseURL! }]);
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const v = await uploadVideo(page.request, await makeWebm(page), `NoAI ${uid()}`);
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-ai-status')).toContainText('ai_disabled', { timeout: 20_000 });
  await context.clearCookies({ name: 'rec_ai_fake' });
  await page.getByTestId('rec-tab-transcript').click();
  await page.getByTestId('rec-retranscribe').click();
  await expect(page.getByTestId('rec-transcript')).toContainText('walkthrough', { timeout: 20_000 });
});

test('analítica: vistas, únicos, % visto y CSV', async ({ page }) => {
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const v = await uploadVideo(page.request, await makeWebm(page), `Stats ${uid()}`, 100);
  const c = db();
  const ins = (key: string, user: string | null, name: string, pos: number, cta = 0) =>
    c.execute({
      sql: `INSERT INTO rec_views (id, video_id, workspace_id, viewer_key, user_id, viewer_name, watched_sec, max_position, duration_sec, cta_clicks, started_at, last_ping_at)
            VALUES (?, ?, 'x', ?, ?, ?, ?, ?, 100, ?, datetime('now'), datetime('now'))`,
      args: [crypto.randomUUID(), v.id, key, user, name, pos, pos, cta],
    });
  await ins('u:lu', 'lu', 'Lucía', 100, 1);
  await ins('a:x', null, '', 50);
  await ins('a:x', null, '', 20);
  c.close();
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('rec-tab-insights').click();
  const insights = page.getByTestId('rec-insights');
  await expect(insights).toContainText('Unique viewers2');
  await expect(insights).toContainText('Average watched75%');
  await expect(insights.getByRole('row').filter({ hasText: 'Lucía' })).toContainText('100%');
  await expect(insights.getByRole('row').filter({ hasText: 'Anonymous' })).toContainText('50%');
  const csv = await page.request.get(`/api/rec/videos/${v.id}/analytics?format=csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Lucía,yes,1,1:40,100,1');
});

test('CRM: el video 1:1 se graba con el grabador de Rec', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/crm/videos', { waitUntil: 'networkidle' });
  await page.getByTestId('video-record').click();
  const dialog = page.getByRole('dialog', { name: 'Record a video' });
  await expect(dialog.getByTestId('rec-recorder')).toBeVisible();
  await dialog.getByText('Camera only', { exact: true }).click();
  await dialog.getByTestId('rec-start').click();
  await expect(dialog.getByTestId('rec-time')).toBeVisible({ timeout: 6_000 });
  await page.waitForTimeout(2000);
  await dialog.getByTestId('rec-stop').click();
  const title = `CRM rec ${uid()}`;
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Save video' }).click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/videos\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByText(title).first()).toBeVisible();
  const duration = await page.locator('video').first().evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        if (v.readyState >= 1) return resolve(v.duration);
        v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
        v.load();
      }),
  );
  expect(Number.isFinite(duration) && duration > 1).toBe(true);
});

test('subir un video que ya tenés: mismo camino por partes, con miniatura y descarga', async ({ page }) => {
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const body = await makeWebm(page, 1500);
  await page.getByTestId('rec-upload-file').setInputFiles({ name: 'demo-subido.webm', mimeType: 'video/webm', buffer: body });
  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = /rec\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByTestId('rec-player')).toBeVisible();
  // La descarga se arma de a partes en el navegador (las respuestas van de a 4 MB como máximo).
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rec-download').click()]);
  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  const { statSync } = await import('fs');
  expect(statSync(await download.path()).size).toBeGreaterThan(body.length - 64);
  const dl = await page.request.get(`/api/rec/videos/${id}/file?download=1`, { headers: { range: 'bytes=0-' } });
  expect(dl.headers()['content-disposition']).toContain('attachment');
  expect(dl.headers()['location']).toBeUndefined();
  expect((await dl.body()).length).toBeGreaterThan(body.length - 64);
});

test('red cortada 60 s mientras se graba: guarda en el navegador, lo dice y sube todo al volver', async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Camera only', { exact: true }).click();
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(4000);
  await context.setOffline(true);
  const status = page.getByTestId('rec-upload-status');
  await expect(status).toContainText('Offline', { timeout: 15_000 });
  await page.waitForTimeout(60_000);
  await expect(status).toContainText(/Offline.*MB pending/);
  await context.setOffline(false);
  await expect(status).toContainText(/Uploading|Uploaded/, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  // Alt+Shift+S termina.
  await page.keyboard.press('Alt+Shift+KeyS');
  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}\?created=/, { timeout: 90_000 });
  const duration = await page.getByTestId('rec-video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        if (Number.isFinite(v.duration) && v.duration > 0) return resolve(v.duration);
        v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
        v.load();
      }),
  );
  // Nada se perdió: están los ~66 s, también los del corte.
  expect(duration).toBeGreaterThan(60);
});

test('se cortó la subida al terminar: descargar local y retomar después de recargar', async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  await page.getByText('Camera only', { exact: true }).click();
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(3000);
  // Esc pide confirmar antes de descartar; seguir grabando.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rec-discard-confirm')).toBeVisible();
  await page.getByRole('button', { name: 'Keep recording' }).click();
  await context.setOffline(true);
  await page.waitForTimeout(3000);
  await page.getByTestId('rec-stop').click();
  await expect(page.getByTestId('rec-saving')).toContainText('No connection', { timeout: 20_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('rec-download-local').click()]);
  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  // Se cierra la pestaña sin red; al volver, Rec ofrece retomar.
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => void d.accept());
  await page.close({ runBeforeUnload: false });
  await context.setOffline(false);
  const again = await context.newPage();
  await again.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const pending = again.getByTestId('rec-pending');
  await expect(pending).toBeVisible();
  await pending.getByTestId('rec-pending-resume').first().click();
  await expect(again).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(again.getByTestId('rec-player')).toBeVisible();
  await again.goto('/en/app/rec', { waitUntil: 'networkidle' });
  await expect(again.getByTestId('rec-pending')).toHaveCount(0);
});

test('recorte: quien no es el autor recibe la copia cortada y la transcripción de adentro', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
  const v = await uploadVideo(page.request, await makeWebm(page, 3000), `Trim ${uid()}`, 90);
  const c = db();
  await c.execute({
    sql: "UPDATE rec_videos SET transcript = ?, transcript_status = 'done' WHERE id = ?",
    args: [JSON.stringify([{ start: 0, end: 4, text: 'secreto del inicio' }, { start: 20, end: 24, text: 'lo que queda' }]), v.id],
  });
  c.close();
  await page.goto(`/en/app/rec/${v.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('rec-tab-edit').click();
  await expect(page.getByTestId('rec-trim-note')).toContainText('trimmed copy');
  await page.getByTestId('rec-trim-start').fill('0:10');
  await page.getByTestId('rec-trim-end').fill('0:05');
  await page.getByTestId('rec-trim-save').click();
  await expect(page.getByRole('alert').filter({ hasText: 'after the start' })).toBeVisible();
  await page.getByTestId('rec-trim-end').fill('1:00');
  await page.getByTestId('rec-trim-save').click();
  await expect(page.getByText('Viewers see 0:50.')).toBeVisible({ timeout: 30_000 });
  const c2 = db();
  const row = (await c2.execute({ sql: 'SELECT trimmed_url, trimmed_for FROM rec_videos WHERE id = ?', args: [v.id] })).rows[0];
  expect(row.trimmed_for).toBe('10:60');
  expect(String(row.trimmed_url)).toMatch(/^\/uploads\/rec\//);
  c2.close();
  // Alguien de otro workspace con el link: transcripción y subtítulos sin lo recortado.
  const other = await foreignCopy(v.id, { trim_start: 10, trim_end: 60 });
  const c3 = db();
  await c3.execute({ sql: 'UPDATE rec_videos SET trimmed_url = ?, trimmed_for = ? WHERE id = ?', args: [row.trimmed_url, row.trimmed_for, other.id] });
  c3.close();
  await page.goto(`/en/v/${other.shareId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await expect(page.getByTestId('rec-transcript')).toContainText('lo que queda');
  await expect(page.getByTestId('rec-transcript')).not.toContainText('secreto');
  const vtt = await (await page.request.get(`/api/rec/v/${other.shareId}/file?kind=captions`)).text();
  expect(vtt).not.toContain('secreto');
  expect(await page.content()).not.toContain('secreto');
});
