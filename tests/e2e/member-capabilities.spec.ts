import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Permisos extra por persona: el owner le da a un member "Puede conectar
 * números en Lines" desde Miembros y permisos (con confirmación y registro),
 * el member conecta un número con el proveedor falso, que queda a su nombre y
 * privado; otro member sin el permiso recibe 403 (o 404 si ni la ve) en cada
 * ruta; al quitarlo, el pedido siguiente ya es 403. Capturas a 1280 claro y
 * 390 oscuro, sin scroll horizontal.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const CAP = 'lines.numbers.manage';

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

/** Un member del workspace demo, con su cuenta creada y el workspace demo activo. */
async function member(browser: Browser, name: string, opts: { width?: number; dark?: boolean } = {}) {
  const email = `member-${uid()}@caps-e2e.io`;
  const demo = await as(browser, 'session-demo');
  await demo.request.get('/api/teams/members');
  await demo.close();
  const ctx = await as(browser, email, opts);
  await ctx.request.get('/api/teams/members');
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = await demoTeam();
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [name, team, id]);
  await sql("INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  return { ctx, email, id, team, name };
}

async function capsOf(team: string, id: string): Promise<string> {
  return String((await sql('SELECT capabilities FROM team_members WHERE team_id = ? AND user_id = ?', [team, id]))[0]?.capabilities ?? '');
}

const row = (p: Page, email: string) => p.locator('tr', { has: p.locator(`[data-testid="member-row"][data-email="${email}"]`) });
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (p: Page, name: string) => {
  const dir = process.env.CAPS_SHOTS_DIR;
  await p.screenshot({ path: dir ? `${dir}/${name}.png` : test.info().outputPath(`${name}.png`), fullPage: false });
};

test('el owner da el permiso, el member conecta su número privado, otro member no puede, y quitarlo corta al instante', async ({ browser, page }) => {
  test.setTimeout(180_000);
  const marta = await member(browser, `Marta ${uid()}`);
  const nico = await member(browser, `Nico ${uid()}`);
  try {
    // Una línea del workspace, del owner.
    const ownerLine = await page.request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Soporte ${uid()}` } });
    expect(ownerLine.status(), await ownerLine.text()).toBe(201);
    const ownerLineId = String(((await ownerLine.json()) as { id: string }).id);

    // Sin el permiso: 403 al agregar y al administrar, y la pantalla lo explica.
    expect((await marta.ctx.request.post('/api/groups/numbers', { data: { provider: 'fake', name: 'No' } })).status()).toBe(403);
    expect((await marta.ctx.request.patch(`/api/groups/numbers/${ownerLineId}`, { data: { name: 'x' } })).status()).toBe(403);
    expect((await marta.ctx.request.post(`/api/groups/numbers/${ownerLineId}/connect`, { data: { action: 'disconnect' } })).status()).toBe(403);
    expect((await marta.ctx.request.delete(`/api/groups/numbers/${ownerLineId}`)).status()).toBe(403);
    // Tampoco se da el permiso a sí misma.
    expect((await marta.ctx.request.patch(`/api/teams/members/${marta.id}`, { data: { capabilities: [CAP] } })).status()).toBe(403);
    expect(await capsOf(marta.team, marta.id)).toBe('[]');
    const mp = await marta.ctx.newPage();
    await mp.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    await expect(mp.getByText('people an admin allowed to connect numbers')).toBeVisible();
    await expect(mp.getByRole('button', { name: 'Add number' })).toHaveCount(0);

    // El owner abre el acceso de Marta y le da el permiso: pide confirmación.
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await row(page, marta.email).getByRole('button', { name: `See what ${marta.name} can see` }).click();
    const dialog = page.getByRole('dialog');
    const section = dialog.getByTestId('caps-section');
    await expect(section).toContainText('Extra permissions');
    await expect(section).toContainText('does not let them see other people');
    // El checkbox no cambia hasta confirmar.
    await section.getByLabel('Can connect numbers in Lines').click();
    const confirm = page.getByRole('alertdialog');
    await page.waitForTimeout(300);
    await expect(confirm).toContainText(`Give ${marta.name} this permission: Can connect numbers in Lines?`);
    await shot(page, 'members-grant-confirm-1280-light');
    await confirm.getByRole('button', { name: 'Give permission' }).click();
    await expect.poll(() => capsOf(marta.team, marta.id), { timeout: 20_000 }).toBe(`["${CAP}"]`);
    await expect(page.getByTestId('members-toast')).toContainText('now has: Can connect numbers in Lines');
    await expect(section.getByLabel('Can connect numbers in Lines')).toBeChecked();
    await shot(page, 'members-permissions-1280-light');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('audit-log')).toContainText(`gave ${marta.name}: Can connect numbers in Lines`);

    // Marta ahora agrega un número con el proveedor falso y lo conecta.
    await mp.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    await expect(mp.getByTestId('numbers-member-note')).toBeVisible();
    await mp.getByRole('button', { name: 'Add number' }).click();
    const form = mp.getByRole('dialog');
    const fake = form.locator('input[name="provider"][value="fake"]');
    if (!(await fake.isVisible())) await form.locator('summary').click();
    await fake.check();
    const lineName = `Marta ventas ${uid()}`;
    await form.getByLabel('Name').fill(lineName);
    await form.locator('button[type="submit"]').click();
    await expect(mp.getByRole('dialog')).toContainText('Connected', { timeout: 15_000 });
    await mp.getByRole('dialog').getByRole('button', { name: /Done|Close/ }).first().click();
    const mine = (await sql('SELECT id, owner_id, visibility, created_by FROM groups_numbers WHERE name = ?', [lineName]))[0] as Record<string, string>;
    expect(mine).toMatchObject({ owner_id: marta.id, visibility: 'restricted', created_by: marta.id });
    const item = mp.locator('.gr-number', { hasText: lineName });
    await expect(item.getByRole('button', { name: 'Delete' })).toBeVisible();
    // La línea del owner la ve (es de todo el workspace) pero sin controles de administrar.
    await expect(mp.locator('.gr-number', { hasText: 'Soporte' }).first().getByRole('button', { name: 'Delete' })).toHaveCount(0);
    // Comparte su línea, pero el dueño no lo cambia.
    await item.getByTestId('line-access-btn').click();
    await expect(mp.getByTestId('line-owner-fixed')).toBeVisible();
    await expect(mp.getByTestId('line-owner')).toHaveCount(0);
    await mp.keyboard.press('Escape');
    expect((await marta.ctx.request.patch(`/api/groups/numbers/${mine.id}`, { data: { ownerId: nico.id } })).status()).toBe(403);

    // Nico (sin el permiso) ni ve la línea privada de Marta: 404 en cada ruta, y no figura en su lista.
    const nicoList = (await (await nico.ctx.request.get('/api/groups/numbers')).json()) as { numbers: Array<{ id: string }>; canEdit: boolean };
    expect(nicoList.canEdit).toBe(false);
    expect(nicoList.numbers.map((n) => n.id)).not.toContain(mine.id);
    expect((await nico.ctx.request.get(`/api/groups/numbers/${mine.id}`)).status()).toBe(404);
    expect((await nico.ctx.request.get(`/api/groups/numbers/${mine.id}/connect`)).status()).toBe(404);
    expect((await nico.ctx.request.delete(`/api/groups/numbers/${mine.id}`)).status()).toBe(403);
    expect((await nico.ctx.request.post('/api/groups/numbers', { data: { provider: 'fake', name: 'Nico' } })).status()).toBe(403);

    // 390 oscuro: la lista de números de Marta y su acceso en Miembros, sin scroll horizontal.
    const mobile = await browser.newContext({ baseURL: test.info().project.use.baseURL as string, viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await mobile.addCookies([{ name: 'zs_e2e_as', value: marta.email, url: test.info().project.use.baseURL as string }]);
    const mm = await mobile.newPage();
    await mm.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    await expect(mm.locator('.gr-number', { hasText: lineName })).toBeVisible();
    expect(await overflow(mm)).toBeLessThanOrEqual(0);
    await shot(mm, 'lines-numbers-member-390-dark');
    await mobile.close();
    const ownerMobile = await browser.newContext({ baseURL: test.info().project.use.baseURL as string, viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const om = await ownerMobile.newPage();
    await om.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await om.locator(`[data-testid="member-row"][data-email="${marta.email}"]`).first().scrollIntoViewIfNeeded();
    await row(om, marta.email).getByRole('button', { name: `See what ${marta.name} can see` }).click();
    await om.getByRole('dialog').getByTestId('caps-section').scrollIntoViewIfNeeded();
    // La entrada del diálogo dura 150 ms: la captura espera a que termine.
    await om.waitForTimeout(400);
    expect(await overflow(om)).toBeLessThanOrEqual(0);
    await shot(om, 'members-permissions-390-dark');
    await ownerMobile.close();

    // El owner se lo quita: sin confirmación, con deshacer, y el pedido siguiente de Marta ya es 403.
    await row(page, marta.email).getByRole('button', { name: `See what ${marta.name} can see` }).click();
    await page.getByRole('dialog').getByTestId('caps-section').getByLabel('Can connect numbers in Lines').uncheck();
    await expect.poll(() => capsOf(marta.team, marta.id), { timeout: 20_000 }).toBe('[]');
    await expect(page.getByTestId('members-toast')).toContainText('no longer has');
    expect((await marta.ctx.request.patch(`/api/groups/numbers/${mine.id}`, { data: { name: 'otra' } })).status()).toBe(403);
    expect((await marta.ctx.request.post(`/api/groups/numbers/${mine.id}/connect`, { data: { action: 'disconnect' } })).status()).toBe(403);
    expect((await marta.ctx.request.post('/api/groups/numbers', { data: { provider: 'fake', name: 'Otra' } })).status()).toBe(403);
    // Sigue viendo su línea (es la dueña), ya sin controles.
    await mp.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    await expect(mp.locator('.gr-number', { hasText: lineName })).toBeVisible();
    await expect(mp.locator('.gr-number', { hasText: lineName }).getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await sql('DELETE FROM groups_numbers WHERE id IN (?, ?)', [mine.id, ownerLineId]);
  } finally {
    await marta.ctx.close();
    await nico.ctx.close();
  }
});

test('hacer admin a alguien pide confirmación', async ({ browser, page }) => {
  const ana = await member(browser, `Ana ${uid()}`);
  try {
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await row(page, ana.email).getByRole('combobox').selectOption('admin');
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('give them that permission');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(row(page, ana.email).getByRole('combobox')).toHaveValue('member');
    expect(String((await sql('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', [ana.team, ana.id]))[0].role)).toBe('member');
    await row(page, ana.email).getByRole('combobox').selectOption('admin');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Make admin' }).click();
    await expect.poll(async () => String((await sql('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?', [ana.team, ana.id]))[0].role)).toBe('admin');
  } finally {
    await ana.ctx.close();
  }
});
