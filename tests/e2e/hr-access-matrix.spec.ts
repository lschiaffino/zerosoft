import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Permisos de People y Hiring como cada rol: empleado, manager, HR y alguien de
 * afuera (sin la app), por las páginas (y su payload RSC), la API de sesión,
 * ⌘K, el asistente y las API keys. El dato sensible es una cadena única: si
 * aparece donde no debe, el test la encuentra en el HTML o en el JSON.
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
  id: string;
  name: string;
}

async function person(browser: Browser, baseURL: string, name: string, apps: string, role = 'member'): Promise<Person> {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `mx-${name.toLowerCase()}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  await page.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [name, id]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, id, role, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return { ctx, id, name };
}

async function html(ctx: BrowserContext, url: string): Promise<string> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const out = await page.content();
  await page.close();
  return out;
}

const text = async (r: Promise<{ text(): Promise<string> }>) => (await r).text();

async function keyFor(ctx: APIRequestContext, scopes: string[]): Promise<string> {
  const res = await ctx.post('/api/keys', { data: { name: `mx-${uid()}`, scopes } });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { key?: string; rawKey?: string; token?: string };
  return String(body.key ?? body.rawKey ?? body.token);
}

test('People: salarios, personales, bajas y salidas por rol y por canal', async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const boss = await person(browser, baseURL!, 'Bossy', '*');
  const emp = await person(browser, baseURL!, 'Emilia', '*');
  const peer = await person(browser, baseURL!, 'Pedro', '*');
  const hr = await person(browser, baseURL!, 'Helena', '*');
  const outsider = await person(browser, baseURL!, 'Otto', '["crm"]');
  try {
    for (const p of [boss, emp, peer, hr]) expect((await p.ctx.request.get('/api/people/me')).ok()).toBe(true);
    expect((await request.post('/api/people/me')).ok()).toBe(true);
    const { employees } = (await (await request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; userId: string }> };
    const idOf = (p: Person) => employees.find((e) => e.userId === p.id)!.id;
    const [bossId, empId, peerId] = [idOf(boss), idOf(emp), idOf(peer)];

    const salary = 734211;
    const address = `Calle Secreta ${uid()}`;
    expect((await request.patch(`/api/people/employees/${empId}`, { data: { managerId: bossId, personal: { address }, startDate: '2020-01-02' } })).ok()).toBe(true);
    expect((await request.post(`/api/people/employees/${empId}/compensation`, { data: { amount: salary, currency: 'USD', period: 'year', reason: 'hire', effectiveDate: '2024-01-01' } })).ok()).toBe(true);
    expect((await request.patch(`/api/people/employees/${peerId}`, { data: { managerId: bossId } })).ok()).toBe(true);
    expect((await request.patch('/api/people/settings', { data: { hrAdmins: [hr.id] } })).ok()).toBe(true);

    // Empleado (compañero): nada de lo sensible por ninguna vía.
    for (const url of [`/en/app/people/${empId}`, `/en/app/people/${empId}?tab=compensation`, '/en/app/people']) {
      const page = await html(peer.ctx, url);
      expect(page, url).not.toContain(String(salary));
      expect(page, url).not.toContain(address);
    }
    const peerGet = (p: string) => peer.ctx.request.get(p);
    expect((await peerGet(`/api/people/employees/${empId}/compensation`)).status()).toBe(403);
    expect((await peerGet(`/api/people/employees/${empId}/history`)).status()).toBe(403);
    expect((await peerGet(`/api/people/employees/${empId}/balances`)).status()).toBe(403);
    expect((await peerGet(`/api/people/employees/${empId}/exit-interview`)).status()).toBe(403);
    expect((await peerGet('/api/people/export')).status()).toBe(403);
    expect((await peerGet('/api/people/reports')).status()).toBe(403);
    expect((await peerGet('/api/people/audit')).status()).toBe(403);
    expect((await peerGet('/api/people/changes')).status()).toBe(403);
    expect((await peerGet('/api/people/custom-reports')).status()).toBe(403);
    expect((await peer.ctx.request.post('/api/people/custom-reports', { data: { config: { columns: ['name'] } } })).status()).toBe(403);
    expect((await peer.ctx.request.post('/api/people/import', { data: { csv: 'Name\nX\n', dryRun: true } })).status()).toBe(403);
    expect((await peer.ctx.request.post('/api/people/surveys', { data: { question: 'x' } })).status()).toBe(403);
    expect(await text(peerGet(`/api/people/employees/${empId}`))).not.toContain(address);
    expect(await text(peerGet(`/api/search?q=${encodeURIComponent('Emilia')}`))).not.toContain(String(salary));

    // El asistente, como compañero: la herramienta de sueldo responde forbidden.
    const chat = await peer.ctx.newPage();
    await chat.goto('/en/app/people', { waitUntil: 'networkidle' });
    await chat.keyboard.press('ControlOrMeta+j');
    const panel = chat.getByTestId('assistant-panel');
    await expect(panel).toBeVisible();
    const input = panel.getByRole('textbox', { name: /Ask anything/ });
    await input.fill('salary of Emilia');
    await input.press('Enter');
    await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText('I could not do that (forbidden)');
    await expect(panel).not.toContainText(String(salary));
    await chat.close();

    // Manager: su reporte sí en licencias y carrera; el sueldo no.
    const bossGet = (p: string) => boss.ctx.request.get(p);
    expect((await bossGet(`/api/people/employees/${empId}/compensation`)).status()).toBe(403);
    expect((await bossGet(`/api/people/employees/${empId}/history`)).ok()).toBe(true);
    expect((await bossGet(`/api/people/employees/${empId}/balances`)).ok()).toBe(true);
    expect((await bossGet(`/api/people/employees/${peerId}/compensation`)).status()).toBe(403);
    expect((await bossGet('/api/people/export')).status()).toBe(403);
    expect(await html(boss.ctx, `/en/app/people/${empId}?tab=compensation`)).not.toContain(String(salary));

    // La propia persona y HR.
    expect(await text(emp.ctx.request.get(`/api/people/employees/${empId}/compensation`))).toContain(String(salary));
    expect(await text(hr.ctx.request.get(`/api/people/employees/${empId}/compensation`))).toContain(String(salary));
    expect((await hr.ctx.request.get('/api/people/export')).ok()).toBe(true);
    expect((await hr.ctx.request.post('/api/people/custom-reports', { data: { config: { columns: ['name', 'department'] } } })).ok()).toBe(true);
    // HR que no es admin del workspace no nombra a otros HR.
    expect((await hr.ctx.request.patch('/api/people/settings', { data: { hrAdmins: [] } })).status()).toBe(403);

    // Salida en curso: un compañero no se entera, por ninguna vía.
    expect((await request.patch(`/api/people/employees/${peerId}`, { data: { status: 'offboarding', endDate: '2099-01-01' } })).ok()).toBe(true);
    const seen = (await (await emp.ctx.request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; status: string }> };
    expect(seen.employees.find((e) => e.id === peerId)?.status).toBe('active');
    expect((await (await emp.ctx.request.get('/api/people/employees?status=offboarding')).json()).employees.some((e: { id: string }) => e.id === peerId)).toBe(true);
    expect(await text(emp.ctx.request.get('/api/people/employees?status=offboarding'))).not.toContain('"status":"offboarding"');
    const asBoss = (await (await boss.ctx.request.get('/api/people/employees')).json()) as { employees: Array<{ id: string; status: string }> };
    expect(asBoss.employees.find((e) => e.id === peerId)?.status).toBe('offboarding');

    // Baja: desaparece para el resto, también por URL directa.
    expect((await request.patch(`/api/people/employees/${peerId}`, { data: { status: 'terminated', endDate: '2020-01-01' } })).ok()).toBe(true);
    expect((await emp.ctx.request.get(`/api/people/employees/${peerId}`)).status()).toBe(404);
    expect(await text(emp.ctx.request.get('/api/people/employees?status=terminated'))).not.toContain(peerId);
    expect((await boss.ctx.request.get(`/api/people/employees/${peerId}`)).status()).toBe(200);
    expect(await text(emp.ctx.request.get(`/api/search?q=${encodeURIComponent('Pedro')}`))).not.toContain(peerId);

    // Sin la app: nada.
    expect((await outsider.ctx.request.get('/api/people/employees')).status()).toBe(401);
    expect((await outsider.ctx.request.get(`/api/people/employees/${empId}/compensation`)).status()).toBe(401);
    expect(await text(outsider.ctx.request.get(`/api/search?q=${encodeURIComponent('Emilia')}`))).not.toContain(empId);
    const blocked = await outsider.ctx.newPage();
    await blocked.goto(`/en/app/people/${empId}`, { waitUntil: 'networkidle' });
    await expect(blocked).toHaveURL(/blocked=people/);
    expect(await blocked.content()).not.toContain(address);
    await blocked.close();

    // API key (la de MCP): directorio público, sin importar el rol de quien la creó.
    const key = await keyFor(request, ['people:read']);
    const v1 = await request.get('/api/v1/people/employees', { headers: { authorization: `Bearer ${key}` } });
    expect(v1.ok()).toBe(true);
    const body = await v1.text();
    expect(body).not.toContain(address);
    expect(body).not.toContain(String(salary));
    expect(body).not.toContain(peerId);
    expect(body).not.toContain('"offboarding"');
  } finally {
    for (const p of [boss, emp, peer, hr, outsider]) await p.ctx.close();
  }
});

test('Hiring: borradores, confidenciales y salario oculto por rol y por canal', async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const recruiter = await person(browser, baseURL!, 'Rita', '["hiring"]');
  const interviewer = await person(browser, baseURL!, 'Ivan', '["hiring"]');
  const outsider = await person(browser, baseURL!, 'Omar', '["hiring"]');
  const noApp = await person(browser, baseURL!, 'Nora', '["crm"]');
  try {
    const salary = 918273;
    const mk = async (title: string, extra: Record<string, unknown> = {}) => {
      const res = await request.post('/api/hiring/jobs', { data: { title, description: 'Do things', salaryMax: salary, ...extra } });
      expect(res.ok(), await res.text()).toBe(true);
      const id = ((await res.json()) as { job: { id: string } }).job.id;
      const team = await request.put(`/api/hiring/jobs/${id}/team`, {
        data: { members: [{ userId: recruiter.id, role: 'recruiter' }, { userId: interviewer.id, role: 'interviewer' }] },
      });
      expect(team.ok(), await team.text()).toBe(true);
      return id;
    };
    const draftTitle = `Draft replacement ${uid()}`;
    const openTitle = `Open role ${uid()}`;
    const secretTitle = `Confidential ${uid()}`;
    const [draftId, openId, secretId] = [await mk(draftTitle), await mk(openTitle), await mk(secretTitle, { confidential: true })];
    for (const id of [openId, secretId]) expect((await request.patch(`/api/hiring/jobs/${id}`, { data: { status: 'published' } })).ok()).toBe(true);

    // Candidato en el puesto abierto: el recruiter lo carga.
    const candidate = `Cand ${uid()}`;
    const add = await recruiter.ctx.request.post('/api/hiring/applications', { data: { jobId: openId, name: candidate, email: `c-${uid()}@x.co` } });
    expect(add.ok(), await add.text()).toBe(true);
    const { candidateId } = (await add.json()) as { candidateId: string };

    // Fuera del equipo: API, páginas (y RSC), ⌘K, API key.
    const listAll = await text(outsider.ctx.request.get('/api/hiring/jobs?status=all'));
    expect(listAll).toContain(openTitle);
    expect(listAll).not.toContain(draftTitle);
    expect(listAll).not.toContain(secretTitle);
    expect(listAll).not.toContain(String(salary));
    expect((await outsider.ctx.request.get(`/api/hiring/jobs/${draftId}`)).status()).toBe(404);
    expect((await outsider.ctx.request.get(`/api/hiring/jobs/${secretId}`)).status()).toBe(404);
    const open = await text(outsider.ctx.request.get(`/api/hiring/jobs/${openId}`));
    expect(open).not.toContain(String(salary));
    expect(open).not.toContain(recruiter.id);
    for (const url of ['/en/app/hiring', '/en/app/hiring/jobs?status=all', `/en/app/hiring/jobs/${openId}`, '/en/app/hiring/reports']) {
      const page = await html(outsider.ctx, url);
      expect(page, url).not.toContain(draftTitle);
      expect(page, url).not.toContain(secretTitle);
      expect(page, url).not.toContain(String(salary));
      expect(page, url).not.toContain(candidate);
    }
    expect(await html(outsider.ctx, `/en/app/hiring/jobs/${draftId}`)).not.toContain(draftTitle);
    for (const q of [draftTitle, secretTitle, candidate]) {
      const found = (await (await outsider.ctx.request.get(`/api/search?q=${encodeURIComponent(q)}`)).json()) as { items: Array<{ label: string; href: string }> };
      expect(found.items.filter((i) => i.label === q || i.href.includes(draftId) || i.href.includes(secretId))).toEqual([]);
    }
    expect(await text(outsider.ctx.request.get('/api/hiring/export'))).not.toContain(candidate);
    expect((await outsider.ctx.request.post(`/api/hiring/jobs/${openId}/import`, { data: { csv: 'Name,Email\nA,a@x.co\n', dryRun: true } })).status()).toBe(403);
    expect((await outsider.ctx.request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(404);

    // API key de alguien de afuera y de un admin.
    const outsiderKey = await keyFor(outsider.ctx.request, ['hiring:read']);
    const asKey = await request.get('/api/v1/hiring/jobs?status=all', { headers: { authorization: `Bearer ${outsiderKey}` } });
    expect(asKey.ok()).toBe(true);
    const keyBody = await asKey.text();
    expect(keyBody).not.toContain(draftTitle);
    expect(keyBody).not.toContain(secretTitle);
    expect(keyBody).not.toContain(String(salary));
    expect(await text(request.get('/api/v1/hiring/candidates?status=all', { headers: { authorization: `Bearer ${outsiderKey}` } }))).not.toContain(candidate);
    const ownerKey = await keyFor(request, ['hiring:read']);
    expect(await text(request.get('/api/v1/hiring/jobs?status=all', { headers: { authorization: `Bearer ${ownerKey}` } }))).toContain(draftTitle);

    // Interviewer: ve sus puestos, sin el salario oculto y sin candidatos que no le asignaron.
    const asInterviewer = await text(interviewer.ctx.request.get(`/api/hiring/jobs/${draftId}`));
    expect(asInterviewer).toContain(draftTitle);
    expect(asInterviewer).not.toContain(String(salary));
    expect((await interviewer.ctx.request.get(`/api/hiring/candidates/${candidateId}`)).status()).toBe(404);
    expect((await interviewer.ctx.request.post(`/api/hiring/jobs/${openId}/import`, { data: { csv: 'Name,Email\nA,a@x.co\n', dryRun: true } })).status()).toBe(403);

    // Recruiter: lo suyo completo.
    expect(await text(recruiter.ctx.request.get(`/api/hiring/jobs/${draftId}`))).toContain(String(salary));
    expect(await text(recruiter.ctx.request.get('/api/hiring/export'))).toContain(candidate);

    // Sin la app.
    expect((await noApp.ctx.request.get('/api/hiring/jobs')).status()).toBe(401);
    expect((await noApp.ctx.request.get('/api/hiring/export')).status()).toBe(401);
    const noAppFound = (await (await noApp.ctx.request.get(`/api/search?q=${encodeURIComponent(openTitle)}`)).json()) as { items: Array<{ label: string }> };
    expect(noAppFound.items.filter((i) => i.label === openTitle)).toEqual([]);

    // Página pública: lo confidencial y el borrador no están ni en el feed.
    const { settings } = (await (await request.put('/api/hiring/settings', { data: { published: true } })).json()) as { settings: { handle: string } };
    const feed = await text(request.get(`/api/hiring/public/${settings.handle}/feed`));
    expect(feed).toContain(openTitle);
    expect(feed).not.toContain(draftTitle);
    expect(feed).not.toContain(secretTitle);
    expect(feed).not.toContain(String(salary));
    const careers = await text(request.get(`/careers/${settings.handle}`));
    expect(careers).not.toContain(secretTitle);
  } finally {
    for (const p of [recruiter, interviewer, outsider, noApp]) await p.ctx.close();
  }
});
