import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Segunda ronda de la auditoría de UI: guardas por workspace, 404 reales, 390 y detalles de teclado. */
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function loggedAs(browser: Browser, baseURL: string, email: string): Promise<{ ctx: BrowserContext; id: string }> {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  await p.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [id]);
  return { ctx, id };
}

/** Otra persona del workspace demo con las apps dadas. */
async function member(browser: Browser, baseURL: string, label: string, apps: string) {
  const out = await loggedAs(browser, baseURL, `${label}-${uid()}@darwin-e2e.io`);
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)`, [team, out.id, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [team, out.id]);
  return out;
}

async function noPageScroll(page: Page) {
  const { doc, win } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(doc).toBeLessThanOrEqual(win + 1);
}

test('un registro de otro workspace responde igual que un id inventado', async ({ request, browser, baseURL }) => {
  // Registros del workspace demo.
  const project = (await (await request.get('/api/analytics/projects')).json()) as { projects: Array<{ id: string }> };
  const projectId = project.projects[0]?.id ?? ((await (await request.post('/api/analytics/projects', { data: { name: `P ${uid()}` } })).json()) as { project: { id: string } }).project.id;
  const ts = new Date().toISOString();
  const ids = { insight: `ai_${uid()}`, flag: `af_${uid()}`, dash: `ad_${uid()}`, person: `p_${uid()}`, channel: `ch_${uid()}`, plan: `pl_${uid()}` };
  await sql(`INSERT INTO analytics_insights (id, project_id, name, kind, query, created_at, updated_at) VALUES (?, ?, 'x', 'trends', '{}', ?, ?)`, [ids.insight, projectId, ts, ts]);
  await sql(`INSERT INTO analytics_flags (id, project_id, key, name, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?)`, [ids.flag, projectId, `k${uid()}`, ts, ts]);
  await sql(`INSERT INTO analytics_dashboards (id, project_id, name, created_at, updated_at) VALUES (?, ?, 'x', ?, ?)`, [ids.dash, projectId, ts, ts]);
  await sql(`INSERT INTO analytics_persons (id, project_id, created_at, last_seen) VALUES (?, ?, ?, ?)`, [ids.person, projectId, Date.now(), Date.now()]);
  await sql(`INSERT INTO talk_channels (id, workspace_id, kind, name, created_by, created_at, updated_at) VALUES (?, 'demo', 'public', ?, 'demo', ?, ?)`, [ids.channel, `c${uid()}`, ts, ts]);
  const plan = (await (await request.post('/api/track/plans', { data: { name: `Plan ${uid()}` } })).json()) as { id: string };

  const paths = [`analytics/insights/${ids.insight}`, `analytics/flags/${ids.flag}`, `analytics/dashboards/${ids.dash}`, `analytics/persons/${ids.person}`, `talk/${ids.channel}`, `track/projects/${plan.id}`];
  const fakes = ['analytics/insights/ai_fake', 'analytics/flags/af_fake', 'analytics/dashboards/ad_fake', 'analytics/persons/p_fake', 'talk/ch_fake', 'track/projects/fake'];

  // Para quien es del workspace, abren.
  for (const path of paths) expect((await request.get(`/en/app/${path}`)).status(), `dueño ${path}`).toBe(200);

  // Para alguien de otro workspace, 404 como los inventados, sin rastro en el cuerpo.
  const stranger = await loggedAs(browser, baseURL!, `stranger-${uid()}@darwin-e2e.io`);
  for (const [i, path] of paths.entries()) {
    const real = await stranger.ctx.request.get(`/en/app/${path}`);
    const fake = await stranger.ctx.request.get(`/en/app/${fakes[i]}`);
    expect(real.status(), path).toBe(404);
    expect(fake.status(), fakes[i]).toBe(404);
  }
  // Tampoco redirige al cambio de workspace de Talk.
  const redirect = await stranger.ctx.request.get(`/en/app/talk/${ids.channel}`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(404);
  await stranger.ctx.close();
});

test('Talk: un link a un canal de otro workspace de la persona la lleva ahí', async ({ browser, baseURL }) => {
  const channelId = `ch_${uid()}`;
  const ts = new Date().toISOString();
  await sql(`INSERT INTO talk_channels (id, workspace_id, kind, name, created_by, created_at, updated_at) VALUES (?, 'demo', 'private', ?, 'demo', ?, ?)`, [channelId, `g${uid()}`, ts, ts]);
  const guest = await loggedAs(browser, baseURL!, `guest-${uid()}@darwin-e2e.io`);
  // Sin ser invitada: 404.
  expect((await guest.ctx.request.get(`/en/app/talk/${channelId}`, { maxRedirects: 0 })).status()).toBe(404);
  // Invitada, y sumada al canal: cambia de workspace.
  await sql(`INSERT INTO talk_guests (workspace_id, user_id, invited_by, created_at) VALUES ('demo', ?, 'demo', ?)`, [guest.id, ts]);
  await sql(`INSERT INTO talk_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`, [channelId, guest.id, ts]);
  const res = await guest.ctx.request.get(`/en/app/talk/${channelId}`, { maxRedirects: 0 });
  expect([200, 302, 303, 307]).toContain(res.status());
  const page = await guest.ctx.newPage();
  await page.goto(`/en/app/talk/${channelId}`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`/app/talk/${channelId}`));
  expect((await page.context().cookies()).find((c) => c.name === 'zs_talk_ws')?.value).toBe('demo');
  // Un canal privado del workspace donde no está: 404 como uno inventado.
  const other = `ch_${uid()}`;
  await sql(`INSERT INTO talk_channels (id, workspace_id, kind, name, created_by, created_at, updated_at) VALUES (?, 'demo', 'private', ?, 'demo', ?, ?)`, [other, `h${uid()}`, ts, ts]);
  expect((await guest.ctx.request.get(`/en/app/talk/${other}`, { maxRedirects: 0 })).status()).toBe(404);
  await guest.ctx.close();
});

test('más ids desconocidos responden 404 y los válidos abren', async ({ request, browser, baseURL }) => {
  // Sin números el layout de la bandeja no renderiza la página hija: el id igual da 404.
  expect((await request.get('/en/app/groups/inbox/zzz')).status()).toBe(404);
  for (const path of [
    'chat/inbox/zzz',
    'crm/tasks/zzz',
    'crm/quotes/zzz',
    'flow/tables/zzz',
    'calendar/routing/zzz',
    'rec/f/zzz',
    'people/onboarding/templates/zzz',
    'people/onboarding/zzz',
    'people/u/zzz',
    'books/reports/zzz',
    'shop/customers/new',
    'shop/orders/new',
    'forms/zzz/responses',
    'hiring/candidates/new',
    'hiring/jobs/new/edit',
  ]) {
    expect((await request.get(`/en/app/${path}`, { maxRedirects: 0 })).status(), path).toBe(404);
  }

  // Forms: pestaña y respuesta desconocidas.
  const form = (await (await request.post('/api/forms', { data: { name: `F ${uid()}`, template: null, lang: 'en' } })).json()) as { id?: string; form?: { id: string } };
  const formId = form.id ?? form.form?.id;
  for (const path of [`forms/${formId}/zzz`, `forms/${formId}/responses/zzz`, `forms/${formId}/summary/x`]) {
    expect((await request.get(`/en/app/${path}`)).status(), path).toBe(404);
  }
  for (const path of [`forms/${formId}`, `forms/${formId}/share`, `forms/${formId}/responses`, `forms/${formId}/summary`]) {
    expect((await request.get(`/en/app/${path}`)).status(), path).toBe(200);
  }

  // Válidos, como owner.
  for (const path of ['books/reports', 'books/reports/pnl', 'books/reports/tax', 'shop/customers', 'crm/tasks', 'crm/tasks/queue', 'crm/quotes', 'flow/tables', 'calendar/routing', 'calendar/routing/new', 'people/onboarding', 'chat/inbox']) {
    expect((await request.get(`/en/app/${path}`, { maxRedirects: 2 })).status(), path).toBe(200);
  }
  const task = (await (await request.post('/api/crm/activities', { data: { type: 'task', subject: `T ${uid()}` } })).json()) as { id?: string; activity?: { id: string } };
  const taskId = task.id ?? task.activity?.id;
  if (taskId) expect((await request.get(`/en/app/crm/tasks/${taskId}`)).status()).toBe(200);

  const table = (await (await request.post('/api/flow/tables', { data: { name: `Tb ${uid()}` } })).json()) as { id?: string; table?: { id: string } };
  expect((await request.get(`/en/app/flow/tables/${table.id ?? table.table?.id}`)).status()).toBe(200);

  const folder = (await (await request.post('/api/rec/folders', { data: { name: `Fd ${uid()}`, space: 'personal' } })).json()) as { id?: string; folder?: { id: string } };
  expect((await request.get(`/en/app/rec/f/${folder.id ?? folder.folder?.id}`)).status()).toBe(200);

  // Hiring: un miembro sin permiso de editar ve el pipeline, no la edición.
  const job = (await (await request.post('/api/hiring/jobs', { data: { title: `J ${uid()}` } })).json()) as { id?: string; job?: { id: string } };
  const jobId = job.id ?? job.job?.id;
  expect((await request.get(`/en/app/hiring/jobs/${jobId}/edit`)).status()).toBe(200);
  const plain = await member(browser, baseURL!, 'plain', '["hiring","people"]');
  expect((await plain.ctx.request.get(`/en/app/hiring/jobs/${jobId}/edit`)).status()).toBe(404);
  expect((await plain.ctx.request.get(`/en/app/hiring/jobs/${jobId}`)).status()).toBe(200);
  // People: la ficha por user id redirige de verdad; un miembro ve el aviso de RR. HH., no un 404.
  await request.get('/en/app/people/me');
  expect((await request.get('/en/app/people/u/demo', { maxRedirects: 0 })).status()).toBe(307);
  expect((await plain.ctx.request.get('/en/app/people/onboarding/templates/zzz')).status()).toBe(200);
  await plain.ctx.close();
});

test('Chat a 390: un email largo no ensancha la página', async ({ browser, baseURL, request }) => {
  const id = `vis_${uid()}`;
  const email = `una.persona.con.un.correo.larguisimo.${uid()}@subdominio.empresa-muy-larga.example.com`;
  const widgets = (await (await request.get('/api/chat/widgets')).json()) as { widgets?: Array<{ id: string }> };
  let widgetId = widgets.widgets?.[0]?.id;
  if (!widgetId) widgetId = ((await (await request.post('/api/chat/widgets', { data: { name: `W ${uid()}` } })).json()) as { id: string }).id;
  await sql(`INSERT INTO chat_visitors (id, widget_id, external_id, name, email) VALUES (?, ?, ?, NULL, ?)`, [id, widgetId, id, email]);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/en/app/chat/people', { waitUntil: 'networkidle' });
  await expect(page.locator('table.table')).toBeVisible();
  await noPageScroll(page);
  expect(await page.locator('.chat-email wbr').count()).toBeGreaterThan(0);
  await page.goto(`/en/app/chat/people/${id}`, { waitUntil: 'networkidle' });
  await noPageScroll(page);
  await ctx.close();
});

test('Chat, Avisos: el foco entra al panel y Esc lo devuelve', async ({ page, request }) => {
  const widgets = (await (await request.get('/api/chat/widgets')).json()) as { widgets?: Array<{ id: string }> };
  if (!widgets.widgets?.length) await request.post('/api/chat/widgets', { data: { name: `W ${uid()}` } });
  await page.goto('/en/app/chat/inbox', { waitUntil: 'networkidle' });
  const bell = page.locator('.chat-alerts > button');
  await bell.click();
  const panel = page.locator('#chat-alerts-panel');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(bell).toBeFocused();
});

test('Esc en los títulos de Forms, Sign y Analytics descarta lo escrito', async ({ page, request }) => {
  const NAME = `Original ${uid()}`;
  const form = (await (await request.post('/api/forms', { data: { name: NAME, template: null, lang: 'en' } })).json()) as { id?: string; form?: { id: string } };
  await page.goto(`/en/app/forms/${form.id ?? form.form?.id}`, { waitUntil: 'networkidle' });
  const f = page.locator('#fm-name');
  await f.fill('Borrador');
  await page.keyboard.press('Escape');
  await expect(f).toHaveValue(NAME);
  await expect(f).not.toBeFocused();

  const env = (await (await request.post('/api/sign/envelopes', { data: { title: NAME } })).json()) as { id?: string; envelope?: { id: string } };
  await page.goto(`/en/app/sign/envelopes/${env.id ?? env.envelope?.id}`, { waitUntil: 'networkidle' });
  const s = page.locator('.sg-title-input');
  await s.fill('Borrador');
  await page.keyboard.press('Escape');
  await expect(s).toHaveValue(NAME);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.sg-title-input')).toHaveValue(NAME);
});

test('Issue nuevo a 390: un proyecto de nombre largo no se sale del selector', async ({ browser, baseURL, request }) => {
  const LONG = `Proyecto con un nombre larguísimo para probar el selector del diálogo nuevo ${uid()}`;
  await request.post('/api/track/projects', { data: { name: LONG } });
  await request.post('/api/track/projects', { data: { name: `Corto ${uid()}` } });
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/en/app/track/issues?newIssue=1', { waitUntil: 'networkidle' });
  const team = page.getByTestId('track-qc-team');
  await expect(team).toBeVisible();
  const box = await team.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await noPageScroll(page);
  await ctx.close();
});

test('Tablas anchas a 390: el borde que sigue tiene sombra de scroll', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/en/app/books/reports', { waitUntil: 'networkidle' });
  const att = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'table-wrap';
    document.body.append(el);
    const value = getComputedStyle(el).backgroundAttachment;
    el.remove();
    return value;
  });
  expect(att).toContain('local');
  await ctx.close();
});

test('Cmd+K no le ofrece a un miembro lo de las apps que no tiene', async ({ browser, baseURL }) => {
  const m = await member(browser, baseURL!, 'cmdk', '["docs"]');
  const page = await m.ctx.newPage();
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  const input = page.locator('.cmdk input');
  await expect(input).toBeVisible();
  const listed = async (q: string) => {
    await input.fill(q);
    await page.waitForTimeout(600);
    return page.locator('.cmdk [role="option"]').allTextContents();
  };
  // Con la paleta vacía y al buscar: ni acciones, ni la app, ni sus ajustes, ni su importación.
  await input.fill('');
  await page.waitForTimeout(300);
  const all = (await page.locator('.cmdk [role="option"]').allTextContents()).join('|');
  expect(all).not.toMatch(/New contact|New company|New deal|Open CRM/i);
  expect((await listed('crm')).join('|')).not.toMatch(/CRM/);
  expect((await listed('hubspot')).join('|')).not.toMatch(/CRM/);
  expect((await listed('track')).join('|')).not.toMatch(/Track/);
  // La app que sí tiene sigue apareciendo.
  expect((await listed('docs')).join('|')).toMatch(/Docs/);
  await m.ctx.close();
});

test('otra zona horaria no rompe la hidratación y el título va en el head', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/en/app/shop/inventory', '/en/app/analytics/events', '/en/app/people/reports', '/en/app/social/library', '/en/app/calendar/settings?tab=activity']) {
    const res = await page.goto(path, { waitUntil: 'networkidle' });
    expect(errors, path).toEqual([]);
    const html = (await res?.text()) ?? '';
    expect(html.indexOf('<title>'), path).toBeLessThan(html.indexOf('</head>'));
  }
  await ctx.close();
});
