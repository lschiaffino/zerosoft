import { e2eDb } from './helpers/db';
import { expect, test } from '@playwright/test';

/**
 * Track: vistas del workspace (como las "workspace views" de Linear). En Issues
 * se guarda una vista compartida; otra persona del workspace la ve en Saved
 * views con su dueño, la abre con sus filtros y no la puede editar. Volverla
 * personal la saca para el resto. My issues no ofrece compartir.
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

test('Issues: una vista compartida con el workspace la ve y la usa otra persona, que no la edita', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(180_000);
  const leo = `leo-views-${uid()}@darwin-e2e.io`;
  const team = (await (await request.post('/api/track/projects', { data: { name: `Views ${uid()}` } })).json()) as { id: string };
  const urgent = `Urgent ${uid()}`;
  const low = `Low ${uid()}`;
  for (const [title, priority] of [
    [urgent, 'urgent'],
    [low, 'low'],
  ] as const) {
    expect((await request.post(`/api/track/projects/${team.id}/issues`, { data: { title, priority } })).ok()).toBe(true);
  }

  // Leo entra al workspace del demo.
  const invite = await request.post('/api/teams/invites', { data: { emails: [leo], role: 'member' } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [leo]))[0]?.token);
  const leoCtx = await browser.newContext({ baseURL });
  await leoCtx.addCookies([{ name: 'zs_e2e_as', value: leo, url: baseURL! }]);
  try {
    const accepted = await leoCtx.request.post('/api/teams/accept', { data: { token } });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    // Sin el mini onboarding de invitado (lo cubre workspace-teams.spec): directo a Track.
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [leo]);

    // El demo guarda una vista compartida con un filtro.
    const name = `Urgent work ${uid()}`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/app/track/issues');
    await expect(page.getByText(urgent).first()).toBeVisible();
    const res = await request.post('/api/track/list-views', {
      data: { key: 'workspace-issues', name, filters: { priority: ['urgent'] }, viewType: 'list', sort: 'manual' },
    });
    expect(res.status()).toBe(201);
    const view = (await res.json()) as { id: string };
    await page.reload();
    await page.getByTestId('track-saved-views').click();
    const mine = page.getByTestId('track-saved-view').filter({ hasText: name });
    await expect(mine).toBeVisible();
    // Compartir desde el menú (el mismo botón que en un team, para el workspace).
    const share = mine.getByTestId('track-view-share');
    await expect(share).toHaveAttribute('aria-label', `Share with the workspace: ${name}`);
    await share.click();
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await expect(mine).toContainText('Workspace');

    // Leo la ve en Saved views, con el nombre del dueño, sin botones de editar.
    const leoPage = await leoCtx.newPage();
    await leoPage.setViewportSize({ width: 1280, height: 800 });
    await leoPage.goto('/en/app/track/issues');
    await leoPage.getByTestId('track-saved-views').click();
    const shared = leoPage.getByTestId('track-saved-view').filter({ hasText: name });
    await expect(shared).toBeVisible();
    await expect(shared).toContainText('Demo');
    await expect(shared.getByTestId('track-view-share')).toHaveCount(0);
    await expect(shared.getByRole('button', { name: new RegExp(`^Delete`) })).toHaveCount(0);
    // La abre: se aplica el filtro.
    await shared.getByRole('button', { name: new RegExp(name) }).first().click();
    await expect(leoPage.getByText(urgent).first()).toBeVisible();
    await expect(leoPage.getByText(low)).toHaveCount(0);
    // Y no la puede cambiar por la API.
    expect((await leoCtx.request.patch('/api/track/list-views', { data: { id: view.id, name: 'Hacked' } })).status()).toBe(404);
    expect((await leoCtx.request.delete(`/api/track/list-views?id=${view.id}`)).status()).toBe(404);

    // El link copiado abre la vista para Leo.
    await leoPage.goto(`/en/app/track/issues?savedView=${view.id}`);
    await expect(leoPage.getByTestId('track-saved-views')).toContainText(name);

    // Personal otra vez: Leo deja de verla.
    await share.click();
    await expect(share).toHaveAttribute('aria-pressed', 'false');
    const rows = (await (await leoCtx.request.get('/api/track/list-views?key=workspace-issues')).json()) as { rows: Array<{ id: string }> };
    expect(rows.rows.map((r) => r.id)).not.toContain(view.id);

    // En el teléfono el menú se abre adentro de la pantalla (antes quedaba debajo del borde).
    await leoPage.setViewportSize({ width: 390, height: 844 });
    await leoPage.goto('/en/app/track/issues');
    await leoPage.getByTestId('track-saved-views').click();
    const menu = leoPage.locator('.track-saved-views-menu');
    await expect(menu).toBeInViewport({ ratio: 1 });

    // My issues: las vistas son de cada uno, sin compartir.
    await page.goto('/en/app/track/my-tasks');
    const mineRes = (await (await request.get('/api/track/list-views?key=mine:assigned')).json()) as { shareable: boolean };
    expect(mineRes.shareable).toBe(false);
  } finally {
    await leoCtx.close();
    await sql("DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE owner_id = 'demo') AND user_id = (SELECT id FROM users WHERE email = ?)", [leo]);
    await sql("UPDATE team_invites SET status = 'revoked' WHERE email = ?", [leo]);
  }
});
