import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Página de project como Linear: crear desde los Projects de un team (queda
 * en ese team), cabecera con chips y menú ⋯ (borrar con confirmación), la
 * pestaña Issues con la lista compartida (grupos, "+" por grupo que crea en
 * el project, agrupar por milestone, tablero), Updates con reacciones, y la
 * lista de projects como tabla. Mis issues: filtros, agrupar y que se
 * recuerden al volver.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function team(request: APIRequestContext) {
  const name = `PP team ${uid()}`;
  const p = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name } }));
  const statuses = await ok<{ rows: Array<{ id: string; category: string; name: string }> }>(request.get(`/api/track/projects/${p.id}/statuses`));
  return { id: p.id, name, status: (c: string) => statuses.rows.find((s) => s.category === c)! };
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('Projects de un team: "New project" nace en ese team y aparece en su lista', async ({ page, request }) => {
  const t = await team(request);
  const name = `Del team ${uid()}`;
  await page.goto(`/en/app/track/projects?team=${t.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('tp-new-plan').click();
  const modal = page.getByTestId('tp-new-plan-modal');
  await expect(page.getByTestId('tp-new-team')).toContainText(t.name);
  await modal.getByLabel('Name').fill(name);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/track\/projects\/[0-9a-f-]{36}/);
  const planId = page.url().split('/projects/')[1].split(/[?#]/)[0];
  const plan = await ok<{ plan: { teams: Array<{ id: string }> } }>(request.get(`/api/track/plans/${planId}`));
  expect(plan.plan.teams.map((x) => x.id)).toEqual([t.id]);
  await page.goto(`/en/app/track/projects?team=${t.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-plans-list').getByTestId('tp-plan-row').filter({ hasText: name })).toBeVisible();
});

test('Project: cabecera, Overview, Issues con la lista compartida y Updates con reacciones', async ({ page, request }) => {
  const t = await team(request);
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Linear page ${uid()}`, status: 'in_progress', teamIds: [t.id] } }));
  await ok(request.post(`/api/track/plans/${plan.id}/milestones`, { data: { name: 'Beta' } }));
  const done = await ok<{ id: string; identifier: string }>(
    request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Hecho ${uid()}`, planId: plan.id, statusId: t.status('done').id } }),
  );
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Pendiente ${uid()}`, planId: plan.id, statusId: t.status('todo').id } }));

  await page.goto(`/en/app/track/projects/${plan.id}`, { waitUntil: 'networkidle' });
  // Una fila de propiedades y, a la derecha, el resumen; sin botón rojo de borrar.
  await expect(page.getByTestId('tp-chips')).toBeVisible();
  await expect(page.getByTestId('tp-side-props')).toContainText(t.name);
  // Un solo panel de progreso (a la derecha): terminado / alcance, en issues.
  await expect(page.getByTestId('tp-progress')).toHaveCount(1);
  await expect(page.getByTestId('tp-progress-detail')).toContainText('1 of 2 issues completed · 50%');
  await expect(page.getByRole('img', { name: 'Scope and completed over time' })).toBeVisible();
  await expect(page.locator('.btn-danger')).toHaveCount(0);
  // Resources: agregar un link.
  await page.getByTestId('tp-add-link').click();
  await page.getByTestId('tp-link-url').fill('figma.com/file/abc');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tp-links')).toContainText('figma.com');
  await shot(page, 'pp-overview-light');

  // Issues: la lista compartida, agrupada por status, sin el buscador viejo ni el alta suelta.
  await page.getByTestId('tp-tab-issues').click();
  const list = page.getByTestId('tp-plan-issues');
  await expect(list.locator('[data-issue-row]')).toHaveCount(2);
  await expect(page.getByTestId('tp-issue-search')).toHaveCount(0);
  await expect(page.getByTestId('tp-new-issue-title')).toHaveCount(0);
  await expect(list.locator('[data-track-sort]')).toHaveAttribute('data-track-sort', 'manual');
  await expect(list.locator(`[data-issue-identifier="${done.identifier}"]`)).toBeVisible();

  // "+" al pie del grupo Todo: el issue nace en el project con ese status.
  const todo = list.getByTestId('track-group').filter({ hasText: 'Todo' });
  await todo.locator('.track-quick-add-btn').click();
  const title = `Desde el grupo ${uid()}`;
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(list.locator('[data-issue-row]', { hasText: title })).toBeVisible();
  await expect
    .poll(async () => {
      const rows = (await ok<{ rows: Array<{ title: string; plan_id: string | null; status_id: string }> }>(request.get(`/api/track/issues?planId=${plan.id}`))).rows;
      const r = rows.find((x) => x.title === title);
      return r ? `${r.plan_id}|${r.status_id}` : '';
    })
    .toBe(`${plan.id}|${t.status('todo').id}`);

  // Agrupar por milestone (Display); el grupo del milestone es destino de arrastre y el "+" crea en el milestone.
  await list.getByTestId('track-display').click();
  await page.getByTestId('track-group-by').click();
  await page.getByTestId('track-group-by-planMilestone').click();
  await page.keyboard.press('Escape');
  const beta = list.getByTestId('track-group').filter({ hasText: 'No milestone' });
  await expect(beta).toHaveAttribute('data-track-drop', 'planMilestone:none');
  await shot(page, 'pp-issues-light');

  // Se recuerda al volver.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('tp-tab-issues').click();
  await expect(page.getByTestId('tp-plan-issues').getByTestId('track-group').first()).toHaveAttribute('data-track-drop', /planMilestone:/);

  // Tablero.
  await page.getByTestId('tp-plan-issues').getByTestId('track-display').click();
  await page.getByTestId('track-view-board').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.track-board-column').first()).toBeVisible();

  // Updates: salud y reacción.
  await page.getByTestId('tp-tab-updates').click();
  await page.locator('.tp-health-opt', { hasText: 'At risk' }).click();
  await page.getByTestId('tp-update-body').fill('Falta el diseño final');
  await page.getByTestId('tp-update-post').click();
  const update = page.getByTestId('tp-update').first();
  await expect(update).toContainText('Falta el diseño final');
  await update.getByRole('button', { name: 'Add reaction' }).first().click();
  await page.getByRole('menuitem', { name: '🎉' }).click();
  await expect(update.getByTestId('tp-reaction')).toContainText('1');

  // ⋯ → Delete con confirmación (Esc cancela).
  await page.getByTestId('tp-plan-more').click();
  await page.keyboard.type('Delete');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Project y lista de projects: oscuro y 390 px sin scroll horizontal', async ({ page, request, context, baseURL }) => {
  const t = await team(request);
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Angosto ${uid()} con un nombre bastante largo`, status: 'in_progress', teamIds: [t.id], targetDate: '2026-12-20' } }));
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Uno ${uid()}`, planId: plan.id } }));
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.goto(`/en/app/track/projects/${plan.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, 'pp-overview-dark');
  await page.getByTestId('tp-tab-issues').click();
  await expect(page.getByTestId('tp-plan-issues').locator('[data-issue-row]')).toHaveCount(1);
  await shot(page, 'pp-issues-dark');
  await page.goto('/en/app/track/projects', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-plans-list')).toBeVisible();
  await shot(page, 'pp-list-dark');
  await context.clearCookies();
  for (const path of [`/en/app/track/projects/${plan.id}`, `/en/app/track/projects/${plan.id}?tab=issues`, '/en/app/track/projects']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path, { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
    await shot(page, `pp-390-${path.includes('issues') ? 'issues' : path.endsWith('projects') ? 'list' : 'overview'}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/app/track/projects', { waitUntil: 'networkidle' });
  await shot(page, 'pp-list-light');
});

test('Mis issues: filtrar, agrupar por team y que se recuerde', async ({ page, request }) => {
  const t = await team(request);
  const me = (await ok<{ me: string }>(request.get('/api/track/plans?meta=only'))).me;
  const high = `Alta ${uid()}`;
  const low = `Baja ${uid()}`;
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: high, priority: 'high', assigneeId: me } }));
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: low, priority: 'low', assigneeId: me } }));
  await page.goto('/en/app/track/my-tasks', { waitUntil: 'networkidle' });
  const list = page.getByTestId('track-my-issues');
  await expect(list.locator('[data-issue-row]', { hasText: high })).toBeVisible();
  // F abre el filtro: Priority → High.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('f');
  await page.keyboard.type('High');
  await page.keyboard.press('Enter');
  await expect(list.locator('[data-issue-row]', { hasText: low })).toHaveCount(0);
  await expect(list.locator('[data-issue-row]', { hasText: high })).toBeVisible();
  // Agrupar por team.
  await list.getByTestId('track-display').click();
  await page.getByTestId('track-group-by').click();
  await page.getByTestId('track-group-by-project').click();
  await page.keyboard.press('Escape');
  await expect(list.getByTestId('track-group').filter({ hasText: t.name })).toBeVisible();
  await shot(page, 'pp-my-issues');
  // Al volver sigue filtrado y agrupado.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(list.getByTestId('track-group').filter({ hasText: t.name })).toBeVisible();
  await expect(list.locator('[data-issue-row]', { hasText: low })).toHaveCount(0);
});
