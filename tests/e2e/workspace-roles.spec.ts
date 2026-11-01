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
    await p.getByText('Just me').click();
    await p.getByRole('button', { name: 'Continue' }).click();
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
    await expect(p.getByTestId('ws-danger-owner')).toContainText('privacy@zerosoft.ai');
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
    await expect(p.getByTestId('roles-legend')).toContainText('Created the workspace');
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
    await expect(p.getByTestId('access-requested')).toBeVisible();

    // El owner (demo) recibe el aviso y el link abre el acceso de esa persona.
    const inbox = (await (await page.request.get('/api/notifications?type=workspace_access&limit=50')).json()) as { rows: Array<{ title: string; href: string }> };
    const n = inbox.rows.find((r) => r.href.includes(me));
    expect(n?.title).toContain('Track');
    await page.goto(`/en${n!.href}`, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Track').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\/track/);
  } finally {
    await ctx.close();
  }
});

test('admin: invita members pero no nombra admins ni toca al owner; 390px oscuro sin scroll horizontal', async ({ browser }) => {
  const { ctx, p, team } = await join(browser, 'admin', '*', { width: 390, dark: true });
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

test('guest: el onboarding corto dice que llega a su propio workspace y ve lo compartido', async ({ browser }) => {
  const { ctx, p, team } = await join(browser, 'guest', '*');
  try {
    await expect(p.getByText(`You joined ${team.name} as a guest`)).toBeVisible();
    await expect(p.getByRole('button', { name: `Go to ${team.name}` })).toHaveCount(0);
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.waitForURL(/\/en\/app$/);
    // En su workspace propio es owner: no ve los miembros del workspace que lo invitó.
    await p.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-testid="member-row"][data-email="demo@zerosoft.ai"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
