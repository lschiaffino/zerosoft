import { createClient } from '@libsql/client';
import { expect, test, type APIResponse, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Workspace como equipo de todas las apps, de punta a punta: el owner (el
 * usuario demo) nombra su equipo, invita a dos personas por email (sin
 * proveedor de email en e2e: la UI ofrece copiar el link), cada una acepta
 * desde su propia sesión (cookie zs_e2e_as, solo con E2E_IDENTITY_COOKIE),
 * pasa por el mini onboarding y ve los datos del workspace en CRM, Track,
 * Docs y Talk. Después el owner limita las apps de una (aviso en la página
 * y 401 en la API) y saca a la otra, que pierde el acceso al instante.
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

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** Otra sesión del navegador como `email` (el server la reconoce por la cookie de e2e). */
async function sessionAs(browser: Browser, email: string): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

test('crear equipo, invitar a dos, aceptar con otra sesión, ver los datos en todas las apps y sacar a una', async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const team = `Darwin AI ${uid()}`;
  const ana = `ana-${uid()}@darwin-e2e.io`;
  const leo = `leo-${uid()}@darwin-e2e.io`;
  const contact = `Contacto ${uid()}`;
  const docTitle = `Manual ${uid()}`;
  const project = `Core ${uid()}`;
  const before = (await sql("SELECT name, use_mode FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0];

  try {
    // 1. El owner nombra el workspace (el switcher lo muestra sin recargar).
    await page.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
    const details = page.locator('form', { has: page.getByLabel('Name', { exact: true }) });
    await details.getByLabel('Name', { exact: true }).fill(team);
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(details.getByText('Saved')).toBeVisible();
    await expect(page.getByTestId('workspace-switcher')).toContainText(team);

    // 2. Invita a dos personas por email.
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: `Invite people to ${team}` })).toBeVisible();
    await page.getByLabel('Emails').fill(`${ana}, ${leo}`);
    await page.getByRole('button', { name: 'Send invitations' }).click();
    const results = page.getByTestId('invite-result');
    await expect(results).toHaveCount(2);
    // Sin RESEND_API_KEY el email no sale: lo dice y ofrece copiar el link.
    await expect(results.first()).toContainText('Emails are not set up here');
    await expect(results.first().getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByTestId('invite-row')).toHaveCount(2);
    const tokens = await sql("SELECT email, token FROM team_invites WHERE email IN (?, ?) AND status = 'pending'", [ana, leo]);
    const tokenOf = (email: string) => String(tokens.find((t) => t.email === email)?.token);

    // Datos del workspace en varias apps.
    await ok(request.post('/api/crm/contacts', { data: { firstName: contact, lastName: 'Pérez' } }));
    await ok(request.post('/api/docs/pages', { data: { title: docTitle } }));
    await ok(request.post('/api/track/projects', { data: { name: project } }));
    const channel = await ok<{ id: string }>(request.post('/api/talk/channels', { data: { name: `equipo-${uid()}`, kind: 'public' } }));
    await ok(request.post(`/api/talk/channels/${channel.id}/messages`, { data: { body: 'Bienvenidos al equipo' } }));

    // 3. Ana acepta desde su sesión, pasa el mini onboarding y entra al workspace.
    const anaCtx = await sessionAs(browser, ana);
    const anaPage = await anaCtx.newPage();
    await anaPage.goto(`/en/invite/${tokenOf(ana)}`, { waitUntil: 'networkidle' });
    await expect(anaPage.getByRole('heading', { name: `Join ${team}` })).toBeVisible();
    await anaPage.getByRole('button', { name: `Join ${team}` }).click();
    await anaPage.waitForURL(/\/en\/app\/welcome\?invited=1/);
    await expect(anaPage.getByRole('heading', { name: `Welcome to ${team}` })).toBeVisible();
    await anaPage.getByLabel('Your name').fill('Ana Gómez');
    await anaPage.getByRole('button', { name: `Go to ${team}` }).click();
    await anaPage.waitForURL(/\/en\/app$/);
    await expect(anaPage.getByTestId('workspace-switcher')).toContainText(team);
    // El link ya no sirve.
    expect((await anaCtx.request.post('/api/teams/accept', { data: { token: tokenOf(ana) } })).status()).toBe(400);

    // Ve lo del workspace en CRM, Docs, Track y Talk.
    await anaPage.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    await expect(anaPage.getByText(contact).first()).toBeVisible();
    await anaPage.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(anaPage.getByText(docTitle).first()).toBeVisible();
    await anaPage.goto('/en/app/track/teams', { waitUntil: 'networkidle' });
    await expect(anaPage.getByText(project).first()).toBeVisible();
    const talk = await ok<{ messages: Array<{ body: string }> }>(anaCtx.request.get(`/api/talk/channels/${channel.id}/messages`));
    expect(talk.messages.map((m) => m.body)).toContain('Bienvenidos al equipo');

    // 4. Leo acepta por la API (otra sesión) y queda en la lista.
    const leoCtx = await sessionAs(browser, leo);
    await ok(leoCtx.request.post('/api/teams/accept', { data: { token: tokenOf(leo) } }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('member-row').filter({ hasText: ana })).toBeVisible();
    await expect(page.getByTestId('member-row').filter({ hasText: leo })).toBeVisible();
    await expect(page.getByTestId('invite-row')).toHaveCount(0);

    // 5. Ana solo con Docs: el CRM muestra el aviso y su API corta.
    const anaRow = page.getByRole('row').filter({ hasText: ana });
    await anaRow.getByRole('button', { name: 'Edit access' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('All apps').uncheck();
    for (const app of ['CRM', 'Track', 'Talk', 'Link', 'Chat', 'Groups', 'Flow', 'Agents', 'Robots', 'Notes', 'Cal', 'Board', 'Voice', 'Rec']) {
      const box = dialog.getByLabel(app, { exact: true });
      if (await box.isChecked()) await box.uncheck();
    }
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(anaRow).toContainText('Docs');
    await anaPage.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await expect(anaPage.getByRole('heading', { name: "You don't have access to CRM here" })).toBeVisible();
    expect((await anaCtx.request.get('/api/crm/contacts')).status()).toBe(401);
    await anaPage.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(anaPage.getByText(docTitle).first()).toBeVisible();

    // 6. Sacar a Leo: pierde el acceso al instante en todas las apps.
    const leoPage = await leoCtx.newPage();
    await leoPage.goto('/en/app/welcome?invited=1', { waitUntil: 'networkidle' });
    await leoPage.getByRole('button', { name: `Go to ${team}` }).click();
    await leoPage.waitForURL(/\/en\/app$/);
    await leoPage.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    await expect(leoPage.getByText(contact).first()).toBeVisible();
    const leoRow = page.getByRole('row').filter({ hasText: leo });
    await leoRow.getByRole('button', { name: /^Remove/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('member-row').filter({ hasText: leo })).toHaveCount(0);
    await leoPage.reload({ waitUntil: 'networkidle' });
    await expect(leoPage.getByText(contact)).toHaveCount(0);
    await expect(leoPage.getByTestId('workspace-switcher')).not.toContainText(team);
    const leoContacts = await ok<{ rows?: Array<{ first_name: string }> }>(leoCtx.request.get('/api/crm/contacts'));
    expect(JSON.stringify(leoContacts)).not.toContain(contact);
    expect((await leoCtx.request.get(`/api/talk/channels/${channel.id}/messages`)).ok()).toBe(false);

    await anaCtx.close();
    await leoCtx.close();
  } finally {
    // Las demás specs corren con el demo: su workspace vuelve a como estaba.
    await sql("DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE owner_id = 'demo') AND user_id IN (SELECT id FROM users WHERE email IN (?, ?))", [ana, leo]);
    await sql("UPDATE team_invites SET status = 'revoked' WHERE email IN (?, ?)", [ana, leo]);
    if (before) await sql("UPDATE teams SET name = ?, use_mode = ? WHERE owner_id = 'demo'", [String(before.name), (before.use_mode as string | null) ?? null]);
  }
});

test('invitación: link usado, vencido y de otro email; 390px y oscuro', async ({ page, browser }) => {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `mia-${uid()}@darwin-e2e.io`;
  const tokExpired = `exp${uid()}${uid()}${uid()}`;
  const tokOther = `oth${uid()}${uid()}${uid()}`;
  await sql("INSERT INTO team_invites (id, team_id, email, token, invited_by, expires_at) VALUES (?, ?, ?, ?, 'demo', datetime('now', '-1 day'))", [`ie-${uid()}`, demoTeam, email, tokExpired]);
  await sql("INSERT INTO team_invites (id, team_id, email, token, invited_by, expires_at) VALUES (?, ?, 'someone-else@darwin-e2e.io', ?, 'demo', datetime('now', '+3 days'))", [`io-${uid()}`, demoTeam, tokOther]);
  const ctx = await sessionAs(browser, email);
  const p = await ctx.newPage();
  try {
    await p.goto(`/en/invite/${tokExpired}`, { waitUntil: 'networkidle' });
    await expect(p.getByRole('heading', { name: 'This invitation expired' })).toBeVisible();
    await p.goto('/en/invite/nope-not-a-token', { waitUntil: 'networkidle' });
    await expect(p.getByRole('heading', { name: 'This invitation no longer works' })).toBeVisible();
    await p.goto(`/en/invite/${tokOther}`, { waitUntil: 'networkidle' });
    await expect(p.getByText('This invitation was sent to')).toBeVisible();
    await expect(p.getByRole('button', { name: `Join as ${email}` })).toBeVisible();
    // 390px y oscuro, sin scroll horizontal.
    await p.setViewportSize({ width: 390, height: 800 });
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.reload({ waitUntil: 'networkidle' });
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // El owner ve sus ajustes de miembros bien a 390px en oscuro.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /^Members \(/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  } finally {
    await ctx.close();
    await sql('UPDATE team_invites SET status = ? WHERE token IN (?, ?)', ['revoked', tokExpired, tokOther]);
  }
});

test('onboarding de una cuenta nueva: equipo, invitaciones, rol y app de entrada; el switcher y los subequipos', async ({ browser }) => {
  const email = `founder-${uid()}@acme-e2e.io`;
  const ctx = await sessionAs(browser, email);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await p.waitForURL(/\/en\/app\/welcome/);
    await expect(p.getByRole('heading', { name: 'How will you use zerosoft?' })).toBeVisible();
    await p.getByText('With my team').click();
    await p.getByRole('button', { name: 'Continue' }).click();
    await expect(p.getByRole('heading', { name: 'Your team' })).toBeVisible();
    await p.getByLabel('Team name').fill('Acme Norte');
    await p.getByText('11 to 50').click();
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByLabel('Your name').fill('Fer');
    await p.getByText('Sales', { exact: true }).click();
    await p.getByRole('button', { name: 'Continue' }).click();
    await expect(p.getByRole('heading', { name: 'Invite people to Acme Norte' })).toBeVisible();
    await p.getByLabel('Emails').fill(`uno-${uid()}@acme-e2e.io`);
    await p.getByRole('button', { name: 'Continue' }).click();
    await expect(p.getByRole('heading', { name: 'Where do you start?' })).toBeVisible();
    await p.getByText('HubSpot', { exact: true }).click();
    await expect(p.getByRole('button', { name: 'Import from HubSpot' })).toBeVisible();
    await p.getByRole('button', { name: 'Go to CRM' }).click();
    // Sin proveedor de email: muestra el link para copiar antes de seguir.
    await expect(p.getByRole('heading', { name: 'Almost there' })).toBeVisible();
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.waitForURL(/\/en\/app\/crm$/);
    await expect(p.getByTestId('workspace-switcher')).toContainText('Acme Norte');
    const row = (await sql('SELECT u.onboarded_at, u.profile, t.name, t.use_mode, t.size FROM users u JOIN teams t ON t.owner_id = u.id WHERE u.email = ?', [email]))[0];
    expect(row.onboarded_at).toBeTruthy();
    expect(JSON.parse(String(row.profile))).toMatchObject({ role: 'sales', sourceTool: 'hubspot', entryApp: 'crm' });
    expect([row.name, row.use_mode, row.size]).toEqual(['Acme Norte', 'team', '11-50']);

    // Switcher: abre con teclado, muestra el workspace y Esc cierra.
    await p.getByTestId('workspace-switcher').click();
    await expect(p.getByRole('menu', { name: 'Workspaces' })).toBeVisible();
    await expect(p.getByTestId('workspace-entry')).toHaveCount(1);
    await p.keyboard.press('Escape');
    await expect(p.getByRole('menu', { name: 'Workspaces' })).toHaveCount(0);

    // Subequipos: crear, verlo en Cmd+K, renombrar y borrar sin recargar.
    await p.goto('/en/app/settings/teams', { waitUntil: 'networkidle' });
    await expect(p.getByText('No teams yet')).toBeVisible();
    await p.getByLabel('Name', { exact: true }).fill('Ventas');
    await p.getByRole('button', { name: 'Create team' }).click();
    await expect(p.getByTestId('group-row').filter({ hasText: 'Ventas' })).toBeVisible();
    await expect(p.getByTestId('group-row')).toContainText('@ventas');
    await p.keyboard.press('ControlOrMeta+k');
    await p.getByRole('combobox').fill('Ventas');
    await expect(p.getByRole('option', { name: /Ventas/ }).first()).toBeVisible();
    await p.keyboard.press('Escape');
    await p.getByTestId('group-row').getByRole('button', { name: 'Edit' }).click();
    await p.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Ventas Norte');
    await p.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(p.getByTestId('group-row')).toContainText('@ventas-norte');
    const crm = (await sql("SELECT name FROM crm_sales_teams WHERE user_id = (SELECT id FROM users WHERE email = ?)", [email])).map((r) => r.name);
    expect(crm).toEqual(['Ventas Norte']);
    await p.getByTestId('group-row').getByRole('button', { name: 'Delete Ventas Norte' }).click();
    await p.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(p.getByTestId('group-row')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
