import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Rec: la retención manda los videos vencidos a la papelera (lib/rec-trash.ts) en vez de borrarlos. El cron
 * de cada minuto (processPendingRec) los saca de la app; en Ajustes se ve la papelera (título y cuándo se borra para siempre) y Restaurar
 * devuelve el video. Se ve bien en los cinco aspectos, claro y oscuro, a 1280 y 390 sin scroll de costado.
 */

test.describe.configure({ mode: 'serial' });

const uid = () => Math.random().toString(36).slice(2, 8);
const CRON = { authorization: 'Bearer e2e-cron' };
const tiny = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);

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

async function upload(request: APIRequestContext, title: string): Promise<string> {
  const { video } = await ok<{ video: { id: string } }>(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm' } }));
  const put = await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: tiny, headers: { 'content-type': 'application/octet-stream' } });
  expect(put.status()).toBe(204);
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 2 } }));
  return video.id;
}

/**
 * Retención de 365 días ya pasado el aviso y un video de hace 350 días: entra en la gracia (30 días antes del
 * plazo). Nada más del workspace demo tiene esa edad.
 */
async function trashedVideo(request: APIRequestContext) {
  await ok(request.patch('/api/rec/settings', { data: { retentionDays: 365 } }));
  const title = `Retention ${uid()}`;
  const id = await upload(request, title);
  await sql("UPDATE rec_videos SET created_at = datetime('now', '-350 days') WHERE id = ?", [id]);
  const ws = String((await sql('SELECT workspace_id FROM rec_videos WHERE id = ?', [id]))[0].workspace_id);
  await sql("UPDATE rec_settings SET retention_starts_at = datetime('now', '-1 hour'), retention_checked_at = NULL WHERE workspace_id = ?", [ws]);
  expect((await request.get('/api/cron/minute', { headers: CRON, timeout: 120_000 })).ok()).toBe(true);
  const entry = await sql("SELECT id FROM soft_deleted WHERE app = 'rec' AND record_id = ?", [id]);
  expect(entry).toHaveLength(1);
  return { id, title, ws, entryId: String(entry[0].id) };
}

async function openSettings(page: Page) {
  await page.goto('/en/app/rec/settings', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('rec-trash')).toBeVisible();
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.afterAll(async ({ request }) => {
  // El workspace demo es compartido: sin retención, como estaba.
  await request.patch('/api/rec/settings', { data: { retentionDays: null } });
});

test('Rec: la retención manda a la papelera, se ve en Ajustes y se restaura', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { id, ws, entryId } = await trashedVideo(request);
  expect(await sql('SELECT 1 FROM rec_videos WHERE id = ?', [id])).toHaveLength(0);
  expect((await request.get(`/api/rec/videos/${id}`)).status()).toBe(404);

  await page.setViewportSize({ width: 1280, height: 900 });
  await openSettings(page);
  const item = page.locator(`[data-testid="rec-trash-item"][data-entry="${entryId}"]`);
  await expect(item).toHaveCount(1);
  await item.getByTestId('rec-trash-restore').click();
  await expect(item).toHaveCount(0);
  await expect(page.getByTestId('rec-settings-toast')).toBeVisible();
  expect((await request.get(`/api/rec/videos/${id}`)).ok()).toBe(true);

  // La corrida siguiente no lo vuelve a sacar: el plazo cuenta desde la restauración.
  await sql('UPDATE rec_settings SET retention_checked_at = NULL WHERE workspace_id = ?', [ws]);
  expect((await request.get('/api/cron/minute', { headers: CRON, timeout: 120_000 })).ok()).toBe(true);
  expect(await sql('SELECT 1 FROM rec_videos WHERE id = ?', [id])).toHaveLength(1);
  // Una entrada que ya no está: 404.
  expect((await request.post('/api/rec/trash', { data: { entryId } })).status()).toBe(404);
  await ok(request.delete(`/api/rec/videos/${id}`));
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Rec: la papelera en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(240_000);
  const { entryId } = await trashedVideo(request);
  try {
    for (const look of LOOKS) {
      await setLook(request, look);
      for (const [theme, width] of [
        ['light', 1280],
        ['dark', 390],
      ] as const) {
        const context = await browser.newContext({ baseURL });
        await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setViewportSize({ width, height: 900 });
        await openSettings(page);
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const item = page.locator(`[data-testid="rec-trash-item"][data-entry="${entryId}"]`);
        await expect(item).toHaveCount(1);
        const restore = item.getByTestId('rec-trash-restore');
        await expect(restore).toBeVisible();
        const [row, btn] = await Promise.all([item.boundingBox(), restore.boundingBox()]);
        expect(btn!.x + btn!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
        expect(row!.x + row!.width).toBeLessThanOrEqual(width);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await page.getByTestId('rec-trash').scrollIntoViewIfNeeded();
        await info.attach(`rec-trash-${look}-${theme}-${width}`, { body: await page.getByTestId('rec-trash').screenshot(), contentType: 'image/png' });
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});
