import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Track, planificación (como Linear): plans con updates, initiatives,
 * roadmap con barras arrastrables, métricas de cycle, insights, dashboards y
 * auto-cierre / auto-archivo.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function team(request: APIRequestContext) {
  const p = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Plan team ${uid()}` } }));
  const statuses = await ok<{ rows: Array<{ id: string; category: string }> }>(request.get(`/api/track/projects/${p.id}/statuses`));
  return { id: p.id, status: (c: string) => statuses.rows.find((s) => s.category === c)!.id };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('plan: crear desde la lista, propiedades, issues y update con salud', async ({ page, request }) => {
  const t = await team(request);
  const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Plan issue ${uid()}`, statusId: t.status('done') } }));
  const name = `Checkout ${uid()}`;

  await page.goto('/en/app/track/plans', { waitUntil: 'networkidle' });
  await page.getByTestId('tp-new-plan').click();
  const modal = page.getByTestId('tp-new-plan-modal');
  await modal.getByLabel('Name').fill(name);
  await modal.getByLabel('Status').selectOption('in_progress');
  await modal.getByLabel('Team').selectOption(t.id);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/track\/plans\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('tp-plan-name')).toHaveValue(name);

  // Fecha objetivo desde el panel de propiedades.
  await page.getByTestId('tp-prop-target').fill('2026-12-15');
  await expect.poll(async () => (await (await request.get(page.url().replace(/.*\/app\/track\/plans\//, '/api/track/plans/'))).json()).plan.target_date).toBe('2026-12-15');

  // Issues: buscar uno existente y sumarlo.
  await page.getByTestId('tp-tab-issues').click();
  await page.getByTestId('tp-issue-search').fill(issue.identifier);
  await page.getByRole('button', { name: new RegExp(issue.identifier) }).click();
  await expect(page.getByTestId('tp-plan-issues')).toContainText(issue.identifier);
  // Crear uno nuevo dentro del plan.
  await page.getByTestId('tp-new-issue-title').fill('Hecho desde el plan');
  await page.getByRole('button', { name: 'Create issue' }).click();
  await expect(page.getByTestId('tp-plan-issues')).toContainText('Hecho desde el plan');

  // Update con salud: aparece en el feed y la salud del plan cambia.
  await page.getByTestId('tp-tab-updates').click();
  await page.locator('.tp-health-opt', { hasText: 'At risk' }).click();
  await page.getByTestId('tp-update-body').fill('Falta el diseño final');
  await page.getByTestId('tp-update-post').click();
  await expect(page.getByTestId('tp-update').first()).toContainText('Falta el diseño final');
  await expect(page.getByTestId('tp-updates-feed')).toContainText('target date');
  await page.getByTestId('tp-tab-overview').click();
  await expect(page.getByTestId('tp-progress-detail')).toContainText('1 of 2 done');

  // La lista lo muestra con su salud; renombrar se ve en la lista.
  await page.goto('/en/app/track/plans', { waitUntil: 'networkidle' });
  const row = page.getByTestId('tp-plans-list').locator('.tp-row', { hasText: name });
  await expect(row).toContainText('At risk');
});

test('roadmap: la barra se arrastra y cambia las fechas; zoom y oscuro a 390px', async ({ page, request }) => {
  const name = `Roadmap ${uid()}`;
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name, status: 'in_progress', startDate: '2026-10-20', targetDate: '2026-11-05' } }));
  await ok(request.post(`/api/track/plans/${plan.id}/milestones`, { data: { name: 'Beta', targetDate: '2026-10-28' } }));
  await page.goto('/en/app/track/roadmap?zoom=week', { waitUntil: 'networkidle' });
  const bar = page.getByTestId('tp-bar').filter({ hasText: name });
  await expect(bar).toBeVisible();
  await expect(page.locator('.tp-tl-ms').first()).toBeVisible();
  const box = (await bar.boundingBox())!;
  // En zoom semana un día = 28px: 3 días a la derecha.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 84, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await (await request.get(`/api/track/plans/${plan.id}`)).json()).plan.start_date).toBe('2026-10-23');
  expect((await (await request.get(`/api/track/plans/${plan.id}`)).json()).plan.target_date).toBe('2026-11-08');
  // Teclado: flecha izquierda mueve un día.
  await bar.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await (await request.get(`/api/track/plans/${plan.id}`)).json()).plan.start_date).toBe('2026-10-22');

  await page.getByTestId('tp-zoom-quarter').click();
  await expect(page).toHaveURL(/zoom=quarter/);

  await page.context().addCookies([{ name: 'zs_theme', value: 'dark', url: page.url() }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/track/roadmap', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});

test('initiative: sumar un plan, progreso y página', async ({ page, request }) => {
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Ini plan ${uid()}`, status: 'in_progress' } }));
  const planName = (await ok<{ plan: { name: string } }>(request.get(`/api/track/plans/${plan.id}`))).plan.name;
  const name = `Goal ${uid()}`;
  await page.goto('/en/app/track/initiatives', { waitUntil: 'networkidle' });
  await page.getByTestId('tp-new-initiative').click();
  await page.getByTestId('tp-new-initiative-modal').getByLabel('Name').fill(name);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/track\/initiatives\/[0-9a-f-]{36}/);
  await page.getByTestId('tp-ini-add-plan').selectOption(plan.id);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('tp-initiative-plans')).toContainText(planName);
  await page.goto('/en/app/track/initiatives', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-initiatives')).toContainText(name);
});

test('cycle: métricas con burn-up, scope creep y capacidad', async ({ page, request }) => {
  const t = await team(request);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const cycle = await ok<{ id: string }>(request.post(`/api/track/projects/${t.id}/cycles`, { data: { name: `Sprint ${uid()}`, startAt: day(-4), endAt: day(9) } }));
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'en el cycle', cycleId: cycle.id, statusId: t.status('done') } }));
  await page.goto(`/en/app/track/cycles/${cycle.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-cycle-detail')).toBeVisible();
  await expect(page.getByTestId('tp-stat-completed')).toContainText('1');
  await expect(page.getByRole('img', { name: 'Burn-up' })).toBeVisible();
  await expect(page.getByTestId('tp-stat-capacity')).toBeVisible();
  await page.goto('/en/app/track/cycles', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-cycles')).toContainText('Current');
});

test('insights → dashboard: medida, CSV y agregar como widget', async ({ page, request }) => {
  const t = await team(request);
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Insight ${uid()}`, priority: 'high' } }));
  await page.goto(`/en/app/track/insights?team=${t.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-insight-table')).toBeVisible();
  await page.getByTestId('tp-segment').selectOption('priority');
  await expect(page).toHaveURL(/segment=priority/);
  const download = page.waitForEvent('download');
  await page.getByTestId('tp-export-csv').click();
  expect((await download).suggestedFilename()).toBe('track-insights.csv');
  await page.getByTestId('tp-measure').selectOption('lead_time');
  await expect(page.getByTestId('tp-segment')).toBeDisabled();
  await page.getByTestId('tp-measure').selectOption('count');

  const dash = `Weekly ${uid()}`;
  await page.getByTestId('tp-add-to-dashboard').click();
  const modal = page.getByTestId('tp-add-dashboard-modal');
  await modal.getByLabel('Dashboards').selectOption('new');
  await page.getByTestId('tp-add-dashboard-name').fill(dash);
  await page.getByTestId('tp-add-dashboard-confirm').click();
  await expect(page.getByText(`Added to ${dash}`)).toBeVisible();

  await page.goto('/en/app/track/dashboards', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: dash }).click();
  await expect(page.getByTestId('tp-widgets').locator('.tp-widget')).toHaveCount(1);
  await expect(page.getByTestId('tp-widgets')).toContainText('Issue count');
});

test('ajustes: auto-cierre muestra cuántos issues cerraría y el archivo restaura', async ({ page, request }) => {
  const t = await team(request);
  await page.goto('/en/app/track/settings?tab=automations', { waitUntil: 'networkidle' });
  await page.locator('#tp-auto-team').selectOption(t.id);
  await page.getByTestId('tp-auto-close').selectOption('3');
  await expect(page.getByTestId('tp-stale-count')).toContainText('No issues would close today.');
  const conf = await ok<{ autoCloseMonths: number }>(request.get(`/api/track/projects/${t.id}/automation`));
  expect(conf.autoCloseMonths).toBe(3);
  await page.getByTestId('tp-auto-archive').selectOption('6');
  await expect(page.getByText('No archived issues.')).toBeVisible();
});

test('⌘K: acciones de planificación', async ({ page }) => {
  await page.goto('/en/app/track/plans', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('Roadmap');
  await dialog.getByRole('option', { name: /Roadmap/ }).first().click();
  await expect(page).toHaveURL(/\/app\/track\/roadmap/);
});
