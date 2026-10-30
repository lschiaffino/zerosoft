import { createClient } from '@libsql/client';
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * People (BambooHR) de punta a punta, con el usuario demo como owner (HR) y
 * otras personas del workspace por la cookie zs_e2e_as: perfil y manager en
 * el organigrama, licencia pedida, aprobada por el manager, saldo y Cal
 * bloqueado, onboarding desde plantilla, un ciclo de evaluación, el sueldo
 * que un empleado no ve (UI, API, ⌘K y asistente) y alguien sin la app.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
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
  name: string;
}

/** Una persona más en el workspace demo (con las apps pedidas), con su propia sesión. */
async function member(browser: Browser, baseURL: string, name: string, apps = '*'): Promise<Member> {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `ppl-${name.toLowerCase().replace(/\W+/g, '-')}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const userId = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [name, userId]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, userId, 'member', apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, userId]);
  // Alta por SQL (sin personJoined): su primera visita a People le crea la ficha, como a un miembro de antes de People.
  if (apps === '*') expect((await ctx.request.get('/api/people/me')).ok()).toBe(true);
  return { ctx, page, userId, name };
}

/** Ficha (id) de una persona del workspace, vista por HR (el demo). */
async function profileOf(request: import('@playwright/test').APIRequestContext, userId: string): Promise<string> {
  const { employees } = await ok<{ employees: Array<{ id: string; userId: string | null }> }>(request.get('/api/people/employees'));
  const e = employees.find((x) => x.userId === userId);
  expect(e, `ficha de ${userId}`).toBeTruthy();
  return e!.id;
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Un lunes al menos 30 días adelante (las personas del test no tienen país: sin feriados). */
function futureMonday(): string {
  let d = addDays(new Date().toISOString().slice(0, 10), 30);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('HR crea una ficha con su manager y el organigrama la muestra', async ({ page, request }) => {
  const errors = watchErrors(page);
  const managerName = `Marta Manager ${uid()}`;
  const { employee: manager } = await ok<{ employee: { id: string } }>(request.post('/api/people/employees', { data: { name: managerName, jobTitle: 'Head of Design' } }));
  const name = `Pablo Perfil ${uid()}`;
  await page.goto('/en/app/people', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add person' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add person' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Job title').fill('Product designer');
  await dialog.getByLabel('Department').fill('Design');
  await dialog.getByLabel('Manager').selectOption({ label: managerName });
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect(page).toHaveURL(/\/en\/app\/people\/emp_/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  await expect(page.getByRole('link', { name: managerName })).toBeVisible();
  const id = page.url().split('/').pop()!.split('?')[0];

  // Aparece en el directorio y ⌘K lo encuentra.
  await page.goto('/en/app/people', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('people-row').filter({ hasText: name })).toBeVisible();

  // Organigrama: el nodo cuelga de su manager; zoom y export están.
  await page.goto('/en/app/people/org', { waitUntil: 'networkidle' });
  const node = page.getByTestId('people-org').locator(`.ppl-org-node[data-name="${name}"]`);
  await expect(node).toBeVisible();
  await expect(node).toHaveAttribute('data-manager', manager.id);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByText('100%')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('110%')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  expect((await download).suggestedFilename()).toBe('org-chart.png');
  await node.click();
  await expect(page).toHaveURL(new RegExp(`/en/app/people/${id}`));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('una persona pide días, su manager aprueba, el saldo baja y Cal la muestra bloqueada', async ({ browser, baseURL, request }) => {
  test.setTimeout(150_000);
  const mgr = await member(browser, baseURL!, `Mario Manager ${uid()}`);
  const emp = await member(browser, baseURL!, `Elena Empleada ${uid()}`);
  const other = await member(browser, baseURL!, `Otto Otro ${uid()}`);
  try {
    const mgrId = await profileOf(request, mgr.userId);
    const empId = await profileOf(request, emp.userId);
    await ok(request.patch(`/api/people/employees/${empId}`, { data: { managerId: mgrId, startDate: '2024-01-01' } }));

    const errors = watchErrors(emp.page);
    await emp.page.goto('/en/app/people/time-off', { waitUntil: 'networkidle' });
    const card = emp.page.getByTestId('people-balances').locator('[data-policy="Vacation"]');
    const before = Number(await card.getByTestId('people-available').innerText());
    expect(before).toBeGreaterThanOrEqual(3);
    await emp.page.getByRole('button', { name: 'Request time off' }).click();
    const dialog = emp.page.getByRole('dialog', { name: 'Request time off' });
    const mon = futureMonday();
    await dialog.getByLabel('Type').selectOption({ label: `Vacation (${before} days available)` });
    await dialog.getByLabel('From').fill(mon);
    await dialog.getByLabel('To').fill(addDays(mon, 2));
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toBeHidden();
    await expect(emp.page.getByTestId('people-requests').locator('[data-status="pending"]')).toBeVisible();
    const reqId = String((await sql('SELECT id FROM people_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1', [empId]))[0].id);

    // Otra persona (no es su manager) no puede aprobar.
    expect((await other.ctx.request.patch(`/api/people/time-off/${reqId}`, { data: { action: 'approve' } })).status()).toBe(403);

    // El manager lo ve en "To approve" y aprueba.
    await mgr.page.goto('/en/app/people/time-off?tab=approvals', { waitUntil: 'networkidle' });
    const row = mgr.page.locator(`tr[data-request="${reqId}"]`);
    await expect(row).toContainText(emp.name);
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(mgr.page.getByText('Nothing waiting for your approval.')).toBeVisible();

    // El saldo disponible bajó 3 días.
    await emp.page.goto('/en/app/people/time-off', { waitUntil: 'networkidle' });
    await expect(emp.page.getByTestId('people-requests').locator('[data-status="approved"]')).toBeVisible();
    await expect(card.getByTestId('people-available')).toHaveText(String(before - 3));

    // Cal: la licencia es un bloqueo en su disponibilidad.
    await emp.page.goto('/en/app/calendar/availability', { waitUntil: 'networkidle' });
    const toggle = emp.page.getByRole('button', { name: /Time off/ });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(emp.page.getByText('Out of office (People)').first()).toBeVisible();
    const slots = await sql('SELECT starts_at, ends_at FROM calendar_blocked_slots WHERE user_id = ?', [emp.userId]);
    expect(slots).toContainEqual({ starts_at: `${mon}T00:00:00.000Z`, ends_at: `${addDays(mon, 3)}T00:00:00.000Z` });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await Promise.all([mgr.ctx.close(), emp.ctx.close(), other.ctx.close()]);
  }
});

test('onboarding: una ficha nueva sale con la checklist de la plantilla', async ({ page }) => {
  const errors = watchErrors(page);
  const name = `Nora Nueva ${uid()}`;
  await page.goto('/en/app/people?new=1', { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog', { name: 'Add person' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Start date').fill('2026-12-01');
  await dialog.getByLabel('Onboarding checklist').selectOption({ label: 'New hire' });
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect(page).toHaveURL(/\/en\/app\/people\/emp_/);

  await page.goto('/en/app/people/onboarding', { waitUntil: 'networkidle' });
  const list = page.getByTestId('people-checklist').filter({ hasText: name });
  await expect(list).toBeVisible();
  await expect(list).toContainText('0 of 5 done');
  // Vencimientos relativos al ingreso: IT 3 días antes, el 1:1 del manager al día siguiente.
  await expect(list.getByText('Prepare laptop and accounts')).toBeVisible();
  await expect(list).toContainText('due Nov 28, 2026');
  await expect(list).toContainText('due Dec 2, 2026');
  await list.getByRole('checkbox', { name: /Prepare laptop and accounts/ }).check();
  await expect(page.getByTestId('people-checklist').filter({ hasText: name })).toContainText('1 of 5 done');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('un ciclo de evaluación: HR lanza, la persona se autoevalúa y HR cierra', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const emp = await member(browser, baseURL!, `Rita Review ${uid()}`);
  try {
    await profileOf(request, emp.userId);
    const cycleName = `H2 review ${uid()}`;
    await page.goto('/en/app/people/reviews', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New review cycle' }).click();
    const dialog = page.getByRole('dialog', { name: 'New review cycle' });
    await dialog.getByLabel('Name').fill(cycleName);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(cycleName);
    await page.getByRole('button', { name: 'Launch' }).click();
    await expect(page.getByText(/0 of \d+ submitted/).first()).toBeVisible();

    // La persona la ve en "Waiting for you" y la escribe.
    await emp.page.goto('/en/app/people/reviews', { waitUntil: 'networkidle' });
    await emp.page.getByTestId('people-to-write').getByRole('link', { name: 'Your self review' }).click();
    const form = emp.page.getByTestId('people-review-form');
    await form.getByLabel('What went well this period?').fill('Shipped People');
    await form.getByLabel('What could be better?').fill('More tests');
    await form.getByLabel('Overall performance').selectOption('4');
    await form.getByRole('button', { name: 'Submit review' }).click();
    await expect(emp.page.getByTestId('people-review').filter({ hasText: 'Self review' })).toContainText('Shipped People');

    // HR ve la evaluación enviada y cierra el ciclo.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('people-review').filter({ hasText: 'Shipped People' })).toBeVisible();
    await page.getByRole('button', { name: 'Close cycle' }).click();
    await expect(page.getByText('Closed').first()).toBeVisible();
  } finally {
    await emp.ctx.close();
  }
});

test('un empleado no ve el sueldo de otro: ni en la UI, ni la API, ni ⌘K, ni el asistente', async ({ browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const rich = await member(browser, baseURL!, `Sofia Salary ${uid()}`);
  const peer = await member(browser, baseURL!, `Pedro Peer ${uid()}`);
  try {
    const richId = await profileOf(request, rich.userId);
    await profileOf(request, peer.userId);
    await ok(request.post(`/api/people/employees/${richId}/compensation`, { data: { amount: 123456.78, currency: 'USD', period: 'year', effectiveDate: '2026-01-01' } }));
    await ok(request.patch(`/api/people/employees/${richId}`, { data: { personal: { address: 'Avenida Secreta 742' } } }));

    // La persona ve su sueldo.
    await rich.page.goto(`/en/app/people/${richId}?tab=compensation`, { waitUntil: 'networkidle' });
    await expect(rich.page.getByTestId('people-salary').first()).toContainText('123,456.78');

    // Un par: sin pestaña, sin montos en el HTML, la API dice 403.
    const p = peer.page;
    const res = await p.goto(`/en/app/people/${richId}`, { waitUntil: 'networkidle' });
    expect(await res!.text()).not.toMatch(/123456|123,456|Avenida Secreta/);
    await expect(p.getByRole('heading', { level: 1 })).toContainText(rich.name);
    await expect(p.getByRole('tab', { name: 'Compensation' })).toHaveCount(0);
    await expect(p.getByTestId('people-personal')).toHaveCount(0);
    expect((await peer.ctx.request.get(`/api/people/employees/${richId}/compensation`)).status()).toBe(403);
    const api = await (await peer.ctx.request.get(`/api/people/employees/${richId}`)).text();
    expect(api).not.toMatch(/123456|Avenida Secreta/);

    // ⌘K: la encuentra por nombre, sin datos sensibles.
    const search = await (await peer.ctx.request.get(`/api/search?q=${encodeURIComponent(rich.name)}`)).text();
    expect(search).toContain(rich.name);
    expect(search).not.toMatch(/123456|Avenida Secreta/);
    await p.keyboard.press('ControlOrMeta+k');
    const palette = p.getByRole('dialog', { name: 'Search' });
    await palette.getByRole('combobox').fill(rich.name);
    await expect(palette.getByRole('option', { name: new RegExp(rich.name) }).first()).toBeVisible();
    await expect(palette).not.toContainText('123,456');
    await expect(palette).not.toContainText('Avenida Secreta');
    await p.keyboard.press('Escape');

    // El asistente: la herramienta de sueldo responde forbidden y no hay monto.
    await p.keyboard.press('ControlOrMeta+j');
    const panel = p.getByTestId('assistant-panel');
    await expect(panel).toBeVisible();
    const input = panel.getByRole('textbox', { name: /Ask anything/ });
    await input.fill(`salary of ${rich.name}`);
    await input.press('Enter');
    await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText('I could not do that (forbidden)');
    await expect(panel).not.toContainText('123456');
  } finally {
    await Promise.all([rich.ctx.close(), peer.ctx.close()]);
  }
});

test('una persona sin la app People no ve páginas, API ni resultados de búsqueda', async ({ browser, baseURL, request }) => {
  const name = `Secreta ${uid()}`;
  await ok(request.post('/api/people/employees', { data: { name } }));
  const noApp = await member(browser, baseURL!, `Nico NoApp ${uid()}`, '["crm"]');
  try {
    await noApp.page.goto('/en/app/people', { waitUntil: 'networkidle' });
    await expect(noApp.page).toHaveURL(/\/en\/app\?blocked=people/);
    for (const path of ['/api/people/employees', '/api/people/me', '/api/people/time-off', '/api/people/reports', '/api/people/export']) {
      expect((await noApp.ctx.request.get(path)).status(), path).toBe(401);
    }
    const search = (await (await noApp.ctx.request.get(`/api/search?q=${encodeURIComponent(name)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.startsWith('/app/people'))).toEqual([]);
    expect((await noApp.ctx.request.post('/api/keys', { data: { name: 'nope', scopes: ['people:read'] } })).status()).toBe(403);
  } finally {
    await noApp.ctx.close();
  }
});
