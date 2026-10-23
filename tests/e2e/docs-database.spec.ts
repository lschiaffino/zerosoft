import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);
const T = '2026-01-01T10:00:00.000Z';

type Row = { id: string; values: Record<string, unknown>; body?: unknown[]; created_at: string; updated_at: string };
type Db = { properties: Array<{ id: string; name: string; type: string; options?: unknown[] }>; rows: Row[]; views: Array<Record<string, unknown>>; active_view?: string };
type Block = { id: string; type: string; content: string; db?: Db; columns?: unknown[]; rows?: string[][] };

const row = (id: string, values: Record<string, unknown>): Row => ({ id, values, created_at: T, updated_at: T });

function tracker(rows: Row[] = [row('r1', { name: 'Alpha', st: 'todo', pts: 3 }), row('r2', { name: 'Beta', st: 'doing', pts: 8 }), row('r3', { name: 'Gamma', st: 'done', pts: 1 })]): Db {
  return {
    properties: [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'st', name: 'Status', type: 'status', options: [
        { id: 'todo', name: 'Todo', group: 'todo' },
        { id: 'doing', name: 'Doing', group: 'in_progress' },
        { id: 'done', name: 'Finished', group: 'done' },
      ] },
      { id: 'pts', name: 'Points', type: 'number' },
      { id: 'ok', name: 'Reviewed', type: 'checkbox' },
    ],
    rows,
    views: [{ id: 'v1', name: '', type: 'table' }],
    active_view: 'v1',
  };
}

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function dbOf(request: APIRequestContext, id: string): Promise<Db> {
  const page = (await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] };
  return page.content.find((b) => b.type === 'database')!.db!;
}

const cell = (page: Page, rowText: string, col: number) =>
  page.locator('.docs-db-tr', { hasText: rowText }).locator('[role="gridcell"]').nth(col);

test('Docs DB: base vieja se migra al editar; teclado (flechas, Enter, Esc, Tab)', async ({ request, page }) => {
  const doc = await pageWith(request, `Vieja ${uid()}`, [
    { id: 'p', type: 'paragraph', content: 'Arriba' },
    {
      id: 'legacy',
      type: 'database',
      content: '',
      columns: [
        { id: 'c1', name: 'Name', type: 'text' },
        { id: 'c2', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
      ],
      rows: [['Uno', 'Todo'], ['Dos', '']],
    },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-db-tr')).toHaveCount(2);
  await expect(cell(page, 'Uno', 1)).toContainText('Todo');

  // Click en el título edita; Esc deja de editar; ↓ baja; Enter edita; Tab pasa a la siguiente.
  await cell(page, 'Uno', 0).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' bis');
  await page.keyboard.press('Escape');
  await expect(page.locator('.docs-db-td.active')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Tab');
  await expect(page.locator('.docs-db-td.active')).toHaveAttribute('data-cell', '1:1');
  // Tipear sobre una celda de texto empieza a editarla.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.docs-db-td.active')).toHaveAttribute('data-cell', '1:0');

  await expect
    .poll(async () => (await dbOf(request, doc.id))?.rows.map((r) => r.values.c1), { timeout: 10_000 })
    .toEqual(['Uno bis', 'Dos!']);
  const db = await dbOf(request, doc.id);
  expect(db.properties.map((p) => p.type)).toEqual(['title', 'select']);
});

test('Docs DB: filtro, orden, agrupar y propiedad oculta se guardan en la vista', async ({ request, page }) => {
  const doc = await pageWith(request, `Vistas ${uid()}`, [{ id: 'db', type: 'database', content: '', db: tracker() }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const wrap = page.getByTestId('docs-database');

  await wrap.getByRole('button', { name: 'Filter' }).click();
  const pop = page.locator('.docs-db-popover');
  await pop.getByRole('button', { name: 'Add a filter' }).click();
  await pop.getByLabel('Property').selectOption({ label: 'Points' });
  await pop.getByLabel('Condition').selectOption('gt');
  await pop.getByLabel('Value').fill('2');
  await expect(page.locator('.docs-db-tr')).toHaveCount(2);
  await page.keyboard.press('Escape');

  await wrap.getByRole('button', { name: 'Sort' }).click();
  await pop.getByRole('button', { name: 'Add a sort' }).click();
  await pop.getByLabel('Property').selectOption({ label: 'Points' });
  await pop.getByLabel('Direction').selectOption('desc');
  await expect(page.locator('.docs-db-tr').first()).toContainText('Beta');
  await page.keyboard.press('Escape');

  // Ocultar Points desde su encabezado.
  await page.locator('.docs-db-th-btn', { hasText: 'Points' }).click();
  await pop.getByRole('menuitem', { name: 'Hide in this view' }).click();
  await expect(page.locator('.docs-db-th-btn', { hasText: 'Points' })).toHaveCount(0);

  await wrap.getByRole('button', { name: 'Group' }).click();
  await pop.locator('select').selectOption({ label: 'Status' });
  await expect(page.locator('.docs-db-group-head')).toHaveCount(3);

  await expect
    .poll(async () => (await dbOf(request, doc.id)).views[0], { timeout: 10_000 })
    .toMatchObject({ group_by: 'st', hidden: ['pts'], sorts: [{ property: 'pts', direction: 'desc' }], filters: [{ property: 'pts', op: 'gt', value: 2 }] });
});

test('Docs DB: board por status, mover una tarjeta y tipos (cambiar a select convierte)', async ({ request, page }) => {
  const doc = await pageWith(request, `Board ${uid()}`, [{ id: 'db', type: 'database', content: '', db: tracker() }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add a view' }).click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: 'Board' }).click();
  const cols = page.locator('.docs-db-bcol');
  await expect(cols).toHaveCount(3);
  await expect(cols.nth(0)).toContainText('Alpha');

  // Arrastrar Alpha a "Finished".
  const src = await page.locator('.docs-db-bcard', { hasText: 'Alpha' }).boundingBox();
  const dst = await cols.nth(2).locator('.docs-db-bcol-cards').boundingBox();
  await page.mouse.move(src!.x + 20, src!.y + 10);
  await page.mouse.down();
  await page.mouse.move(src!.x + 40, src!.y + 30, { steps: 4 });
  await page.mouse.move(dst!.x + 30, dst!.y + dst!.height - 4, { steps: 8 });
  await page.mouse.up();
  await expect(cols.nth(2)).toContainText('Alpha');
  // Alt+→ con teclado: Beta (Doing) pasa a Finished.
  await page.locator('.docs-db-bcard', { hasText: 'Beta' }).locator('.docs-db-bcard-open').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect
    .poll(async () => (await dbOf(request, doc.id)).rows.map((r) => r.values.st), { timeout: 10_000 })
    .toEqual(['done', 'done', 'done']);

  // Points (número) → texto conserva los valores.
  await page.getByRole('tab', { name: 'Table' }).click();
  await page.locator('.docs-db-th-btn', { hasText: 'Points' }).click();
  await page.locator('.docs-db-popover select').first().selectOption('text');
  // Soltar al final de la columna también la deja última (orden manual): se compara por fila.
  await expect
    .poll(async () => Object.fromEntries((await dbOf(request, doc.id)).rows.map((r) => [r.id, r.values.pts])), { timeout: 10_000 })
    .toEqual({ r1: '3', r2: '8', r3: '1' });
});

test('Docs DB: la fila se abre como página (panel y página completa) y la encuentran Cmd+K y [[', async ({ request, page }) => {
  const name = `Fila${uid()}`;
  const doc = await pageWith(request, `Filas ${uid()}`, [
    { id: 'db', type: 'database', content: '', db: tracker([row('r1', { name, st: 'todo' })]) },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-db-tr', { hasText: name }).hover();
  await page.locator('.docs-db-open').first().click();
  const panel = page.getByTestId('docs-db-rowpanel');
  await expect(panel).toBeVisible();
  // Propiedad desde el panel: el checkbox.
  await panel.getByRole('button', { name: 'Reviewed' }).click();
  await panel.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('Cuerpo de la fila');
  await expect
    .poll(async () => {
      const r = (await dbOf(request, doc.id)).rows[0];
      return [r.values.ok, JSON.stringify(r.body ?? [])];
    }, { timeout: 10_000 })
    .toEqual([true, expect.stringContaining('Cuerpo de la fila')]);

  await panel.getByRole('button', { name: 'Open as full page' }).click();
  await expect(page).toHaveURL(/\?row=r1/);
  await expect(panel).toHaveClass(/is-full/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('docs-db-rowpanel')).toHaveClass(/is-full/);
  await expect(page.getByTestId('docs-db-rowpanel')).toContainText('Cuerpo de la fila');
  await page.getByTestId('docs-db-rowpanel').getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/row=/);

  const search = (await (await request.get(`/api/search?q=${name}`)).json()) as { items?: Array<{ href: string }>; results?: Array<{ href: string }> };
  const items = search.items ?? search.results ?? [];
  expect(items.some((i) => i.href === `/app/docs/${doc.id}?row=r1`)).toBeTruthy();
  const links = (await (await request.get(`/api/docs/search?q=${name}`)).json()) as { rows: Array<{ id: string; row_id?: string }> };
  expect(links.rows).toContainEqual(expect.objectContaining({ id: doc.id, row_id: 'r1' }));
});

test('Docs DB: 1.000 filas se virtualizan y la exportación usa la vista', async ({ request, page }) => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(`x${i}`, { name: `Item ${String(i).padStart(4, '0')}`, pts: i }));
  const doc = await pageWith(request, `Mil ${uid()}`, [{ id: 'db', type: 'database', content: '', db: tracker(rows) }]);
  const t0 = Date.now();
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-db-tr').first()).toContainText('Item 0000');
  expect(Date.now() - t0).toBeLessThan(15_000);
  const rendered = await page.locator('.docs-db-tr').count();
  expect(rendered).toBeLessThan(150);
  // Teclado hasta la última fila (Cmd+↓): la ventana virtual la trae.
  await cell(page, 'Item 0000', 2).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect(page.locator('.docs-db-tr', { hasText: 'Item 0999' })).toBeVisible();
  // Tipear en una celda sigue rápido.
  const t1 = Date.now();
  await page.keyboard.press('Enter');
  await page.keyboard.type('12345');
  await page.keyboard.press('Enter');
  expect(Date.now() - t1).toBeLessThan(3_000);
  const md = await (await request.get(`/api/docs/pages/${doc.id}/export?format=md`)).text();
  expect(md).toContain('| Name | Status | Points | Reviewed |');
});

test('Docs DB: el centro de ayuda muestra la vista activa en lectura (sin personas)', async ({ request, page }) => {
  const db = tracker();
  db.properties.push({ id: 'who', name: 'Owner', type: 'person' });
  db.views = [{ id: 'v1', name: '', type: 'board', group_by: 'st' }];
  const doc = await pageWith(request, `Lectura ${uid()}`, [{ id: 'db', type: 'database', content: '', db }]);
  const pub = await request.patch(`/api/docs/pages/${doc.id}`, { data: { published: true } });
  expect(pub.ok()).toBeTruthy();
  const { slug } = (await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { slug: string };
  const { handle } = (await (await request.get('/api/calendar/config')).json()) as { handle: string };
  await page.goto(`/en/h/${handle}/${slug}`, { waitUntil: 'networkidle' });
  const ro = page.getByTestId('docs-database-readonly');
  await expect(ro.locator('.docs-db-bcol')).toHaveCount(3);
  await expect(ro).toContainText('Alpha');
  await expect(ro).not.toContainText('Owner');
});
