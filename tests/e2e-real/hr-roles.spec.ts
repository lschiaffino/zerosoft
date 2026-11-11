import fs from 'fs';
import { e2eDb } from '../e2e/helpers/db';
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
  // Con reintento si la app tiene la base tomada (SQLITE_BUSY): ver tests/e2e/helpers/db.ts.
  const db = e2eDb();
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
    expect((await w.olga.ctx.request.patch(`/api/people/surveys/${id}`, { data: { status: 'open' } })).status()).toBe(400);
    expect((await seen()).score).toBeNull();
    expect((await w.olga.ctx.request.patch(`/api/people/surveys/${id}`, { data: { status: 'closed' } })).ok()).toBe(true);
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

test('quien fue HR y se dio de baja deja de leer sueldos; su equipo sube por la cadena; HR deshace la baja', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    const salary = 661177;
    expect((await w.olga.ctx.request.post(`/api/people/employees/${w.ids.emp}/compensation`, { data: { amount: salary, currency: 'USD', period: 'year', reason: 'hire', effectiveDate: '2024-01-01' } })).ok()).toBe(true);
    const { employees } = (await (await w.olga.ctx.request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
    const hrId = employees.find((e) => e.userId === w.hrp.id)!.id;
    const url = `/api/people/employees/${w.ids.emp}/compensation`;
    expect(await (await w.hrp.ctx.request.get(url)).text()).toContain(String(salary));

    // Una baja de la ficha, sin sacarla del workspace.
    expect((await w.olga.ctx.request.patch(`/api/people/employees/${hrId}`, { data: { status: 'terminated', endDate: '2020-01-01' } })).ok()).toBe(true);
    expect((await w.hrp.ctx.request.get(url)).status()).toBe(403);
    expect((await w.hrp.ctx.request.get('/api/people/export')).status()).toBe(403);
    expect((await w.hrp.ctx.request.get('/api/people/changes')).status()).toBe(403);
    expect(await html(w.hrp, `/en/app/people/${w.ids.emp}?tab=compensation`)).not.toContain(String(salary));

    // Un manager que se fue: no decide más, y el pedido le llega a quien sigue.
    const bossEmp = w.ids.boss;
    expect((await w.olga.ctx.request.patch(`/api/people/employees/${bossEmp}`, { data: { managerId: employees.find((e) => e.userId === w.olga.id)!.id } })).ok()).toBe(true);
    expect((await w.olga.ctx.request.patch(`/api/people/employees/${bossEmp}`, { data: { status: 'terminated', endDate: '2020-01-01' } })).ok()).toBe(true);
    const pol = ((await (await w.emp.ctx.request.get('/api/people/settings')).json()) as { policies: Array<{ id: string }> }).policies[0];
    const y = new Date().getUTCFullYear() + 1;
    const made = await w.emp.ctx.request.post('/api/people/time-off', { data: { policyId: pol.id, startDate: `${y}-03-02`, endDate: `${y}-03-02` } });
    expect(made.status(), await made.text()).toBe(201);
    const { request } = (await made.json()) as { request: { id: string } };
    expect((await w.boss.ctx.request.patch(`/api/people/time-off/${request.id}`, { data: { action: 'approve' } })).status()).toBe(403);
    const bell = await (await w.olga.ctx.request.get('/api/notifications?limit=50')).text();
    expect(bell).toContain('Emma');
    expect((await w.olga.ctx.request.patch(`/api/people/time-off/${request.id}`, { data: { action: 'approve' } })).ok()).toBe(true);

    // Reactivar: la ficha vuelve, sin fecha de salida, y solo HR puede.
    expect((await w.emp.ctx.request.post(`/api/people/employees/${hrId}/exit`, { data: { action: 'reactivate' } })).status()).toBe(403);
    expect((await w.olga.ctx.request.post(`/api/people/employees/${hrId}/exit`, { data: { action: 'reactivate' } })).ok()).toBe(true);
    const back = (await (await w.olga.ctx.request.get(`/api/people/employees/${hrId}`)).json()) as { employee: { status: string; endDate: string | null } };
    expect(back.employee).toMatchObject({ status: 'active', endDate: null });
    expect(await (await w.hrp.ctx.request.get(url)).text()).toContain(String(salary));
  } finally {
    await closeWorld(w);
  }
});

test('salidas: el último día sigue, una fecha vieja la confirma HR y se puede cancelar', async ({ browser }) => {
  const w = await peopleWorld(browser);
  try {
    const off = (id: string, endDate: string) => w.olga.ctx.request.post(`/api/people/employees/${id}/offboard`, { data: { endDate } });
    const tick = () => w.olga.ctx.request.get('/api/cron/tick', { headers: { authorization: 'Bearer e2e-cron' } });
    const status = async (id: string) => ((await (await w.olga.ctx.request.get(`/api/people/employees/${id}`)).json()) as { employee: { status: string; exitOverdue: boolean } }).employee;
    const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    // Con fecha de mañana, sigue visible para sus compañeros; el cron no la toca.
    expect((await off(w.ids.peer, iso(2))).ok()).toBe(true);
    expect((await tick()).ok()).toBe(true);
    expect((await status(w.ids.peer)).status).toBe('offboarding');
    expect((await w.emp.ctx.request.get(`/api/people/employees/${w.ids.peer}`)).status()).toBe(200);

    // Se cancela antes de la fecha.
    await w.olga.page.goto(`/en/app/people/${w.ids.peer}`, { waitUntil: 'networkidle' });
    await w.olga.page.getByRole('button', { name: 'Cancel exit' }).click();
    await expect(w.olga.page.getByRole('button', { name: 'Offboard' })).toBeVisible();
    await expect.poll(async () => (await status(w.ids.peer)).status).toBe('active');

    // Una salida vieja: el cron no la cierra, HR la ve y la confirma con un clic.
    await sql("UPDATE people_employees SET status = 'offboarding', end_date = ? WHERE id = ?", [iso(-30), w.ids.emp]);
    expect((await tick()).ok()).toBe(true);
    expect(await status(w.ids.emp)).toMatchObject({ status: 'offboarding', exitOverdue: true });
    await w.olga.page.goto('/en/app/people', { waitUntil: 'networkidle' });
    await expect(w.olga.page.getByTestId('people-inbox')).toContainText('Exits to confirm');
    await w.olga.page.goto(`/en/app/people/${w.ids.emp}`, { waitUntil: 'networkidle' });
    await expect(w.olga.page.getByTestId('people-exit-overdue')).toBeVisible();
    await w.olga.page.getByRole('button', { name: 'Finish exit' }).click();
    await expect.poll(async () => (await status(w.ids.emp)).status).toBe('terminated');

    // Una reciente la cierra el cron y avisa a HR.
    await sql("UPDATE people_employees SET status = 'offboarding', end_date = ? WHERE id = ?", [iso(-3), w.ids.boss]);
    expect((await tick()).ok()).toBe(true);
    await expect.poll(async () => (await status(w.ids.boss)).status).toBe('terminated');
    expect(await (await w.olga.ctx.request.get('/api/notifications?limit=50')).text()).toContain('Bruna');
  } finally {
    await closeWorld(w);
  }
});

test('publicar con cadena: siempre aprobado, por botón y por API; lo material vuelve a pedir aprobación', async ({ browser }) => {
  const olga = await owner(browser);
  const rita = await join(browser, olga, 'Rita', 'member', ['hiring']);
  const abel = await join(browser, olga, 'Abel', 'member', ['hiring']);
  try {
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [abel.id], offerApprovers: [] } })).ok()).toBe(true);
    const mk = async () => {
      const res = await olga.ctx.request.post('/api/hiring/jobs', { data: { title: `Job ${uid()}`, description: 'x', salaryMax: 100 } });
      const id = ((await res.json()) as { job: { id: string } }).job.id;
      expect((await olga.ctx.request.put(`/api/hiring/jobs/${id}/team`, { data: { members: [{ userId: rita.id, role: 'recruiter' }] } })).ok()).toBe(true);
      return id;
    };
    const patch = (id: string, data: unknown) => rita.ctx.request.patch(`/api/hiring/jobs/${id}`, { data });
    const act = (p: Person, id: string, action: string, note = '') => p.ctx.request.post(`/api/hiring/jobs/${id}/approval`, { data: { action, note } });
    const approve = async (id: string) => {
      expect((await act(rita, id, 'request')).ok()).toBe(true);
      expect((await act(abel, id, 'approve')).ok()).toBe(true);
    };

    // Sin aprobar, pendiente o rechazado: no publica.
    const a = await mk();
    expect((await patch(a, { status: 'published' })).status()).toBe(409);
    expect((await act(rita, a, 'request')).ok()).toBe(true);
    expect((await patch(a, { status: 'published' })).status()).toBe(409);
    expect((await act(abel, a, 'reject', 'No')).ok()).toBe(true);
    expect((await patch(a, { status: 'published' })).status()).toBe(409);

    // Aprobado y publicado: lo material no se cambia; el resto, sí.
    const b = await mk();
    await approve(b);
    expect((await patch(b, { status: 'published' })).ok()).toBe(true);
    expect((await patch(b, { department: 'Ops', location: 'BA', description: 'y' })).ok()).toBe(true);
    for (const change of [{ title: 'Otro' }, { salaryMax: 200 }, { salaryPublic: true }]) expect((await patch(b, change)).status(), JSON.stringify(change)).toBe(409);

    // Cerrado y editado: no se reabre con clics mientras esté pendiente.
    expect((await patch(b, { status: 'closed' })).ok()).toBe(true);
    expect((await patch(b, { title: `Nuevo ${uid()}`, salaryMax: 300 })).ok()).toBe(true);
    await rita.page.goto(`/en/app/hiring/jobs/${b}/edit`, { waitUntil: 'networkidle' });
    await expect(rita.page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await rita.page.getByTestId('hiring-request-approval').click();
    await expect(rita.page.getByTestId('hiring-job-approval')).toBeVisible();
    await expect(rita.page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    expect((await patch(b, { status: 'published' })).status()).toBe(409);
    expect((await act(abel, b, 'approve')).ok()).toBe(true);
    expect((await patch(b, { status: 'published' })).ok()).toBe(true);

    // Confidencial: sacarlo con el puesto publicado es material.
    const c = await mk();
    expect((await patch(c, { confidential: true })).ok()).toBe(true);
    await approve(c);
    expect((await patch(c, { status: 'published' })).ok()).toBe(true);
    expect((await patch(c, { confidential: false })).status()).toBe(409);

    // Apagar y prender la cadena no deja un aprobado viejo.
    const d = await mk();
    await approve(d);
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [] } })).ok()).toBe(true);
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [abel.id] } })).ok()).toBe(true);
    expect((await patch(d, { status: 'published' })).status()).toBe(409);

    // Un puesto publicado sin aprobar de antes de la cadena: cerrado, no se reabre sin ella.
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [] } })).ok()).toBe(true);
    const e = await mk();
    expect((await patch(e, { status: 'published' })).ok()).toBe(true);
    expect((await patch(e, { status: 'closed' })).ok()).toBe(true);
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { jobApprovers: [abel.id] } })).ok()).toBe(true);
    expect((await patch(e, { status: 'published' })).status()).toBe(409);
  } finally {
    await closeAll(olga, rita, abel);
  }
});

test('aprobadores: sin nadie más se dice y no se crea nada; quitar la app o sacar a alguien pasa su paso; un miembro no ve los campos protegidos', async ({ browser }) => {
  const solo = await owner(browser);
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', ['hiring']);
  const abel = await join(browser, olga, 'Abel', 'member', ['hiring']);
  const cruz = await join(browser, olga, 'Cruz', 'member', ['hiring']);
  const omar = await join(browser, olga, 'Omar', 'member', ['hiring']);
  try {
    // Workspace de una sola persona con una cadena: la oferta no se crea, y dice qué hacer.
    expect((await solo.ctx.request.put('/api/hiring/settings', { data: { offerApprovers: [solo.id] } })).ok()).toBe(true);
    const sJob = ((await (await solo.ctx.request.post('/api/hiring/jobs', { data: { title: `S ${uid()}`, description: 'x' } })).json()) as { job: { id: string } }).job.id;
    const sApp = (await (await solo.ctx.request.post('/api/hiring/applications', { data: { jobId: sJob, name: 'Sole', email: `s-${uid()}@real-e2e.io` } })).json()) as { applicationId: string };
    const refused = await solo.ctx.request.post(`/api/hiring/applications/${sApp.applicationId}/offers`, { data: { salary: 1, currency: 'USD', body: 'Hi' } });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('no_other_approver');
    expect(((await (await solo.ctx.request.get(`/api/hiring/applications/${sApp.applicationId}/offers`)).json()) as { offers: unknown[] }).offers).toEqual([]);

    // La oferta de antes de la cadena sigue la cadena al aprobar.
    const job = ((await (await olga.ctx.request.post('/api/hiring/jobs', { data: { title: `J ${uid()}`, description: 'x' } })).json()) as { job: { id: string } }).job.id;
    const app = (await (await olga.ctx.request.post('/api/hiring/applications', { data: { jobId: job, name: 'Legacy', email: `l-${uid()}@real-e2e.io` } })).json()) as { applicationId: string; candidateId: string };
    const legacy = (await (await olga.ctx.request.post(`/api/hiring/applications/${app.applicationId}/offers`, { data: { salary: 1, currency: 'USD', body: 'Hi' } })).json()) as { offer: { id: string } };
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { offerApprovers: [abel.id] } })).ok()).toBe(true);
    const moved = (await (await olga.ctx.request.patch(`/api/hiring/offers/${legacy.offer.id}`, { data: { action: 'approve' } })).json()) as { offer: { status: string; approval: Array<{ userId: string }> } };
    expect(moved.offer.status).toBe('pending_approval');
    expect(moved.offer.approval.map((s) => s.userId)).toEqual([abel.id]);

    // Quitarle Hiring al aprobador: su paso pasa al owner, y sale de equipos y ajustes.
    const members = () => sql('SELECT user_id FROM hiring_job_members WHERE job_id = ? AND user_id = ?', [job, abel.id]);
    expect((await members()).length).toBe(1);
    const changed = await olga.ctx.request.patch(`/api/teams/members/${abel.id}`, { data: { apps: ['crm'] } });
    expect(changed.ok(), await changed.text()).toBe(true);
    const after = (await (await olga.ctx.request.get(`/api/hiring/applications/${app.applicationId}/offers`)).json()) as { offers: Array<{ approval: Array<{ userId: string; status: string }> }> };
    // La armó el owner: su paso va al otro admin, no vuelve a quien la pidió.
    expect(after.offers[0].approval[0]).toMatchObject({ userId: ada.id, status: 'pending' });
    expect((await members()).length).toBe(0);

    // El owner que armó la oferta no se aprueba: pasa a otro admin.
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { offerApprovers: [cruz.id] } })).ok()).toBe(true);
    const second = (await (await olga.ctx.request.post('/api/hiring/applications', { data: { jobId: job, name: 'Second', email: `n-${uid()}@real-e2e.io` } })).json()) as { applicationId: string };
    const own = (await (await olga.ctx.request.post(`/api/hiring/applications/${second.applicationId}/offers`, { data: { salary: 1, currency: 'USD', body: 'Hi' } })).json()) as { offer: { id: string } };
    expect((await olga.ctx.request.delete(`/api/teams/members/${cruz.id}`)).ok()).toBe(true);
    const reassigned = (await (await olga.ctx.request.get(`/api/hiring/applications/${second.applicationId}/offers`)).json()) as { offers: Array<{ approval: Array<{ userId: string }> }> };
    expect(reassigned.offers[0].approval[0].userId).toBe(ada.id);
    expect((await olga.ctx.request.patch(`/api/hiring/offers/${own.offer.id}`, { data: { action: 'approve' } })).status()).toBe(403);
    expect((await ada.ctx.request.patch(`/api/hiring/offers/${own.offer.id}`, { data: { action: 'approve' } })).ok()).toBe(true);

    // Los nombres de los campos protegidos no le llegan a un miembro.
    const label = `Pay ${uid()}`;
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { candidateFields: [{ id: 'pay', label, type: 'text', options: [], protected: true }] } })).ok()).toBe(true);
    expect(await (await omar.ctx.request.get('/api/hiring/settings')).text()).not.toContain(label);
    expect(await html(omar, '/en/app/hiring/settings')).not.toContain(label);
    expect(await (await ada.ctx.request.get('/api/hiring/settings')).text()).toContain(label);

    // Postulación retirada: sin oferta.
    const pub = ((await (await olga.ctx.request.post('/api/hiring/jobs', { data: { title: `P ${uid()}`, description: 'x' } })).json()) as { job: { id: string } }).job.id;
    expect((await olga.ctx.request.put('/api/hiring/settings', { data: { offerApprovers: [] } })).ok()).toBe(true);
    expect((await olga.ctx.request.patch(`/api/hiring/jobs/${pub}`, { data: { status: 'published' } })).ok()).toBe(true);
    const w = (await (await olga.ctx.request.post('/api/hiring/applications', { data: { jobId: job, name: 'Withdrawn', email: `w-${uid()}@real-e2e.io` } })).json()) as { applicationId: string };
    expect((await olga.ctx.request.post(`/api/hiring/applications/${w.applicationId}/copy`, { data: { jobId: pub, move: true } })).status()).toBe(201);
    expect((await olga.ctx.request.post(`/api/hiring/applications/${w.applicationId}/offers`, { data: { salary: 1, currency: 'USD', body: 'Hi' } })).status()).toBe(409);
  } finally {
    await closeAll(solo, olga, ada, abel, cruz, omar);
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
