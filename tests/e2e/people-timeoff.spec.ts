import { e2eDb } from './helpers/db';
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * People › Licencias: editar un pedido. La persona corre las fechas de uno
 * pendiente, el manager lo aprueba, ella lo vuelve a cambiar y el pedido
 * vuelve a pendiente sin el bloqueo de Cal. El diálogo cierra con Esc y la
 * página no tiene scroll lateral a 390 px.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

interface Member {
  ctx: BrowserContext;
  page: Page;
  userId: string;
}

async function member(browser: Browser, baseURL: string, name: string): Promise<Member> {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `ppl-edit-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const userId = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [name, userId]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, userId, 'member', '*']);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, userId]);
  expect((await ctx.request.post('/api/people/me')).ok()).toBe(true);
  return { ctx, page, userId };
}

async function profileOf(request: import('@playwright/test').APIRequestContext, userId: string): Promise<string> {
  const { employees } = await ok<{ employees: Array<{ id: string; userId: string | null }> }>(request.get('/api/people/employees'));
  const e = employees.find((x) => x.userId === userId);
  expect(e, `ficha de ${userId}`).toBeTruthy();
  return e!.id;
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Un lunes lejos (las personas del test no tienen país: sin feriados). */
function futureMonday(): string {
  let d = addDays(new Date().toISOString().slice(0, 10), 45);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

test('editar un pedido: pendiente se corre de fecha; aprobado vuelve a pendiente y suelta Cal', async ({ browser, baseURL, request }) => {
  test.setTimeout(150_000);
  // El demo (HR) entra primero: con una base nueva esto crea el esquema y su workspace.
  await ok(request.get('/api/people/employees'));
  const mgr = await member(browser, baseURL!, `Mara Manager ${uid()}`);
  const emp = await member(browser, baseURL!, `Ema Edit ${uid()}`);
  try {
    const mgrId = await profileOf(request, mgr.userId);
    const empId = await profileOf(request, emp.userId);
    await ok(request.patch(`/api/people/employees/${empId}`, { data: { managerId: mgrId, startDate: '2024-01-01' } }));
    const { balances } = await ok<{ balances: Array<{ policy: { id: string; kind: string; accrual: string }; balance: { available: number } }> }>(
      emp.ctx.request.get(`/api/people/employees/${empId}/balances`),
    );
    const vacation = balances.find((b) => b.policy.kind === 'vacation' && b.policy.accrual !== 'none' && b.balance.available >= 3)!.policy;
    const mon = futureMonday();
    const { request: created } = await ok<{ request: { id: string } }>(emp.ctx.request.post('/api/people/time-off', { data: { policyId: vacation.id, startDate: mon, endDate: mon } }));

    const page = emp.page;
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/app/people/time-off', { waitUntil: 'networkidle' });
    const row = page.locator(`tr[data-request="${created.id}"]`);
    await expect(row.locator('[data-status="pending"]')).toBeVisible();

    // Esc cierra el diálogo sin cambiar nada.
    await row.getByTestId('people-request-edit').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#rq-start')).toHaveValue(mon);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Pendiente: pasa a tres días.
    await row.getByTestId('people-request-edit').click();
    await dialog.locator('#rq-end').fill(addDays(mon, 2));
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('td.num')).toHaveText('3');
    await expect(row.locator('[data-status="pending"]')).toBeVisible();

    // El manager aprueba; Cal queda bloqueado.
    await ok(mgr.ctx.request.patch(`/api/people/time-off/${created.id}`, { data: { action: 'approve' } }));
    expect(await sql('SELECT 1 AS x FROM calendar_blocked_slots WHERE user_id = ?', [emp.userId])).toHaveLength(1);

    // Aprobado: el diálogo avisa que vuelve a aprobación; guardar lo deja pendiente y suelta Cal.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(row.locator('[data-status="approved"]')).toBeVisible();
    await row.getByTestId('people-request-edit').click();
    await expect(dialog.getByTestId('people-edit-reapproval')).toBeVisible();
    await dialog.locator('#rq-start').fill(addDays(mon, 1));
    await dialog.locator('#rq-end').fill(addDays(mon, 1));
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('[data-status="pending"]')).toBeVisible();
    await expect(row.locator('td.num')).toHaveText('1');
    expect(await sql('SELECT 1 AS x FROM calendar_blocked_slots WHERE user_id = ?', [emp.userId])).toHaveLength(0);

    // El manager lo vuelve a ver para aprobar, sin botón de editar.
    await mgr.page.goto('/en/app/people/time-off?tab=approvals', { waitUntil: 'networkidle' });
    const mgrRow = mgr.page.locator(`tr[data-request="${created.id}"]`);
    await expect(mgrRow.locator('[data-status="pending"]')).toBeVisible();
    await expect(mgrRow.getByTestId('people-request-edit')).toHaveCount(0);

    // 390 px: sin scroll lateral en la página ni con el diálogo abierto.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload({ waitUntil: 'networkidle' });
    const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noSideScroll()).toBe(true);
    await row.getByTestId('people-request-edit').click();
    await expect(dialog.locator('#rq-start')).toBeVisible();
    expect(await noSideScroll()).toBe(true);
    await page.keyboard.press('Escape');
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await Promise.all([mgr.ctx.close(), emp.ctx.close()]);
  }
});
