import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Arrastrar issues como en Linear (components/track/TrackIssueDnd.tsx): a un
 * team del sidebar (identificador nuevo, el viejo sigue llevando al issue,
 * Deshacer vuelve con el mismo ID), a un grupo de status de la lista, varios
 * seleccionados a la vez y el menú del clic derecho. A 1280 de ancho.
 */

const uid = () => Math.random().toString(36).slice(2, 7);
test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.use({ viewport: { width: 1280, height: 860 } });

type Status = { id: string; name: string; category: string };
type Issue = { id: string; identifier: string; project_id: string; status_id: string | null };

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

async function team(request: APIRequestContext, prefix: string) {
  const name = `${prefix} ${uid()}`;
  const p = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name } }));
  const statuses = ((await (await request.get(`/api/track/projects/${p.id}/statuses`)).json()) as { rows: Status[] }).rows;
  return { id: p.id, slug: p.slug.toUpperCase(), name, statuses };
}

const issueOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;

async function openTeam(page: Page, slug: string) {
  await page.goto(`/en/app/track/team/${slug}`);
  await expect(page.locator('[data-issue-key]').first()).toBeVisible({ timeout: 60_000 });
}

test('arrastrar al team del sidebar: ID nuevo, el viejo redirige y Deshacer vuelve con el mismo ID', async ({ page, request }) => {
  const a = await team(request, 'Drag A');
  const b = await team(request, 'Drag B');
  const issue = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: `Arrastrame ${uid()}` } }));
  await openTeam(page, a.slug);

  const target = page.locator(`[data-track-drop="team:${b.id}"]`);
  await expect(target).toBeVisible();
  await page.locator(`[data-issue-key="${issue.id}"]`).first().dragTo(target);

  const toast = page.getByText(new RegExp(`Moved ${issue.identifier} to ${b.name} as ${b.slug}-\\d+`));
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const moved = await issueOf(request, issue.id);
  expect(moved.project_id).toBe(b.id);
  expect(moved.identifier).toMatch(new RegExp(`^${b.slug}-\\d+$`));
  // La lista del team A ya no lo muestra, sin recargar.
  await expect(page.locator(`[data-issue-key="${issue.id}"]`)).toHaveCount(0, { timeout: 30_000 });

  // El ID viejo sigue llevando al issue.
  await page.goto(`/en/app/track/issue/${issue.identifier}`);
  await expect(page.locator(`.track-detail[data-track-issue-id="${issue.id}"]`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(moved.identifier).first()).toBeVisible();

  // Deshacer (desde la lista): vuelve al team A con el mismo identificador.
  await openTeam(page, b.slug);
  await page.locator(`[data-issue-key="${issue.id}"]`).first().dragTo(page.locator(`[data-track-drop="team:${a.id}"]`));
  await expect(page.getByText(new RegExp(`Moved ${moved.identifier} to`))).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect.poll(async () => (await issueOf(request, issue.id)).identifier, { timeout: 30_000 }).toBe(moved.identifier);
});

test('arrastrar a un grupo de status cambia el status', async ({ page, request }) => {
  const a = await team(request, 'Drag S');
  const issue = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: `Status ${uid()}` } }));
  const started = a.statuses.find((s) => s.category === 'in_progress')!;
  // Los grupos vacíos no se muestran (como Linear): uno ya en curso para que exista el grupo.
  const other = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: `En curso ${uid()}` } }));
  expect((await request.patch(`/api/track/issues/${other.id}`, { data: { statusId: started.id } })).ok()).toBeTruthy();
  await openTeam(page, a.slug);
  const group = page.locator(`[data-track-drop="status:${started.id}"]`);
  await expect(group).toBeVisible({ timeout: 30_000 });
  await page.locator(`[data-issue-key="${issue.id}"]`).first().dragTo(group);
  await expect.poll(async () => (await issueOf(request, issue.id)).status_id, { timeout: 30_000 }).toBe(started.id);
  await expect(page.getByRole('button', { name: 'Undo' }).last()).toBeVisible();
});

test('varios seleccionados se arrastran juntos y el clic derecho abre el menú', async ({ page, request }) => {
  const a = await team(request, 'Drag M');
  const b = await team(request, 'Drag N');
  const one = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: `Uno ${uid()}` } }));
  const two = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: `Dos ${uid()}` } }));
  await openTeam(page, a.slug);

  // ⌘/Ctrl + clic suma a la selección, como Linear.
  await page.locator(`[data-issue-key="${one.id}"]`).first().click({ modifiers: ['ControlOrMeta'], position: { x: 300, y: 10 } });
  await page.locator(`[data-issue-key="${two.id}"]`).first().click({ modifiers: ['ControlOrMeta'], position: { x: 300, y: 10 } });
  await expect(page.locator('[data-issue-key].is-selected')).toHaveCount(2);

  await page.locator(`[data-issue-key="${one.id}"]`).first().dragTo(page.locator(`[data-track-drop="team:${b.id}"]`));
  await expect(page.getByText(`Moved 2 issues to ${b.name}.`)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => [(await issueOf(request, one.id)).project_id, (await issueOf(request, two.id)).project_id], { timeout: 30_000 }).toEqual([b.id, b.id]);

  // Clic derecho: el menú del issue, que se cierra con Esc.
  await openTeam(page, b.slug);
  await page.locator(`[data-issue-key="${one.id}"]`).first().click({ button: 'right', position: { x: 300, y: 10 } });
  const menu = page.getByTestId('track-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Move to team' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
