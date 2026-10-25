import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track como Linear (tanda T1): atajos de propiedad y ⌘K en contexto,
 * deshacer, filtros con reglas, vistas de equipo y favoritas, sub-issues en
 * línea, editor (tareas, "/", referencias), hilos y reacciones, y cambios en
 * vivo sin recargar.
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
type Issue = { id: string; identifier: string; status_id: string | null; priority: string; assignee_id: string | null; parent_id: string | null };

async function project(request: APIRequestContext, name = `Linear ${uid()}`) {
  const p = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name } }));
  const statuses = ((await (await request.get(`/api/track/projects/${p.id}/statuses`)).json()) as { rows: Status[] }).rows;
  return { id: p.id, statuses };
}

const issueOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe('Track como Linear', () => {
  test('S, P, A, I y ⇧1 cambian propiedades desde la fila; ⌘K actúa en contexto y ⌘Z deshace', async ({ page, request }) => {
    const p = await project(request);
    const a = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Atajo uno' } }));
    const b = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Atajo dos' } }));
    const done = p.statuses.find((s) => s.category === 'done')!;
    await page.goto(`/en/app/track/team/${p.id}`);
    const rowA = page.locator(`tr[data-issue-key="${a.id}"]`);
    await expect(rowA).toBeVisible();

    // S con el mouse sobre la fila: la paleta abre en "Change status…".
    await rowA.hover();
    await page.keyboard.press('s');
    const palette = page.locator('.cmdk');
    await expect(page.getByTestId('cmdk-crumbs')).toContainText(a.identifier);
    await expect(page.getByTestId('cmdk-crumbs')).toContainText('Change status');
    await shot(page, 't1-status-palette');
    await page.keyboard.type(done.name);
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect.poll(async () => (await issueOf(request, a.id)).status_id).toBe(done.id);
    await expect(page.getByTestId('track-undo-toast')).toContainText(a.identifier);

    // ⌘Z deshace el cambio.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await issueOf(request, a.id)).status_id).not.toBe(done.id);

    // ⇧1 = urgente, I = asignarme, sin abrir nada.
    await rowA.hover();
    await page.keyboard.press('Shift+Digit1');
    await expect.poll(async () => (await issueOf(request, a.id)).priority).toBe('urgent');
    await page.keyboard.press('i');
    await expect.poll(async () => (await issueOf(request, a.id)).assignee_id).not.toBeNull();

    // X selecciona; con dos seleccionados P cambia ambos.
    await page.locator(`tr[data-issue-key="${b.id}"]`).hover();
    await page.keyboard.press('x');
    await rowA.hover();
    await page.keyboard.press('x');
    await page.mouse.move(5, 5);
    await page.keyboard.press('p');
    await expect(page.getByTestId('cmdk-crumbs')).toContainText('2 issues');
    await page.keyboard.type('low');
    await page.keyboard.press('Enter');
    await expect.poll(async () => [(await issueOf(request, a.id)).priority, (await issueOf(request, b.id)).priority]).toEqual(['low', 'low']);
    await page.keyboard.press('Escape');

    // ⌘K sobre la fila: acciones del issue (copiar ID, asignar…).
    await rowA.hover();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette.getByRole('option', { name: /Copy issue ID/ })).toBeVisible();
    await page.keyboard.type('assign to');
    await expect(palette.getByRole('option', { name: /Assign to…/ })).toBeVisible();
    await shot(page, 't1-cmdk-context');
    await page.keyboard.press('Escape');

    // Espacio: vista rápida del issue bajo el mouse; Esc la cierra.
    await rowA.hover();
    await page.keyboard.press('Space');
    const peek = page.getByTestId('track-peek');
    await expect(peek).toContainText(a.identifier);
    await expect(peek).toContainText('Atajo uno');
    await shot(page, 't1-peek');
    await page.keyboard.press('Escape');
    await expect(peek).toBeHidden();

    // G y después I: navegar al inbox.
    await page.mouse.move(5, 5);
    await blur(page);
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(page).toHaveURL(/\/app\/track\/inbox/);
  });

  test('filtros: F, filtro rápido, operador, AND/OR y la URL los conserva', async ({ page, request }) => {
    const p = await project(request);
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Urgente filtro', priority: 'urgent' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Bajo filtro', priority: 'low' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Medio filtro', priority: 'medium', estimate: 5 } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(3);
    await blur(page);
    await page.keyboard.press('f');
    await page.getByTestId('track-filter-quick').fill('urgent');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-filter-chip')).toHaveCount(1);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
    await expect(page.locator('tr[data-issue-row]')).toContainText('Urgente filtro');

    // "is" → "is not".
    await page.getByTestId('track-filter-op').click();
    await page.getByRole('button', { name: 'is not' }).click();
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);

    // Segunda regla (estimación con valor) y OR.
    await page.getByTestId('track-filter-add').click();
    await page.getByTestId('track-filter-field-estimate').click();
    // Elegir un valor agrega la regla y cierra el menú.
    await page.getByRole('checkbox', { name: /5 points/ }).click();
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
    await page.getByTestId('track-filter-match').click();
    await expect(page.getByTestId('track-filter-match')).toHaveText('Any filter');
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
    await shot(page, 't1-filters');

    await page.reload();
    await expect(page.getByTestId('track-filter-chip')).toHaveCount(2);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
  });

  test('vistas de equipo, favoritas en el sidebar y link compartible', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const name = `Vistas ${uid()}`;
    const p = await project(request, name);
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Alta vista', priority: 'high' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Baja vista', priority: 'low' } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
    await blur(page);
    await page.keyboard.press('f');
    await page.getByTestId('track-filter-quick').fill('high');
    await page.keyboard.press('Enter');
    await expect(page.locator('tr[data-issue-row]')).toHaveCount(1);
    await page.getByTestId('track-save-view').click();
    await page.getByLabel('Name').fill('Solo altas');
    await page.getByTestId('track-save-view-shared').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('track-saved-views')).toContainText('Solo altas');
    await expect(page).toHaveURL(/savedView=/);
    const viewId = new URL(page.url()).searchParams.get('savedView')!;

    await page.getByTestId('track-saved-views').click();
    await expect(page.getByTestId('track-saved-view')).toContainText('Team');
    await page.getByTestId('track-view-favorite').click();
    await expect(page.getByTestId('track-branch-favorites')).toContainText('Solo altas');
    await shot(page, 't1-saved-views');

    // El link abre la vista con sus filtros en una pestaña nueva.
    const other = await page.context().newPage();
    await other.goto(`/en/app/track/team/${p.id}?savedView=${viewId}`);
    await expect(other.locator('tr[data-issue-row]')).toHaveCount(1);
    await expect(other.getByTestId('track-filter-chip')).toHaveCount(1);
    await other.close();
  });

  test('issue: sub-issues en línea, progreso, ⌘⇧O, editor con tareas y "/", hilos y reacciones', async ({ page, request }) => {
    const p = await project(request);
    const ref = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Referenciado' } }));
    const parent = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Padre Linear', priority: 'high' } }));
    await page.goto(`/en/app/track/issues/${parent.id}`);

    // + Agregar sub-issues: Enter crea y deja el composer listo para el siguiente.
    await page.getByTestId('track-add-subissue').click();
    const input = page.getByTestId('track-subissue-input');
    await input.fill('Hijo uno');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await input.fill('Hijo dos');
    await page.keyboard.press('Enter');
    await expect(page.locator('.track-subtask-row:not(.is-composer)')).toHaveCount(2);
    await expect(page.getByTestId('track-subissues-progress')).toContainText('0/2');
    await page.keyboard.press('Escape');
    // Heredan la prioridad del padre.
    const children = async () => ((await (await request.get(`/api/track/issues/${parent.id}/children`)).json()) as { rows: Issue[] }).rows;
    await expect.poll(async () => (await children()).map((k) => k.priority)).toEqual(['high', 'high']);
    const kids = await children();

    // S sobre una fila de sub-issue cambia ese sub-issue (no el padre).
    const done = p.statuses.find((s) => s.category === 'done')!;
    await page.locator(`.track-subtask-row[data-issue-key="${kids[0].id}"]`).hover();
    await page.keyboard.press('s');
    await expect(page.getByTestId('cmdk-crumbs')).toContainText(kids[0].identifier);
    await page.keyboard.type(done.name);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-subissues-progress')).toContainText('1/2');

    // ⌘⇧O abre el composer.
    await page.mouse.move(5, 5);
    await blur(page);
    await page.keyboard.press('ControlOrMeta+Shift+O');
    await expect(page.getByTestId('track-subissue-input')).toBeFocused();
    await page.keyboard.press('Escape');

    // Descripción en el editor visual (como Linear): tareas que siguen con
    // Enter, "/" para un bloque de código y una referencia a otro issue.
    const description = async () => {
      const raw = ((await (await request.get(`/api/track/issues/${parent.id}`)).json()) as { description: string }).description;
      try {
        return (JSON.parse(raw) as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n');
      } catch {
        return raw;
      }
    };
    const desc = page.getByTestId('track-issue-description');
    await desc.click();
    await page.keyboard.type('[] primera');
    await page.keyboard.press('Enter');
    await page.keyboard.type('segunda');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/cod');
    await expect(page.getByTestId('track-md-menu')).toContainText('Code block');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const a = 1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Ver ${ref.identifier} y **listo**`);
    await expect(desc.locator('li[data-task]')).toHaveCount(2);
    await expect(desc.locator('pre')).toContainText('const a = 1');
    await expect(desc.locator('strong')).toHaveText('listo');
    await shot(page, 't1-editor');
    // Se guarda solo como markdown (al dejar de tipear o al salir).
    await page.getByTestId('track-issue-title').focus();
    await expect.poll(description).toContain('- [ ] primera');
    expect(await description()).toContain('```\nconst a = 1\n```');
    expect(await description()).toContain(`Ver ${ref.identifier} y **listo**`);
    // Tildar la casilla guarda.
    const box = await desc.locator('li[data-task]').first().boundingBox();
    await page.mouse.click(box!.x + 6, box!.y + 10);
    await expect.poll(description).toContain('[x] primera');
    // Al volver, la referencia es un chip con el issue.
    await page.reload();
    await expect(desc.locator(`[data-issue-ref="${ref.identifier}"]`)).toContainText('Referenciado');

    // Comentario, reacción, respuesta en hilo y resolver.
    const composer = page.getByPlaceholder('Add comment');
    await composer.fill('Primer comentario');
    await page.keyboard.press('ControlOrMeta+Enter');
    const comment = page.getByTestId('track-comment').filter({ hasText: 'Primer comentario' });
    await expect(comment).toBeVisible();
    await comment.hover();
    await comment.getByRole('button', { name: 'Add reaction' }).click();
    await page.getByRole('menuitem', { name: '🎉' }).click();
    await expect(comment.getByTestId('track-reaction')).toContainText('1');
    await comment.getByTestId('track-comment-reply').click();
    await page.getByTestId('track-reply-input').fill('Respuesta');
    await page.getByTestId('track-reply-submit').click();
    const thread = page.getByTestId('track-thread').filter({ hasText: 'Primer comentario' });
    await expect(thread.locator('.track-comment.is-reply')).toContainText('Respuesta');
    await thread.locator('.track-comment').first().hover();
    await thread.getByRole('button', { name: 'Comment actions' }).first().click();
    await page.getByTestId('track-thread-resolve').click();
    // Resuelto: el hilo se colapsa en una línea que se puede volver a abrir.
    const resolved = page.getByTestId('track-thread-resolved');
    await expect(resolved).toContainText('Resolved by');
    await expect(page.getByTestId('track-comment').filter({ hasText: 'Primer comentario' })).toHaveCount(0);
    await resolved.click();
    await expect(page.getByTestId('track-comment').filter({ hasText: 'Primer comentario' })).toBeVisible();
    await shot(page, 't1-issue-page');
  });

  test('cambios de otros se ven sin recargar (lista e issue) y borrar se deshace', async ({ page, request }) => {
    const p = await project(request);
    const a = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'En vivo' } }));
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator(`tr[data-issue-key="${a.id}"]`)).toContainText('En vivo');
    // "Otra persona" (la API) renombra y crea: la lista lo muestra sola.
    await ok(request.patch(`/api/track/issues/${a.id}`, { data: { title: 'Renombrado por otro' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Creado por otro' } }));
    await expect(page.locator(`tr[data-issue-key="${a.id}"]`)).toContainText('Renombrado por otro', { timeout: 15_000 });
    await expect(page.locator('tr[data-issue-row]', { hasText: 'Creado por otro' })).toBeVisible({ timeout: 15_000 });

    // Borrar con la barra de selección: sale de la lista y "Deshacer" lo devuelve.
    await page.locator(`tr[data-issue-key="${a.id}"]`).hover();
    await page.keyboard.press('x');
    const bar = page.getByTestId('track-bulk-bar');
    await bar.getByRole('button', { name: 'Delete' }).click();
    await bar.getByRole('button', { name: 'Delete' }).last().click();
    await expect(page.locator(`tr[data-issue-key="${a.id}"]`)).toHaveCount(0);
    await page.getByTestId('track-undo').click();
    await expect(page.locator(`tr[data-issue-key="${a.id}"]`)).toBeVisible();
    await page.waitForTimeout(9000);
    expect((await request.get(`/api/track/issues/${a.id}`)).status()).toBe(200);

    // Issue abierto: un comentario de otro aparece solo.
    await page.goto(`/en/app/track/issues/${a.id}`);
    await ok(request.post(`/api/track/issues/${a.id}/comments`, { data: { body: 'Comentario en vivo' } }));
    await expect(page.getByTestId('track-comment').filter({ hasText: 'Comentario en vivo' })).toBeVisible({ timeout: 15_000 });
  });

  test('issue a 390px y en oscuro sin scroll horizontal', async ({ page, request }) => {
    const p = await project(request);
    const parent = await ok<Issue>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Mobile padre' } }));
    await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Mobile hijo con un título largo para ver el recorte', parentId: parent.id } }));
    await ok(request.post(`/api/track/issues/${parent.id}/comments`, { data: { body: 'Un comentario' } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/en/app/track/issues/${parent.id}`);
    await expect(page.locator('.track-subtask-row')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, 't1-issue-390-dark');
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]').first()).toBeVisible();
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow2).toBeLessThanOrEqual(1);
    await shot(page, 't1-project-390-dark');
  });
});
