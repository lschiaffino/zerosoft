import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * People y Hiring usados de punta a punta en el navegador, con la sesión de cada
 * rol y datos en la base real del e2e: HR importa, una empleada cambia sus datos y
 * HR lo aprueba, se agenda un cambio, responden una encuesta, un manager suma un
 * par; en Hiring, cadena de aprobación, confidencial, importar, copiar, fusionar,
 * knock-out, guía de entrevista y la contratación que llega a People.
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
  const email = `fx-${name.toLowerCase().replace(/\W+/g, '')}-${uid()}@darwin-e2e.io`;
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

test('People: importar, cambios con aprobación, historial, agenda e inicio', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const errors = watch(page);
  const boss = await person(browser, baseURL!, `Boss${uid()}`);
  const emp = await person(browser, baseURL!, `Emma${uid()}`);
  const peer = await person(browser, baseURL!, `Peer${uid()}`);
  try {
    for (const p of [boss, emp, peer]) expect((await p.ctx.request.get('/api/people/me')).ok()).toBe(true);
    expect((await request.post('/api/people/me')).ok()).toBe(true);
    const { employees } = (await (await request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
    const idOf = (p: Person) => employees.find((e) => e.userId === p.id)!.id;
    const [bossId, empId, peerId] = [idOf(boss), idOf(emp), idOf(peer)];
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(5, 10);
    expect((await request.patch(`/api/people/employees/${empId}`, { data: { managerId: bossId, phone: '111', personal: { birthDate: `1991-${soon}` } } })).ok()).toBe(true);
    expect((await request.patch(`/api/people/employees/${peerId}`, { data: { managerId: bossId } })).ok()).toBe(true);

    // HR importa una planilla: primero ve la vista previa con el error por fila.
    const imported = `Imported ${uid()}`;
    await page.goto('/en/app/people', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByTestId('csv-file').setInputFiles({ name: 'p.csv', mimeType: 'text/csv', buffer: Buffer.from(`Name,Job title,Department\n${imported},Analyst,Finance\n,Nobody,Finance\n`) });
    await dialogButton(page, 'Check the file').click();
    await expect(page.getByTestId('csv-summary')).toContainText('1 new profile');
    await expect(page.getByTestId('csv-failed')).toContainText('Line 3');
    await dialogButton(page, 'Import').click();
    await expect(page.getByRole('link', { name: new RegExp(imported) })).toBeVisible();

    // HR enciende la aprobación desde Ajustes.
    await page.goto('/en/app/people/settings?tab=changes', { waitUntil: 'networkidle' });
    await page.getByTestId('people-changes').getByRole('checkbox').check();
    await expect(page.getByTestId('people-changes').getByRole('checkbox')).toBeChecked();
    await page.waitForLoadState('networkidle');

    // La empleada cambia su teléfono: espera a HR y no se aplica.
    await emp.page.goto(`/en/app/people/${empId}`, { waitUntil: 'networkidle' });
    await emp.page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(emp.page.locator('#pp-nid')).toHaveCount(0);
    await emp.page.locator('#pp-phone').fill('222');
    await emp.page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(emp.page.getByTestId('people-pending-change')).toBeVisible();
    expect(((await (await emp.ctx.request.get(`/api/people/employees/${empId}`)).json()) as { employee: { phone: string } }).employee.phone).toBe('111');

    // Un compañero no ve el pedido.
    expect((await peer.ctx.request.get('/api/people/changes')).status()).toBe(403);

    // El inicio de HR lo cuenta y lleva a revisarlo; HR aprueba.
    await page.goto('/en/app/people', { waitUntil: 'networkidle' });
    await page.getByTestId('people-inbox').getByRole('link', { name: /Profile changes to review/ }).click();
    await expect(page).toHaveURL(/tab=changes/);
    const changes = page.getByTestId('people-changes');
    await expect(changes.getByRole('cell', { name: '222' })).toBeVisible();
    await changes.getByRole('button', { name: 'Approve' }).click();
    await expect(changes.getByText('Nothing waiting for review.')).toBeVisible();
    await emp.page.reload({ waitUntil: 'networkidle' });
    await expect(emp.page.getByTestId('people-pending-change')).toHaveCount(0);
    expect(((await (await emp.ctx.request.get(`/api/people/employees/${empId}`)).json()) as { employee: { phone: string } }).employee.phone).toBe('222');

    // Cumpleaños en el inicio de un compañero, sin el año.
    await peer.page.goto('/en/app/people', { waitUntil: 'networkidle' });
    const coming = peer.page.getByTestId('people-celebrations');
    await expect(coming).toContainText(emp.name);
    await expect(coming).toContainText('Birthday');
    expect(await peer.page.content()).not.toContain('1991');

    // HR cambia el puesto: queda en el historial, que el manager ve y el compañero no.
    await page.goto(`/en/app/people/${empId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('#pe-title').fill('Senior Analyst');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Job history' }).click();
    const history = page.getByTestId('people-history');
    await expect(history).toContainText('Senior Analyst');
    await boss.page.goto(`/en/app/people/${empId}?tab=history`, { waitUntil: 'networkidle' });
    await expect(boss.page.getByTestId('people-history')).toContainText('Senior Analyst');
    await peer.page.goto(`/en/app/people/${empId}`, { waitUntil: 'networkidle' });
    await expect(peer.page.getByRole('tab', { name: 'Job history' })).toHaveCount(0);

    // HR agenda un cambio; el manager no lo ve; se cancela.
    const scheduled = page.getByTestId('people-scheduled');
    await scheduled.getByRole('button', { name: 'Schedule a change' }).click();
    await page.locator('#sch-date').fill('2099-03-01');
    await page.locator('#sch-title').fill('Chief Wizard');
    await dialogButton(page, 'Schedule a change').click();
    await expect(scheduled).toContainText('Chief Wizard');
    await boss.page.reload({ waitUntil: 'networkidle' });
    await expect(boss.page.locator('body')).not.toContainText('Chief Wizard');
    await scheduled.getByRole('button', { name: 'Cancel' }).click();
    await expect(scheduled).toContainText('Nothing scheduled.');

    // Apaga la aprobación para no afectar a otros tests.
    expect((await request.patch('/api/people/settings', { data: { approveChanges: false } })).ok()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    for (const p of [boss, emp, peer]) await p.ctx.close();
  }
});

test('People: encuesta, reporte, pares, políticas y organigrama', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const errors = watch(page);
  const boss = await person(browser, baseURL!, `Lead${uid()}`);
  const a = await person(browser, baseURL!, `Ana${uid()}`);
  const b = await person(browser, baseURL!, `Beto${uid()}`);
  try {
    for (const p of [boss, a, b]) expect((await p.ctx.request.get('/api/people/me')).ok()).toBe(true);
    expect((await request.post('/api/people/me')).ok()).toBe(true);
    const { employees } = (await (await request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
    const idOf = (p: Person) => employees.find((e) => e.userId === p.id)!.id;
    for (const p of [a, b]) expect((await request.patch(`/api/people/employees/${idOf(p)}`, { data: { managerId: idOf(boss), department: 'Ops' } })).ok()).toBe(true);

    // Encuesta: HR la abre y tres personas responden en el navegador.
    const question = `Recommend us ${uid()}?`;
    await page.goto('/en/app/people/reviews', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New eNPS survey' }).click();
    await page.locator('#svy-q').fill(question);
    await dialogButton(page, 'Open survey').click();
    const card = page.locator('article', { hasText: question });
    await expect(card).toContainText('0 answers so far');
    for (const [p, score] of [[a, '10'], [b, '9'], [boss, '3']] as Array<[Person, string]>) {
      await p.page.goto('/en/app/people/reviews', { waitUntil: 'networkidle' });
      const mine = p.page.locator('article', { hasText: question });
      await mine.locator('label', { hasText: new RegExp(`^${score}$`) }).click();
      await mine.getByRole('button', { name: 'Send answer' }).click();
      await expect(mine).toContainText('your answer is in');
      await p.page.reload({ waitUntil: 'networkidle' });
      await expect(p.page.locator('article', { hasText: question }).getByRole('button', { name: 'Send answer' })).toHaveCount(0);
      await expect(p.page.getByTestId('people-enps')).toHaveCount(0);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('article', { hasText: question }).getByTestId('people-enps')).toHaveText('+33');

    // ⌘K encuentra la encuesta.
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search' });
    await palette.getByRole('combobox').fill(question);
    await expect(palette.getByRole('option', { name: new RegExp(question.replace('?', '')) }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Reporte a medida: columnas, vista, guardar, renombrar, borrar; CSV.
    const reportName = `Ops list ${uid()}`;
    await page.goto('/en/app/people/reports', { waitUntil: 'networkidle' });
    const box = page.getByTestId('people-custom-reports');
    await box.getByRole('checkbox', { name: 'Manager', exact: true }).check();
    await box.getByRole('combobox', { name: 'Department' }).selectOption('Ops');
    await box.getByRole('button', { name: 'Run report' }).click();
    await expect(box.getByTestId('people-report-table')).toContainText(a.name);
    await expect(box.getByTestId('people-report-table')).toContainText(boss.name);
    await expect(box.getByTestId('people-report-table')).not.toContainText('Salary');
    const [download] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: 'Download CSV' }).click()]);
    expect(download.suggestedFilename()).toBe('people-report.csv');
    await box.getByLabel('Report name').fill(reportName);
    await box.getByRole('button', { name: 'Save report' }).click();
    await expect(box.getByRole('button', { name: reportName, exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await box.getByRole('button', { name: `Rename ${reportName}` }).click();
    await page.locator('#rpt-name').fill(`${reportName} v2`);
    await dialogButton(page, 'Save').click();
    await expect(box.getByRole('button', { name: `${reportName} v2`, exact: true })).toBeVisible();
    await box.getByRole('button', { name: `Delete ${reportName} v2` }).click();
    await expect(box.getByRole('button', { name: `${reportName} v2`, exact: true })).toHaveCount(0);
    expect((await a.ctx.request.post('/api/people/custom-reports', { data: { config: { columns: ['name'] } } })).status()).toBe(403);

    // Par a mano: el manager lo suma y a esa persona le aparece para escribir.
    const created = (await (await request.post('/api/people/cycles', { data: { name: `Cycle ${uid()}`, selfReview: true, managerReview: true } })).json()) as { cycle: { id: string; name: string } };
    expect((await request.post(`/api/people/cycles/${created.cycle.id}/launch`, { data: {} })).ok()).toBe(true);
    await boss.page.goto(`/en/app/people/reviews/${created.cycle.id}`, { waitUntil: 'networkidle' });
    await boss.page.getByRole('combobox', { name: `Add a peer reviewer for ${a.name}` }).selectOption({ label: b.name });
    await boss.page.getByRole('combobox', { name: `Add a peer reviewer for ${a.name}` }).locator('xpath=..').getByRole('button', { name: 'Add peer' }).click();
    await b.page.goto('/en/app/people/reviews', { waitUntil: 'networkidle' });
    await expect(b.page.getByTestId('people-to-write')).toContainText(`Review of ${a.name}`);

    // Política con alcance y niveles, desde Ajustes.
    const policyName = `Only MX ${uid()}`;
    await page.goto('/en/app/people/settings', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'New policy' }).click();
    await page.locator('#pol-name').fill(policyName);
    await page.locator('#pol-levels').fill('3=18, 5=20');
    await page.locator('#pol-sc').fill('MX');
    await dialogButton(page, 'Save').click();
    await expect(page.getByTestId('people-policies')).toContainText(policyName);
    await a.page.goto('/en/app/people/time-off', { waitUntil: 'networkidle' });
    await expect(a.page.locator('main')).not.toContainText(policyName);
    expect((await request.patch(`/api/people/employees/${idOf(a)}`, { data: { country: 'MX' } })).ok()).toBe(true);
    await a.page.reload({ waitUntil: 'networkidle' });
    await expect(a.page.locator('main')).toContainText(policyName);

    // Organigrama: legible al abrir y sin bloquear el scroll del teléfono.
    await page.goto('/en/app/people/org', { waitUntil: 'networkidle' });
    const org = page.getByTestId('people-org');
    await expect(org).toBeVisible();
    expect(await org.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
    await expect(page.getByLabel('Org chart').or(page.locator('.ppl-org-tools')).first()).toContainText('50%');
    expect(errors).toEqual([]);
  } finally {
    for (const p of [boss, a, b]) await p.ctx.close();
  }
});

test('Hiring: cadena de aprobación, confidencial, importar, copiar, fusionar y contratar', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(300_000);
  const errors = watch(page);
  const approver = await person(browser, baseURL!, `Appr${uid()}`, '["hiring"]');
  const interviewer = await person(browser, baseURL!, `Intv${uid()}`, '["hiring"]');
  try {
    // Admin elige el aprobador en Ajustes.
    await page.goto('/en/app/hiring/settings', { waitUntil: 'networkidle' });
    const approvers = page.getByTestId('hiring-approvers');
    await approvers.getByRole('combobox', { name: /To publish a new job/ }).selectOption({ label: approver.name });
    await approvers.getByRole('combobox', { name: /To send an offer/ }).selectOption({ label: approver.name });
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByText('Saved.')).toBeVisible();
    const { settings } = (await (await request.get('/api/hiring/settings')).json()) as { settings: { handle: string; published: boolean } };
    expect((await request.put('/api/hiring/settings', { data: { published: true } })).ok()).toBe(true);

    // El puesto nuevo no se publica sin la cadena.
    const title = `Role ${uid()}`;
    const job = (await (await request.post('/api/hiring/jobs', { data: { title, description: 'Do things', department: 'Ops' } })).json()) as { job: { id: string; slug: string }; stages: Array<{ id: string; name: string; kind: string }> };
    const jobId = job.job.id;
    await page.goto(`/en/app/hiring/jobs/${jobId}/edit`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await page.getByTestId('hiring-request-approval').click();
    await expect(page.getByTestId('hiring-job-approval')).toContainText(approver.name);

    // El aprobador lo ve en su inicio y aprueba.
    await approver.page.goto('/en/app/hiring', { waitUntil: 'networkidle' });
    await approver.page.getByTestId('hiring-approvals').getByRole('link', { name: new RegExp(title) }).click();
    await expect(approver.page).toHaveURL(new RegExp(`/jobs/${jobId}/edit`));
    await approver.page.getByTestId('hiring-job-approval').getByRole('button', { name: 'Approve' }).click();
    await expect(approver.page.getByTestId('hiring-job-approval')).toContainText('Approved');

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.locator('main')).toContainText('Published');

    // Confidencial: fuera de la página pública; el miembro de afuera no lo ve.
    const secret = (await (await request.post('/api/hiring/jobs', { data: { title: `Secret ${uid()}`, description: 'x' } })).json()) as { job: { id: string; title: string; slug: string } };
    await page.goto(`/en/app/hiring/jobs/${secret.job.id}/edit`, { waitUntil: 'networkidle' });
    await page.getByTestId('hiring-confidential').check();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.').first()).toBeVisible();
    await interviewer.page.goto('/en/app/hiring/jobs?status=all', { waitUntil: 'networkidle' });
    await expect(interviewer.page.locator('main')).not.toContainText(secret.job.title);
    await expect(interviewer.page.locator('main')).toContainText(title);

    // Importar candidatos con vista previa.
    const imported = `Imp ${uid()}`;
    await page.goto(`/en/app/hiring/jobs/${jobId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.getByTestId('csv-file').setInputFiles({ name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from(`Name,Email\n${imported},imp-${uid()}@x.co\nNo mail,\n`) });
    await dialogButton(page, 'Check the file').click();
    await expect(page.getByTestId('csv-summary')).toContainText('1 candidate');
    await expect(page.getByTestId('csv-failed')).toContainText('Line 3');
    await dialogButton(page, 'Import').click();
    await expect(page.locator('main')).toContainText(imported);

    // Dos postulaciones públicas con el mismo email: se fusionan desde el perfil.
    const other = (await (await request.post('/api/hiring/jobs', { data: { title: `Other ${uid()}`, description: 'x' } })).json()) as { job: { id: string; slug: string; title: string } };
    await request.put(`/api/hiring/settings`, { data: { jobApprovers: [] } });
    expect((await request.patch(`/api/hiring/jobs/${other.job.id}`, { data: { status: 'published' } })).ok()).toBe(true);
    const email = `twin-${uid()}@x.co`;
    const apply = (slug: string, name: string) =>
      request.post('/api/hiring/public/apply', {
        multipart: { handle: settings.handle, job: slug, name, email, consent: 'on', resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') } },
      });
    const appliedName = `Twin ${uid()}`;
    expect((await apply(job.job.slug, appliedName)).ok()).toBe(true);
    expect((await apply(other.job.slug, `${appliedName} B`)).ok()).toBe(true);
    const found = (await (await request.get(`/api/hiring/applications?q=${encodeURIComponent(appliedName)}&status=all`)).json()) as { applications: Array<{ id: string; candidateId: string; name: string; jobId: string }> };
    expect(found.applications).toHaveLength(2);
    const keep = found.applications.find((x) => x.name === appliedName)!;
    await page.goto(`/en/app/hiring/candidates/${keep.candidateId}`, { waitUntil: 'networkidle' });
    await page.getByTestId('hiring-merge').click();
    await dialogButton(page, 'Merge').click();
    await expect(page.getByText('Merged.')).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('tab', { name: other.job.title })).toBeVisible();

    // Copiar otro candidato a otro puesto.
    const third = (await (await request.post('/api/hiring/applications', { data: { jobId, name: `Copy ${uid()}`, email: `copy-${uid()}@x.co` } })).json()) as { candidateId: string };
    await page.goto(`/en/app/hiring/candidates/${third.candidateId}`, { waitUntil: 'networkidle' });
    await page.getByTestId('hiring-copy').click();
    await page.getByRole('dialog').getByRole('combobox').selectOption({ label: other.job.title });
    await dialogButton(page, 'Copy').click();
    await expect(page.getByRole('tab', { name: other.job.title })).toBeVisible();

    // Motivo de rechazo con reporte.
    const rejected = (await (await request.post('/api/hiring/applications', { data: { jobId, name: `Rej ${uid()}`, email: `rej-${uid()}@x.co` } })).json()) as { candidateId: string };
    await page.goto(`/en/app/hiring/candidates/${rejected.candidateId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Reason (internal)').fill('Salary expectations');
    await page.getByRole('dialog').getByRole('checkbox').first().uncheck();
    await dialogButton(page, 'Reject').click();
    await page.goto('/en/app/hiring/reports', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('hiring-reject-reasons')).toContainText('Salary expectations');

    // Guía de entrevista: quien evalúa la ve arriba del scorecard.
    const detail = (await (await request.get(`/api/hiring/jobs/${jobId}`)).json()) as { stages: Array<{ id: string; name: string; kind: string; criteria: Array<{ id: string; label: string }> }> };
    const question = `What did you ship ${uid()}?`;
    const stages = detail.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, criteria: s.kind === 'interview' ? [{ id: 'skills', label: 'Skills' }] : [], kit: s.kind === 'interview' ? [question] : [] }));
    expect((await request.put(`/api/hiring/jobs/${jobId}/stages`, { data: { stages } })).ok()).toBe(true);
    expect((await request.put(`/api/hiring/jobs/${jobId}/team`, { data: { members: [{ userId: 'demo', role: 'recruiter' }, { userId: approver.id, role: 'hiring_manager' }, { userId: interviewer.id, role: 'interviewer' }] } })).ok()).toBe(true);
    const hireName = `Hire ${uid()}`;
    const hire = (await (await request.post('/api/hiring/applications', { data: { jobId, name: hireName, email: `hire-${uid()}@x.co` } })).json()) as { candidateId: string; applicationId: string };
    const interviewStage = detail.stages.find((s) => s.kind === 'interview')!;
    expect((await request.patch(`/api/hiring/applications/${hire.applicationId}`, { data: { action: 'move', stageId: interviewStage.id } })).ok()).toBe(true);
    await interviewer.page.goto(`/en/app/hiring/candidates/${hire.candidateId}`, { waitUntil: 'networkidle' });
    await interviewer.page.getByRole('tab', { name: 'Scorecards' }).click();
    await expect(interviewer.page.getByTestId('hiring-kit')).toContainText(question);

    // Oferta con cadena: el recruiter no la aprueba; el aprobador sí.
    expect((await request.post(`/api/hiring/applications/${hire.applicationId}/offers`, { data: { salary: 100, currency: 'USD', body: 'Welcome', startDate: '2099-02-01' } })).ok()).toBe(true);
    await page.goto(`/en/app/hiring/candidates/${hire.candidateId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Offers' }).click();
    await expect(page.getByTestId('hiring-offer-chain')).toContainText(approver.name);
    await expect(page.getByTestId('hiring-offer-chain').getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await approver.page.goto(`/en/app/hiring/candidates/${hire.candidateId}`, { waitUntil: 'networkidle' });
    await approver.page.getByRole('tab', { name: 'Offers' }).click();
    await approver.page.getByTestId('hiring-offer-chain').getByRole('button', { name: 'Approve' }).click();
    await expect(approver.page.getByTestId('hiring-offer-chain')).toHaveCount(0);

    // Contratar: llega a People como ficha en onboarding, sin sueldo.
    expect((await request.get('/api/people/me')).ok()).toBe(true);
    const hiredStage = detail.stages.find((s) => s.kind === 'hired')!;
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByLabel('Stage', { exact: true }).selectOption(hiredStage.id);
    await page.waitForLoadState('networkidle');
    await page.goto('/en/app/people', { waitUntil: 'networkidle' });
    const row = page.getByTestId('people-row').filter({ hasText: hireName });
    await expect(row).toContainText('Starting soon');
    await row.getByRole('link').click();
    await page.getByRole('tab', { name: 'Compensation' }).click();
    await expect(page.locator('main')).not.toContainText('100');

    // Exportar lo que se ve.
    const csv = await (await request.get('/api/hiring/export?status=all')).text();
    expect(csv).toContain(hireName);
    expect(errors).toEqual([]);
  } finally {
    await request.put('/api/hiring/settings', { data: { jobApprovers: [], offerApprovers: [] } });
    await approver.ctx.close();
    await interviewer.ctx.close();
  }
});
