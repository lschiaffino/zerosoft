import fs from 'fs';
import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * People y Hiring con sesiones reales: cada rol entra con su código por email y
 * aceptó su invitación. Sueldos, salidas, puestos confidenciales y aprobaciones,
 * mirando también el HTML de las páginas, Cmd+K y las API keys de cada persona.
 */

// Empieza con letra: seis dígitos seguidos en el email se confundirían con el código.
const uid = () => `x${Math.random().toString(36).slice(2, 8)}`;
let ip = 100;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function lastCode(email: string): string {
  const lines = fs.readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').trim().split('\n').filter(Boolean);
  const mail = lines.map((l) => JSON.parse(l) as { to: string; text: string }).reverse().find((m) => m.to === email);
  return /\b(\d{6})\b/.exec(mail!.text)![1];
}

interface Person {
  ctx: BrowserContext;
  page: Page;
  email: string;
  id: string;
}

async function signIn(browser: Browser, name: string): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `${name.toLowerCase()}-${uid()}@real-e2e.io`;
  ip += 1;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 860 }, extraHTTPHeaders: { 'x-forwarded-for': `10.21.${ip % 250}.7` } });
  const sent = await ctx.request.post('/api/auth/email-code', { data: { email, locale: 'en' } });
  expect(sent.ok(), await sent.text()).toBe(true);
  await expect.poll(() => (fs.existsSync(process.env.E2E_MAIL_FILE!) ? fs.readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').includes(email) : false)).toBe(true);
  const { csrfToken } = (await (await ctx.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  await ctx.request.post('/api/auth/callback/email-code', { form: { csrfToken, email, code: lastCode(email), json: 'true', callbackUrl: `${baseURL}/en/app` } });
  const session = (await (await ctx.request.get('/api/auth/session')).json()) as { user?: { email?: string } };
  expect(session.user?.email).toBe(email);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  return { ctx, page: await ctx.newPage(), email, id };
}

async function owner(browser: Browser): Promise<Person> {
  const p = await signIn(browser, 'owner');
  const res = await p.ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', teamName: `Acme ${uid()}`, size: '2-10', name: 'Olga Owner' } });
  expect(res.ok(), await res.text()).toBe(true);
  return p;
}

async function join(browser: Browser, by: Person, name: string, role: 'admin' | 'member', apps: '*' | string[]): Promise<Person> {
  const p = await signIn(browser, name);
  const res = await by.ctx.request.post('/api/teams/invites', { data: { emails: p.email, role, apps } });
  expect(res.status(), await res.text()).toBe(201);
  const { results } = (await res.json()) as { results: Array<{ url: string }> };
  const token = results[0].url.split('/invite/')[1].split('?')[0];
  expect((await p.ctx.request.post('/api/teams/accept', { data: { token } })).ok()).toBe(true);
  expect((await p.ctx.request.post('/api/onboarding', { data: { kind: 'invited', name } })).ok()).toBe(true);
  return p;
}

const closeAll = async (...people: Person[]) => {
  for (const p of people) await Promise.race([p.ctx.close().catch(() => undefined), new Promise((done) => setTimeout(done, 5000))]);
};

async function html(p: Person, url: string): Promise<string> {
  await p.page.goto(url, { waitUntil: 'networkidle' });
  return p.page.content();
}

async function keyOf(p: Person, scopes: string[]): Promise<string> {
  const res = await p.ctx.request.post('/api/keys', { data: { name: `k-${uid()}`, scopes } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

interface PeopleWorld {
  olga: Person;
  ada: Person;
  hrp: Person;
  boss: Person;
  emp: Person;
  peer: Person;
  noApp: Person;
  ids: Record<'boss' | 'emp' | 'peer', string>;
}

async function peopleWorld(browser: Browser): Promise<PeopleWorld> {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  const hrp = await join(browser, olga, 'Helena', 'member', '*');
  const boss = await join(browser, olga, 'Bruna', 'member', '*');
  const emp = await join(browser, olga, 'Emma', 'member', '*');
  const peer = await join(browser, olga, 'Pedro', 'member', '*');
  const noApp = await join(browser, olga, 'Nora', 'member', ['crm']);
  expect((await olga.ctx.request.get('/api/people/me')).ok()).toBe(true);
  expect((await olga.ctx.request.post('/api/people/me')).ok()).toBe(true);
  const { employees } = (await (await olga.ctx.request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
  const idOf = (p: Person) => employees.find((e) => e.userId === p.id)!.id;
  const ids = { boss: idOf(boss), emp: idOf(emp), peer: idOf(peer) };
  for (const k of ['emp', 'peer'] as const) expect((await olga.ctx.request.patch(`/api/people/employees/${ids[k]}`, { data: { managerId: ids.boss } })).ok()).toBe(true);
  expect((await olga.ctx.request.patch('/api/people/settings', { data: { hrAdmins: [hrp.id] } })).ok()).toBe(true);
  return { olga, ada, hrp, boss, emp, peer, noApp, ids };
}

const closeWorld = (w: PeopleWorld) => closeAll(w.olga, w.ada, w.hrp, w.boss, w.emp, w.peer, w.noApp);

test('sueldo: owner, HR marcado y la persona; ni admin, ni manager, ni compañero, por ningún canal', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    const salary = 834201;
    const address = `Calle Real ${uid()}`;
    const url = `/api/people/employees/${w.ids.emp}/compensation`;
    const added = await w.olga.ctx.request.post(url, { data: { amount: salary, currency: 'USD', period: 'year', reason: 'hire', effectiveDate: '2024-01-01' } });
    expect(added.ok(), await added.text()).toBe(true);
    expect((await w.emp.ctx.request.patch(`/api/people/employees/${w.ids.emp}`, { data: { personal: { address } } })).ok()).toBe(true);

    for (const p of [w.olga, w.hrp, w.emp]) expect(await (await p.ctx.request.get(url)).text(), p.email).toContain(String(salary));
    for (const p of [w.ada, w.boss, w.peer]) {
      expect((await p.ctx.request.get(url)).status(), p.email).toBe(403);
      expect((await p.ctx.request.get('/api/people/export')).status(), p.email).toBe(403);
      expect((await p.ctx.request.post(url, { data: { amount: 1, currency: 'USD', period: 'year', reason: 'x', effectiveDate: '2024-01-01' } })).status(), p.email).toBe(403);
      expect(await html(p, `/en/app/people/${w.ids.emp}?tab=compensation`), p.email).not.toContain(String(salary));
      expect(await (await p.ctx.request.get(`/api/search?q=${encodeURIComponent(String(salary))}`)).text(), p.email).not.toContain(w.ids.emp);
    }
    expect((await w.noApp.ctx.request.get(url)).status()).toBe(401);
    await w.noApp.page.goto(`/en/app/people/${w.ids.emp}`, { waitUntil: 'networkidle' });
    await expect(w.noApp.page).toHaveURL(/blocked=people/);

    // Los datos personales: la persona y HR (owner, admin, marcado); un compañero y el manager, no.
    for (const p of [w.peer, w.boss]) expect(await (await p.ctx.request.get(`/api/people/employees/${w.ids.emp}`)).text(), p.email).not.toContain(address);
    expect(await (await w.olga.ctx.request.get(`/api/people/employees/${w.ids.emp}`)).text()).toContain(address);

    // La API key de cada persona lee el directorio público, nunca el sueldo, tampoco la del owner.
    for (const p of [w.olga, w.peer]) {
      const key = await keyOf(p, ['people:read']);
      const body = await (await p.ctx.request.get('/api/v1/people/employees', { headers: { authorization: `Bearer ${key}` } })).text();
      expect(body, p.email).toContain(w.ids.emp);
      expect(body, p.email).not.toContain(String(salary));
      expect(body, p.email).not.toContain(address);
    }
    expect((await w.noApp.ctx.request.post('/api/keys', { data: { name: 'nope', scopes: ['people:read'] } })).status()).toBe(403);

    // Reporte a medida y bitácora: HR; no el manager ni el compañero. No trae sueldos ni para HR.
    for (const p of [w.boss, w.peer]) {
      expect((await p.ctx.request.post('/api/people/custom-reports', { data: { config: { columns: ['name'] } } })).status(), p.email).toBe(403);
      expect((await p.ctx.request.get('/api/people/audit')).status(), p.email).toBe(403);
      expect((await p.ctx.request.post('/api/people/import', { data: { csv: 'Name\nX\n', dryRun: true } })).status(), p.email).toBe(403);
    }
    const report = await (await w.ada.ctx.request.post('/api/people/custom-reports', { data: { config: { columns: ['name', 'salary', 'compensation', 'personal'] } } })).text();
    expect(report).not.toContain(String(salary));
    expect(report).not.toContain(address);
  } finally {
    await closeWorld(w);
  }
});

test('salidas y bajas: un compañero no se entera; el manager y HR sí', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    const leaving = w.ids.peer;
    const offboard = await w.olga.ctx.request.post(`/api/people/employees/${leaving}/offboard`, { data: { endDate: '2099-01-01' } });
    expect(offboard.ok(), await offboard.text()).toBe(true);
    const statusFor = async (p: Person) => ((await (await p.ctx.request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; status: string }> }).employees.find((e) => e.id === leaving)?.status;
    expect(await statusFor(w.emp)).toBe('active');
    expect(await statusFor(w.boss)).toBe('offboarding');
    expect(await statusFor(w.ada)).toBe('offboarding');
    // La fila no lleva la insignia (el texto "Leaving" viaja con los mensajes de la app).
    await w.emp.page.goto('/en/app/people', { waitUntil: 'networkidle' });
    await expect(w.emp.page.locator('[data-testid="people-row"]', { hasText: 'Pedro' }).locator('.badge')).toHaveCount(0);
    expect(await (await w.emp.ctx.request.get(`/api/people/employees/${leaving}`)).text()).not.toContain('offboarding');
    expect(await (await w.emp.ctx.request.get('/api/people/employees?status=offboarding')).text()).not.toContain('"status":"offboarding"');
    const key = await keyOf(w.emp, ['people:read']);
    expect(await (await w.emp.ctx.request.get('/api/v1/people/employees', { headers: { authorization: `Bearer ${key}` } })).text()).not.toContain('offboarding');

    // Baja efectiva.
    expect((await w.olga.ctx.request.patch(`/api/people/employees/${leaving}`, { data: { status: 'terminated', endDate: '2020-01-01' } })).ok()).toBe(true);
    expect((await w.emp.ctx.request.get(`/api/people/employees/${leaving}`)).status()).toBe(404);
    expect(await (await w.emp.ctx.request.get('/api/people/employees?status=terminated')).text()).not.toContain(leaving);
    await w.emp.page.goto(`/en/app/people/${leaving}`, { waitUntil: 'networkidle' });
    expect(await w.emp.page.content()).not.toContain('Pedro');
    expect((await w.boss.ctx.request.get(`/api/people/employees/${leaving}`)).status()).toBe(200);
    expect((await w.ada.ctx.request.get(`/api/people/employees/${leaving}`)).status()).toBe(200);
  } finally {
    await closeWorld(w);
  }
});

test('aprobación de cambios: la persona pide, solo HR decide y nadie se aprueba a sí mismo', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    expect((await w.emp.ctx.request.patch('/api/people/settings', { data: { approveChanges: true } })).status()).toBe(403);
    expect((await w.olga.ctx.request.patch('/api/people/settings', { data: { approveChanges: true } })).ok()).toBe(true);
    expect((await w.emp.ctx.request.patch(`/api/people/employees/${w.ids.emp}`, { data: { phone: '555' } })).ok()).toBe(true);
    const seen = (await (await w.emp.ctx.request.get(`/api/people/employees/${w.ids.emp}`)).json()) as { employee: { phone: string; pendingChange: boolean } };
    expect(seen.employee.phone).not.toBe('555');
    expect(seen.employee.pendingChange).toBe(true);
    for (const p of [w.emp, w.boss, w.peer]) expect((await p.ctx.request.get('/api/people/changes')).status(), p.email).toBe(403);
    const { requests } = (await (await w.ada.ctx.request.get('/api/people/changes')).json()) as { requests: Array<{ id: string }> };
    expect(requests).toHaveLength(1);
    for (const p of [w.emp, w.boss]) expect((await p.ctx.request.patch(`/api/people/changes/${requests[0].id}`, { data: { decision: 'approve' } })).status(), p.email).toBe(403);
    expect((await w.ada.ctx.request.patch(`/api/people/changes/${requests[0].id}`, { data: { decision: 'approve' } })).ok()).toBe(true);
    const after = (await (await w.emp.ctx.request.get(`/api/people/employees/${w.ids.emp}`)).json()) as { employee: { phone: string; pendingChange: boolean } };
    expect(after.employee).toMatchObject({ phone: '555', pendingChange: false });
    // Con People, HR marcado edita lo suyo directo: no hay pedido que se apruebe solo.
    expect(((await (await w.hrp.ctx.request.get('/api/people/changes')).json()) as { requests: unknown[] }).requests).toHaveLength(0);
  } finally {
    await closeWorld(w);
  }
});

test('reportes: el período de pago no llega a un admin sin marca, ni guardado', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    const run = (p: Person, columns: string[]) => p.ctx.request.post('/api/people/custom-reports', { data: { config: { columns } } });
    const asAda = (await (await run(w.ada, ['name', 'payPeriod'])).json()) as { columns: Array<{ key: string }> };
    expect(asAda.columns.map((c) => c.key)).toEqual(['name']);
    expect((await run(w.ada, ['payPeriod'])).status()).toBe(400);
    const asHr = (await (await run(w.hrp, ['name', 'payPeriod'])).json()) as { columns: Array<{ key: string }> };
    expect(asHr.columns.map((c) => c.key)).toEqual(['name', 'payPeriod']);
    await w.ada.page.goto('/en/app/people/reports', { waitUntil: 'networkidle' });
    await expect(w.ada.page.getByTestId('people-custom-reports').getByRole('checkbox', { name: 'Pay period' })).toHaveCount(0);
  } finally {
    await closeWorld(w);
  }
});

test('encuesta: sin resultado antes de cerrar, ni bajo el mínimo, para nadie; quien se fue no responde; otro workspace no borra nada', async ({ browser }) => {
  const w = await peopleWorld(browser);
  const other = await owner(browser);
  try {
    const { id } = (await (await w.olga.ctx.request.post('/api/people/surveys', { data: { question: 'Recommend?' } })).json()) as { id: string };
    const answers: Array<[Person, number]> = [[w.emp, 10], [w.peer, 2], [w.boss, 9], [w.hrp, 8], [w.ada, 9]];
    const seen = async () => ((await (await w.olga.ctx.request.get('/api/people/surveys')).json()) as { surveys: Array<{ id: string; score: number | null; responses: number; comments: string[] }> }).surveys.find((s) => s.id === id)!;
    for (const [p, score] of answers) {
      expect((await p.ctx.request.post(`/api/people/surveys/${id}`, { data: { score, comment: 'hola' } })).status(), p.email).toBe(201);
      expect(await seen()).toMatchObject({ score: null, comments: [] });
    }
    // Otro workspace no toca respuestas.
    expect((await other.ctx.request.delete(`/api/people/surveys/${id}`)).status()).toBe(404);
    expect((await seen()).responses).toBe(5);
    expect((await w.olga.ctx.request.patch(`/api/people/surveys/${id}`, { data: {} })).ok()).toBe(true);
    expect((await seen()).score).toBe(40);
    const second = (await (await w.olga.ctx.request.post('/api/people/surveys', { data: { question: 'Again?' } })).json()) as { id: string };
    expect((await w.olga.ctx.request.patch(`/api/people/employees/${w.ids.peer}`, { data: { status: 'terminated', endDate: '2020-01-01' } })).ok()).toBe(true);
    expect((await w.peer.ctx.request.post(`/api/people/surveys/${second.id}`, { data: { score: 5 } })).status()).toBe(403);
  } finally {
    await closeAll(other);
    await closeWorld(w);
  }
});

test('contratar en un puesto confidencial no publica el título: directorio, API, v1 y aviso de HR', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    const title = `Secret CEO ${uid()}`;
    const created = await w.olga.ctx.request.post('/api/hiring/jobs', { data: { title, description: 'x', confidential: true } });
    expect(created.status(), await created.text()).toBe(201);
    const job = (await created.json()) as { job: { id: string }; stages: Array<{ id: string; kind: string }> };
    expect((await w.olga.ctx.request.patch(`/api/hiring/jobs/${job.job.id}`, { data: { status: 'published' } })).ok()).toBe(true);
    const name = `Hire ${uid()}`;
    const app = (await (await w.olga.ctx.request.post('/api/hiring/applications', { data: { jobId: job.job.id, name, email: `h-${uid()}@real-e2e.io` } })).json()) as { applicationId: string };
    const hired = job.stages.find((s) => s.kind === 'hired')!;
    expect((await w.olga.ctx.request.patch(`/api/hiring/applications/${app.applicationId}`, { data: { action: 'move', stageId: hired.id } })).ok()).toBe(true);
    await expect.poll(async () => (await (await w.emp.ctx.request.get('/api/people/employees')).text()).includes(name)).toBe(true);
    for (const p of [w.emp, w.peer, w.hrp, w.ada]) {
      expect(await (await p.ctx.request.get('/api/people/employees')).text(), p.email).not.toContain(title);
      expect(await html(p, '/en/app/people'), p.email).not.toContain(title);
      const found = await (await p.ctx.request.get(`/api/search?q=${encodeURIComponent(title)}`)).json() as { items: Array<{ group: string }> };
      expect(found.items.filter((i) => i.group === 'people'), p.email).toEqual([]);
    }
    const bell = await (await w.hrp.ctx.request.get('/api/notifications?limit=50')).text();
    expect(bell).not.toContain(title);
    const key = await keyOf(w.emp, ['people:read']);
    expect(await (await w.emp.ctx.request.get('/api/v1/people/employees', { headers: { authorization: `Bearer ${key}` } })).text()).not.toContain(title);
  } finally {
    await closeWorld(w);
  }
});

test('mover a un puesto confidencial no le muestra el título al equipo del puesto de origen', async ({ browser }) => {
  const olga = await owner(browser);
  const rita = await join(browser, olga, 'Rita', 'member', ['hiring']);
  const omar = await join(browser, olga, 'Omar', 'member', ['hiring']);
  try {
    const mk = async (title: string, extra: Record<string, unknown>, members: Array<{ userId: string; role: string }>) => {
      const id = ((await (await olga.ctx.request.post('/api/hiring/jobs', { data: { title, description: 'x', ...extra } })).json()) as { job: { id: string } }).job.id;
      expect((await olga.ctx.request.patch(`/api/hiring/jobs/${id}`, { data: { status: 'published' } })).ok()).toBe(true);
      expect((await olga.ctx.request.put(`/api/hiring/jobs/${id}/team`, { data: { members } })).ok()).toBe(true);
      return id;
    };
    const secretTitle = `Secret ${uid()}`;
    const open = await mk(`Open ${uid()}`, {}, [{ userId: rita.id, role: 'recruiter' }, { userId: omar.id, role: 'recruiter' }]);
    const secret = await mk(secretTitle, { confidential: true }, [{ userId: rita.id, role: 'recruiter' }]);
    const c = (await (await rita.ctx.request.post('/api/hiring/applications', { data: { jobId: open, name: `Cand ${uid()}`, email: `c-${uid()}@real-e2e.io` } })).json()) as { candidateId: string; applicationId: string };
    expect((await rita.ctx.request.post(`/api/hiring/applications/${c.applicationId}/copy`, { data: { jobId: secret, move: true } })).status()).toBe(201);
    expect(await (await omar.ctx.request.get(`/api/hiring/candidates/${c.candidateId}`)).text()).not.toContain(secretTitle);
    expect(await html(omar, `/en/app/hiring/candidates/${c.candidateId}`)).not.toContain(secretTitle);
  } finally {
    await closeAll(olga, rita, omar);
  }
});

test('Hiring: borrador, confidencial y salario oculto por rol, y cadena de aprobación en turno', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', ['hiring']);
  const rita = await join(browser, olga, 'Rita', 'member', ['hiring']);
  const ivan = await join(browser, olga, 'Ivan', 'member', ['hiring']);
  const omar = await join(browser, olga, 'Omar', 'member', ['hiring']);
  const appr = await join(browser, olga, 'Abel', 'member', ['hiring']);
  const nora = await join(browser, olga, 'Nora', 'member', ['crm']);
  try {
    const salary = 712345;
    const mk = async (title: string, extra: Record<string, unknown> = {}) => {
      const res = await olga.ctx.request.post('/api/hiring/jobs', { data: { title, description: 'Do things', salaryMax: salary, ...extra } });
      expect(res.status(), await res.text()).toBe(201);
      const id = ((await res.json()) as { job: { id: string } }).job.id;
      const team = await olga.ctx.request.put(`/api/hiring/jobs/${id}/team`, { data: { members: [{ userId: rita.id, role: 'recruiter' }, { userId: ivan.id, role: 'interviewer' }] } });
      expect(team.ok(), await team.text()).toBe(true);
      return id;
    };
    const [draftT, openT, secretT] = [`Draft ${uid()}`, `Open ${uid()}`, `Secret ${uid()}`];
    const [draft, open, secret] = [await mk(draftT), await mk(openT), await mk(secretT, { confidential: true })];
    for (const id of [open, secret]) expect((await olga.ctx.request.patch(`/api/hiring/jobs/${id}`, { data: { status: 'published' } })).ok()).toBe(true);
    const cand = `Cand ${uid()}`;
    const added = await rita.ctx.request.post('/api/hiring/applications', { data: { jobId: open, name: cand, email: `c-${uid()}@real-e2e.io` } });
    expect(added.status(), await added.text()).toBe(201);
    const { candidateId } = (await added.json()) as { candidateId: string };

    // Fuera del equipo.
    const list = await (await omar.ctx.request.get('/api/hiring/jobs?status=all')).text();
    expect(list).toContain(openT);
    for (const hidden of [draftT, secretT, String(salary)]) expect(list).not.toContain(hidden);
    for (const id of [draft, secret]) expect((await omar.ctx.request.get(`/api/hiring/jobs/${id}`)).status()).toBe(404);
    expect(await (await omar.ctx.request.get(`/api/hiring/jobs/${open}`)).text()).not.toContain(String(salary));
    for (const url of ['/en/app/hiring', '/en/app/hiring/jobs?status=all', `/en/app/hiring/jobs/${open}`, '/en/app/hiring/reports']) {
      const page = await html(omar, url);
      for (const hidden of [draftT, secretT, String(salary), cand]) expect(page, `${url} ${hidden}`).not.toContain(hidden);
    }
    for (const q of [draftT, secretT, cand]) {
      const found = (await (await omar.ctx.request.get(`/api/search?q=${encodeURIComponent(q)}`)).json()) as { items: Array<{ label: string }> };
      expect(found.items.filter((i) => i.label === q), q).toEqual([]);
    }
    expect((await omar.ctx.request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(404);
    expect(await (await omar.ctx.request.get('/api/hiring/export')).text()).not.toContain(cand);
    const key = await keyOf(omar, ['hiring:read']);
    const viaKey = await (await omar.ctx.request.get('/api/v1/hiring/jobs?status=all', { headers: { authorization: `Bearer ${key}` } })).text();
    expect(viaKey).toContain(openT);
    for (const hidden of [draftT, secretT, String(salary)]) expect(viaKey).not.toContain(hidden);
    expect(await (await omar.ctx.request.get('/api/v1/hiring/candidates?status=all', { headers: { authorization: `Bearer ${key}` } })).text()).not.toContain(cand);

    // Interviewer: sus puestos, sin salario oculto ni candidatos que no le asignaron.
    const asIvan = await (await ivan.ctx.request.get(`/api/hiring/jobs/${draft}`)).text();
    expect(asIvan).toContain(draftT);
    expect(asIvan).not.toContain(String(salary));
    expect((await ivan.ctx.request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(404);

    // Recruiter y admin ven lo suyo completo; sin la app, nada.
    expect(await (await rita.ctx.request.get(`/api/hiring/jobs/${draft}`)).text()).toContain(String(salary));
    expect(await (await ada.ctx.request.get(`/api/hiring/jobs/${secret}`)).text()).toContain(secretT);
    expect((await nora.ctx.request.get('/api/hiring/jobs')).status()).toBe(401);

    // Cadena: nadie publica sin ella, tampoco el owner; cada uno en su turno.
    expect((await rita.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [rita.id] } })).status()).toBe(403);
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [appr.id, ada.id] } })).ok()).toBe(true);
    const chained = await mk(`Chain ${uid()}`);
    expect((await olga.ctx.request.patch(`/api/hiring/jobs/${chained}`, { data: { status: 'published' } })).status()).toBe(409);
    expect((await omar.ctx.request.post(`/api/hiring/jobs/${chained}/approval`, { data: { action: 'request' } })).status()).toBe(403);
    expect((await rita.ctx.request.post(`/api/hiring/jobs/${chained}/approval`, { data: { action: 'request' } })).ok()).toBe(true);
    expect((await ada.ctx.request.post(`/api/hiring/jobs/${chained}/approval`, { data: { action: 'approve' } })).status()).toBe(403);
    expect((await olga.ctx.request.post(`/api/hiring/jobs/${chained}/approval`, { data: { action: 'approve' } })).status()).toBe(403);
    expect((await appr.ctx.request.post(`/api/hiring/jobs/${chained}/approval`, { data: { action: 'approve' } })).ok()).toBe(true);
    expect((await olga.ctx.request.patch(`/api/hiring/jobs/${chained}`, { data: { status: 'published' } })).status()).toBe(409);
    expect((await ada.ctx.request.post(`/api/hiring/jobs/${chained}/approval`, { data: { action: 'approve' } })).ok()).toBe(true);
    expect((await rita.ctx.request.patch(`/api/hiring/jobs/${chained}`, { data: { status: 'published' } })).ok()).toBe(true);

    // Oferta con cadena: quien la arma no la aprueba, y un admin no la saltea.
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { offerApprovers: [appr.id] } })).ok()).toBe(true);
    const offerRes = await rita.ctx.request.post(`/api/hiring/applications/${((await added.json()) as { applicationId: string }).applicationId}/offers`, { data: { salary: 100, currency: 'USD', body: 'Welcome' } });
    expect(offerRes.status(), await offerRes.text()).toBe(201);
    const offer = (await offerRes.json()) as { offer: { id: string } };
    for (const p of [rita, ada, olga]) expect((await p.ctx.request.patch(`/api/hiring/offers/${offer.offer.id}`, { data: { action: 'approve' } })).status(), p.email).toBe(403);
    // Quien arma y es el único aprobador: alguien más tiene que revisar.
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [rita.id] } })).ok()).toBe(true);
    const selfJob = await mk(`Self ${uid()}`);
    const selfChain = (await (await rita.ctx.request.post(`/api/hiring/jobs/${selfJob}/approval`, { data: { action: 'request' } })).json()) as { status: string; steps: Array<{ userId: string; status: string }> };
    expect(selfChain.status).toBe('pending');
    expect(selfChain.steps.at(-1)).toMatchObject({ userId: olga.id, status: 'pending' });
    expect((await rita.ctx.request.post(`/api/hiring/jobs/${selfJob}/approval`, { data: { action: 'approve' } })).status()).toBe(403);
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [] } })).ok()).toBe(true);
    expect((await rita.ctx.request.patch(`/api/hiring/offers/${offer.offer.id}`, { data: { action: 'send' } })).status()).toBe(409);
    expect((await appr.ctx.request.patch(`/api/hiring/offers/${offer.offer.id}`, { data: { action: 'approve' } })).ok()).toBe(true);
  } finally {
    await closeAll(olga, ada, rita, ivan, omar, appr, nora);
  }
});
