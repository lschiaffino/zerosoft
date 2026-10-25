import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track como Linear (tanda TL2): los menús de ⌘K con filtro tipeado, dígitos
 * y crear en línea (L con un label nuevo, ⇧P tipeado, P con 0–4), ⌘⌫ en una
 * fila, el ID viejo de un issue movido en ⌘K, el composer con chips (y Esc
 * que guarda el borrador), los chips del panel del issue anclados y la
 * navegación del sub-issue (progreso del padre, J/K, deshacer "Remove parent").
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
type Issue = {
  id: string;
  identifier: string;
  status_id: string | null;
  priority: string;
  labels: string;
  plan_id: string | null;
  parent_id: string | null;
  project_id: string;
};

async function team(request: APIRequestContext, name = `Kbd ${uid()}`) {
  const p = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name } }));
  const statuses = ((await (await request.get(`/api/track/projects/${p.id}/statuses`)).json()) as { rows: Status[] }).rows;
  return { id: p.id, statuses };
}

const issueOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;
const labelNames = (i: Issue) => (JSON.parse(i.labels || '[]') as Array<{ name: string }>).map((l) => l.name);

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function hoverRow(page: Page, id: string) {
  const row = page.locator(`[data-issue-key="${id}"]`).first();
  await expect(row).toBeVisible();
  await row.hover();
  return row;
}

test.describe('Track como Linear: teclado y menús', () => {
  test('L crea un label nuevo tipeando; ⇧P tipeado elige el proyecto (no "No project"); P con dígitos', async ({ page, request }) => {
    const t = await team(request);
    const name = `Pagos ${uid()}`;
    const plan = await ok<{ id: string; name: string }>(request.post('/api/track/plans', { data: { name } }));
    const a = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Teclado uno' } }));
    await page.goto(`/en/app/track/team/${t.id}`);
    const palette = page.locator('.cmdk');

    // L en un team sin labels abre igual, y lo tipeado que no existe se crea con Enter.
    await hoverRow(page, a.id);
    await page.keyboard.press('l');
    await expect(palette).toBeVisible();
    const label = `bug-${uid()}`;
    await page.keyboard.type(label);
    await expect(palette.getByRole('option', { name: new RegExp(`Create new label.*${label}`) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(async () => labelNames(await issueOf(request, a.id))).toContain(label);
    // Como Linear, el menú de labels queda abierto (multi-selección) con el nuevo tildado.
    await expect(palette.getByRole('option', { name: new RegExp(label) })).toContainText('✓');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    // ⇧P + parte del nombre + Enter: el proyecto, no "No project".
    await hoverRow(page, a.id);
    await page.keyboard.press('Shift+P');
    await expect(page.getByTestId('cmdk-crumbs')).toContainText('Project');
    await page.keyboard.type(name.slice(0, 6));
    await expect(palette.getByRole('option').first()).toContainText(plan.name);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await issueOf(request, a.id)).plan_id).toBe(plan.id);

    // P y un dígito: 1 urgente, 0 sin prioridad (con "No priority" en el menú).
    await hoverRow(page, a.id);
    await page.keyboard.press('p');
    await expect(palette.getByRole('option', { name: /No priority/ })).toBeVisible();
    await shot(page, 'tl2-priority-menu');
    await page.keyboard.press('1');
    await expect(palette).toBeHidden();
    await expect.poll(async () => (await issueOf(request, a.id)).priority).toBe('urgent');
    await hoverRow(page, a.id);
    await page.keyboard.press('p');
    await page.keyboard.press('0');
    await expect.poll(async () => (await issueOf(request, a.id)).priority).toBe('none');
  });

  test('⌘⌫ sobre una fila la borra (con deshacer) y el ID viejo de un issue movido se encuentra en ⌘K', async ({ page, request }) => {
    const a = await team(request, `Origen ${uid()}`);
    const b = await team(request, `Destino ${uid()}`);
    const gone = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: 'Para borrar' } }));
    const moved = await ok<Issue>(request.post(`/api/track/projects/${a.id}/issues`, { data: { title: `Mudanza ${uid()}` } }));
    await page.goto(`/en/app/track/team/${a.id}`);

    await hoverRow(page, gone.id);
    await page.keyboard.press('ControlOrMeta+Backspace');
    // Borra al instante con aviso "Undo" (o pide confirmación, según el rol).
    const dialog = page.getByRole('alertdialog');
    if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /Delete/ }).click();
    await expect(page.locator(`[data-issue-key="${gone.id}"]`)).toHaveCount(0);
    await expect(page.getByTestId('track-undo-toast')).toContainText(gone.identifier);

    // Mover de team y buscar el ID viejo.
    const res = await request.post(`/api/track/issues/${moved.id}/move`, { data: { teamId: b.id } });
    expect(res.ok()).toBeTruthy();
    const after = await issueOf(request, moved.id);
    expect(after.identifier).not.toBe(moved.identifier);
    await blur(page);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.cmdk-input').fill(moved.identifier);
    const hit = page.locator('.cmdk').getByRole('option', { name: new RegExp(after.identifier) });
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await hit.click();
    await expect(page.getByTestId('track-issue-title')).toHaveValue(/Mudanza/);
    // La URL es la del identificador nuevo (como Linear) y el viejo también abre.
    await expect(page).toHaveURL(new RegExp(`/app/track/issue/${after.identifier}`));
    await page.goto(`/en/app/track/issue/${moved.identifier}`);
    await expect(page.getByTestId('track-issue-title')).toHaveValue(/Mudanza/);
  });

  test('composer: chips con menús tipeados, label nuevo en línea, Esc guarda el borrador y ⌘↵ crea', async ({ page, request }) => {
    const t = await team(request);
    await page.goto(`/en/app/track/team/${t.id}`);
    await page.waitForLoadState('networkidle');
    const dialog = page.getByRole('dialog', { name: /New issue/ });
    // C abre el composer (reintenta si la página todavía estaba hidratando).
    await expect(async () => {
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('c');
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    const title = `Desde el composer ${uid()}`;
    await page.keyboard.type(title);
    // Sin <select>: chips.
    await expect(dialog.locator('select')).toHaveCount(0);
    await expect(page.getByTestId('track-qc-priority')).toContainText('Priority');

    await page.getByTestId('track-qc-priority').click();
    await page.keyboard.type('hig');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-qc-priority')).toContainText('High');

    const label = `ux-${uid()}`;
    await page.getByTestId('track-qc-labels').click();
    await page.keyboard.type(label);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('track-qc-labels')).toContainText(label);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toBeHidden();
    await shot(page, 'tl2-composer-chips');

    // Esc cierra y guarda; C de nuevo lo recupera.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await blur(page);
    await page.keyboard.press('c');
    await expect(page.getByRole('textbox', { name: 'Issue title' })).toHaveValue(title);
    await expect(page.getByText('Draft restored')).toBeVisible();
    await expect(page.getByTestId('track-qc-priority')).toContainText('High');

    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-issue-key]').filter({ hasText: title })).toBeVisible();
    const rows = ((await (await request.get(`/api/track/projects/${t.id}/issues`)).json()) as { rows: Issue[] }).rows;
    const created = rows.find((r) => (r as unknown as { title: string }).title === title)!;
    expect(created.priority).toBe('high');
    expect(labelNames(created)).toContain(label);
    // El borrador ya no vuelve.
    await blur(page);
    await page.keyboard.press('c');
    await expect(page.getByRole('textbox', { name: 'Issue title' })).toHaveValue('');
  });

  test('issue: chips del panel anclados, S con dígito, sub-issue con progreso del padre, J/K y deshacer "Remove parent"', async ({ page, request }) => {
    const t = await team(request);
    const parent = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Padre' } }));
    const one = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Hijo uno', parentId: parent.id } }));
    const two = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Hijo dos', parentId: parent.id } }));
    await page.goto(`/en/app/track/issues/${one.id}`);
    await expect(page.getByTestId('track-parent-line')).toContainText(parent.identifier);
    await expect(page.getByTestId('track-parent-progress')).toContainText('0/2');

    // Clic en el chip de estado: menú anclado; 2 elige el segundo estado.
    await page.getByTestId('track-side-status').getByRole('button').click();
    await expect(page.locator('.cmdk.is-anchored')).toBeVisible();
    const sorted = [...t.statuses].sort((x, y) => x.position - y.position);
    await page.keyboard.press('2');
    await expect.poll(async () => (await issueOf(request, one.id)).status_id).toBe(sorted[1].id);

    // J va al hermano siguiente.
    await blur(page);
    await page.keyboard.press('j');
    await expect(page.getByTestId('track-issue-title')).toHaveValue('Hijo dos');
    await expect(page.getByTestId('track-issue-nav')).toContainText('2 / 2');
    await page.keyboard.press('k');
    await expect(page.getByTestId('track-issue-title')).toHaveValue('Hijo uno');

    // "Remove parent" y ⌘Z: el breadcrumb vuelve con el ID (nunca "…").
    await page.locator('.track-detail-more').click();
    await page.getByTestId('track-remove-parent').click();
    await expect(page.getByTestId('track-parent-line')).toHaveCount(0);
    await blur(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await issueOf(request, one.id)).parent_id).toBe(parent.id);
    await expect(page.locator('.track-breadcrumb')).toContainText(parent.identifier);
    await expect(page.locator('.track-breadcrumb')).not.toContainText('…');
    await shot(page, 'tl2-subissue-page');

    // Estrella: el issue aparece en Favoritos del sidebar.
    await page.getByTestId('track-issue-favorite').click();
    await expect(page.getByTestId('track-issue-favorite')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('track-branch-favorite-issue').filter({ hasText: 'Hijo uno' })).toBeVisible();
    void two;
  });
});

test.describe('Track como Linear: volver con Esc y foco', () => {
  for (const locale of ['en', 'es']) {
    test(`Esc en un issue abierto desde la lista vuelve a la lista (${locale})`, async ({ page, request }) => {
      const t = await team(request);
      const a = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Volver ${uid()}` } }));
      await page.goto(`/${locale}/app/track/team/${t.id}`);
      await page.waitForURL(/\/app\/track\/team\/[A-Z0-9]{2,5}(\?|$)/);
      await page.waitForLoadState('networkidle');
      const listUrl = page.url();
      await page.locator(`[data-issue-key="${a.id}"]`).first().getByText(/Volver/).click();
      await expect(page.getByTestId('track-issue-title')).toHaveValue(/Volver/);
      await blur(page);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(new RegExp(`^${listUrl.split('?')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      expect(page.url()).not.toContain(`/${locale}/${locale}/`);
      await expect(page.locator(`[data-issue-key="${a.id}"]`).first()).toBeVisible();
    });
  }

  test('clic en el espacio vacío del issue no manda el foco al comentario: S y ⌘⇧O siguen andando', async ({ page, request }) => {
    const t = await team(request);
    const a = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Foco' } }));
    await page.goto(`/en/app/track/issues/${a.id}`);
    await expect(page.getByTestId('track-issue-title')).toHaveValue('Foco');
    const main = page.locator('.track-detail-main');
    const box = (await main.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);
    const tag = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[contenteditable="true"], textarea, input') ? 'editable' : 'other');
    expect(tag).toBe('other');
    await page.keyboard.press('s');
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+Shift+O');
    await expect(page.getByRole('dialog', { name: /New sub-issue/ })).toBeVisible();
  });
});

test('⇧C: el cycle activo va primero y Enter lo asigna; "No cycle" al final', async ({ page, request }) => {
  const t = await team(request);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (n: number) => new Date(today.getTime() + n * 86_400_000);
  await ok(request.post(`/api/track/projects/${t.id}/cycles`, { data: { name: `Old ${uid()}`, startAt: iso(plus(-30)), endAt: iso(plus(-16)) } }));
  const now = await ok<{ id: string; name: string }>(request.post(`/api/track/projects/${t.id}/cycles`, { data: { name: `Now ${uid()}`, startAt: iso(plus(-3)), endAt: iso(plus(10)) } }));
  const a = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Cycle me' } }));
  await page.goto(`/en/app/track/issues/${a.id}`);
  await expect(page.getByTestId('track-issue-title')).toHaveValue('Cycle me');
  await blur(page);
  await page.keyboard.press('Shift+C');
  const opts = page.locator('.cmdk').getByRole('option');
  await expect(opts.first()).toContainText(now.name);
  await expect(opts.last()).toContainText('No cycle');
  await page.keyboard.press('Enter');
  await expect.poll(async () => ((await (await request.get(`/api/track/issues/${a.id}`)).json()) as { cycle_id: string | null }).cycle_id).toBe(now.id);
});
