import { expect, test, type Page } from '@playwright/test';

/**
 * Rec: captura de pantalla real de punta a punta (Chromium comparte la pantalla
 * sin diálogo con los flags de abajo): grabar solo pantalla, parar, subir, y ver
 * el video con imagen, con duración y que se pueda adelantar, primero el
 * original (WebM con índice) y después el MP4 de reproducción.
 */

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-desktop-capture-source=Entire screen'],
  },
  permissions: ['camera', 'microphone'],
});

type Probe = { duration: number; seekable: number; seeked: boolean; luma: number[] };

/** Abre `src` en un <video> aparte: duración, hasta dónde se puede adelantar, si adelanta al final y la luz de unos cuadros. */
async function probe(page: Page, src: string, at: number[]): Promise<Probe> {
  return page.evaluate(
    async ({ src, at }) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = src;
      await new Promise((ok, fail) => {
        v.onloadeddata = ok;
        v.onerror = () => fail(new Error('video error'));
      });
      const seekTo = (t: number) =>
        new Promise<boolean>((ok) => {
          const timer = setTimeout(() => ok(false), 10_000);
          v.onseeked = () => {
            clearTimeout(timer);
            ok(true);
          };
          v.currentTime = t;
        });
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 36;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      const luma: number[] = [];
      for (const t of at) {
        await seekTo(t);
        g.drawImage(v, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        luma.push(Math.round(sum / (d.length / 4)));
      }
      const duration = v.duration;
      const seekable = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
      const seeked = Number.isFinite(duration) && (await seekTo(Math.max(0, duration - 0.4))) && v.currentTime > duration / 2;
      return { duration, seekable, seeked, luma };
    },
    { src, at },
  );
}

test('pantalla de verdad: grabar, parar, subir y ver con imagen, duración y adelantar (WebM y MP4)', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/rec/new', { waitUntil: 'networkidle' });
  const screenOnly = page.locator('input[name="rec-mode"][value="screen"]');
  await page.locator('label').filter({ has: screenOnly }).click();
  await expect(screenOnly).toBeChecked();
  await page.getByTestId('rec-start').click();
  const failed = page.getByTestId('rec-recorder').getByRole('alert');
  const started = page.getByTestId('rec-countdown');
  await expect(failed.or(started).first()).toBeVisible({ timeout: 10_000 });
  test.skip(await failed.isVisible(), 'Este Chromium no comparte pantalla sin interacción');
  // Tras la cuenta regresiva arranca cuando el servidor creó el video (la primera vez, en dev, compila la ruta).
  await expect(page.getByTestId('rec-time')).toBeVisible({ timeout: 20_000 });
  // Unos segundos grabando: el aviso de pantalla negra no aparece.
  await page.waitForTimeout(4500);
  await expect(page.getByTestId('rec-black-warning')).toHaveCount(0);
  await page.getByTestId('rec-stop').click();

  // Termina de subir y abre el detalle (en dev, la primera vez compila finalize y la página).
  await expect(page).toHaveURL(/\/en\/app\/rec\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const id = /rec\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByTestId('rec-player')).toBeVisible();

  // Lo que quedó guardado: modo pantalla, listo y con la duración de lo grabado.
  const meta = async () => (await (await page.request.get(`/api/rec/videos/${id}`)).json()).video as { mode: string; status: string; durationSec: number; playVer: string };
  const saved = await meta();
  expect(saved.mode).toBe('screen');
  expect(saved.durationSec).toBeGreaterThan(3);
  expect(saved.durationSec).toBeLessThan(12);

  // El original: imagen (no negro), duración del header y se adelanta hasta el final.
  const webm = await probe(page, `/api/rec/videos/${id}/file?kind=play`, [0.3, 2]);
  for (const l of webm.luma) expect(l, `luz del WebM: ${webm.luma.join(', ')}`).toBeGreaterThan(20);
  expect(Number.isFinite(webm.duration)).toBe(true);
  expect(Math.abs(webm.duration - saved.durationSec)).toBeLessThan(1.5);
  expect(webm.seekable).toBeGreaterThan(webm.duration - 1);
  expect(webm.seeked).toBe(true);

  // El MP4 de reproducción (ffmpeg local en dev y CI) muestra lo mismo.
  await expect.poll(async () => (await meta()).playVer, { timeout: 60_000 }).not.toBe('');
  const { playVer } = await meta();
  const mp4 = await probe(page, `/api/rec/videos/${id}/file?kind=play&v=${playVer}`, [0.3, 2]);
  for (const l of mp4.luma) expect(l, `luz del MP4: ${mp4.luma.join(', ')}`).toBeGreaterThan(20);
  expect(Math.abs(mp4.duration - saved.durationSec)).toBeLessThan(1.5);
  expect(mp4.seeked).toBe(true);

  // El reproductor de la página pasa al MP4 y adelanta.
  await page.reload();
  await expect(page.getByTestId('rec-video')).toHaveAttribute('src', new RegExp(`v=${playVer}`));
  const seeked = await page.getByTestId('rec-video').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<boolean>((done) => {
        const go = () => {
          v.onseeked = () => done(true);
          v.currentTime = Math.max(0, v.duration - 0.5);
        };
        if (v.readyState >= 1) go();
        else v.onloadedmetadata = go;
        setTimeout(() => done(false), 10_000);
      }),
  );
  expect(seeked).toBe(true);

  // A 390 px el detalle entra sin scroll de costado.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('rec-player')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
