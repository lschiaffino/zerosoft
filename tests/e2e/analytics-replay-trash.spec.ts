import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * Pulse: la retención de replay manda las grabaciones a la papelera (lib/analytics/trash.ts) en vez de
 * borrarlas. El cron horario saca lo que entra en la gracia; en Ajustes del proyecto se ve la papelera (cuándo
 * empezó y cuándo se borra para siempre, nada de la persona) y se restaura. Se ve bien en los cinco aspectos,
 * claro y oscuro, a 1280 y 390 sin scroll de costado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;

async function sql(statement: string, args: Array<string | number | null | Uint8Array> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Proyecto con una grabación de hace 25 días (replay guarda 30: está en la gracia) y otra reciente. */
async function projectWithOldRecording(request: APIRequestContext) {
  const created = await request.post('/api/analytics/projects', { data: { name: `Trash ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { project } = (await created.json()) as { project: { id: string } };
  const ids = { old: `ar_e2e_old_${uid()}${uid()}`, fresh: `ar_e2e_fresh_${uid()}${uid()}` };
  const age = { old: 25, fresh: 2 };
  for (const k of ['old', 'fresh'] as const) {
    const end = Date.now() - age[k] * DAY;
    await sql(
      `INSERT INTO analytics_replay_recordings (id, project_id, session_id, window_id, distinct_id, start_ts, end_ts, has_snapshot, chunks, bytes, raw_bytes, created_at)
       VALUES (?, ?, ?, 'w1', 'e2e-visitor', ?, ?, 1, 1, 4, 4, ?)`,
      [ids[k], project.id, `s-${ids[k]}`, end - 60_000, end, end],
    );
    await sql(
      `INSERT INTO analytics_replay_chunks (recording_id, project_id, session_id, seq, bytes, raw_bytes, data, created_at) VALUES (?, ?, ?, 0, 4, 4, ?, ?)`,
      [ids[k], project.id, `s-${ids[k]}`, new Uint8Array([1, 2, 3, 4]), end],
    );
  }
  // La retención de replay corre una vez por hora por proyecto: este es nuevo, entra en el tick.
  const tick = await request.get('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron' } });
  expect(tick.ok()).toBe(true);
  return { projectId: project.id, ids };
}

async function openSettings(page: Page, context: BrowserContext, baseURL: string, projectId: string) {
  await context.addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
  await page.goto('/en/app/pulse/settings', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-replay-trash')).toBeVisible();
  // La papelera se carga aparte (la primera vez, con la ruta recién compilada en dev, tarda más).
  await expect(page.getByTestId('an-replay-trash-loading')).toHaveCount(0, { timeout: 30_000 });
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Pulse: la retención de replay manda a la papelera, se ve en Ajustes y se restaura', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const { projectId, ids } = await projectWithOldRecording(request);

  // La vieja está en la papelera (con sus chunks guardados); la reciente sigue.
  const left = (await sql('SELECT id FROM analytics_replay_recordings WHERE project_id = ?', [projectId])).map((r) => String(r.id));
  expect(left).toEqual([ids.fresh]);
  const trashed = await sql("SELECT record_id, label FROM soft_deleted WHERE app = 'analytics' AND scope_id = ?", [projectId]);
  expect(trashed.map((r) => String(r.record_id))).toEqual([ids.old]);
  // La etiqueta es solo la fecha: nada de la persona.
  expect(String(trashed[0].label)).not.toContain('e2e-visitor');
  expect(await sql('SELECT 1 FROM analytics_replay_chunks WHERE recording_id = ?', [ids.old])).toHaveLength(1);
  // No se puede abrir mientras está en la papelera.
  expect((await request.get(`/api/analytics/replay/${ids.old}`)).status()).toBe(404);

  await page.setViewportSize({ width: 1280, height: 900 });
  await openSettings(page, page.context(), baseURL!, projectId);
  const items = page.getByTestId('an-replay-trash-item');
  await expect(items).toHaveCount(1);

  // Restaurar: sale de la papelera y vuelve a la lista de grabaciones.
  const restored = page.waitForResponse((r) => r.url().endsWith(`/api/analytics/projects/${projectId}/trash`) && r.request().method() === 'POST', { timeout: 60_000 });
  await items.first().getByTestId('an-replay-trash-restore').click();
  expect((await restored).ok()).toBe(true);
  await expect(page.getByTestId('an-replay-trash-notice')).toHaveAttribute('role', 'status');
  await expect(items).toHaveCount(0);
  await expect(page.getByTestId('an-replay-trash-empty')).toBeVisible();
  const list = (await (await request.get(`/api/analytics/replay?project=${projectId}`)).json()) as { recordings: Array<{ id: string }> };
  expect(list.recordings.map((r) => r.id).sort()).toEqual([ids.fresh, ids.old].sort());
  expect((await request.get(`/api/analytics/replay/${ids.old}`)).ok()).toBe(true);

  // Una entrada que no está en la papelera de este proyecto: 404.
  expect((await request.post(`/api/analytics/projects/${projectId}/trash`, { data: { entryId: 'sdel_nope' } })).status()).toBe(404);
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Pulse: la papelera de grabaciones en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(240_000);
  const { projectId } = await projectWithOldRecording(request);
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
        await openSettings(page, context, baseURL!, projectId);
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        const item = page.getByTestId('an-replay-trash-item');
        await expect(item).toHaveCount(1);
        const restore = item.getByTestId('an-replay-trash-restore');
        await expect(restore).toBeVisible();
        // El botón entra entero en la fila y la fila en la pantalla.
        const [row, btn] = await Promise.all([item.boundingBox(), restore.boundingBox()]);
        expect(btn!.x + btn!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
        expect(row!.x + row!.width).toBeLessThanOrEqual(width);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await page.getByTestId('an-replay-trash').scrollIntoViewIfNeeded();
        await info.attach(`replay-trash-${look}-${theme}-${width}`, { body: await page.getByTestId('an-replay-trash').screenshot(), contentType: 'image/png' });
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});
