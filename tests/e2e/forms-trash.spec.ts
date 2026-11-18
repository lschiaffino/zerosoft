import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Forms: la retención manda las respuestas a la papelera (lib/forms/trash.ts) en vez de borrarlas. El cron
 * horario saca lo que entra en la gracia y purga lo vencido; en Ajustes del form se ve la papelera (fecha y
 * cuándo se borra para siempre, sin contenido) y se restaura. Se ve bien en los cinco aspectos, claro y
 * oscuro, a 1280 y 390 sin scroll de costado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Form publicado con retención de 90 días y tres respuestas: vencida, en la gracia y reciente. */
async function formWithOldResponses(request: APIRequestContext) {
  const created = await request.post('/api/forms', { data: { name: `Retention ${uid()}`, template: 'contact' } });
  expect(created.ok()).toBe(true);
  const { form } = (await created.json()) as { form: { id: string } };
  expect((await request.patch(`/api/forms/${form.id}`, { data: { status: 'published', settings: { retentionDays: 90 } } })).ok()).toBe(true);
  const ws = String((await sql('SELECT workspace_id FROM forms_forms WHERE id = ?', [form.id]))[0].workspace_id);
  const ids: Record<'overdue' | 'grace' | 'fresh', string> = { overdue: `fmr_${uid()}${uid()}`, grace: `fmr_${uid()}${uid()}`, fresh: `fmr_${uid()}${uid()}` };
  const age = { overdue: 100, grace: 70, fresh: 10 };
  for (const k of ['overdue', 'grace', 'fresh'] as const) {
    const at = new Date(Date.now() - age[k] * DAY).toISOString();
    await sql(
      `INSERT INTO forms_responses (id, form_id, workspace_id, status, answers, lang, created_at, updated_at, submitted_at)
       VALUES (?, ?, ?, 'completed', ?, 'en', ?, ?, ?)`,
      [ids[k], form.id, ws, JSON.stringify({ q_name: 'E2E', q_email: 'e2e@example.com', q_message: 'hi' }), at, at, at],
    );
  }
  await sql('UPDATE forms_forms SET response_count = response_count + 3 WHERE id = ?', [form.id]);
  const tick = await request.get('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron' } });
  expect(tick.ok()).toBe(true);
  return { formId: form.id, ids };
}

async function openSettings(page: Page, formId: string) {
  await page.goto(`/en/app/forms/${formId}`, { waitUntil: 'networkidle' });
  await page.locator('#fm-tab-settings').click();
  await expect(page.getByTestId('forms-trash')).toBeVisible();
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Forms: la retención manda a la papelera, se ve en Ajustes y se restaura', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { formId, ids } = await formWithOldResponses(request);

  // La vencida se purgó en el mismo tick; la de la gracia está en la papelera; la reciente sigue.
  const left = (await sql('SELECT id FROM forms_responses WHERE form_id = ? ORDER BY id', [formId])).map((r) => String(r.id));
  expect(left).toEqual([ids.fresh]);
  const trashed = await sql("SELECT record_id FROM soft_deleted WHERE app = 'forms' AND scope_id = ?", [formId]);
  expect(trashed.map((r) => String(r.record_id))).toEqual([ids.grace]);

  await page.setViewportSize({ width: 1280, height: 900 });
  await openSettings(page, formId);
  const items = page.getByTestId('forms-trash-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute('data-kind', 'response');

  // Restaurar: sale de la papelera, vuelve a la lista de respuestas.
  await items.first().getByTestId('forms-trash-restore').click();
  await expect(page.getByTestId('forms-trash-notice')).toHaveAttribute('role', 'status');
  await expect(items).toHaveCount(0);
  await expect(page.getByTestId('forms-trash-empty')).toBeVisible();
  const back = (await sql('SELECT id FROM forms_responses WHERE form_id = ? ORDER BY id', [formId])).map((r) => String(r.id));
  expect(back.sort()).toEqual([ids.fresh, ids.grace].sort());

  // El cron siguiente no la vuelve a sacar: la retención cuenta desde que se restauró.
  expect((await request.get('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron' } })).ok()).toBe(true);
  expect(await sql('SELECT 1 FROM forms_responses WHERE id = ?', [ids.grace])).toHaveLength(1);
  // Una entrada que no está en la papelera de este form: 404.
  expect((await request.post(`/api/forms/${formId}/trash`, { data: { entryId: 'sdel_nope' } })).status()).toBe(404);
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

/** El aspecto es de la cuenta (users.ui_look manda sobre la cookie zs_look); el usuario demo es compartido. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Forms: la papelera en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(240_000);
  const { formId } = await formWithOldResponses(request);
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
        await openSettings(page, formId);
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        const item = page.getByTestId('forms-trash-item');
        await expect(item).toHaveCount(1);
        const restore = item.getByTestId('forms-trash-restore');
        await expect(restore).toBeVisible();
        // El botón entra entero en la fila y la fila en la pantalla.
        const [row, btn] = await Promise.all([item.boundingBox(), restore.boundingBox()]);
        expect(btn!.x + btn!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
        expect(row!.x + row!.width).toBeLessThanOrEqual(width);
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await page.getByTestId('forms-trash').scrollIntoViewIfNeeded();
        await info.attach(`trash-${look}-${theme}-${width}`, { body: await page.getByTestId('forms-trash').screenshot(), contentType: 'image/png' });
        expect(errors).toEqual([]);
        await context.close();
      }
    }
  } finally {
    await setLook(request, 'current');
  }
});
