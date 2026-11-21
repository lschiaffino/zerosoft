import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Time: aprobación de horas por semana, como en Harvest. Una persona del
 * workspace demo (cookie zs_e2e_as) envía su semana: la hoja queda trabada.
 * La persona demo, que administra, la devuelve con una nota desde
 * Aprobaciones; la persona la corrige, la vuelve a enviar y se aprueba.
 * Sin textos visibles en los selectores: testids, roles y atributos data-*.
 */
test.setTimeout(150_000);

const uid = () => Math.random().toString(36).slice(2, 8);
const WEEK = '2026-10-05';

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Otra persona del workspace demo con todas las apps. */
async function member(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `time-appr-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  await p.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  let team = (await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0]?.id as string | undefined;
  if (!team) {
    team = `team-${uid()}`;
    await sql("INSERT INTO teams (id, name, owner_id) VALUES (?, 'Demo team', 'demo')", [team]);
  }
  await sql("UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [team, id]);
  await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  return { ctx, id };
}

test('enviar, devolver con nota, reenviar y aprobar una semana', async ({ page, browser, baseURL }) => {
  // El inicio crea la base y el workspace demo si esta suite corre sola.
  await page.goto('/en/app/time/approvals', { waitUntil: 'networkidle' });
  expect((await page.request.post('/api/time/projects', { data: { name: `Approvals ${uid()}` } })).status()).toBe(201);
  const { ctx, id } = await member(browser, baseURL!);
  const mp = await ctx.newPage();

  const tasks = ((await (await mp.request.get('/api/time/tasks')).json()) as { tasks: Array<{ id: string; archived: boolean }> }).tasks.filter((x) => !x.archived);
  const projects = ((await (await mp.request.get('/api/time/projects')).json()) as { projects: Array<{ id: string; archived: boolean }> }).projects.filter((p) => !p.archived);
  const made = await mp.request.post('/api/time/entries', { data: { date: '2026-10-07', projectId: projects[0].id, taskId: tasks[0].id, minutes: 120 } });
  expect(made.status()).toBe(201);

  // La persona envía la semana desde la grilla.
  await mp.goto(`/en/app/time?date=${WEEK}&view=week`, { waitUntil: 'networkidle' });
  const bar = mp.getByTestId('time-sheet-status');
  await expect(bar).toHaveAttribute('data-status', 'open');
  await mp.getByTestId('time-sheet-submit').click();
  const confirm = mp.getByTestId('confirm-dialog-confirm');
  await expect(confirm).toBeVisible();
  await Promise.all([mp.waitForResponse((r) => r.url().endsWith('/api/time/approvals') && r.request().method() === 'POST' && r.ok()), confirm.click()]);
  await expect(bar).toHaveAttribute('data-status', 'submitted');
  // Trabada: las celdas no se editan, no hay filas nuevas ni carga.
  await expect(mp.getByTestId('time-week-cell').first()).toHaveAttribute('readonly', '');
  await expect(mp.getByTestId('time-week-add-row')).toHaveCount(0);
  await expect(mp.getByTestId('time-track')).toBeDisabled();
  expect((await mp.request.post('/api/time/entries', { data: { date: '2026-10-08', projectId: projects[0].id, taskId: tasks[0].id, minutes: 10 } })).status()).toBe(409);

  // Quien administra la ve pendiente y la devuelve con una nota.
  await page.goto('/en/app/time/approvals', { waitUntil: 'networkidle' });
  const row = page.locator(`[data-testid=time-approval-row][data-person="${id}"][data-week="${WEEK}"]`);
  await expect(row).toHaveAttribute('data-status', 'submitted');
  await row.getByTestId('time-approval-view').click();
  const detail = page.getByTestId('time-approval-detail');
  await expect(detail.getByTestId('time-approval-entry')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await row.getByTestId('time-approval-return').click();
  const ret = page.getByTestId('time-approval-return-dialog');
  await ret.locator('textarea[name=note]').fill('Missing Friday');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/time/approvals') && r.request().method() === 'POST' && r.ok()), ret.getByTestId('time-approval-return-submit').click()]);
  await expect(row).toHaveCount(0);
  await page.getByTestId('time-approval-tab-returned').click();
  await expect(row).toHaveAttribute('data-status', 'returned');

  // La persona ve la nota, corrige y vuelve a enviar.
  await mp.reload({ waitUntil: 'networkidle' });
  await expect(bar).toHaveAttribute('data-status', 'returned');
  await expect(mp.getByTestId('time-sheet-note')).toHaveText('Missing Friday');
  const friday = mp.locator('[data-testid=time-week-cell][data-day="2026-10-09"]').first();
  await friday.fill('1:30');
  await Promise.all([mp.waitForResponse((r) => r.url().endsWith('/api/time/entries') && r.request().method() === 'POST' && r.ok()), friday.press('Enter')]);
  await mp.getByTestId('time-sheet-submit').click();
  await Promise.all([mp.waitForResponse((r) => r.url().endsWith('/api/time/approvals') && r.request().method() === 'POST' && r.ok()), mp.getByTestId('confirm-dialog-confirm').click()]);
  await expect(bar).toHaveAttribute('data-status', 'submitted');

  // Se aprueba y queda trabada para la persona.
  await page.getByTestId('time-approval-tab-submitted').click();
  await expect(row).toHaveAttribute('data-status', 'submitted');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/time/approvals') && r.request().method() === 'POST' && r.ok()), row.getByTestId('time-approval-approve').click()]);
  await expect(row).toHaveCount(0);
  await mp.reload({ waitUntil: 'networkidle' });
  await expect(bar).toHaveAttribute('data-status', 'approved');
  await expect(mp.getByTestId('time-sheet-withdraw')).toHaveCount(0);

  // La persona ve sus semanas en Aprobaciones, sin pestañas del equipo ni acciones.
  await mp.goto('/en/app/time/approvals', { waitUntil: 'networkidle' });
  await expect(mp.locator(`[data-testid=time-approval-row][data-week="${WEEK}"]`)).toHaveAttribute('data-status', 'approved');
  await expect(mp.getByTestId('time-approval-tab-submitted')).toHaveCount(0);
  await expect(mp.getByTestId('time-approval-approve')).toHaveCount(0);
  await ctx.close();
});
