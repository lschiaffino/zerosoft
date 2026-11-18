import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Hiring: la retención manda a los candidatos inactivos a la papelera (lib/hiring/trash.ts) en vez de borrarlos.
 * El cron horario los saca de la app; en Ajustes un admin ve la papelera (nombre y cuándo se borra para siempre)
 * y restaura al candidato con su postulación. Se ve bien en los cinco aspectos, claro y oscuro, a 1280 y 390 sin
 * scroll de costado.
 */

test.describe.configure({ mode: 'serial' });

const uid = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;
const CRON = { authorization: 'Bearer e2e-cron' };

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function setRetention(request: APIRequestContext, months: number) {
  const res = await request.put('/api/hiring/settings', { data: { retentionMonths: months } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Candidato cargado a mano, sin actividad hace 160 días: con 6 meses de retención entra en la gracia. */
async function staleCandidate(request: APIRequestContext) {
  const job = await request.post('/api/hiring/jobs', { data: { title: `Retention ${uid()}` } });
  expect(job.ok(), await job.text()).toBe(true);
  const { job: j } = (await job.json()) as { job: { id: string } };
  const name = `Retention ${uid()}`;
  const added = await request.post('/api/hiring/applications', { data: { jobId: j.id, name, email: `ret-${uid()}@example.com` } });
  expect(added.ok(), await added.text()).toBe(true);
  const { candidateId } = (await added.json()) as { candidateId: string };
  await sql('UPDATE hiring_candidates SET last_activity_at = ? WHERE id = ?', [new Date(Date.now() - 160 * DAY).toISOString(), candidateId]);
  expect((await request.get('/api/cron/tick', { headers: CRON })).ok()).toBe(true);
  const entry = await sql("SELECT id FROM soft_deleted WHERE app = 'hiring' AND record_id = ?", [candidateId]);
  expect(entry).toHaveLength(1);
  return { candidateId, entryId: String(entry[0].id), name };
}

async function openSettings(page: Page) {
  await page.goto('/en/app/hiring/settings', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('hiring-trash')).toBeVisible();
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.afterAll(async ({ request }) => {
  // El workspace demo es compartido: sin retención, como estaba.
  await setRetention(request, 0);
});

test('Hiring: la retención manda a la papelera, se ve en Ajustes y se restaura', async ({ page, request }) => {
  test.setTimeout(120_000);
  await setRetention(request, 6);
  const { candidateId, entryId } = await staleCandidate(request);
  expect(await sql('SELECT 1 FROM hiring_candidates WHERE id = ?', [candidateId])).toHaveLength(0);
  // Fuera de la app: el perfil ya no está.
  expect((await request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(404);

  await page.setViewportSize({ width: 1280, height: 900 });
  await openSettings(page);
  const item = page.locator(`[data-testid="hiring-trash-item"][data-entry="${entryId}"]`);
  await expect(item).toHaveCount(1);
  await item.getByTestId('hiring-trash-restore').click();
  await expect(item).toHaveCount(0);
  expect(await sql('SELECT 1 FROM hiring_candidates WHERE id = ?', [candidateId])).toHaveLength(1);
  expect((await request.get(`/api/hiring/candidates/${candidateId}`)).ok()).toBe(true);

  // El cron siguiente no lo vuelve a sacar: restaurar cuenta como actividad.
  expect((await request.get('/api/cron/tick', { headers: CRON })).ok()).toBe(true);
  expect(await sql('SELECT 1 FROM hiring_candidates WHERE id = ?', [candidateId])).toHaveLength(1);
  // Una entrada que ya no está: 404.
  expect((await request.post('/api/hiring/trash', { data: { entryId } })).status()).toBe(404);
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Hiring: la papelera en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(240_000);
  await setRetention(request, 6);
  const { entryId } = await staleCandidate(request);
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
        const item = page.locator(`[data-testid="hiring-trash-item"][data-entry="${entryId}"]`);
        await expect(item).toHaveCount(1);
        const restore = item.getByTestId('hiring-trash-restore');
        await expect(restore).toBeVisible();
        // El botón entra entero en la fila y la fila en la pantalla.
        const [row, btn] = await Promise.all([item.boundingBox(), restore.boundingBox()]);
        expect(btn!.x + btn!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
        expect(row!.x + row!.width).toBeLessThanOrEqual(width);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await page.getByTestId('hiring-trash').scrollIntoViewIfNeeded();
        await info.attach(`hiring-trash-${look}-${theme}-${width}`, { body: await page.getByTestId('hiring-trash').screenshot(), contentType: 'image/png' });
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});
