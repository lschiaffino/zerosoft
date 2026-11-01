import { createClient } from '@libsql/client';
import { mkdirSync } from 'fs';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Pasada visual local (no se commitea): siembra datos y saca capturas de cada pantalla.
const OUT = process.env.LOOK_DIR ?? '/tmp/ph-look';
const WIDTHS = (process.env.LOOK_WIDTHS ?? '390,1280').split(',').map(Number);
const THEMES = (process.env.LOOK_THEMES ?? 'light').split(',') as Array<'light' | 'dark'>;
const uid = () => Math.random().toString(36).slice(2, 7);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function member(browser: Browser, baseURL: string, name: string) {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `look-${name.toLowerCase().replace(/\W+/g, '')}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  await page.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [name, id]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, id, 'member', '*']);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  expect((await ctx.request.get('/api/people/me')).ok()).toBe(true);
  return { ctx, id, name };
}

interface Report {
  url: string;
  width: number;
  overflow: number;
  clipped: string[];
  errors: string[];
}
const reports: Report[] = [];

async function snap(page: Page, name: string, url: string, width: number, theme: string, tall = true) {
  const errors: string[] = [];
  const onErr = (e: Error) => errors.push(e.message.slice(0, 160));
  page.on('pageerror', onErr);
  await page.setViewportSize({ width, height: width < 700 ? 800 : 900 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => {
    const d = document.documentElement;
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > d.clientWidth + 1 && !el.closest('.table-wrap,.hr-board,.ppl-org,.ui-tabs,[data-scroll]')) clipped.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
    }
    return { overflow: d.scrollWidth - d.clientWidth, clipped: clipped.slice(0, 5) };
  });
  reports.push({ url, width, overflow: metrics.overflow, clipped: metrics.clipped, errors });
  await page.screenshot({ path: `${OUT}/${name}-${theme}-${width}.png`, fullPage: tall });
  page.off('pageerror', onErr);
}

test('capturas de People y Hiring', async ({ browser, baseURL, request }) => {
  test.setTimeout(1_500_000);
  mkdirSync(OUT, { recursive: true });
  const boss = await member(browser, baseURL!, 'Bruna Boss');
  const emp = await member(browser, baseURL!, 'María José Fernández de la Cruz Rodríguez');
  const peer = await member(browser, baseURL!, 'Pedro Paz');
  expect((await request.post('/api/people/me')).ok()).toBe(true);
  const { employees } = (await (await request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
  const idOf = (u: string) => employees.find((e) => e.userId === u)!.id;
  const [bossId, empId, peerId] = [idOf(boss.id), idOf(emp.id), idOf(peer.id)];
  const demoId = employees.find((e) => e.userId === 'demo')?.id ?? null;
  const y = new Date().getUTCFullYear();
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(5, 10);
  await request.patch(`/api/people/employees/${bossId}`, { data: { managerId: demoId, jobTitle: 'Head of Engineering and Platform Operations', department: 'Engineering', location: 'Buenos Aires', country: 'AR', startDate: `${y - 3}-${soon}` } });
  await request.patch(`/api/people/employees/${empId}`, { data: { managerId: bossId, jobTitle: 'Senior Software Engineer II', department: 'Engineering', location: 'Ciudad Autónoma de Buenos Aires', country: 'AR', startDate: '2022-02-01', personal: { birthDate: `1990-${soon}`, address: 'Av. Siempreviva 742' }, phone: '+54 9 11 5555 0000' } });
  await request.patch(`/api/people/employees/${peerId}`, { data: { managerId: bossId, jobTitle: 'Designer', department: 'Design', location: 'Montevideo', startDate: '2024-06-10' } });
  for (let i = 0; i < 9; i++) await request.post('/api/people/employees', { data: { name: `Persona ${i} Ejemplo`, jobTitle: 'Account Executive', department: i % 2 ? 'Sales' : 'Support', location: 'CDMX', managerId: bossId, startDate: '2023-01-15' } });
  await request.post(`/api/people/employees/${empId}/compensation`, { data: { amount: 90000, currency: 'USD', period: 'year', reason: 'hire', effectiveDate: '2024-01-01' } });
  await request.post(`/api/people/employees/${empId}/scheduled`, { data: { effectiveDate: '2099-01-01', changes: { jobTitle: 'Staff Engineer' } } });
  await request.patch('/api/people/settings', { data: { approveChanges: true } });
  await emp.ctx.request.patch(`/api/people/employees/${empId}`, { data: { phone: '+54 9 11 4444 1111' } });
  const pols = (await (await request.get('/api/people/settings')).json()) as { policies: Array<{ id: string }> };
  await emp.ctx.request.post('/api/people/time-off', { data: { policyId: pols.policies[0].id, startDate: `${y + 1}-03-02`, endDate: `${y + 1}-03-06` } });
  const cycle = (await (await request.post('/api/people/cycles', { data: { name: 'Evaluación anual de desempeño', selfReview: true, managerReview: true, peerReview: true } })).json()) as { cycle: { id: string } };
  await request.post(`/api/people/cycles/${cycle.cycle.id}/launch`, { data: {} });
  await request.post('/api/people/surveys', { data: { question: 'How likely are you to recommend working here to a friend?' } });
  const survey = (await (await request.get('/api/people/surveys')).json()) as { surveys: Array<{ id: string }> };
  await emp.ctx.request.post(`/api/people/surveys/${survey.surveys[0].id}`, { data: { score: 9, comment: 'Muy buen equipo' } });
  await peer.ctx.request.post(`/api/people/surveys/${survey.surveys[0].id}`, { data: { score: 4 } });
  await boss.ctx.request.post(`/api/people/surveys/${survey.surveys[0].id}`, { data: { score: 7 } });
  await request.post('/api/people/surveys', { data: { question: 'Second survey still open' } });

  // Hiring
  const job = (await (await request.post('/api/hiring/jobs', { data: { title: 'Senior Backend Engineer, Payments and Reconciliation Platform', department: 'Engineering', location: 'Remote LATAM', description: '## Role\nBuild things.', salaryMin: 50000, salaryMax: 90000 } })).json()) as { job: { id: string }; stages: Array<{ id: string; name: string; criteria: unknown[]; kind: string }> };
  await request.put(`/api/hiring/jobs/${job.job.id}/team`, { data: { members: [{ userId: 'demo', role: 'recruiter' }, { userId: boss.id, role: 'hiring_manager' }, { userId: peer.id, role: 'interviewer' }] } });
  await request.patch(`/api/hiring/jobs/${job.job.id}`, { data: { status: 'published', questions: [{ id: 'visa', label: 'Do you have a work visa?', type: 'yesno', required: true, options: [], knockout: { accepted: ['yes'], min: null, autoReject: true } }] } });
  await request.post('/api/hiring/jobs', { data: { title: 'Draft Designer', description: 'x', confidential: true } });
  const cands: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await request.post('/api/hiring/applications', { data: { jobId: job.job.id, name: i === 0 ? 'Alexandria Montserrat Hernández-Villanueva' : `Candidata ${i}`, email: `cand-${i}-${uid()}@example.com`, source: i % 2 ? 'linkedin' : 'referral', tags: ['backend', 'latam'] } });
    cands.push(((await r.json()) as { candidateId: string; applicationId: string }).candidateId);
  }
  const apps = (await (await request.get(`/api/hiring/applications?jobId=${job.job.id}`)).json()) as { applications: Array<{ id: string; candidateId: string }> };
  await request.patch(`/api/hiring/applications/${apps.applications[1].id}`, { data: { action: 'reject', reason: 'Salary expectations' } });
  await request.post(`/api/hiring/applications/${apps.applications[0].id}/offers`, { data: { salary: 70000, currency: 'USD', body: 'Welcome' } });
  await request.put('/api/hiring/settings', { data: { published: true, offerApprovers: [] } });

  const screens: Array<[string, string]> = [
    ['p-directory', '/en/app/people'],
    ['p-org', '/en/app/people/org'],
    ['p-profile', `/en/app/people/${empId}`],
    ['p-profile-history', `/en/app/people/${empId}?tab=history`],
    ['p-profile-comp', `/en/app/people/${empId}?tab=compensation`],
    ['p-profile-timeoff', `/en/app/people/${empId}?tab=timeoff`],
    ['p-profile-docs', `/en/app/people/${empId}?tab=documents`],
    ['p-timeoff', '/en/app/people/time-off?tab=approvals'],
    ['p-onboarding', '/en/app/people/onboarding'],
    ['p-reviews', '/en/app/people/reviews'],
    ['p-cycle', `/en/app/people/reviews/${cycle.cycle.id}`],
    ['p-reports', '/en/app/people/reports'],
    ['p-settings-policies', '/en/app/people/settings'],
    ['p-settings-changes', '/en/app/people/settings?tab=changes'],
    ['h-overview', '/en/app/hiring'],
    ['h-jobs', '/en/app/hiring/jobs?status=all'],
    ['h-new', '/en/app/hiring/jobs/new'],
    ['h-pipeline', `/en/app/hiring/jobs/${job.job.id}`],
    ['h-pipeline-list', `/en/app/hiring/jobs/${job.job.id}?view=list`],
    ['h-edit', `/en/app/hiring/jobs/${job.job.id}/edit`],
    ['h-edit-questions', `/en/app/hiring/jobs/${job.job.id}/edit?tab=questions`],
    ['h-edit-stages', `/en/app/hiring/jobs/${job.job.id}/edit?tab=stages`],
    ['h-candidates', '/en/app/hiring/candidates'],
    ['h-candidate', `/en/app/hiring/candidates/${cands[0]}`],
    ['h-reports', '/en/app/hiring/reports'],
    ['h-templates', '/en/app/hiring/templates'],
    ['h-settings', '/en/app/hiring/settings'],
  ];
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ baseURL, colorScheme: theme });
    const page = await ctx.newPage();
    for (const w of WIDTHS) for (const [name, url] of screens) await snap(page, name, url, w, theme);
    // Empleado: lo que ve él.
    await ctx.close();
  }
  const empPage = await emp.ctx.newPage();
  for (const w of WIDTHS) {
    await snap(empPage, 'emp-directory', '/en/app/people', w, 'light');
    await snap(empPage, 'emp-reviews', '/en/app/people/reviews', w, 'light');
    await snap(empPage, 'emp-profile', `/en/app/people/${empId}`, w, 'light');
    await snap(empPage, 'emp-org', '/en/app/people/org', w, 'light');
  }
  const bad = reports.filter((r) => r.overflow > 0 || r.clipped.length || r.errors.length);
  // eslint-disable-next-line no-console
  console.log('LOOKREPORT', JSON.stringify(bad, null, 0));
});
