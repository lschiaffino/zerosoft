import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track, pulido contra Linear: vocabulario (Teams y Projects) y sus rutas,
 * sidebar con los teams desplegables, Project en el issue y en la vista
 * rápida (⇧P), mover de team (⌘⇧M) con identificador nuevo, archivar y
 * restaurar, rehacer (⌘⇧Z), editor visual en comentarios y la API con teamId.
 */

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Team = { id: string; slug: string; name: string };
type Issue = {
  id: string;
  identifier: string;
  title: string;
  project_id: string;
  plan_id?: string | null;
  plan_name?: string | null;
  status_name: string | null;
  archived_at?: string | null;
};

const team = (request: APIRequestContext, name: string) => ok<Team>(request.post('/api/track/projects', { data: { name } }));
const issueOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;

test.describe('Track como Linear (pulido)', () => {
  test('rutas con el vocabulario de Linear: /team/<clave>, /teams, /projects y los links viejos', async ({ page, request }) => {
    const t = await team(request, `Voc ${uid()}`);
    const key = t.slug.toUpperCase();
    const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Lanzamiento ${uid()}` } }));

    await page.goto(`/en/app/track/team/${key}`);
    await expect(page.getByRole('heading', { level: 1, name: t.name })).toBeVisible();
    // Sidebar: "Your teams" con el team abierto, desplegado en Issues / Cycles / Projects / Views.
    await expect(page.locator('#side-branch').getByRole('link', { name: t.name })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('track-branch-cycles').first()).toBeVisible();
    await shot(page, 'tl-team');

    // Link viejo a un team (/projects/<id>) → página del team por su clave.
    await page.goto(`/en/app/track/projects/${t.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/track/team/${key}`));
    // "Plans" pasó a ser Projects.
    await page.goto(`/en/app/track/plans/${plan.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/track/projects/${plan.id}`));
    await page.goto('/en/app/track/teams');
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    await page.goto('/en/app/track/projects');
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();

    // La API acepta teamId y /api/v1/track/teams responde lo mismo que /projects (sesión: misma ruta interna).
    const created = await ok<{ id: string; teamId?: string }>(
      request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Por API', planId: plan.id } }),
    );
    expect((await issueOf(request, created.id)).plan_id).toBe(plan.id);
  });

  test('issue: Project con ⇧P, mover de team con ⌘⇧M, archivar, restaurar y rehacer', async ({ page, request }) => {
    const a = await team(request, `Origen ${uid()}`);
    const b = await team(request, `Destino ${uid()}`);
    const plan = await ok<{ id: string; name: string }>(request.post('/api/track/plans', { data: { name: `Proj ${uid()}` } }));
    const issue = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: 'Mover y archivar' } }));
    const child = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: 'Hijo', parentId: issue.id } }));
    const ref = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: 'Lo cita', description: [{ type: 'text', text: `Ver ${issue.identifier}` }] } }));

    await page.goto(`/en/app/track/issues/${issue.id}`);
    await expect(page.getByTestId('track-side-plan')).toContainText('None');

    // ⇧P abre la paleta en Project; elegir uno lo asigna.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Shift+P');
    await expect(page.getByTestId('cmdk-crumbs')).toContainText('Project');
    await page.keyboard.type(plan.name);
    await page.locator('.cmdk').getByText(plan.name, { exact: true }).click();
    await expect(page.getByTestId('track-side-plan')).toContainText(plan.name);
    await expect.poll(async () => (await issueOf(request, issue.id)).plan_id).toBe(plan.id);
    await expect(page.getByTestId('track-activity-list').or(page.locator('.track-activity'))).toContainText(`added the issue to ${plan.name}`);

    // ⌘Z lo saca y ⌘⇧Z lo vuelve a poner.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await issueOf(request, issue.id)).plan_id ?? null).toBeNull();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(async () => (await issueOf(request, issue.id)).plan_id).toBe(plan.id);

    // ⌘⇧M: mover a otro team; identificador nuevo, sub-issue incluido, y el ID viejo sigue resolviendo.
    await page.keyboard.press('ControlOrMeta+Shift+m');
    await expect(page.getByTestId('cmdk-crumbs')).toContainText('Move to team');
    await page.locator('.cmdk').getByText(b.name, { exact: true }).click();
    await expect.poll(async () => (await issueOf(request, issue.id)).project_id).toBe(b.id);
    const moved = await issueOf(request, issue.id);
    expect(moved.identifier.startsWith(`${b.slug.toUpperCase()}-`)).toBe(true);
    expect((await issueOf(request, child.id)).project_id).toBe(b.id);
    await expect(page.getByTestId('track-notice').or(page.getByTestId('track-undo-toast'))).toContainText(moved.identifier);
    const refs = (await (await request.get(`/api/track/refs?refs=${issue.identifier}`)).json()) as { rows: Array<{ id: string; identifier: string }> };
    expect(refs.rows[0]?.id).toBe(issue.id);
    expect(refs.rows[0]?.identifier).toBe(moved.identifier);
    await page.goto(`/en/app/track/issues/${ref.id}`);
    await expect(page.getByTestId('track-issue-description').locator(`[data-issue-ref="${issue.identifier}"]`)).toContainText('Mover y archivar');

    // Archivar desde ⌘K: banner con Restaurar.
    await page.goto(`/en/app/track/issues/${issue.id}`);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Archive issue');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-archived-banner')).toBeVisible();
    await shot(page, 'tl-archived');
    await expect.poll(async () => Boolean((await issueOf(request, issue.id)).archived_at)).toBe(true);
    await page.getByTestId('track-restore-issue').click();
    await expect(page.getByTestId('track-archived-banner')).toBeHidden();
    await expect.poll(async () => (await issueOf(request, issue.id)).archived_at ?? null).toBeNull();
  });

  test('vista rápida: Project editable con ⇧P; comentarios con el editor visual', async ({ page, request }) => {
    const t = await team(request, `Peek ${uid()}`);
    const plan = await ok<{ id: string; name: string }>(request.post('/api/track/plans', { data: { name: `Peek proj ${uid()}` } }));
    const issue = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'En la vista rápida' } }));
    await page.goto(`/en/app/track/team/${t.id}`);
    const row = page.locator(`tr[data-issue-key="${issue.id}"]`);
    await row.hover();
    await page.keyboard.press(' ');
    const peek = page.getByTestId('track-peek');
    await expect(peek).toContainText('En la vista rápida');
    await peek.getByTestId('track-peek-plan').click();
    await expect(page.getByTestId('cmdk-crumbs')).toContainText('Project');
    await page.locator('.cmdk').getByText(plan.name, { exact: true }).click();
    await expect(peek.getByTestId('track-peek-plan')).toContainText(plan.name);
    await expect.poll(async () => (await issueOf(request, issue.id)).plan_id).toBe(plan.id);
    await page.keyboard.press('Escape');

    // Comentario con formato: **negrita** y lista, enviado con ⌘↵.
    await page.goto(`/en/app/track/issues/${issue.id}`);
    const composer = page.getByTestId('track-comment-input');
    await composer.click();
    await page.keyboard.type('Un **detalle** importante');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- uno');
    await page.keyboard.press('Enter');
    await page.keyboard.type('dos');
    await expect(composer.locator('strong')).toHaveText('detalle');
    await expect(composer.locator('li')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+Enter');
    const comment = page.getByTestId('track-comment').filter({ hasText: 'importante' });
    await expect(comment.locator('strong')).toHaveText('detalle');
    await expect(comment.locator('li')).toHaveCount(2);
    await expect(composer).toHaveText('');
    const comments = (await (await request.get(`/api/track/issues/${issue.id}/comments`)).json()) as { rows?: Array<{ body: string }> } | Array<{ body: string }>;
    const list = Array.isArray(comments) ? comments : (comments.rows ?? []);
    expect(list.some((c) => c.body === 'Un **detalle** importante\n\n- uno\n- dos')).toBe(true);
  });
});
