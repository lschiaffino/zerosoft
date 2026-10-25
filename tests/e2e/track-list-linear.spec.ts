import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lista del team como Linear (tanda tl2): menú de filtros con teclado (F,
 * tipear, Enter entra y tilda), Display (diseño, agrupar, propiedades),
 * grupos por estado colapsables, pestañas All/Active/Backlog, barra de
 * selección que abre ⌘K y atajos que siguen andando después de un clic.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Status = { id: string; name: string; category: string; position: number };
type Issue = { id: string; identifier: string; status_id: string | null; priority: string };

async function team(request: APIRequestContext) {
  const p = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Lista ${uid()}` } }));
  const statuses = ((await (await request.get(`/api/track/projects/${p.id}/statuses`)).json()) as { rows: Status[] }).rows;
  return { id: p.id, statuses };
}

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(2, 2);
}

test.describe('Track: lista como Linear', () => {
  test('F + "prio" + Enter + Enter tilda Urgent y filtra; ← vuelve; Esc cierra', async ({ page, request }) => {
    const p = await team(request);
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Urgente lista', priority: 'urgent' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Baja lista', priority: 'low' } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
    await blur(page);

    await page.keyboard.press('f');
    await expect(page.getByTestId('track-filter-quick')).toBeFocused();
    await page.keyboard.type('prio');
    // El primero queda resaltado: la propiedad Priority.
    await expect(page.getByTestId('track-filter-field-priority')).toHaveClass(/is-active/);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-filter-value-search')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-filter-value-urgent')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
    await expect(page.locator('tr[data-issue-row]')).toContainText('Urgente lista');
    await shot(page, 'tl2-filter-keyboard');

    // ↓ y Enter suma otro valor (is any of); ← vuelve a las propiedades.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-filter-value-low')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('track-filter-quick')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('track-filter-quick')).toHaveCount(0);
    await expect(page.getByTestId('track-filter-chip')).toHaveCount(1);
    await expect(page.getByTestId('track-filter-op')).toHaveText('is any of');
  });

  test('Display cambia a tablero y vuelve; las propiedades se ocultan', async ({ page, request }) => {
    const p = await team(request);
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Display uno' } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
    await page.getByTestId('track-display').click();
    await expect(page.getByTestId('track-display-panel')).toBeVisible();
    await page.getByTestId('track-view-board').click();
    await expect(page).toHaveURL(/view=board/);
    await expect(page.locator('.track-board')).toBeVisible();
    await shot(page, 'tl2-display-board');
    await page.getByTestId('track-view-list').click();
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
    // Ocultar el ID de las filas.
    await expect(page.locator('tr[data-issue-row] .track-col-id')).toHaveCount(1);
    await page.getByTestId('track-prop-id').click();
    await expect(page.locator('tr[data-issue-row] .track-col-id')).toHaveCount(0);
    await page.getByTestId('track-prop-id').click();
    // Agrupar con teclado: Enter abre, flechas, Enter elige.
    await page.getByTestId('track-group-by').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('track-group-by-none').click();
    await expect(page.getByTestId('track-group')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('track-display-panel')).toHaveCount(0);
    await expect(page.getByTestId('track-display')).toBeFocused();
  });

  test('grupos por estado colapsables, "+" crea en ese estado y pestañas Active/Backlog', async ({ page, request }) => {
    const p = await team(request);
    const backlog = p.statuses.find((s) => s.category === 'backlog');
    const todo = p.statuses.find((s) => s.category === 'todo')!;
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'En todo', statusId: todo.id } }));
    if (backlog) await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'En backlog', statusId: backlog.id } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    const groups = page.getByTestId('track-group');
    await expect(groups).toHaveCount(backlog ? 2 : 1);
    const todoGroup = groups.filter({ hasText: todo.name }).first();
    await todoGroup.getByTestId('track-group-toggle').click();
    await expect(todoGroup.getByTestId('track-group-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('tr[data-issue-row]', { hasText: 'En todo' })).toHaveCount(0);
    await todoGroup.getByTestId('track-group-toggle').press('Enter');
    await expect(page.locator('tr[data-issue-row]', { hasText: 'En todo' })).toHaveCount(1);
    await shot(page, 'tl2-groups');

    // "+" del grupo abre el composer con ese estado.
    await todoGroup.getByTestId('track-group-add').click();
    const title = `Desde grupo ${uid()}`;
    await page.getByRole('textbox', { name: 'Issue title' }).fill(title);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect
      .poll(async () => {
        const res = await request.get(`/api/track/projects/${p.id}/issues?q=${encodeURIComponent(title)}`);
        const rows = ((await res.json()) as { rows: Issue[] }).rows;
        return rows[0]?.status_id ?? null;
      })
      .toBe(todo.id);

    if (backlog) {
      await page.getByTestId('track-scope-backlog').click();
      await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
      await expect(page.locator('tr[data-issue-row]')).toContainText('En backlog');
      await page.getByTestId('track-scope-active').click();
      await expect(page.locator('tr[data-issue-row]', { hasText: 'En backlog' })).toHaveCount(0);
      await expect(page).toHaveURL(/scope=active/);
      await page.getByTestId('track-scope-all').click();
    }
  });

  test('después de clickear Display o una casilla, J/X y S siguen andando', async ({ page, request }) => {
    const p = await team(request);
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Tecla uno' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Tecla dos' } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);

    await page.getByTestId('track-display').click();
    await page.getByTestId('track-show-subissues').click();
    await page.getByTestId('track-show-subissues').click();
    // Esc cierra el panel y el foco vuelve al botón: los atajos siguen andando.
    await page.keyboard.press('Escape');
    await page.mouse.move(2, 2);
    await page.keyboard.press('j');
    await expect(page.locator('tr[data-issue-row].is-kb-active')).toHaveCount(1);
    await page.keyboard.press('x');
    await expect(page.getByTestId('track-bulk-bar')).toContainText('1 selected');

    // Casilla con el mouse y después X sobre otra fila.
    await page.getByTestId('track-select-row').nth(1).click();
    await expect(page.getByTestId('track-bulk-bar')).toContainText(/selected/);
    await page.keyboard.press('s');
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.keyboard.press('Escape');

    // La barra abre ⌘K con la página de prioridad.
    await page.getByTestId('track-bulk-priority').click();
    await expect(page.getByTestId('cmdk-crumbs')).toBeVisible();
    await page.keyboard.press('Escape');
    await shot(page, 'tl2-keys-after-click');
  });

  test('My issues: pestañas Assigned / Created / Subscribed / Activity agrupadas por estado', async ({ page, request }) => {
    const p = await team(request);
    const me = (await (await request.get('/api/track/projects/' + p.id + '/members')).json()) as { rows: Array<{ id: string }> };
    const meId = me.rows[0]?.id;
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: `Mío ${uid()}`, assigneeId: meId } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: `Creado ${uid()}` } }));
    await page.goto('/en/app/track/my-tasks');
    await expect(page.getByTestId('track-my-tabs')).toBeVisible();
    await expect(page.getByTestId('track-my-tab-assigned')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('track-group').first()).toBeVisible();
    await page.getByTestId('track-my-tab-created').click();
    await expect(page).toHaveURL(/tab=created/);
    await expect(page.locator('tr[data-issue-row]', { hasText: 'Creado' }).first()).toBeVisible();
    await page.getByTestId('track-my-tab-subscribed').click();
    await expect(page).toHaveURL(/tab=subscribed/);
    await page.getByTestId('track-my-tab-activity').click();
    await expect(page).toHaveURL(/tab=activity/);
    await shot(page, 'tl2-my-issues');
  });

  for (const [w, scheme] of [
    [390, 'light'],
    [390, 'dark'],
    [1280, 'dark'],
  ] as const) {
    test(`team sin scroll horizontal (${w}px, ${scheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: w, height: 800 });
      const p = await team(request);
      await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Ancho' } }));
      await page.goto(`/en/app/track/team/${p.id}`);
      await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
      await page.getByTestId('track-display').click();
      await expect(page.getByTestId('track-display-panel')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await shot(page, `tl2-team-${w}-${scheme}`);
    });
  }
});
