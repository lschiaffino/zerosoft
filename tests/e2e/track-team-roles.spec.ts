import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Track: dueños de equipo (como los team owners de Linear). Un rol por prueba:
 * el admin del workspace (el demo) nombra dueño a Lea en Ajustes del equipo ›
 * Miembros; Lea maneja su equipo sin ser admin, pero no otro equipo ni el
 * acceso del workspace; Dev, miembro común, ve los ajustes y no los cambia.
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

/** Invita a `email` al workspace del demo y devuelve su contexto ya adentro. */
async function joinAs(request: APIRequestContext, browser: Browser, baseURL: string, email: string, teamId: string): Promise<{ ctx: BrowserContext; id: string }> {
  const invite = await request.post('/api/teams/invites', { data: { emails: [email], role: 'member' } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [email]))[0]?.token);
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const accepted = await ctx.request.post('/api/teams/accept', { data: { token } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
  // Su id tal como lo ve Track (el del miembro en la lista del equipo).
  const view = await ctx.request.get(`/api/track/projects/${teamId}/access`);
  expect(view.ok(), await view.text()).toBe(true);
  const { me } = (await view.json()) as { me: string };
  return { ctx, id: me };
}

async function cleanup(email: string) {
  await sql("DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE owner_id = 'demo') AND user_id = (SELECT id FROM users WHERE email = ?)", [email]);
  await sql("UPDATE team_invites SET status = 'revoked' WHERE email = ?", [email]);
}

async function openSettings(page: Page, teamId: string, tab = 'general') {
  await page.goto(`/en/app/track/team/${teamId}`);
  await page.getByTestId('track-project-settings').click();
  const drawer = page.getByTestId('track-project-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByTestId(`track-settings-tab-${tab}`).click();
  return drawer;
}

test('Track: un rol por prueba, miembro, dueño del equipo y admin del workspace', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(240_000);
  const leaEmail = `lea-roles-${uid()}@darwin-e2e.io`;
  const devEmail = `dev-roles-${uid()}@darwin-e2e.io`;
  const team = (await (await request.post('/api/track/projects', { data: { name: `Roles ${uid()}` } })).json()) as { id: string };
  const other = (await (await request.post('/api/track/projects', { data: { name: `Other ${uid()}` } })).json()) as { id: string };
  const lea = await joinAs(request, browser, baseURL!, leaEmail, team.id);
  const dev = await joinAs(request, browser, baseURL!, devEmail, team.id);
  try {
    // Admin del workspace: nombra dueña a Lea desde Miembros.
    await page.setViewportSize({ width: 1280, height: 800 });
    const adminDrawer = await openSettings(page, team.id, 'members');
    // La lista llega de /api/track/projects/:id/access (con next dev, la primera vez compila).
    await expect(adminDrawer.getByTestId('track-team-members')).toBeVisible({ timeout: 90_000 });
    const leaRow = adminDrawer.locator(`[data-testid="track-team-member"][data-user-id="${lea.id}"]`);
    await expect(leaRow).toHaveAttribute('data-team-role', 'member');
    const roleSet = page.waitForResponse((r) => r.url().endsWith(`/api/track/projects/${team.id}/access`) && r.request().method() === 'POST');
    await leaRow.getByTestId('track-team-role-select').selectOption('owner');
    expect((await roleSet).status()).toBe(200);
    await expect(leaRow).toHaveAttribute('data-team-role', 'owner');
    // El admin también ve y cambia los permisos del equipo.
    await expect(adminDrawer.getByTestId('track-team-perm-settings')).toBeEnabled();

    // Miembro común: ve los ajustes, todo bloqueado, y la API dice que no.
    const devPage = await dev.ctx.newPage();
    await devPage.setViewportSize({ width: 1280, height: 800 });
    const devDrawer = await openSettings(devPage, team.id);
    await expect(devDrawer.getByTestId('track-team-name-edit')).toBeDisabled();
    await expect(devDrawer.getByTestId('track-team-key-edit')).toBeDisabled();
    await expect(devDrawer.getByTestId('track-team-general-locked')).toBeVisible();
    await devDrawer.getByTestId('track-settings-tab-statuses').click();
    await expect(devDrawer.getByTestId('track-statuses-fieldset')).toBeDisabled();
    await devDrawer.getByTestId('track-settings-tab-labels').click();
    await expect(devDrawer.getByTestId('track-labels-locked')).toBeVisible();
    await devDrawer.getByTestId('track-settings-tab-templates').click();
    await expect(devDrawer.getByTestId('track-templates-locked')).toBeVisible();
    await devDrawer.getByTestId('track-settings-tab-members').click();
    await expect(devDrawer.getByTestId('track-team-member').first()).toBeVisible();
    await expect(devDrawer.getByTestId('track-team-role-select')).toHaveCount(0);
    await expect(devDrawer.getByTestId('track-team-perm-settings')).toBeDisabled();
    await devDrawer.getByTestId('track-settings-tab-integrations').click();
    await expect(devDrawer.getByTestId('track-team-slack-locked')).toBeVisible();
    expect((await dev.ctx.request.patch(`/api/track/projects/${team.id}`, { data: { name: 'Hijacked' } })).status()).toBe(403);
    expect((await dev.ctx.request.post(`/api/track/projects/${team.id}/statuses`, { data: { name: 'Nope' } })).status()).toBe(403);
    expect((await dev.ctx.request.post(`/api/track/projects/${team.id}/access`, { data: { action: 'setRole', userId: dev.id, role: 'owner' } })).status()).toBe(403);

    // Dueña del equipo: cambia el nombre y los estados, y abre un área a todos.
    const leaPage = await lea.ctx.newPage();
    await leaPage.setViewportSize({ width: 1280, height: 800 });
    const leaDrawer = await openSettings(leaPage, team.id);
    const name = leaDrawer.getByTestId('track-team-name-edit');
    await expect(name).toBeEnabled();
    const renamed = `Roles renamed ${uid()}`;
    await name.fill(renamed);
    const saved = leaPage.waitForResponse((r) => r.url().endsWith(`/api/track/projects/${team.id}`) && r.request().method() === 'PATCH');
    await name.press('Enter');
    expect((await saved).status()).toBe(200);
    await leaDrawer.getByTestId('track-settings-tab-statuses').click();
    await expect(leaDrawer.getByTestId('track-statuses-fieldset')).toBeEnabled();
    await leaDrawer.getByTestId('track-settings-tab-members').click();
    await expect(leaDrawer.getByTestId('track-team-role-select').first()).toBeVisible();
    const permSet = leaPage.waitForResponse((r) => r.url().endsWith(`/api/track/projects/${team.id}/access`) && r.request().method() === 'POST');
    await leaDrawer.getByTestId('track-team-perm-labels').selectOption('members');
    expect((await permSet).status()).toBe(200);
    await expect(leaDrawer.getByTestId('track-team-perm-labels')).toHaveValue('members');
    // Con labels abierto, Dev ya puede crear labels del equipo, y nada más.
    expect((await dev.ctx.request.post('/api/track/labels', { data: { name: `dev-${uid()}`, projectId: team.id } })).status()).toBe(201);
    expect((await dev.ctx.request.patch(`/api/track/projects/${team.id}`, { data: { name: 'Still no' } })).status()).toBe(403);

    // Pero no el otro equipo ni lo del workspace.
    const leaOther = await openSettings(leaPage, other.id);
    await expect(leaOther.getByTestId('track-team-name-edit')).toBeDisabled();
    expect((await lea.ctx.request.patch(`/api/track/projects/${other.id}`, { data: { name: 'Mine now' } })).status()).toBe(403);
    expect((await lea.ctx.request.delete(`/api/track/projects/${other.id}`)).status()).toBe(403);
    expect((await lea.ctx.request.get('/api/track/access')).status()).toBe(403);
    expect((await lea.ctx.request.get('/api/track/integrations/slack/channels')).status()).toBe(403);

    // En el teléfono, la fila de Lea entra sin scroll lateral.
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await openSettings(page, team.id, 'members');
    await expect(phone.getByTestId('track-team-role-select').first()).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await lea.ctx.close();
    await dev.ctx.close();
    await cleanup(leaEmail);
    await cleanup(devEmail);
  }
});
