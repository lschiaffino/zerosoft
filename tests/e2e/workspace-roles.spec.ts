import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Primer día por rol, de punta a punta: una cuenta personal con datos de
 * ejemplo cae en su app; un member con apps limitadas choca con una app
 * bloqueada, pide acceso y el owner lo recibe como aviso que abre su acceso;
 * Ajustes muestra solo las apps de cada uno, la leyenda de roles y la zona
 * de propiedad y cierre según el rol; un admin no nombra admins ni un member
 * cambia roles; un guest entra sabiendo que llega a su propio workspace.
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

async function as(browser: Browser, email: string, opts: { width?: number; dark?: boolean } = {}): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width ?? 1280, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function demoTeam(): Promise<{ id: string; name: string }> {
  const row = (await sql("SELECT id, name FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0];
  return { id: String(row.id), name: String(row.name) };
}

/** Invitación sembrada y aceptada desde la sesión de `email` (pasa el onboarding corto). */
async function join(browser: Browser, role: 'admin' | 'member' | 'guest', apps: string, opts: { width?: number; dark?: boolean } = {}) {
  const team = await demoTeam();
  const email = `${role}-${uid()}@roles-e2e.io`;
  const token = `role${uid()}${uid()}${uid()}`;
  await sql(
    "INSERT INTO team_invites (id, team_id, email, token, invited_by, role, apps, expires_at) VALUES (?, ?, ?, ?, 'demo', ?, ?, datetime('now', '+3 days'))",
    [`ir-${uid()}`, team.id, email, token, role, apps],
  );
  const ctx = await as(browser, email, opts);
  const p = await ctx.newPage();
  await p.goto(`/en/invite/${token}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Join/ }).click();
  await p.waitForURL(/\/app\/welcome/);
  return { ctx, p, email, team };
}

test('cuenta personal con datos de ejemplo: cae en la app elegida y el inicio enseña el paso siguiente', async ({ browser }) => {
  const ctx = await as(browser, `solo-${uid()}@gmail.com`);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await p.waitForURL(/\/en\/app\/welcome/);
    await expect(p.getByText(/^Signed in as/)).toBeVisible();
    await expect(p.getByRole('button', { name: 'Not you? Sign out' })).toBeVisible();
    await p.getByText('Just me').click();
    await p.getByRole('button', { name: 'Continue' }).click();
    await expect(p.getByRole('button', { name: 'Not you? Sign out' })).toBeVisible();
    await p.getByLabel('Your name').fill('Sol');
    await p.getByRole('button', { name: 'Continue' }).click();
    await expect(p.getByRole('heading', { name: 'Where do you start?' })).toBeVisible();
    await p.locator('label.wl-app', { hasText: 'Docs' }).click();
    await p.getByLabel(/sample data/).check();
    await p.getByRole('button', { name: 'Go to Docs' }).click();
    await p.waitForURL(/\/en\/app\/docs/);
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(p.getByRole('heading', { name: /Sol$/ })).toBeVisible();
    // Uso personal: sin "Sumá a tu equipo", con importar; los datos de ejemplo aparecen en Recientes.
    await expect(p.getByTestId('home-invite')).toHaveCount(0);
    await expect(p.getByTestId('home-import')).toBeVisible();
    // El owner ve la zona de propiedad y cierre.
    await p.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('ws-danger-owner')).toContainText('reply by hand');
    await expect(p.getByTestId('ws-danger-owner')).not.toContainText('30 days');
  } finally {
    await ctx.close();
  }
});

test('member con CRM y Docs: app bloqueada, pide acceso y el owner lo habilita desde el aviso', async ({ browser, page }) => {
  test.setTimeout(120_000);
  const { ctx, p, email, team } = await join(browser, 'member', '["crm","docs"]');
  try {
    await p.getByRole('button', { name: `Go to ${team.name}` }).click();
    await p.waitForURL(/\/en\/app$/);
    // Ajustes: solo los ajustes de sus apps; leyenda de roles; salir del workspace.
    await p.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    const nav = p.locator('.st-layout nav').first();
    await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Track', exact: true })).toHaveCount(0);
    await p.getByTestId('roles-legend').locator('summary').click();
    await expect(p.getByTestId('roles-legend')).toContainText('The only one who can name, change or remove admins');
    await expect(p.getByTestId('roles-legend')).not.toContainText('you allow');
    await expect(p.getByRole('button', { name: 'Leave workspace' })).toBeVisible();
    // Member: no cambia roles ni invita (API).
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    expect((await p.request.patch('/api/teams/members/demo', { data: { role: 'member' } })).status()).toBe(403);
    expect((await p.request.post('/api/teams/invites', { data: { emails: 'x@roles-e2e.io' } })).status()).toBe(403);
    await p.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('ws-danger-member')).toBeVisible();
    await expect(p.getByTestId('ws-danger-owner')).toHaveCount(0);

    // Track no está entre sus apps: aviso y "Pedir acceso".
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await p.waitForURL(/\/en\/app\?blocked=track/);
    await expect(p.getByTestId('home-blocked')).toContainText("You don't have access to Track here");
    await p.getByRole('button', { name: 'Ask for access' }).click();
    await expect(p.getByTestId('access-requested')).toContainText('Request sent');
    // Pedirlo otra vez el mismo día lo dice.
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Ask for access' }).click();
    await expect(p.getByTestId('access-requested')).toContainText('You already asked today');

    // El owner (demo) recibe el aviso y el link abre el acceso de esa persona.
    const inbox = (await (await page.request.get('/api/notifications?type=workspace_access&limit=50')).json()) as { rows: Array<{ title: string; href: string }> };
    const n = inbox.rows.find((r) => r.href.includes(me));
    expect(n?.title).toContain('Track');
    await page.goto(`/en${n!.href}`, { waitUntil: 'networkidle' });
    expect(n!.href).toContain('&ws=');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Track').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    // Se entera, el link viejo ya no muestra el bloqueo y la app abre.
    const mine = (await (await p.request.get('/api/notifications?type=workspace_access&limit=10')).json()) as { rows: Array<{ title: string }> };
    expect(mine.rows.some((r) => /access to Track/.test(r.title))).toBe(true);
    await p.goto('/en/app?blocked=track', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('home-blocked')).toHaveCount(0);
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\/track/);
  } finally {
    await ctx.close();
  }
});

test('admin con otro workspace activo: el aviso no abre el acceso ahí; primero cambia al workspace del pedido', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await join(browser, 'admin', '*');
  const mem = await join(browser, 'member', '["docs"]');
  try {
    await admin.p.getByRole('button', { name: /^Go to/ }).click();
    await admin.p.waitForURL(/\/en\/app$/);
    await mem.p.getByRole('button', { name: /^Go to/ }).click();
    await mem.p.waitForURL(/\/en\/app$/);
    expect((await mem.p.request.post('/api/teams/access-request', { data: { app: 'crm' } })).status()).toBe(200);
    const inbox = (await (await admin.p.request.get('/api/notifications?type=workspace_access&limit=20')).json()) as { rows: Array<{ href: string }> };
    const memId = String((await sql('SELECT id FROM users WHERE email = ?', [mem.email]))[0].id);
    const href = inbox.rows.find((r) => r.href.includes(memId))!.href;
    // Vuelve a su workspace propio y abre el aviso.
    expect((await admin.p.request.post('/api/teams/switch', { data: { teamId: null } })).ok()).toBe(true);
    await admin.p.goto(`/en${href}`, { waitUntil: 'networkidle' });
    await expect(admin.p.getByTestId('request-other-workspace')).toContainText(admin.team.name);
    await expect(admin.p.getByRole('dialog')).toHaveCount(0);
    await admin.p.getByRole('button', { name: `Switch to ${admin.team.name}` }).click();
    await expect(admin.p.getByRole('dialog')).toBeVisible();
    await expect(admin.p.getByTestId('request-other-workspace')).toHaveCount(0);
    // Un workspace del que no es parte no dice ni abre nada.
    await mem.p.goto(`/en/app/settings/members?person=${memId}&ws=ws_no_existe`, { waitUntil: 'networkidle' });
    await expect(mem.p.getByTestId('request-other-workspace')).toContainText('not part of');
    await expect(mem.p.getByRole('dialog')).toHaveCount(0);
  } finally {
    await admin.ctx.close();
    await mem.ctx.close();
  }
});

test('admin: invita members pero no nombra admins ni toca al owner; 320px oscuro sin scroll horizontal', async ({ browser }) => {
  const { ctx, p, team } = await join(browser, 'admin', '*', { width: 320, dark: true });
  try {
    await expect(p.getByRole('heading', { name: `Welcome to ${team.name}` })).toBeVisible();
    await p.getByRole('button', { name: `Go to ${team.name}` }).click();
    await p.waitForURL(/\/en\/app$/);
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    expect((await p.request.post('/api/teams/invites', { data: { emails: `a-${uid()}@roles-e2e.io`, role: 'admin' } })).status()).toBe(403);
    expect((await p.request.post('/api/teams/invites', { data: { emails: `m-${uid()}@roles-e2e.io`, role: 'member' } })).status()).toBe(201);
    expect((await p.request.patch('/api/teams/members/demo', { data: { apps: ['crm'] } })).status()).toBe(403);
    // Pedir acceso a una app que ya tiene no avisa a nadie.
    expect((await p.request.post('/api/teams/access-request', { data: { app: 'crm' } })).status()).toBe(409);
    for (const path of ['/en/app/settings/members', '/en/app/settings/workspace']) {
      await p.goto(path, { waitUntil: 'networkidle' });
      expect(await overflow(p), path).toBeLessThanOrEqual(0);
    }
    await expect(p.getByTestId('ws-danger-member')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('guest: el onboarding corto lo explica, abre lo compartido, no ve el resto y se puede ir', async ({ browser, page }) => {
  const { ctx, p, team, email } = await join(browser, 'guest', '*');
  try {
    await expect(p.getByRole('heading', { name: `You’re a guest of ${team.name}` })).toBeVisible();
    await expect(p.getByText(`You joined ${team.name} as a guest`)).toBeVisible();
    await expect(p.getByRole('button', { name: 'Not you? Sign out' })).toBeVisible();
    await expect(p.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(p.getByRole('button', { name: `Go to ${team.name}` })).toHaveCount(0);
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.waitForURL(/\/en\/app\/docs/);
    // Una página compartida se abre; otra del mismo workspace, no.
    const title = `Compartida ${uid()}`;
    const shared = (await (await page.request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
    const hidden = (await (await page.request.post('/api/docs/pages', { data: { title: `Privada ${uid()}` } })).json()) as { id: string };
    expect((await page.request.post(`/api/docs/pages/${shared.id}/share`, { data: { kind: 'user', email, role: 'view' } })).status()).toBe(201);
    await p.goto(`/en/app/docs/${shared.id}`, { waitUntil: 'networkidle' });
    await expect(p.getByText(title).first()).toBeVisible();
    expect((await p.request.get(`/api/docs/pages/${hidden.id}`)).ok()).toBe(false);
    // El workspace no aparece en su switcher, pero sí en Ajustes, y puede irse.
    await p.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-testid="member-row"][data-email="demo@zerosoft.ai"]')).toHaveCount(0);
    await expect(p.getByTestId('guest-of')).toContainText(team.name);
    await p.getByRole('button', { name: 'Stop being a guest' }).click();
    await p.getByRole('alertdialog').getByRole('button', { name: 'Stop being a guest' }).click();
    await expect(p.getByTestId('guest-of')).toHaveCount(0);
    expect((await p.request.get(`/api/docs/pages/${shared.id}`)).ok()).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('sitio: Empezar gratis lleva a entrar con Google o código', async ({ browser }) => {
  const ctx = await as(browser, 'session');
  const p = await ctx.newPage();
  try {
    await p.goto('/en', { waitUntil: 'networkidle' });
    await p.getByRole('link', { name: 'Start free' }).first().click();
    await p.waitForURL(/\/en\/auth\/signin/);
    await expect(p.getByRole('button', { name: /Google/ })).toBeVisible();
    await expect(p.getByLabel(/email/i).first()).toBeVisible();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
  } finally {
    await ctx.close();
  }
});

test('admin desde la UI: invita en lote, cambia roles y saca a un member; quien sale pierde el acceso', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = await join(browser, 'admin', '*');
  const mem = await join(browser, 'member', '*');
  try {
    const { p } = admin;
    await p.getByRole('button', { name: /^Go to/ }).click();
    await p.waitForURL(/\/en\/app$/);
    await mem.p.getByRole('button', { name: /^Go to/ }).click();
    await mem.p.waitForURL(/\/en\/app$/);
    await p.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    // Lote con un email inválido: cada uno dice cómo salió.
    const a = `lote-a-${uid()}@roles-e2e.io`;
    const b = `lote-b-${uid()}@roles-e2e.io`;
    await p.getByLabel('Emails').fill(`${a}, ${b}, no-es-un-email`);
    await p.getByRole('button', { name: 'Send invitations' }).click();
    await expect(p.getByTestId('invite-result')).toHaveCount(2);
    await expect(p.getByText('no-es-un-email')).toBeVisible();
    await expect(p.getByTestId('invite-row').filter({ hasText: a })).toBeVisible();
    // Un admin no ofrece nombrar admins; al owner no lo puede tocar.
    const row = p.locator('tr', { has: p.locator(`[data-email="${mem.email}"]`) });
    const select = row.getByRole('combobox');
    await expect(select.locator('option', { hasText: 'Admin' })).toHaveCount(0);
    const roleOf = async () => String((await sql('SELECT role FROM team_members WHERE team_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)', [admin.team.id, mem.email]))[0].role);
    await select.selectOption('guest');
    await expect.poll(roleOf).toBe('guest');
    await select.selectOption('member');
    await expect.poll(roleOf).toBe('member');
    expect((await p.request.delete('/api/teams/members/demo')).status()).toBe(403);
    // Sacar: el acceso se corta en el pedido siguiente.
    await row.getByRole('button', { name: 'Remove' }).click();
    await p.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(p.locator(`[data-email="${mem.email}"]`)).toHaveCount(0);
    await mem.p.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(mem.p.locator('[data-testid="member-row"][data-email="demo@zerosoft.ai"]')).toHaveCount(0);
    // Salir por su cuenta: el admin deja el workspace y vuelve al suyo.
    await p.getByRole('button', { name: 'Leave workspace' }).click();
    await p.getByRole('alertdialog').getByRole('button', { name: 'Leave workspace' }).click();
    await p.waitForURL(/\/en\/app/);
    await p.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-testid="member-row"][data-email="demo@zerosoft.ai"]')).toHaveCount(0);
  } finally {
    await admin.ctx.close();
    await mem.ctx.close();
  }
});
