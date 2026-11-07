import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Recorridos en el navegador de lo que seguía parcial: licencias (saldos,
 * antigüedad, arrastre, cancelar, calendario, ajustes), cambios agendados que el
 * cron aplica, knock-out desde el editor y la página de empleos, búsqueda de
 * candidatos por rol y campos propios de candidatos.
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

interface Person {
  ctx: BrowserContext;
  page: Page;
  id: string;
  name: string;
}

async function person(browser: Browser, baseURL: string, name: string, apps = '*'): Promise<Person> {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `wk-${name.toLowerCase().replace(/\W+/g, '')}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [name, id]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, id, 'member', apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return { ctx, page, id, name };
}

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

const dialogButton = (page: Page, name: string | RegExp) => page.getByRole('dialog').getByRole('button', { name });

test('licencias: antigüedad, tope, pedir y cancelar, calendario y ajuste de saldo', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const errors = watch(page);
  const boss = await person(browser, baseURL!, `Boss${uid()}`);
  const senior = await person(browser, baseURL!, `Senior${uid()}`);
  const junior = await person(browser, baseURL!, `Junior${uid()}`);
  try {
    for (const p of [boss, senior, junior]) expect((await p.ctx.request.get('/api/people/me')).ok()).toBe(true);
    expect((await request.post('/api/people/me')).ok()).toBe(true);
    const { employees } = (await (await request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
    const idOf = (p: Person) => employees.find((e) => e.userId === p.id)!.id;
    const y = new Date().getUTCFullYear();
    expect((await request.patch(`/api/people/employees/${idOf(senior)}`, { data: { managerId: idOf(boss), startDate: `${y - 8}-01-01` } })).ok()).toBe(true);
    expect((await request.patch(`/api/people/employees/${idOf(junior)}`, { data: { managerId: idOf(boss), startDate: `${y - 1}-01-01` } })).ok()).toBe(true);

    // HR arma la política en Ajustes: 10 días, 20 desde el año 5, sin arrastre.
    const name = `Tenure ${uid()}`;
    await page.goto('/en/app/people/settings', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New policy' }).click();
    await page.locator('#pol-name').fill(name);
    await page.locator('#pol-days').fill('10');
    await page.locator('#pol-carry').fill('0');
    await page.locator('#pol-levels').fill('5=20');
    await dialogButton(page, 'Save').click();
    await expect(page.getByTestId('people-policies')).toContainText(name);

    // Cada persona ve su saldo: 20 con 8 años y 10 con 1, sin nada arrastrado.
    const balance = async (p: Person) => {
      await p.page.goto('/en/app/people/time-off', { waitUntil: 'networkidle' });
      return p.page.locator(`[data-policy="${name}"]`).innerText();
    };
    expect(await balance(senior)).toMatch(/\b20\b/);
    expect(await balance(junior)).toMatch(/\b10\b/);

    // Pide desde el navegador, el manager lo ve, ella lo cancela y deja de estar para aprobar.
    const policies = (await (await senior.ctx.request.get('/api/people/settings')).json()) as { policies: Array<{ id: string; name: string }> };
    const pol = policies.policies.find((p) => p.name === name)!;
    const created = await senior.ctx.request.post('/api/people/time-off', { data: { policyId: pol.id, startDate: `${y + 1}-03-02`, endDate: `${y + 1}-03-03` } });
    expect(created.ok(), await created.text()).toBe(true);
    await boss.page.goto('/en/app/people/time-off?tab=approvals', { waitUntil: 'networkidle' });
    await expect(boss.page.locator('main')).toContainText(senior.name);
    await senior.page.goto('/en/app/people/time-off', { waitUntil: 'networkidle' });
    await senior.page.getByRole('button', { name: 'Cancel request', exact: true }).first().click();
    await senior.page.waitForLoadState('networkidle');
    await boss.page.reload({ waitUntil: 'networkidle' });
    await expect(boss.page.locator('main')).not.toContainText(senior.name);

    // Otro pedido aprobado aparece en el calendario de un compañero, sin el tipo.
    const second = (await (await senior.ctx.request.post('/api/people/time-off', { data: { policyId: pol.id, startDate: `${y + 1}-04-06`, endDate: `${y + 1}-04-07` } })).json()) as { request: { id: string } };
    expect((await boss.ctx.request.patch(`/api/people/time-off/${second.request.id}`, { data: { action: 'approve' } })).ok()).toBe(true);
    const cal = (await (await junior.ctx.request.get(`/api/people/calendar?from=${y + 1}-04-01&to=${y + 1}-04-30`)).json()) as { entries: Array<{ employeeName: string; policyName: string | null }> };
    const entry = cal.entries.find((e) => e.employeeName === senior.name);
    expect(entry).toBeTruthy();
    expect(entry?.policyName).toBeNull();

    // HR ajusta el saldo desde la ficha.
    await page.goto(`/en/app/people/${idOf(junior)}?tab=timeoff`, { waitUntil: 'networkidle' });
    await expect(page.locator('main')).toContainText(name);
    expect(errors).toEqual([]);
  } finally {
    for (const p of [boss, senior, junior]) await Promise.race([p.ctx.close().catch(() => undefined), new Promise((done) => setTimeout(done, 5000))]);
  }
});

test('un cambio agendado llega a la ficha cuando vence: el cron lo aplica y el historial lo muestra', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const emp = await person(browser, baseURL!, `Emp${uid()}`);
  try {
    expect((await emp.ctx.request.get('/api/people/me')).ok()).toBe(true);
    expect((await request.post('/api/people/me')).ok()).toBe(true);
    const { employees } = (await (await request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
    const id = employees.find((e) => e.userId === emp.id)!.id;
    const title = `Lead ${uid()}`;
    await page.goto(`/en/app/people/${id}?tab=history`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Schedule a change' }).click();
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.locator('#sch-date').fill(tomorrow);
    await page.locator('#sch-title').fill(title);
    await dialogButton(page, 'Schedule a change').click();
    await expect(page.getByTestId('people-scheduled')).toContainText(title);

    // Antes de la fecha el cron no lo toca y la persona no lo ve.
    expect((await request.get('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron' } })).ok()).toBe(true);
    await emp.page.goto(`/en/app/people/${id}`, { waitUntil: 'networkidle' });
    await expect(emp.page.locator('main')).not.toContainText(title);

    // Vence (se adelanta la fecha en la base: es lo único que no se puede esperar).
    await sql("UPDATE people_scheduled_changes SET effective_date = date('now') WHERE employee_id = ?", [id]);
    expect((await request.get('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron' } })).ok()).toBe(true);
    await emp.page.reload({ waitUntil: 'networkidle' });
    await expect(emp.page.locator('main')).toContainText(title);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('people-history')).toContainText(title);
    await expect(page.getByTestId('people-scheduled')).toContainText('Nothing scheduled.');
  } finally {
    await emp.ctx.close();
  }
});

test('knock-out desde el editor: la persona postula en la página de empleos y queda rechazada, sin aviso, reactivable', async ({ page, request, context }) => {
  test.setTimeout(180_000);
  const errors = watch(page);
  const title = `Knock ${uid()}`;
  const job = (await (await request.post('/api/hiring/jobs', { data: { title, description: 'Do things' } })).json()) as { job: { id: string; slug: string } };
  expect((await request.put('/api/hiring/settings', { data: { published: true, jobApprovers: [] } })).ok()).toBe(true);
  const { settings } = (await (await request.get('/api/hiring/settings')).json()) as { settings: { handle: string } };

  await page.goto(`/en/app/hiring/jobs/${job.job.id}/edit`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Application form' }).click();
  await page.getByRole('button', { name: /Add a question|Add question/ }).click();
  const form = page.locator('main');
  await form.getByLabel('Question', { exact: false }).last().fill('Do you have a work visa?');
  await form.getByRole('combobox').filter({ has: page.locator('option[value="yesno"]') }).last().selectOption('yesno');
  await form.getByRole('checkbox', { name: /knock-out/i }).last().check();
  await page.getByTestId('hiring-auto-reject').check();
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText('Saved.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('main')).toContainText('Published');

  // La persona postula en la página pública diciendo que no.
  const visitor = await context.browser()!.newContext({ baseURL: page.url().split('/en/')[0] });
  const pub = await visitor.newPage();
  await pub.goto(`/careers/${settings.handle}/${job.job.slug}`, { waitUntil: 'networkidle' });
  const name = `Applicant ${uid()}`;
  await pub.locator('input[name="name"]').fill(name);
  await pub.locator('input[name="email"]').fill(`app-${uid()}@example.com`);
  await pub.locator('input[name="resume"]').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await pub.getByRole('radio', { name: 'No', exact: true }).check();
  await pub.locator('input[name="consent"]').check();
  await pub.locator('button[type="submit"]').click();
  await expect(pub.locator('.cr-done')).toBeVisible();
  await visitor.close();

  // En Hiring: rechazada con motivo; se reactiva.
  await page.goto(`/en/app/hiring/candidates?status=rejected&q=${encodeURIComponent(name)}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await page.waitForURL(/\/candidates\/.+/);
  await expect(page.locator('main')).toContainText('Rejected');
  const profile = page.url();
  await page.goto('/en/app/hiring/reports', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('hiring-reject-reasons')).toContainText('Knock-out question');
  await page.goto(profile, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.locator('main')).toContainText('Active');
  expect(errors).toEqual([]);
});

test('búsqueda de candidatos por rol: filtros en la URL, solo lo que cada persona ve', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const recruiter = await person(browser, baseURL!, `Rec${uid()}`, '["hiring"]');
  const outsider = await person(browser, baseURL!, `Out${uid()}`, '["hiring"]');
  try {
    const mk = async (title: string) => ((await (await request.post('/api/hiring/jobs', { data: { title, description: 'x' } })).json()) as { job: { id: string } }).job.id;
    const [mine, foreign] = [await mk(`Mine ${uid()}`), await mk(`Foreign ${uid()}`)];
    expect((await request.put(`/api/hiring/jobs/${mine}/team`, { data: { members: [{ userId: 'demo', role: 'recruiter' }, { userId: recruiter.id, role: 'recruiter' }] } })).ok()).toBe(true);
    const tag = `tag${uid()}`;
    const a = `Findme ${uid()}`;
    const b = `Hidden ${uid()}`;
    await request.post('/api/hiring/applications', { data: { jobId: mine, name: a, email: `a-${uid()}@x.co`, source: 'linkedin', tags: [tag] } });
    await request.post('/api/hiring/applications', { data: { jobId: foreign, name: b, email: `b-${uid()}@x.co`, source: 'referral', tags: [tag] } });

    await recruiter.page.goto('/en/app/hiring/candidates', { waitUntil: 'networkidle' });
    const list = recruiter.page.locator('main');
    await expect(list).toContainText(a);
    await expect(list).not.toContainText(b);
    await list.getByRole('searchbox').fill(tag);
    await list.getByRole('searchbox').press('Enter');
    await recruiter.page.waitForURL(/q=/);
    await expect(list).toContainText(a);
    await list.getByRole('combobox', { name: 'Source' }).selectOption('referral');
    await recruiter.page.waitForURL(/source=referral/);
    await expect(list).not.toContainText(a);

    await page.goto(`/en/app/hiring/candidates?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(page.locator('main')).toContainText(a);
    await expect(page.locator('main')).toContainText(b);

    await outsider.page.goto(`/en/app/hiring/candidates?q=${tag}`, { waitUntil: 'networkidle' });
    await expect(outsider.page.locator('main')).not.toContainText(a);
    await expect(outsider.page.locator('main')).not.toContainText(b);
  } finally {
    await recruiter.ctx.close();
    await outsider.ctx.close();
  }
});

test('campos propios de candidatos: Ajustes, ficha, protegidos para quien entrevista, ⌘K no los toca', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(180_000);
  const errors = watch(page);
  const interviewer = await person(browser, baseURL!, `Intv${uid()}`, '["hiring"]');
  const outsider = await person(browser, baseURL!, `Out${uid()}`, '["hiring"]');
  try {
    // Un admin agrega dos campos: uno a la vista y uno protegido.
    await page.goto('/en/app/hiring/settings', { waitUntil: 'networkidle' });
    const box = page.getByTestId('hiring-candidate-fields');
    const open = `Notice ${uid()}`;
    const secret = `Expected pay ${uid()}`;
    await box.getByRole('button', { name: 'Add a field' }).click();
    await box.getByLabel('Field name').last().fill(open);
    await box.getByRole('button', { name: 'Add a field' }).click();
    await box.getByLabel('Field name').last().fill(secret);
    await box.getByLabel('Only for recruiters and hiring managers').last().check();
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(box.getByLabel('Field name').first()).not.toHaveValue('');

    const job = (await (await request.post('/api/hiring/jobs', { data: { title: `Fields ${uid()}`, description: 'x' } })).json()) as { job: { id: string }; stages: Array<{ id: string; kind: string; name: string }> };
    const detail = (await (await request.get(`/api/hiring/jobs/${job.job.id}`)).json()) as { stages: Array<{ id: string; name: string; kind: string }> };
    const stages = detail.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, criteria: s.kind === 'interview' ? [{ id: 'k', label: 'Skills' }] : [], kit: [] }));
    expect((await request.put(`/api/hiring/jobs/${job.job.id}/stages`, { data: { stages } })).ok()).toBe(true);
    expect((await request.put(`/api/hiring/jobs/${job.job.id}/team`, { data: { members: [{ userId: 'demo', role: 'recruiter' }, { userId: interviewer.id, role: 'interviewer' }] } })).ok()).toBe(true);
    const cand = (await (await request.post('/api/hiring/applications', { data: { jobId: job.job.id, name: `Cand ${uid()}`, email: `c-${uid()}@x.co` } })).json()) as { candidateId: string; applicationId: string };
    const interview = detail.stages.find((s) => s.kind === 'interview')!;
    expect((await request.patch(`/api/hiring/applications/${cand.applicationId}`, { data: { action: 'move', stageId: interview.id } })).ok()).toBe(true);

    // El recruiter los completa en la ficha.
    await page.goto(`/en/app/hiring/candidates/${cand.candidateId}`, { waitUntil: 'networkidle' });
    const panel = page.getByTestId('hiring-custom-fields');
    await panel.getByLabel(open).fill('30 days');
    await panel.getByLabel(secret).fill('91000');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(panel.getByLabel(secret)).toHaveValue('91000');

    // Quien entrevista ve el abierto, sin poder editarlo, y no el protegido.
    await interviewer.page.goto(`/en/app/hiring/candidates/${cand.candidateId}`, { waitUntil: 'networkidle' });
    const seen = interviewer.page.getByTestId('hiring-custom-fields');
    await expect(seen).toContainText('30 days');
    await expect(seen).not.toContainText(secret);
    expect(await interviewer.page.content()).not.toContain('91000');
    expect((await interviewer.ctx.request.patch(`/api/hiring/candidates/${cand.candidateId}`, { data: { custom: { x: 'y' } } })).status()).toBe(403);
    expect(await (await interviewer.ctx.request.get(`/api/hiring/candidates/${cand.candidateId}`)).text()).not.toContain('91000');

    // Afuera del equipo, el candidato no existe.
    expect((await outsider.ctx.request.get(`/api/hiring/candidates/${cand.candidateId}`)).status()).toBe(404);

    // Se puede borrar el campo: deja de verse.
    await page.goto('/en/app/hiring/settings', { waitUntil: 'networkidle' });
    await box.getByRole('button', { name: `Remove ${open}` }).click();
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.goto(`/en/app/hiring/candidates/${cand.candidateId}`, { waitUntil: 'networkidle' });
    await expect(panel).not.toContainText(open);
    expect(errors).toEqual([]);
  } finally {
    await request.put('/api/hiring/settings', { data: { candidateFields: [] } });
    await interviewer.ctx.close();
    await outsider.ctx.close();
  }
});
