import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Ajustes › Miembros y permisos, con la sesión de cada rol: el owner cambia
 * rol y apps en línea y lo deshace, da apps en lote, mira qué puede ver una
 * persona, la quita pasándole su trabajo a otra y la suma de nuevo, y todo
 * queda en el registro. Un admin no nombra admins ni toca al owner; un
 * member ve la lista y la leyenda sin controles; un guest no ve a nadie.
 * 390px en oscuro sin scroll horizontal.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function demoTeam(): Promise<string> {
  return String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
}

async function as(browser: Browser, email: string, opts: { width?: number; dark?: boolean } = {}): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width ?? 1280, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** Una persona del workspace demo con ese rol y apps, ya con su cuenta creada. */
async function person(browser: Browser, role: 'admin' | 'member' | 'guest', apps: string, name: string) {
  const email = `${role}-${uid()}@perm-e2e.io`;
  // El workspace demo existe desde el primer pedido del usuario demo.
  const demo = await as(browser, 'session-demo');
  await demo.request.get('/api/teams/members');
  await demo.close();
  const c = await as(browser, email);
  await c.request.get('/api/teams/members');
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = await demoTeam();
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [name, role === 'guest' ? null : team, id]);
  await sql('INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [team, id, role, apps]);
  return { ctx: c, email, id, team, name };
}

async function memberOf(team: string, id: string) {
  return (await sql('SELECT role, apps FROM team_members WHERE team_id = ? AND user_id = ?', [team, id]))[0] as { role: string; apps: string } | undefined;
}

const row = (p: Page, email: string) => p.locator('tr', { has: p.locator(`[data-testid="member-row"][data-email="${email}"]`) });
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('owner: rol y apps en línea con deshacer, lote, qué puede ver, quitar con traspaso y sumar de nuevo', async ({ browser, page }) => {
  test.setTimeout(150_000);
  const ana = await person(browser, 'member', '["crm","docs"]', `Ana ${uid()}`);
  const leo = await person(browser, 'member', '["crm"]', `Leo ${uid()}`);
  try {
    // Trabajo de Ana para pasarle a Leo.
    const contact = `c-${uid()}`;
    await sql("INSERT INTO crm_contacts (id, user_id, owner_id, first_name) VALUES (?, 'demo', ?, 'Para Leo')", [contact, ana.id]);

    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(page.locator('.st-layout nav').first().getByRole('link', { name: 'Members and permissions', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(row(page, ana.email)).toContainText('CRM, Docs');

    // Rol en línea y deshacer.
    await row(page, ana.email).getByRole('combobox').selectOption('admin');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Make admin' }).click();
    await expect(page.getByTestId('members-toast')).toContainText('is now Admin');
    await expect.poll(async () => (await memberOf(ana.team, ana.id))?.role).toBe('admin');
    await page.getByTestId('members-undo').click();
    await expect.poll(async () => (await memberOf(ana.team, ana.id))?.role).toBe('member');
    await expect(row(page, ana.email).getByRole('combobox')).toHaveValue('member');

    // Qué puede ver: CRM al instante, Esc no se lleva el cambio, deshacer con el teclado.
    await row(page, ana.email).getByRole('button', { name: `See what ${ana.name} can see` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('access-view')).toBeVisible();
    await expect(dialog).toContainText('Sees every record');
    await dialog.getByLabel('CRM', { exact: true }).uncheck();
    await expect.poll(async () => (await memberOf(ana.team, ana.id))?.apps).toBe('["docs"]');
    await expect(page.getByTestId('members-toast')).toContainText('no longer sees CRM');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row(page, ana.email)).toContainText('Docs');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect.poll(async () => (await memberOf(ana.team, ana.id))?.apps).toBe('["crm","docs"]');

    // En lote: Track para los dos, y deshacer.
    await row(page, ana.email).getByRole('checkbox').check();
    await row(page, leo.email).getByRole('checkbox').check();
    const bar = page.getByTestId('bulk-bar');
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('combobox', { name: 'Give app' }).selectOption({ label: 'Track' });
    await expect.poll(async () => (await memberOf(leo.team, leo.id))?.apps).toBe('["crm","track"]');
    await expect.poll(async () => (await memberOf(ana.team, ana.id))?.apps).toBe('["crm","docs","track"]');
    await page.getByTestId('members-undo').click();
    await expect.poll(async () => (await memberOf(leo.team, leo.id))?.apps).toBe('["crm"]');
    await bar.getByRole('button', { name: 'Clear selection' }).click();
    await expect(bar).toHaveCount(0);

    // Quitar a Ana pasándole su contacto a Leo: sale de la tabla y aparece en Quitados.
    await row(page, ana.email).getByRole('button', { name: `See what ${ana.name} can see` }).click();
    await page.getByRole('dialog').getByRole('button', { name: `Remove ${ana.name}` }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('1 CRM record');
    await confirm.getByLabel('Pass their work to').selectOption({ label: leo.name });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator(`[data-testid="member-row"][data-email="${ana.email}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-removed-email="${ana.email}"]`)).toBeVisible();
    expect(await memberOf(ana.team, ana.id)).toBeUndefined();
    expect(String((await sql('SELECT owner_id FROM crm_contacts WHERE id = ?', [contact]))[0].owner_id)).toBe(leo.id);
    // Su sesión ya no ve el workspace.
    expect((await ana.ctx.request.get('/api/crm/contacts')).ok()).toBe(true);
    expect(JSON.stringify(await (await ana.ctx.request.get('/api/crm/contacts')).json())).not.toContain('Para Leo');

    // Sumarla de nuevo: vuelve con su rol y sus apps.
    await page.getByRole('button', { name: `Add ${ana.name} back` }).click();
    await expect(page.locator(`[data-testid="member-row"][data-email="${ana.email}"]`)).toBeVisible();
    expect(await memberOf(ana.team, ana.id)).toEqual({ role: 'member', apps: '["crm","docs"]' });

    // El registro cuenta lo que pasó.
    const log = page.getByTestId('audit-log');
    await expect(log).toContainText(`added ${ana.name} back`);
    await expect(log).toContainText(`removed ${ana.name}`);
    await expect(log).toContainText(`passed the work of ${ana.name} to ${leo.name}`);

    // Link de invitación con rol: queda entre las pendientes.
    await page.getByLabel('Role', { exact: true }).selectOption('guest');
    await page.getByTestId('invite-link').click();
    await expect(page.getByTestId('invite-result').first()).toContainText('Invite link ready');
    await expect(page.getByTestId('invite-row').filter({ hasText: 'Invite link' }).first()).toBeVisible();
  } finally {
    for (const c of [ana.ctx, leo.ctx]) await c.close().catch(() => undefined);
  }
});

test('admin, member y guest: cada uno ve y hace solo lo suyo; 390px oscuro', async ({ browser }) => {
  test.setTimeout(240_000);
  const adm = await person(browser, 'admin', '*', `Adm ${uid()}`);
  const mem = await person(browser, 'member', '["docs"]', `Mem ${uid()}`);
  const gst = await person(browser, 'guest', '[]', `Gst ${uid()}`);
  try {
    // Admin: puede cambiar a members, no ofrece Admin, no toca al owner.
    const a = await adm.ctx.newPage();
    await a.goto('/en/app/settings/members', { waitUntil: 'load' });
    const memRow = row(a, mem.email);
    await expect(memRow.getByRole('combobox').locator('option', { hasText: 'Admin' })).toHaveCount(0);
    await expect(row(a, 'demo@zerosoft.ai').getByRole('checkbox')).toHaveCount(0);
    await expect(row(a, 'demo@zerosoft.ai').getByRole('combobox')).toHaveCount(0);
    await expect(a.getByLabel('Role', { exact: true }).locator('option', { hasText: 'Admin' })).toHaveCount(0);
    expect((await a.request.patch('/api/teams/members/demo', { data: { role: 'member' } })).status()).toBe(403);
    expect((await a.request.post('/api/teams/invites', { data: { link: true, role: 'admin' } })).status()).toBe(403);
    // Qué puede ver: el admin lo consulta.
    expect((await a.request.get(`/api/teams/members/${mem.id}`)).status()).toBe(200);

    // Member: lista y leyenda, sin invitar, sin selección, sin acciones; la API lo frena.
    const m = await mem.ctx.newPage();
    await m.goto('/en/app/settings/members', { waitUntil: 'load' });
    await expect(m.locator(`[data-testid="member-row"][data-email="${adm.email}"]`)).toBeVisible();
    await expect(m.getByRole('heading', { name: /^Invite people/ })).toHaveCount(0);
    await expect(m.getByRole('checkbox')).toHaveCount(0);
    await expect(m.getByRole('button', { name: /^See what/ })).toHaveCount(0);
    await m.getByTestId('roles-legend').locator('summary').click();
    await expect(m.getByTestId('roles-legend').getByRole('table')).toContainText('Invite people');
    expect((await m.request.get(`/api/teams/members/${adm.id}`)).status()).toBe(403);
    expect((await m.request.post('/api/teams/invites', { data: { link: true, role: 'member' } })).status()).toBe(403);
    expect((await m.request.delete(`/api/teams/members/${adm.id}`)).status()).toBe(403);
    expect((await m.request.post(`/api/teams/members/${adm.id}`, { data: { action: 'owned' } })).status()).toBe(403);

    // Guest: no ve a la gente del workspace.
    const g = await gst.ctx.newPage();
    await g.goto('/en/app/settings/members', { waitUntil: 'load' });
    await expect(g.locator(`[data-testid="member-row"][data-email="${adm.email}"]`)).toHaveCount(0);
    expect((await g.request.patch(`/api/teams/members/${mem.id}`, { data: { apps: '*' } })).status()).not.toBe(200);

    // 390px en oscuro, con el diálogo de acceso abierto, sin scroll horizontal.
    const narrow = await as(browser, adm.email, { width: 390, dark: true });
    const n = await narrow.newPage();
    await n.goto('/en/app/settings/members', { waitUntil: 'load' });
    expect(await overflow(n)).toBeLessThanOrEqual(0);
    await row(n, mem.email).getByRole('button', { name: /^See what/ }).click();
    await expect(n.getByRole('dialog').getByTestId('access-view')).toBeVisible();
    expect(await overflow(n)).toBeLessThanOrEqual(0);
    await narrow.close();
  } finally {
    for (const c of [adm.ctx, mem.ctx, gst.ctx]) await c.close().catch(() => undefined);
  }
});
