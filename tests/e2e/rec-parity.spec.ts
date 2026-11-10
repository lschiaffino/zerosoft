import { readFileSync, existsSync } from 'fs';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Rec, paridad con Loom: personas puntuales y pedido de acceso, email para ver,
 * link nuevo, archivo y ver más tarde, espacios, overlays, editar desde la
 * transcripción, unir, marca, defaults, retención, Docs y Track, resumen por mail
 * y oEmbed. Cada caso prueba lo que deja pasar y lo que frena.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const db = () => e2eDb();

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** WebM real grabado en el navegador de la prueba, con un keyframe cada 500 ms. */
async function makeWebm(page: Page, ms = 6000, hue = 0): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([ms, hue]) => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const g = c.getContext('2d')!;
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm', videoKeyFrameIntervalDuration: 500 } as MediaRecorderOptions);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      let f = 0;
      const id = setInterval(() => {
        g.fillStyle = `hsl(${(hue + f++ * 7) % 360} 70% 50%)`;
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
    },
    [ms, hue] as const,
  );
  return Buffer.from(b64, 'base64');
}

async function upload(request: APIRequestContext, body: Buffer, title: string, durationSec = 2): Promise<{ id: string; shareId: string }> {
  const { video } = await ok<{ video: { id: string; shareId: string } }>(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm' } }));
  const put = await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: body, headers: { 'content-type': 'application/octet-stream' } });
  expect(put.status()).toBe(204);
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec } }));
  // Lo nuevo nace restringido: estas pruebas parten del link abierto.
  await ok(request.patch(`/api/rec/videos/${video.id}`, { data: { title, privacy: 'link' } }));
  return video;
}

const tiny = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);

/** Otra persona: otra sesión con otro workspace. `session` = sin login. */
async function asPerson(browser: Browser, baseURL: string, who: string) {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: who, url: baseURL }]);
  return { ctx, page: await ctx.newPage(), request: ctx.request };
}

async function waitDone(request: APIRequestContext, id: string) {
  await expect
    .poll(async () => ((await (await request.get(`/api/rec/videos/${id}`)).json()) as { video: { transcriptStatus: string } }).video.transcriptStatus, { timeout: 30_000 })
    .toMatch(/done|failed|disabled/);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('personas puntuales: frena a los demás en página y API, pedir acceso, aprobar y cortar', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(120_000);
  const email = `guest-${uid()}@e2e.dev`;
  const title = `Privado ${uid()}`;
  const v = await upload(request, tiny, title);

  await page.goto(`/en/app/rec/${v.id}`);
  await page.getByTestId('rec-share').click();
  await page.getByTestId('rec-share-access').selectOption('people');
  await page.getByTestId('rec-share-save').click();
  await expect(page.getByTestId('rec-detail')).toContainText('Restricted');

  // Sin sesión: pide entrar; ni la página ni la API dicen el título.
  const anon = await asPerson(browser, baseURL!, 'session');
  const anonRes = await anon.request.get(`/en/v/${v.shareId}`);
  expect(await anonRes.text()).not.toContain(title);
  expect((await anon.request.get(`/api/rec/v/${v.shareId}/file`)).status()).toBe(403);
  expect((await anon.request.get(`/api/rec/v/${v.shareId}/comments`)).status()).toBe(403);
  await anon.page.goto(`/en/v/${v.shareId}`);
  await expect(anon.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'signin');
  // Pedir acceso sin cuenta no se puede.
  expect((await anon.request.post(`/api/rec/v/${v.shareId}/request`)).status()).toBe(401);
  await anon.ctx.close();

  // Con otra cuenta: prohibido, puede pedir acceso.
  const guest = await asPerson(browser, baseURL!, email);
  await guest.page.goto(`/en/v/${v.shareId}`);
  await expect(guest.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'forbidden');
  expect(await guest.page.content()).not.toContain(title);
  expect((await guest.request.get(`/api/rec/v/${v.shareId}/file`)).status()).toBe(403);
  await guest.page.getByTestId('rec-request-access').click();
  await expect(guest.page.getByTestId('rec-request-sent')).toBeVisible();
  // Repetir no duplica.
  await guest.page.reload();
  await expect(guest.page.getByTestId('rec-request-sent')).toBeVisible();

  // Quien grabó ve el aviso y aprueba desde compartir (el link del aviso abre el modal).
  const c = db();
  const n = await c.execute({ sql: "SELECT href FROM notifications WHERE type = 'rec_access' AND source_id = ?", args: [v.id] });
  expect(n.rows).toHaveLength(1);
  await page.goto(`/en${String(n.rows[0].href)}`);
  await expect(page.getByTestId('rec-share-requests')).toContainText(email);
  await page.getByTestId('rec-request-approve').click();
  await expect(page.getByTestId('rec-share-requests')).toHaveCount(0);
  await expect(page.getByTestId('rec-share-person').filter({ hasText: email })).toBeVisible();

  // Ya puede ver.
  await guest.page.goto(`/en/v/${v.shareId}`);
  await expect(guest.page.getByRole('heading', { name: title })).toBeVisible();
  expect((await guest.request.get(`/api/rec/v/${v.shareId}/file`, { headers: { range: 'bytes=0-3' } })).ok()).toBe(true);

  // Sacarlo corta el acceso al toque, en página y archivo.
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { allowedEmails: [] } }));
  await guest.page.goto(`/en/v/${v.shareId}`);
  await expect(guest.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'forbidden');
  expect((await guest.request.get(`/api/rec/v/${v.shareId}/file`)).status()).toBe(403);
  // Y la biblioteca de otro no lo muestra nunca.
  expect((await guest.request.get(`/api/rec/videos/${v.id}`)).status()).toBe(404);
  await guest.ctx.close();
  c.close();
});

test('pedir email: frena página, archivo y comentarios hasta dejarlo; quien grabó lo ve', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  const title = `Con email ${uid()}`;
  const v = await upload(request, tiny, title);
  await page.goto(`/en/app/rec/${v.id}`);
  await page.getByTestId('rec-share').click();
  await page.getByTestId('rec-share-require-email').check();
  await page.getByTestId('rec-share-save').click();
  await expect(page.getByTestId('rec-toast')).toBeVisible();

  const anon = await asPerson(browser, baseURL!, 'session');
  await anon.page.goto(`/en/v/${v.shareId}`);
  await expect(anon.page.getByTestId('rec-gate')).toHaveAttribute('data-state', 'email');
  expect(await anon.page.content()).not.toContain(title);
  expect((await anon.request.get(`/api/rec/v/${v.shareId}/file`)).status()).toBe(403);
  expect((await anon.request.post(`/api/rec/v/${v.shareId}/identify`, { data: { email: 'no-es-email' } })).status()).toBe(400);
  await anon.page.locator('#rec-gate-email').fill('lead@example.com');
  await anon.page.locator('#rec-gate-name').fill('Lead Persona');
  await anon.page.locator('#rec-gate-email').press('Enter');
  await expect(anon.page.getByRole('heading', { name: title })).toBeVisible();
  expect((await anon.request.get(`/api/rec/v/${v.shareId}/file`, { headers: { range: 'bytes=0-1' } })).ok()).toBe(true);
  await ok(anon.request.post(`/api/rec/v/${v.shareId}/track`, { data: { duration: 2, name: 'Lead Persona' } }));
  await anon.ctx.close();

  const stats = await ok<{ viewers: Array<{ email: string }> }>(request.get(`/api/rec/videos/${v.id}/analytics`));
  expect(stats.viewers.map((x) => x.email)).toContain('lead@example.com');
  const csv = await (await request.get(`/api/rec/videos/${v.id}/analytics?format=csv`)).text();
  expect(csv).toContain('lead@example.com');

  // El pedido de email no sirve para saltear una contraseña.
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { password: 'clave-segura' } }));
  const other = await asPerson(browser, baseURL!, 'session');
  expect((await other.request.post(`/api/rec/v/${v.shareId}/identify`, { data: { email: 'a@b.io' } })).status()).toBe(400);
  await other.ctx.close();
});

test('cambiar el link: confirma, el viejo deja de andar y el nuevo anda', async ({ page, request }) => {
  const v = await upload(request, tiny, `Rotar ${uid()}`);
  await page.goto(`/en/app/rec/${v.id}`);
  await page.getByTestId('rec-share').click();
  await page.getByText('Embed and reset link').click();
  await page.getByTestId('rec-share-rotate').click();
  await page.getByRole('button', { name: 'Reset link' }).last().click();
  await expect(page.getByTestId('rec-toast')).toContainText('New link');
  expect((await request.get(`/api/rec/v/${v.shareId}/file`)).status()).toBe(404);
  const { video } = await ok<{ video: { shareId: string } }>(request.get(`/api/rec/videos/${v.id}`));
  expect(video.shareId).not.toBe(v.shareId);
  expect((await request.get(`/en/v/${v.shareId}`)).status()).toBe(404);
});

test('archivo y ver más tarde: desde la tarjeta, sin recargar, con estados vacíos', async ({ page, request }) => {
  const name = `Archivar ${uid()}`;
  const v = await upload(request, tiny, name);
  await page.goto('/en/app/rec');
  const card = page.getByTestId('rec-card').filter({ hasText: name });
  await card.getByRole('button', { name: `Actions for ${name}` }).click();
  await card.getByTestId('rec-card-later').click();
  await expect(page.locator('.ui-toast')).toContainText('watch later');

  await page.getByRole('link', { name: 'Watch later' }).first().click();
  await expect(page).toHaveURL(/\/en\/app\/rec\/later$/);
  await expect(page.getByTestId('rec-card').filter({ hasText: name })).toBeVisible();
  const laterCard = page.getByTestId('rec-card').filter({ hasText: name });
  await laterCard.getByRole('button', { name: `Actions for ${name}` }).click();
  await laterCard.getByTestId('rec-card-later').click();
  await expect(page.getByTestId('rec-card').filter({ hasText: name })).toHaveCount(0);

  await page.goto('/en/app/rec');
  await card.getByRole('button', { name: `Actions for ${name}` }).click();
  await card.getByTestId('rec-card-archive').click();
  await expect(card).toHaveCount(0);
  await page.goto('/en/app/rec/archive');
  const arch = page.getByTestId('rec-card').filter({ hasText: name });
  await expect(arch).toBeVisible();
  // El link sigue andando.
  expect((await request.get(`/en/v/${v.shareId}`)).status()).toBe(200);
  await arch.getByRole('button', { name: `Actions for ${name}` }).click();
  await arch.getByTestId('rec-card-archive').click();
  await expect(arch).toHaveCount(0);
  await page.goto('/en/app/rec');
  await expect(card).toBeVisible();
});

test('espacios: crear, sidebar, ⌘K, miembros, renombrar y borrar; afuera no entra nadie', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  const name = `Espacio ${uid()}`;
  await page.goto('/en/app/rec');
  await page.getByTestId('rec-new-space').click();
  await page.getByRole('dialog').getByRole('textbox').fill(name);
  await page.getByRole('dialog').getByRole('textbox').press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/rec\/s\/[0-9a-f-]{36}$/);
  const id = /\/s\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByTestId('rec-branch-spaces')).toContainText(name);
  await expect(page.getByTestId('rec-branch-spaces').getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('This space has no videos')).toBeVisible();

  const search = await ok<{ items: Array<{ label: string; href: string }> }>(request.get(`/api/search?q=${encodeURIComponent(name)}`));
  expect(search.items.some((i) => i.href === `/app/rec/s/${id}`)).toBe(true);

  // Video adentro: no aparece en el espacio general del workspace.
  const inside = `Adentro ${uid()}`;
  const { video } = await ok<{ video: { id: string; shareId: string } }>(request.post('/api/rec/videos', { data: { title: inside, mode: 'camera', contentType: 'video/webm', spaceId: id } }));
  await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: tiny, headers: { 'content-type': 'application/octet-stream' } });
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 2 } }));
  await ok(request.patch(`/api/rec/videos/${video.id}`, { data: { title: inside } }));
  await page.reload();
  await expect(page.getByTestId('rec-card').filter({ hasText: inside })).toBeVisible();
  const general = await ok<{ videos: Array<{ title: string }> }>(request.get('/api/rec/videos?scope=workspace'));
  expect(general.videos.some((x) => x.title === inside)).toBe(false);

  // De otro workspace: 404 en página y API; tampoco en Cmd+K.
  const out = await asPerson(browser, baseURL!, `space-${uid()}@e2e.dev`);
  const foreign = await out.request.get(`/en/app/rec/s/${id}`);
  expect(await foreign.text()).not.toContain(name);
  expect((await request.get(`/en/app/rec/s/${crypto.randomUUID()}`)).status()).toBe(404);
  expect((await out.request.get(`/api/rec/spaces/${id}`)).status()).toBe(404);
  expect((await out.request.get(`/api/rec/spaces/${id}/members`)).status()).toBe(404);
  expect((await out.request.delete(`/api/rec/spaces/${id}`)).status()).toBe(404);
  const outSearch = await ok<{ items: Array<{ href: string }> }>(out.request.get(`/api/search?q=${encodeURIComponent(name)}`));
  expect(outSearch.items.some((i) => i.href.includes(id))).toBe(false);
  await out.ctx.close();

  await page.getByTestId('rec-space-members').click();
  await expect(page.getByTestId('rec-members-dialog').getByTestId('rec-member-check').first()).toBeVisible();
  await page.getByTestId('rec-members-dialog').getByRole('button', { name: 'Cancel' }).click();

  const renamed = `${name} bis`;
  await page.getByTestId('rec-space-rename').click();
  const box = page.getByRole('dialog').getByRole('textbox');
  await box.fill(renamed);
  await box.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await expect(page.getByTestId('rec-branch-spaces')).toContainText(renamed);

  await page.getByTestId('rec-space-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/en\/app\/rec$/);
  // El video vuelve a Mis videos, no se borra.
  await expect(page.getByTestId('rec-card').filter({ hasText: inside })).toBeVisible();
});

test('overlays: se editan, salen en la página y en el embed como texto, y no hacen nada raro', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/rec');
  const body = await makeWebm(page, 3000);
  const v = await upload(request, body, `Overlays ${uid()}`, 3);
  await page.goto(`/en/app/rec/${v.id}`);
  await page.getByTestId('rec-tab-edit').click();
  await page.getByTestId('rec-overlay-add-text').click();
  const danger = '<img src=x onerror="window.__pwned=1">Mirá acá';
  await page.getByTestId('rec-overlay-text').fill(danger);
  await page.getByTestId('rec-overlay-add-box').click();
  await page.getByTestId('rec-overlay-add-arrow').click();
  // Se ve en el reproductor antes de guardar.
  await expect(page.getByTestId('rec-overlay-shown').first()).toBeAttached();
  await page.getByTestId('rec-overlays-save').click();
  await expect(page.getByTestId('rec-toast')).toBeVisible();

  const anon = await asPerson(browser, baseURL!, 'session');
  for (const path of [`/en/v/${v.shareId}`, `/en/v/${v.shareId}/embed`]) {
    await anon.page.goto(path);
    await expect(anon.page.locator('.rec-overlay-text').first()).toHaveText(danger);
    await expect(anon.page.locator('.rec-overlay-box').first()).toBeAttached();
    await expect(anon.page.locator('.rec-overlay-arrow').first()).toBeAttached();
    expect(await anon.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  }
  await anon.ctx.close();

  // Lo inválido no entra y nadie más puede cambiarlos.
  const res = await ok<{ video: { overlays: unknown[] } }>(request.patch(`/api/rec/videos/${v.id}`, { data: { overlays: [{ kind: 'script', start: 0, end: 1 }] } }));
  expect(res.video.overlays).toEqual([]);
  const out = await asPerson(browser, baseURL!, `ov-${uid()}@e2e.dev`);
  expect((await out.request.patch(`/api/rec/videos/${v.id}`, { data: { overlays: [] } })).status()).toBe(404);
  await out.ctx.close();
});

test('editar desde la transcripción y unir: copia nueva que reproduce, sin IA ni cambios en el original', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.goto('/en/app/rec');
  const a = await upload(request, await makeWebm(page, 6000, 0), `Fuente ${uid()}`, 6);
  const b = await upload(request, await makeWebm(page, 3000, 120), `Segundo ${uid()}`, 3);
  await waitDone(request, a.id);
  await waitDone(request, b.id);
  const c = db();
  const segs = [
    { start: 0, end: 2, text: 'First phrase stays' },
    { start: 2, end: 4, text: 'Cut this secret phrase' },
    { start: 4, end: 6, text: 'um' },
  ];
  await c.execute({ sql: "UPDATE rec_videos SET transcript = ?, transcript_status = 'done', summary = 'Mentions the secret' WHERE id = ?", args: [JSON.stringify(segs), a.id] });
  const usageBefore = Number((await c.execute("SELECT COUNT(*) AS n FROM ai_usage WHERE feature LIKE 'rec_%'").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);

  await page.goto(`/en/app/rec/${a.id}`);
  await page.getByTestId('rec-tab-edit').click();
  await page.getByTestId('rec-edit-seg').nth(1).check();
  await page.getByTestId('rec-mark-fillers').click();
  await expect(page.getByTestId('rec-edit-seg').nth(2)).toBeChecked();
  await expect(page.getByTestId('rec-edit-summary')).toContainText('Removes');
  await page.getByTestId('rec-edit-seg').nth(2).uncheck();
  await page.getByTestId('rec-edit-create').click();
  await expect(page).toHaveURL(new RegExp(`/en/app/rec/(?!${a.id})[0-9a-f-]{36}$`), { timeout: 60_000 });
  const copyId = /rec\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(edited)');

  const { video: copy } = await ok<{ video: { durationSec: number; summary: string; transcript: Array<{ text: string }>; transcriptStatus: string } }>(request.get(`/api/rec/videos/${copyId}`));
  expect(copy.durationSec).toBeLessThan(5.5);
  expect(copy.durationSec).toBeGreaterThan(2);
  expect(copy.transcriptStatus).toBe('done');
  expect(copy.summary).toBe('');
  expect(JSON.stringify(copy.transcript)).not.toContain('secret');
  expect(JSON.stringify(copy.transcript)).toContain('First phrase stays');
  // Reproduce de verdad: el navegador lee la duración nueva y avanza.
  const played = await page.getByTestId('rec-video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<{ duration: number; moved: boolean }>((resolve) => {
        const finish = () => resolve({ duration: v.duration, moved: v.currentTime > 0.2 });
        v.muted = true;
        void v.play().catch(() => undefined);
        setTimeout(finish, 2000);
      }),
  );
  expect(played.moved).toBe(true);
  expect(played.duration).toBeLessThan(5.5);

  // El original no cambió.
  const { video: orig } = await ok<{ video: { durationSec: number; summary: string } }>(request.get(`/api/rec/videos/${a.id}`));
  expect(orig.durationSec).toBe(6);
  expect(orig.summary).toBe('Mentions the secret');
  // Ninguna transcripción ni resumen con IA para la copia.
  const usageAfter = Number((await c.execute("SELECT COUNT(*) AS n FROM ai_usage WHERE feature LIKE 'rec_%'").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  expect(usageAfter).toBe(usageBefore);

  // Unir.
  await page.goto(`/en/app/rec/${a.id}`);
  await page.getByTestId('rec-tab-edit').click();
  await expect(page.getByTestId('rec-join-select')).toBeVisible();
  await page.getByTestId('rec-join-select').selectOption(b.id);
  await page.getByTestId('rec-join-create').click();
  await expect(page).toHaveURL(new RegExp(`/en/app/rec/(?!${a.id})[0-9a-f-]{36}$`), { timeout: 60_000 });
  const joinId = /rec\/([0-9a-f-]{36})/.exec(page.url())![1];
  const { video: joined } = await ok<{ video: { durationSec: number } }>(request.get(`/api/rec/videos/${joinId}`));
  expect(joined.durationSec).toBeGreaterThan(7);
  const d = await page.getByTestId('rec-video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        if (Number.isFinite(v.duration) && v.duration > 0) return resolve(v.duration);
        v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
        v.load();
      }),
  );
  expect(d).toBeGreaterThan(7);
  c.close();

  // Un MP4 subido lo dice y no ofrece editar.
  const { video: mp4 } = await ok<{ video: { id: string } }>(request.post('/api/rec/videos', { data: { title: 'MP4', mode: 'camera', contentType: 'video/mp4' } }));
  await request.put(`/api/rec/videos/${mp4.id}/parts?kind=video&n=1`, { data: Buffer.from([0, 0, 0, 0]), headers: { 'content-type': 'application/octet-stream' } });
  await ok(request.post(`/api/rec/videos/${mp4.id}/complete`, { data: { kind: 'video', contentType: 'video/mp4', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${mp4.id}/finalize`, { data: { durationSec: 1 } }));
  await page.goto(`/en/app/rec/${mp4.id}`);
  await page.getByTestId('rec-tab-edit').click();
  await expect(page.getByTestId('rec-edit-only-webm')).toBeVisible();
});

test('ajustes: marca en la página y el embed, no en la puerta; defaults para lo nuevo; retención con confirmación', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  const before = await upload(request, tiny, `Antes ${uid()}`);
  await page.goto('/en/app/rec/settings');
  await expect(page.getByTestId('rec-settings')).toBeVisible();
  const brand = `Acme ${uid()}`;
  await page.getByTestId('rec-brand-name').fill(brand);
  await page.getByTestId('rec-brand-color').fill('not-a-color');
  await page.getByTestId('rec-brand-save').click();
  await expect(page.locator('.ui-error')).toContainText('#e11d48');
  await page.getByTestId('rec-brand-color').fill('#1d4ed8');
  await page.getByTestId('rec-brand-save').click();
  await expect(page.getByTestId('rec-settings-toast')).toBeVisible();
  // Logo: rechaza SVG y lo demás lo guarda.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg==', 'base64');
  const svgRes = await request.post('/api/rec/settings/logo', { multipart: { file: { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') } } });
  expect(svgRes.status()).toBe(415);
  await page.getByTestId('rec-logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Logo uploaded.')).toBeVisible();

  const anon = await asPerson(browser, baseURL!, 'session');
  await anon.page.goto(`/en/v/${before.shareId}`);
  await expect(anon.page.getByTestId('rec-brand')).toContainText(brand);
  await expect(anon.page.getByTestId('rec-brand-logo')).toBeVisible();
  await expect(anon.page.getByText('Powered by')).toBeHidden();
  expect(await anon.page.title()).not.toContain('zerosoft');
  const logo = await anon.request.get(`/api/rec/v/${before.shareId}/file?kind=logo`);
  expect(logo.ok()).toBe(true);
  expect(logo.headers()['content-type']).toContain('image/png');
  await anon.page.goto(`/en/v/${before.shareId}/embed`);
  await expect(anon.page.getByTestId('rec-embed')).toHaveClass(/branded/);

  // Detrás de una contraseña no se muestra la marca ni se sirve el logo.
  const locked = await upload(request, tiny, `Cerrado ${uid()}`);
  await ok(request.patch(`/api/rec/videos/${locked.id}`, { data: { password: 'clave-segura' } }));
  await anon.page.goto(`/en/v/${locked.shareId}`);
  await expect(anon.page.getByTestId('rec-gate')).toBeVisible();
  await expect(anon.page.getByTestId('rec-brand')).toHaveCount(0);
  expect((await anon.request.get(`/api/rec/v/${locked.shareId}/file?kind=logo`)).status()).toBe(403);
  await anon.ctx.close();

  // Defaults.
  await page.getByTestId('rec-default-workspace').check();
  await page.getByTestId('rec-default-download').uncheck();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/rec/settings') && r.request().method() === 'PATCH');
  await page.getByTestId('rec-defaults-save').click();
  await saved;
  // Guardar una sección no pisa lo que se escribe en otra.
  await page.getByTestId('rec-brand-name').fill('Sin guardar');
  const { video: fresh } = await ok<{ video: { privacy: string; allowDownload: boolean } }>(request.post('/api/rec/videos', { data: { title: 'Nuevo', mode: 'camera', contentType: 'video/webm' } }));
  expect(fresh.privacy).toBe('workspace');
  expect(fresh.allowDownload).toBe(false);
  const { video: unchanged } = await ok<{ video: { privacy: string; allowDownload: boolean } }>(request.get(`/api/rec/videos/${before.id}`));
  expect(unchanged.privacy).toBe('link');
  expect(unchanged.allowDownload).toBe(true);
  await ok(request.patch('/api/rec/settings', { data: { defaultPrivacy: 'people', defaultAllowDownload: true, brandName: '', brandColor: null } }));

  // Retención: confirma con la cuenta; cancelar no prende.
  await page.getByTestId('rec-retention').selectOption('30');
  await page.getByTestId('rec-retention-save').click();
  const dialog = page.getByRole('alertdialog').filter({ hasText: 'older than 30 days' });
  await expect(dialog).toBeVisible();
  if (process.env.REC_SHOTS) {
    for (const [name, w, scheme] of [['dark-390', 390, 'dark'], ['light-390', 390, 'light'], ['dark-1280', 1280, 'dark']] as const) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${process.env.REC_SHOTS}/retention-${name}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  let s = await ok<{ settings: { retentionDays: number | null } }>(request.get('/api/rec/settings'));
  expect(s.settings.retentionDays).toBeNull();
  await page.getByTestId('rec-retention-save').click();
  await dialog.getByRole('button', { name: 'Turn on retention' }).click();
  await expect(page.getByTestId('rec-retention-status')).toBeVisible();
  await expect(page.getByTestId('rec-brand-name')).toHaveValue('Sin guardar');
  await ok(request.patch('/api/rec/settings', { data: { retentionDays: null } }));
  s = await ok<{ settings: { retentionDays: number | null } }>(request.get('/api/rec/settings'));
  expect(s.settings.retentionDays).toBeNull();
});

test('del video a Docs y Track, y resumen por mail con tope y sin repetir', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000);
  const title = `Exportar ${uid()}`;
  const v = await upload(request, tiny, title);
  await waitDone(request, v.id);
  const c = db();
  await c.execute({ sql: "UPDATE rec_videos SET transcript = ?, summary = ? WHERE id = ?", args: [JSON.stringify([{ start: 0, end: 1, text: '<script>window.__x=1</script> hola' }]), 'Resumen del video', v.id] });
  c.close();
  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Rec ${uid()}`, identifier: `R${uid().slice(0, 3).toUpperCase()}` } }));

  await page.goto(`/en/app/rec/${v.id}`);
  // Video personal: sin confirmar, ni la API lo deja.
  expect((await request.post(`/api/rec/videos/${v.id}/export`, { data: { target: 'doc' } })).status()).toBe(409);
  await page.getByTestId('rec-export-doc').click();
  const widen = page.getByRole('alertdialog').filter({ hasText: 'More people will read this' });
  await widen.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('rec-export-done')).toHaveCount(0);
  await page.getByTestId('rec-export-doc').click();
  await widen.getByRole('button', { name: 'Create anyway' }).click();
  await page.getByTestId('rec-export-link').click();
  await expect(page).toHaveURL(/\/en\/app\/docs\//);
  await expect(page.getByText('Resumen del video')).toBeVisible();
  await expect(page.getByText('hola').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();

  await page.goto(`/en/app/rec/${v.id}`);
  await page.getByTestId('rec-export-project').selectOption(project.id);
  await page.getByTestId('rec-export-issue').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Create anyway' }).click();
  await page.getByTestId('rec-export-link').click();
  await expect(page).toHaveURL(/\/en\/app\/track\/issue/);
  await expect(page.getByText(title).first()).toBeVisible();

  // Sin permiso sobre el video no hay exportación.
  const out = await asPerson(browser, baseURL!, `exp-${uid()}@e2e.dev`);
  expect((await out.request.post(`/api/rec/videos/${v.id}/export`, { data: { target: 'doc', confirmWiden: true } })).status()).toBe(404);
  expect((await out.request.post(`/api/rec/videos/${v.id}/recap`, { data: { emails: ['a@b.io'] } })).status()).toBe(404);
  await out.ctx.close();

  // Resumen por mail.
  const stamp = uid();
  await page.goto(`/en/app/rec/${v.id}`);
  // Afuera del workspace no se manda (ni con la API).
  const blocked = await request.post(`/api/rec/videos/${v.id}/recap`, { data: { emails: ['stranger@spam.example'] } });
  expect(blocked.status()).toBe(403);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { privacy: 'workspace', allowedEmails: [`recap-${stamp}@example.com`] } }));
  await page.reload();
  await page.getByTestId('rec-recap').click();
  const to = `recap-${stamp}@example.com`;
  await page.getByTestId('rec-recap-emails').fill(to);
  await page.getByTestId('rec-recap-send').click();
  await expect(page.getByTestId('rec-recap-msg')).toContainText('Sent to 1 person');
  await page.getByTestId('rec-recap-send').click();
  await expect(page.getByTestId('rec-recap-msg')).toContainText('Nothing was sent');
  const mail = process.env.E2E_MAIL_FILE!;
  await expect.poll(() => (existsSync(mail) ? readFileSync(mail, 'utf8').split(to).length - 1 : 0)).toBe(1);
  const many = Array.from({ length: 21 }, (_, i) => `m${i}@x.io`);
  expect((await request.post(`/api/rec/videos/${v.id}/recap`, { data: { emails: many } })).status()).toBe(400);
});

test('oEmbed y descarga: solo lo abierto se describe; sin descarga no hay botón ni archivo', async ({ request, browser, baseURL }) => {
  const title = `Abierto ${uid()}`;
  const v = await upload(request, tiny, title);
  const ask = (share: string) => `/api/rec/oembed?url=${encodeURIComponent(`${baseURL}/en/v/${share}`)}`;
  const anon = await asPerson(browser, baseURL!, 'session');
  const r = await ok<{ type: string; title: string; html: string }>(anon.request.get(ask(v.shareId)));
  expect(r.type).toBe('video');
  expect(r.title).toBe(title);
  expect(r.html).toContain(`/v/${v.shareId}/embed`);
  const html = await (await anon.request.get(`/en/v/${v.shareId}`)).text();
  expect(html).toContain('application/json+oembed');
  expect(html).toContain('og:title');

  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { privacy: 'workspace' } }));
  expect((await anon.request.get(ask(v.shareId))).status()).toBe(404);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { privacy: 'link', password: 'clave-segura' } }));
  expect((await anon.request.get(ask(v.shareId))).status()).toBe(404);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { password: null, requireEmail: true } }));
  expect((await anon.request.get(ask(v.shareId))).status()).toBe(404);
  await ok(request.patch(`/api/rec/videos/${v.id}`, { data: { requireEmail: false, allowDownload: false } }));
  expect((await anon.request.get(`/api/rec/v/${v.shareId}/file?download=1`)).status()).toBe(403);
  await anon.page.goto(`/en/v/${v.shareId}`);
  await expect(anon.page.getByRole('heading', { name: title })).toBeVisible();
  await expect(anon.page.getByRole('button', { name: 'Download' })).toHaveCount(0);
  await anon.ctx.close();
});

test('traspaso: solo de quien se fue, con confirmación; a quien sigue no se le saca nada', async ({ page, request }) => {
  const v = await upload(request, tiny, `De quien se fue ${uid()}`);
  const c = db();
  const leaver = `rec-left-${uid()}`;
  await c.execute({ sql: "INSERT INTO users (id, email, name) VALUES (?, ?, 'Persona Ida')", args: [leaver, `${leaver}@e2e.dev`] });
  await c.execute({ sql: 'UPDATE rec_videos SET created_by = ? WHERE id = ?', args: [leaver, v.id] });
  const me = (await c.execute({ sql: 'SELECT workspace_id FROM rec_videos WHERE id = ?', args: [v.id] })).rows[0].workspace_id as string;
  c.close();
  // Con la API: la dueña no se puede.
  const self = await request.post('/api/rec/settings/transfer', { data: { from: me, to: leaver } });
  expect(self.status()).toBe(403);

  await page.goto('/en/app/rec/settings');
  const fromSelect = page.getByTestId('rec-transfer-from');
  await expect(fromSelect.locator(`option[value="${leaver}"]`)).toHaveCount(1);
  // Quien sigue en el workspace nunca figura como origen, y la dueña tampoco.
  const owners = await fromSelect.locator('option').evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(owners).not.toContain(me);
  await fromSelect.selectOption(leaver);
  // Destino: quien hace el pase solo se lo puede quedar si no hay nadie más (la API rechaza el resto).
  const toSelect = page.getByTestId('rec-transfer-to');
  await expect(toSelect.locator('option').nth(1)).toBeAttached();
  const targets = await toSelect.locator('option').evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  const { people } = await ok<{ people: Array<{ id: string }> }>(request.get('/api/rec/settings'));
  if (people.some((p) => p.id !== me)) expect(targets).not.toContain(me);
  const receiver = targets[0];
  await toSelect.selectOption(receiver);
  await page.getByTestId('rec-transfer-go').click();
  const dialog = page.getByRole('alertdialog').filter({ hasText: 'Transfer this content?' });
  await expect(dialog).toContainText('1 video');
  if (process.env.REC_SHOTS) {
    for (const [name, w, scheme] of [['dark-390', 390, 'dark'], ['light-390', 390, 'light'], ['dark-1280', 1280, 'dark']] as const) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${process.env.REC_SHOTS}/transfer-${name}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await dialog.getByRole('button', { name: 'Transfer' }).click();
  await expect(page.getByTestId('rec-settings-toast')).toContainText('Transferred 1 video');
  // Directo en la base: un video personal pasa a ser de quien lo recibe, y si es otra persona la API ya no se lo da a la dueña.
  const after = db();
  const owner = (await after.execute({ sql: 'SELECT created_by FROM rec_videos WHERE id = ?', args: [v.id] })).rows[0].created_by;
  after.close();
  expect(owner).toBe(receiver);
});
