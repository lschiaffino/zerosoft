import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Rec: quitar una reacción. La marca de la línea de tiempo abre un cuadro con
 * quién reaccionó, el segundo y "Quitar reacción" (la propia, o cualquiera si
 * se administra el video); debajo del video, "Tus reacciones" lista las
 * propias con su ×. El cuadro se cierra afuera, con Esc y al actuar, no se
 * va al pasar el mouse por encima y no ensancha la página en el teléfono.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

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

async function uploadVideo(request: APIRequestContext, body: Buffer, title: string): Promise<{ id: string; shareId: string }> {
  const { video } = await ok<{ video: { id: string; shareId: string } }>(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm' } }));
  const put = await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: body, headers: { 'content-type': 'application/octet-stream' } });
  expect(put.status()).toBe(204);
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 2 } }));
  await ok(request.patch(`/api/rec/videos/${video.id}`, { data: { title, privacy: 'link' } }));
  return video;
}

/** Reacción de otra persona (sin cuenta), directo en la base: la interfaz no deja reaccionar por otro. */
async function seedGuestReaction(videoId: string, emoji: string, atSec: number, name: string): Promise<string> {
  const c = e2eDb();
  const id = crypto.randomUUID();
  await c.execute({
    sql: `INSERT INTO rec_comments (id, video_id, workspace_id, parent_id, kind, body, emoji, at_sec, user_id, author_name, viewer_key)
          SELECT ?, id, workspace_id, NULL, 'reaction', '', ?, ?, NULL, ?, ? FROM rec_videos WHERE id = ?`,
    args: [id, emoji, atSec, name, `a:seed-${uid()}${uid()}${uid()}`, videoId],
  });
  c.close();
  return id;
}

async function reactionRows(videoId: string): Promise<number> {
  const c = e2eDb();
  const n = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM rec_comments WHERE video_id = ? AND kind = 'reaction'", args: [videoId] })).rows[0].n);
  c.close();
  return n;
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** El cuadro entra entero en la pantalla y no agrega scroll horizontal. */
async function expectPopInView(page: Page, width: number) {
  const box = (await page.getByTestId('rec-mark-pop').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
}

async function asAnonymous(browser: Browser, baseURL: string, width: number, scheme: 'light' | 'dark') {
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 800 }, colorScheme: scheme });
  // zs_e2e_as=session: sin sesión (lib/session.ts), o sea alguien de afuera sin cuenta.
  await ctx.addCookies([{ name: 'zs_e2e_as', value: 'session', url: baseURL }]);
  return { ctx, page: await ctx.newPage(), request: ctx.request };
}

for (const [width, scheme] of [
  [1280, 'light'],
  [390, 'dark'],
] as const) {
  test.describe(`quitar reacciones a ${width} px (${scheme})`, () => {
    test.use({ viewport: { width, height: 800 }, colorScheme: scheme });

    test('en la app: la marca abre el cuadro, se cierra afuera y con Esc, y quita la propia y la ajena', async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
      const video = await uploadVideo(page.request, await makeWebm(page), `Remove reaction ${uid()}`);
      // Una propia cerca del borde izquierdo y una de alguien sin cuenta cerca del derecho.
      await ok(page.request.post(`/api/rec/v/${video.shareId}/comments`, { data: { kind: 'reaction', emoji: '❤️', atSec: 0.2 } }));
      await seedGuestReaction(video.id, '🎉', 1.8, 'Guest Tester');
      await page.goto(`/en/app/rec/${video.id}`);
      const player = page.getByTestId('rec-player');
      const markers = player.locator('.rec-marker.emoji');
      await expect(markers).toHaveCount(2);
      const mine = markers.filter({ hasText: '❤️' });
      const theirs = markers.filter({ hasText: '🎉' });
      const pop = page.getByTestId('rec-mark-pop');
      const heart = page.getByRole('button', { name: 'React with ❤️' });
      const myList = page.getByTestId('rec-my-reactions');

      // Lo ya usado se ve marcado y aparece en "Tus reacciones".
      await expect(heart).toHaveAttribute('data-mine', 'true');
      await expect(heart).toContainText('1');
      await expect(page.getByRole('button', { name: 'React with 🎉' })).not.toHaveAttribute('data-mine', 'true');
      await expect(myList.getByTestId('rec-my-reaction')).toHaveCount(1);

      // Clic en la marca: lleva al segundo y abre el cuadro, sin salirse de la pantalla.
      await theirs.click();
      await expect(pop).toBeVisible();
      await expect(pop).toContainText('Guest Tester');
      await expect(theirs).toHaveAttribute('aria-expanded', 'true');
      await expect(player.locator('.rec-player-time')).toHaveText(/^0:01/);
      await expectPopInView(page, width);
      // No se va al pasar el mouse de la marca al cuadro ni al botón.
      await pop.hover();
      await expect(pop).toBeVisible();
      await page.getByTestId('rec-mark-remove').hover();
      await expect(pop).toBeVisible();
      // Esc lo cierra.
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);

      // Otra marca cambia el cuadro; un clic afuera lo cierra.
      await theirs.click();
      await mine.click();
      await expect(pop).toHaveCount(1);
      await expect(pop).not.toContainText('Guest Tester');
      await expectPopInView(page, width);
      await page.locator('.rec-my-label').click();
      await expect(pop).toHaveCount(0);
      // Un segundo clic en la misma marca también lo cierra.
      await mine.click();
      await expect(pop).toBeVisible();
      await mine.click();
      await expect(pop).toHaveCount(0);

      // Teclado: Enter en la marca abre el cuadro con el foco en "Quitar reacción"; Esc devuelve el foco a la marca.
      await mine.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('rec-mark-remove')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
      await expect(mine).toBeFocused();
      // Flechas: de una marca a la otra, sin mover el video de más.
      await page.keyboard.press('ArrowRight');
      await expect(theirs).toBeFocused();

      // Quitar la propia: se va la marca, la cuenta y la lista; el cuadro se cierra.
      await mine.click();
      await page.getByTestId('rec-mark-remove').click();
      await expect(pop).toHaveCount(0);
      await expect(markers).toHaveCount(1);
      await expect(heart).not.toHaveAttribute('data-mine', 'true');
      await expect(heart).not.toContainText('1');
      await expect(myList).toHaveCount(0);
      await expect.poll(() => reactionRows(video.id)).toBe(1);

      // Quien administra el video quita la de otra persona.
      await theirs.click();
      await expect(pop).toContainText('Guest Tester');
      await page.getByTestId('rec-mark-remove').click();
      await expect(markers).toHaveCount(0);
      await expect.poll(() => reactionRows(video.id)).toBe(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test('debajo del video: varias reacciones del mismo emoji, quitar una desde "Tus reacciones" y volver atrás si falla', async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
      const video = await uploadVideo(page.request, await makeWebm(page), `Reaction list ${uid()}`);
      await page.goto(`/en/app/rec/${video.id}`);
      const clap = page.getByRole('button', { name: 'React with 👏' });
      const items = page.getByTestId('rec-my-reaction');
      const markers = page.getByTestId('rec-player').locator('.rec-marker.emoji');
      // Con los comentarios ya cargados (antes de eso la página todavía no sabe quién mira).
      await expect(page.locator('.rec-comments-empty')).toBeVisible();
      // Otro clic en un emoji ya usado suma otra reacción (como Loom): no la quita.
      await clap.click();
      await expect(items).toHaveCount(1);
      await clap.click();
      await expect(items).toHaveCount(2);
      await expect(clap).toContainText('2');
      await expect(clap).toHaveAttribute('data-mine', 'true');
      await expect(markers).toHaveCount(2);

      // Si el servidor falla, la reacción vuelve con un aviso.
      await page.route('**/api/rec/v/*/comments/*', (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
      await items.first().getByRole('button', { name: /^Remove your 👏/ }).click();
      await expect(page.getByTestId('rec-react-error')).toBeVisible();
      await expect(items).toHaveCount(2);
      await expect(clap).toContainText('2');
      await expect(markers).toHaveCount(2);
      expect(await reactionRows(video.id)).toBe(2);
      await page.unroute('**/api/rec/v/*/comments/*');

      // Ahora sí: se quita una y queda la otra; el aviso se va.
      await items.first().getByRole('button', { name: /^Remove your 👏/ }).click();
      await expect(items).toHaveCount(1);
      await expect(page.getByTestId('rec-react-error')).toHaveCount(0);
      await expect(clap).toContainText('1');
      await expect(markers).toHaveCount(1);
      await expect.poll(() => reactionRows(video.id)).toBe(1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test('página pública sin cuenta: cada quien quita solo la suya', async ({ page, browser, baseURL }) => {
      test.setTimeout(120_000);
      await page.goto('/en/app/rec', { waitUntil: 'networkidle' });
      const video = await uploadVideo(page.request, await makeWebm(page), `Guest reaction ${uid()}`);
      // La autora reaccionó en el borde derecho.
      await ok(page.request.post(`/api/rec/v/${video.shareId}/comments`, { data: { kind: 'reaction', emoji: '🎉', atSec: 1.8 } }));

      const guest = await asAnonymous(browser, baseURL!, width, scheme);
      await guest.page.goto(`/en/v/${video.shareId}`);
      await expect(guest.page.getByTestId('rec-watch')).toBeVisible();
      const markers = guest.page.getByTestId('rec-player').locator('.rec-marker.emoji');
      const pop = guest.page.getByTestId('rec-mark-pop');
      await expect(markers).toHaveCount(1);
      await guest.page.getByLabel('Your name').fill('Guest Tester');
      await guest.page.getByRole('button', { name: 'React with ❤️' }).click();
      await expect(markers).toHaveCount(2);
      await expect(guest.page.getByTestId('rec-my-reaction')).toHaveCount(1);

      // La de la autora se ve, pero no se puede quitar.
      await markers.filter({ hasText: '🎉' }).click();
      await expect(pop).toBeVisible();
      await expect(guest.page.getByTestId('rec-mark-remove')).toHaveCount(0);
      await expectPopInView(guest.page, width);
      await guest.page.getByLabel('Your name').click();
      await expect(pop).toHaveCount(0);

      // Otra persona sin cuenta ve la de la invitada sin "Quitar", y la API se lo niega.
      const other = await asAnonymous(browser, baseURL!, width, scheme);
      await other.page.goto(`/en/v/${video.shareId}`);
      const otherMarkers = other.page.getByTestId('rec-player').locator('.rec-marker.emoji');
      await expect(otherMarkers).toHaveCount(2);
      await expect(other.page.getByTestId('rec-my-reactions')).toHaveCount(0);
      await otherMarkers.filter({ hasText: '❤️' }).click();
      await expect(other.page.getByTestId('rec-mark-pop')).toContainText('Guest Tester');
      await expect(other.page.getByTestId('rec-mark-remove')).toHaveCount(0);
      const c = e2eDb();
      const heartId = String((await c.execute({ sql: "SELECT id FROM rec_comments WHERE video_id = ? AND emoji = '❤️'", args: [video.id] })).rows[0].id);
      c.close();
      expect((await other.request.delete(`/api/rec/v/${video.shareId}/comments/${heartId}`)).status()).toBe(403);
      expect(await reactionRows(video.id)).toBe(2);
      await other.ctx.close();

      // La invitada quita la suya desde la marca.
      await markers.filter({ hasText: '❤️' }).click();
      await expect(pop).toContainText('Guest Tester');
      await guest.page.getByTestId('rec-mark-remove').click();
      await expect(pop).toHaveCount(0);
      await expect(markers).toHaveCount(1);
      await expect(guest.page.getByTestId('rec-my-reactions')).toHaveCount(0);
      await expect.poll(() => reactionRows(video.id)).toBe(1);
      expect(await overflow(guest.page)).toBeLessThanOrEqual(0);
      await guest.ctx.close();
    });
  });
}
