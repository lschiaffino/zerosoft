import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Una sola lista de issues en todo Track (TrackIssueList), como Linear: el
 * team filtra, agrupa y sub-agrupa y lo recuerda; "Save view" guarda vistas
 * personales en My issues; X selecciona en cualquier lista; en el tablero
 * varias cards seleccionadas se arrastran juntas a una columna; los grupos
 * muestran el total real y "Load more" trae lo que falta.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;
test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1280, height: 860 } });

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Status = { id: string; name: string; category: string };
type Issue = { id: string; identifier: string; status_id: string | null };

async function team(request: APIRequestContext) {
  const p = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name: `Unica ${uid()}` } }));
  const statuses = ((await (await request.get(`/api/track/projects/${p.id}/statuses`)).json()) as { rows: Status[] }).rows;
  return { id: p.id, key: p.slug.toUpperCase(), statuses, status: (c: string) => statuses.find((s) => s.category === c)! };
}

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(2, 2);
}

async function pick(page: Page, choice: string, value: string) {
  await page.getByTestId(choice).click();
  await page.getByTestId(`${choice}-${value}`).click();
}

test('team: filtro, agrupar, sub-agrupar y se recuerda al volver', async ({ page, request }) => {
  const t = await team(request);
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Alta todo', priority: 'high', statusId: t.status('todo').id } }));
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Alta curso', priority: 'high', statusId: t.status('in_progress').id } }));
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Baja todo', priority: 'low', statusId: t.status('todo').id } }));
  await page.goto(`/en/app/track/team/${t.key}`);
  await expect(page.locator('tr[data-issue-row]')).toHaveCount(3);
  await blur(page);

  await page.keyboard.press('f');
  await page.getByTestId('track-filter-quick').fill('high');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);

  await page.getByTestId('track-display').click();
  await pick(page, 'track-group-by', 'priority');
  await pick(page, 'track-subgroup-by', 'status');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-group')).toHaveCount(1);
  await expect(page.getByTestId('track-subgroup')).toHaveCount(2);
  await expect(page).toHaveURL(/subGroup=status/);
  await shot(page, 'unified-team-subgroups');

  // Recargar (la URL) y volver sin parámetros (lo recordado por persona).
  await page.reload();
  await expect(page.getByTestId('track-subgroup')).toHaveCount(2);
  await expect(page.getByTestId('track-filter-chip')).toHaveCount(1);
  await page.goto(`/en/app/track/team/${t.key}`);
  await expect(page.getByTestId('track-subgroup')).toHaveCount(2);
  await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
});

test('My issues: Save view guarda una vista personal que se vuelve a abrir', async ({ page, request }) => {
  const t = await team(request);
  const name = `Altas ${uid()}`;
  await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Mía alta ${uid()}`, priority: 'urgent' } }));
  await page.goto('/en/app/track/my-tasks?tab=created');
  await expect(page.locator('tr[data-issue-row]').first()).toBeVisible();
  await blur(page);
  await page.keyboard.press('f');
  await page.getByTestId('track-filter-quick').fill('urgent');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByTestId('track-save-view').click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('track-saved-views')).toContainText(name);

  // Sin filtros, la vista vuelve a ponerlos.
  await page.getByTestId('track-filter-chip').getByRole('button').last().click();
  await expect(page.getByTestId('track-filter-chip')).toHaveCount(0);
  await page.getByTestId('track-saved-views').click();
  await page.getByTestId('track-saved-view').filter({ hasText: name }).getByRole('button').first().click();
  await expect(page.getByTestId('track-filter-chip')).toHaveCount(1);
  await shot(page, 'unified-my-issues-view');
});

test('X selecciona en Issues y My issues y abre la barra', async ({ page, request }) => {
  const t = await team(request);
  const me = (await (await request.get(`/api/track/projects/${t.id}/members`)).json()) as { rows: Array<{ id: string }> };
  const a = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Equis ${uid()}`, assigneeId: me.rows[0]?.id } }));
  for (const url of ['/en/app/track/issues', '/en/app/track/my-tasks']) {
    await page.goto(url);
    const row = page.locator(`tr[data-issue-key="${a.id}"]`);
    await expect(row).toBeVisible();
    await row.hover();
    await page.keyboard.press('x');
    await expect(row).toHaveClass(/is-selected/);
    await expect(page.getByTestId('track-bulk-bar')).toContainText('1 selected');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('track-bulk-bar')).toHaveCount(0);
  }
});

test('tablero: ⌘ clic en dos cards y arrastrarlas juntas a otra columna', async ({ page, request }) => {
  const t = await team(request);
  const one = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Card uno ${uid()}`, statusId: t.status('todo').id } }));
  const two = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Card dos ${uid()}`, statusId: t.status('todo').id } }));
  await page.goto(`/en/app/track/team/${t.key}?view=board`);
  const cards = page.locator('.track-board-card[data-issue-key]');
  await expect(cards).toHaveCount(2);
  await page.locator(`.track-board-card[data-issue-key="${one.id}"]`).click({ modifiers: ['ControlOrMeta'] });
  await page.locator(`.track-board-card[data-issue-key="${two.id}"]`).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.track-board-card.is-selected')).toHaveCount(2);
  await expect(page.getByTestId('track-bulk-bar')).toContainText('2 selected');
  await shot(page, 'unified-board-selected');

  const target = page.locator(`[data-track-drop="status:${t.status('in_progress').id}"]`);
  await page.locator(`.track-board-card[data-issue-key="${one.id}"]`).dragTo(target);
  const statusOf = async (id: string) => ((await (await request.get(`/api/track/issues/${id}`)).json()) as Issue).status_id;
  await expect.poll(async () => [await statusOf(one.id), await statusOf(two.id)], { timeout: 30_000 }).toEqual([t.status('in_progress').id, t.status('in_progress').id]);
  await expect(page.getByRole('button', { name: 'Undo' }).last()).toBeVisible();
});

test('los grupos dicen el total real y Load more trae lo que falta', async ({ page, request }) => {
  const t = await team(request);
  for (let i = 0; i < 104; i++) await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Lote ${i}` } }));
  await page.goto(`/en/app/track/team/${t.key}`);
  // El total del grupo es el del servidor aunque se haya cargado una sola página.
  await expect(page.getByTestId('track-group-count').first()).toHaveText('104');
  // El resto llega con "Load more" del grupo o, si la ventana es alta, con el scroll infinito antes del clic.
  const more = page.getByTestId('track-group-more').first();
  const rows = page.locator('tr[data-issue-row]');
  await expect
    .poll(
      async () => {
        if (await more.isVisible().catch(() => false)) await more.click().catch(() => undefined);
        else await page.mouse.wheel(0, 4000);
        return rows.count();
      },
      { timeout: 60_000 },
    )
    .toBe(104);
  await expect(page.getByTestId('track-list-load-more')).toHaveCount(0);
});
