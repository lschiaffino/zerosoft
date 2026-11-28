import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * "Puede invitar a Lines": un member sin el permiso ve la pestaña Invitar
 * apagada y con motivo; el owner se lo da desde Miembros; el member invita
 * por email y por link con acceso solo a Lines; pedir otra app o admin sigue
 * siendo 403; quitarlo corta. 1280 claro y 390 oscuro, sin scroll horizontal.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const CAP = 'lines.invite';

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
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

async function member(browser: Browser, name: string, opts: { width?: number; dark?: boolean } = {}) {
  const email = `member-${uid()}@invite-e2e.io`;
  const demo = await as(browser, 'session-demo');
  await demo.request.get('/api/teams/members');
  await demo.close();
  const ctx = await as(browser, email, opts);
  await ctx.request.get('/api/teams/members');
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [name, team, id]);
  await sql("INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  return { ctx, email, id, team, name };
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('un member sin el permiso ve Invitar apagado; con "Puede invitar a Lines" invita solo a Lines; sin él, corta', async ({ browser, page }) => {
  test.setTimeout(180_000);
  const marta = await member(browser, `Marta ${uid()}`);
  const guestEmail = `new-${uid()}@invite-e2e.io`;
  try {
    // Sin el permiso: pestaña apagada con el motivo, y el servidor dice 403.
    const mp = await marta.ctx.newPage();
    await mp.goto('/en/app/lines/settings?tab=invite', { waitUntil: 'networkidle' });
    await expect(mp.getByTestId('lines-invite-send')).toBeDisabled();
    await expect(mp.getByTestId('lines-invite-locked')).toContainText('Ask an admin');
    expect((await marta.ctx.request.post('/api/teams/invites', { data: { emails: guestEmail, role: 'member', apps: ['groups'] } })).status()).toBe(403);

    // El owner le da el permiso desde Miembros (con confirmación).
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: `See what ${marta.name} can see` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('caps-section').getByLabel('Can invite to Lines').click();
    const confirm = page.getByRole('alertdialog');
    await page.waitForTimeout(300);
    await confirm.getByRole('button', { name: 'Give permission' }).click();
    await expect
      .poll(async () => String((await sql('SELECT capabilities FROM team_members WHERE team_id = ? AND user_id = ?', [marta.team, marta.id]))[0]?.capabilities), { timeout: 20_000 })
      .toBe(`["${CAP}"]`);

    // Marta invita por email: el invitado queda como member y solo con Lines.
    await mp.goto('/en/app/lines/settings?tab=invite', { waitUntil: 'networkidle' });
    await mp.getByLabel('Emails').fill(guestEmail);
    await mp.getByTestId('lines-invite-send').click();
    await expect(mp.getByTestId('lines-invite-result').first()).toContainText(guestEmail);
    const inv = (await sql('SELECT role, apps FROM team_invites WHERE team_id = ? AND lower(email) = ?', [marta.team, guestEmail]))[0];
    expect(inv.role).toBe('member');
    expect(JSON.parse(String(inv.apps))).toEqual(['groups']);
    // Y por link.
    await mp.getByTestId('lines-invite-link').click();
    await expect(mp.getByTestId('lines-invite-result').first()).toBeVisible();

    // Lo que sigue cerrado.
    const post = (data: unknown) => marta.ctx.request.post('/api/teams/invites', { data });
    expect((await post({ emails: `x-${uid()}@invite-e2e.io`, role: 'member', apps: ['crm'] })).status()).toBe(403);
    expect((await post({ emails: `x-${uid()}@invite-e2e.io`, role: 'admin', apps: ['groups'] })).status()).toBe(403);
    expect((await post({ emails: `x-${uid()}@invite-e2e.io`, role: 'member', apps: '*' })).status()).toBe(403);
    expect((await marta.ctx.request.patch(`/api/teams/members/${marta.id}`, { data: { role: 'admin' } })).status()).toBe(403);

    // 390 oscuro, sin scroll horizontal.
    const mobile = await as(browser, marta.email, { width: 390, dark: true });
    const mm = await mobile.newPage();
    await mm.goto('/en/app/lines/settings?tab=invite', { waitUntil: 'networkidle' });
    await expect(mm.getByTestId('lines-invite-send')).toBeVisible();
    expect(await overflow(mm)).toBeLessThanOrEqual(0);
    const box = await mm.getByTestId('lines-invite-send').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
    await mobile.close();
    expect(await overflow(mp)).toBeLessThanOrEqual(0);

    // Sin el permiso otra vez: 403 en el pedido siguiente.
    await sql('UPDATE team_members SET capabilities = ? WHERE team_id = ? AND user_id = ?', ['[]', marta.team, marta.id]);
    expect((await post({ emails: `y-${uid()}@invite-e2e.io`, role: 'member', apps: ['groups'] })).status()).toBe(403);
  } finally {
    await marta.ctx.close();
    await sql('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [marta.team, marta.id]);
  }
});
