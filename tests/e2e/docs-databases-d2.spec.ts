import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Bases de Docs como Notion (tanda D2): tipos nuevos (fórmula, ID, creado
 * por, relación y rollup, botón), vistas lista, calendario, timeline y
 * subgrupos, vistas vinculadas, automatizaciones, autocompletar con IA
 * (modelo falso DOCS_AI_FAKE) y CSV.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const T = '2026-01-01T10:00:00.000Z';

type Row = { id: string; values: Record<string, unknown>; body?: unknown[]; files?: unknown; created_at: string; updated_at: string; created_by?: string };
type Prop = { id: string; name: string; type: string; [k: string]: unknown };
type Db = { title?: string; properties: Prop[]; rows: Row[]; views: Array<Record<string, unknown>>; active_view?: string; automations?: unknown[] };
type Block = { id: string; type: string; content: string; db?: Db; linked?: unknown };

const row = (id: string, values: Record<string, unknown>, extra: Partial<Row> = {}): Row => ({ id, values, created_at: T, updated_at: T, ...extra });

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function dbOf(request: APIRequestContext, id: string, blockId = 'db'): Promise<Db> {
  const page = (await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] };
  return page.content.find((b) => b.id === blockId)!.db!;
}

async function me(request: APIRequestContext): Promise<{ id: string; name: string | null; email: string }> {
  const { rows } = (await (await request.get('/api/docs/members')).json()) as { rows: Array<{ id: string; name: string | null; email: string }> };
  return rows[0];
}

const cell = (page: Page, rowText: string, col: number) => page.locator('.docs-db-tr', { hasText: rowText }).locator('[role="gridcell"]').nth(col);

function tasksDb(projectsPage: string): Db {
  return {
    title: 'Tasks',
    properties: [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'pts', name: 'Points', type: 'number' },
      { id: 'done', name: 'Done', type: 'checkbox' },
      { id: 'dbl', name: 'Double', type: 'formula', formula: 'prop("Points") * 2' },
      { id: 'proj', name: 'Project', type: 'relation', relation: { page_id: projectsPage, block_id: 'db', synced_prop: 'tasks' } },
    ],
    rows: [row('t1', { name: 'Write', pts: 3, done: true }), row('t2', { name: 'Review', pts: 5 })],
    views: [{ id: 'v1', name: '', type: 'table' }],
    active_view: 'v1',
  };
}

function projectsDb(tasksPage: string): Db {
  return {
    title: 'Projects',
    properties: [
      { id: 'pname', name: 'Name', type: 'title' },
      { id: 'tasks', name: 'Tasks', type: 'relation', relation: { page_id: tasksPage, block_id: 'db', mirror_of: 'proj' } },
      { id: 'sum', name: 'Total points', type: 'rollup', rollup: { relation: 'tasks', property: 'pts', fn: 'sum' } },
      { id: 'pct', name: 'Progress', type: 'rollup', rollup: { relation: 'tasks', property: 'done', fn: 'percent_checked' } },
    ],
    rows: [row('p1', { pname: 'Alpha' }), row('p2', { pname: 'Beta' })],
    views: [{ id: 'v1', name: '', type: 'table' }],
    active_view: 'v1',
  };
}

test('D2: el título de una fila abre el panel; el resto de la celda edita', async ({ request, page }) => {
  const doc = await pageWith(request, `Titulo ${uid()}`, [
    { id: 'db', type: 'database', content: '', db: { properties: [{ id: 'name', name: 'Name', type: 'title' }], rows: [row('r1', { name: 'Click me' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-db-title-text', { hasText: 'Click me' }).click();
  await expect(page.getByTestId('docs-db-rowpanel')).toBeVisible();
  await page.getByTestId('docs-db-rowpanel').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('docs-db-rowpanel')).toHaveCount(0);
  // Click a la derecha del texto: entra a editar el título.
  const box = await cell(page, 'Click me', 0).boundingBox();
  await page.mouse.click(box!.x + box!.width - 90, box!.y + box!.height / 2);
  await expect(page.locator('.docs-db-td.editing input')).toBeFocused();
});

test('D2: fórmula, ID único y creado por; relación de dos vías y rollups entre páginas', async ({ request, page }) => {
  const projects = (await (await request.post('/api/docs/pages', { data: { title: `Projects ${uid()}` } })).json()) as { id: string };
  const tasks = (await (await request.post('/api/docs/pages', { data: { title: `Tasks ${uid()}` } })).json()) as { id: string };
  const db = tasksDb(projects.id);
  db.properties.push({ id: 'uid', name: 'ID', type: 'unique_id', prefix: 'TSK', next_id: 3 }, { id: 'by', name: 'Created by', type: 'created_by' });
  db.rows = db.rows.map((r, i) => ({ ...r, values: { ...r.values, uid: i + 1 } }));
  expect((await request.patch(`/api/docs/pages/${tasks.id}`, { data: { content: [{ id: 'db', type: 'database', content: '', db }] } })).ok()).toBeTruthy();
  expect((await request.patch(`/api/docs/pages/${projects.id}`, { data: { content: [{ id: 'db', type: 'database', content: '', db: projectsDb(tasks.id) }] } })).ok()).toBeTruthy();

  await page.goto(`/en/app/docs/${tasks.id}`, { waitUntil: 'networkidle' });
  await expect(cell(page, 'Write', 3)).toHaveText('6');
  await expect(cell(page, 'Review', 5)).toHaveText('TSK-2');

  // Fila nueva: ID 3 y, guardada, "Creado por" la persona.
  await page.getByTestId('docs-database').locator('.docs-db-new:not(.docs-db-new-more)').click();
  await page.keyboard.type('Ship');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Ship', 5)).toHaveText('TSK-3');
  const user = await me(request);
  await expect.poll(async () => (await dbOf(request, tasks.id)).rows.find((r) => r.values.name === 'Ship')?.created_by, { timeout: 10_000 }).toBe(user.id);

  // Relación: elegir el proyecto desde el selector.
  await cell(page, 'Write', 4).click();
  const picker = page.getByTestId('docs-db-relation-picker');
  await expect(picker).toContainText('Alpha');
  await picker.getByRole('option', { name: 'Alpha' }).click();
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Write', 4)).toContainText('Alpha');
  await cell(page, 'Review', 4).click();
  await picker.getByRole('option', { name: 'Alpha' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await dbOf(request, tasks.id)).rows.find((r) => r.id === 't2')?.values.proj, { timeout: 10_000 }).toEqual(['p1']);

  // En la otra página: el espejo y los rollups (5 + 3 puntos, la mitad hecha).
  await page.goto(`/en/app/docs/${projects.id}`, { waitUntil: 'networkidle' });
  await expect(cell(page, 'Alpha', 1)).toContainText('Write');
  await expect(cell(page, 'Alpha', 1)).toContainText('Review');
  await expect(cell(page, 'Alpha', 2)).toHaveText('8');
  await expect(cell(page, 'Alpha', 3)).toHaveText('50%');

  // Editar desde el espejo escribe en la base original: sacar Review de Alpha y ponerla en Beta.
  await cell(page, 'Beta', 1).click();
  await page.getByTestId('docs-db-relation-picker').getByRole('option', { name: 'Review' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await dbOf(request, tasks.id)).rows.find((r) => r.id === 't2')?.values.proj, { timeout: 10_000 }).toEqual(['p1', 'p2']);
  await expect(cell(page, 'Beta', 2)).toHaveText('5');
});

test('D2: crear una relación de dos vías desde el menú de la propiedad', async ({ request, page }) => {
  const pageTitle = `Clients ${uid()}`;
  const dbTitle = `Clients${uid()}`;
  const other = await pageWith(request, pageTitle, [
    { id: 'db', type: 'database', content: '', db: { title: dbTitle, properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [row('c1', { n: 'Acme' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  const doc = await pageWith(request, `Deals ${uid()}`, [
    { id: 'db', type: 'database', content: '', db: { title: 'Deals', properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [row('d1', { n: 'Big deal' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: 'Relation' }).click();
  const cfg = page.getByTestId('docs-db-relation-config');
  await cfg.locator('select').first().selectOption({ label: `${dbTitle} · ${pageTitle}` });
  await cfg.getByRole('checkbox').click();
  await expect(cfg.getByRole('checkbox')).toBeChecked();
  await expect.poll(async () => (await dbOf(request, other.id)).properties.find((p) => p.type === 'relation')?.relation, { timeout: 10_000 }).toMatchObject({ page_id: doc.id, block_id: 'db' });
  await expect.poll(async () => (await dbOf(request, doc.id)).properties.find((p) => p.type === 'relation')?.relation, { timeout: 10_000 }).toMatchObject({ page_id: other.id, synced_prop: expect.any(String) });
});

test('D2: lista, calendario (mover con teclado, crear en un día), timeline y subgrupos', async ({ request, page }) => {
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const day = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const d0 = new Date(today.getFullYear(), today.getMonth(), 10);
  const db: Db = {
    properties: [
      { id: 'name', name: 'Name', type: 'title' },
      { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'Todo', group: 'todo' }, { id: 'done', name: 'Done', group: 'done' }] },
      { id: 'pri', name: 'Priority', type: 'select', options: [{ id: 'hi', name: 'High' }, { id: 'lo', name: 'Low' }] },
      { id: 'start', name: 'Start', type: 'date' },
      { id: 'end', name: 'End', type: 'date' },
    ],
    rows: [row('a', { name: 'Kickoff', st: 'todo', pri: 'hi', start: day(d0), end: day(new Date(d0.getTime() + 2 * 86400000)) }), row('b', { name: 'Retro', st: 'done', pri: 'lo' })],
    views: [
      { id: 'vl', name: 'My list', type: 'list' },
      { id: 'vc', name: 'Cal', type: 'calendar', date_by: 'start', hidden: ['st', 'pri', 'end'] },
      { id: 'vt', name: 'Plan', type: 'timeline', date_by: 'start', end_by: 'end', zoom: 'week' },
      { id: 'vb', name: 'Board', type: 'board', group_by: 'st', sub_group_by: 'pri' },
    ],
    active_view: 'vl',
  };
  const doc = await pageWith(request, `Vistas ${uid()}`, [{ id: 'db', type: 'database', content: '', db }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const list = page.getByTestId('docs-db-list');
  await expect(list.locator('.docs-db-list-item')).toHaveCount(2);
  await list.getByRole('button', { name: 'Kickoff' }).click();
  await expect(page.getByTestId('docs-db-rowpanel')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Cal' }).click();
  const cal = page.getByTestId('docs-db-calendar');
  await expect(cal.locator(`[data-day="${day(d0)}"]`)).toContainText('Kickoff');
  await expect(cal).toContainText('No date (1)');
  await cal.locator(`[data-day="${day(d0)}"]`).getByRole('button', { name: 'Kickoff' }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  const d1 = day(new Date(d0.getFullYear(), d0.getMonth(), 11));
  await expect(cal.locator(`[data-day="${d1}"]`)).toContainText('Kickoff');
  await cal.locator(`[data-day="${day(new Date(d0.getFullYear(), d0.getMonth(), 20))}"]`).hover();
  await cal.getByRole('button', { name: `New row on ${day(new Date(d0.getFullYear(), d0.getMonth(), 20))}` }).click();
  await expect(page.getByTestId('docs-db-rowpanel')).toBeVisible();
  await page.getByTestId('docs-db-rowpanel').getByRole('button', { name: 'Close' }).click();
  await expect.poll(async () => (await dbOf(request, doc.id)).rows.map((r) => r.values.start), { timeout: 10_000 }).toEqual([d1, undefined, day(new Date(d0.getFullYear(), d0.getMonth(), 20))]);

  await page.getByRole('tab', { name: 'Plan' }).click();
  const tl = page.getByTestId('docs-db-timeline');
  const bar = tl.locator('.docs-db-tl-label', { hasText: 'Kickoff' });
  await expect(bar).toBeVisible();
  await bar.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => {
      const r = (await dbOf(request, doc.id)).rows.find((x) => x.id === 'a')!;
      return [r.values.start, r.values.end];
    }, { timeout: 10_000 })
    .toEqual([day(new Date(d0.getFullYear(), d0.getMonth(), 12)), day(new Date(d0.getFullYear(), d0.getMonth(), 14))]);

  await page.getByRole('tab', { name: 'Board' }).click();
  const subs = page.getByTestId('docs-db-subgroups');
  // High, Low y la fila nueva sin prioridad.
  await expect(subs.locator('.docs-db-subgroup')).toHaveCount(3);
  await expect(subs.locator('.docs-db-subgroup').first()).toContainText('High');
});

test('D2: vista vinculada de una base de otra página, con sus vistas y edición', async ({ request, page }) => {
  const src = await pageWith(request, `Source ${uid()}`, [
    {
      id: 'db',
      type: 'database',
      content: '',
      db: { title: 'Inventory', properties: [{ id: 'n', name: 'Name', type: 'title' }, { id: 'q', name: 'Qty', type: 'number' }], rows: [row('i1', { n: 'Bolts', q: 10 }), row('i2', { n: 'Nuts', q: 2 })], views: [{ id: 'v', name: '', type: 'table' }] },
    },
  ]);
  const doc = await pageWith(request, `Linked ${uid()}`, [
    { id: 'lnk', type: 'database', content: '', linked: { page_id: src.id, block_id: 'db', views: [{ id: 'lv', name: 'Low stock', type: 'table', filters: [{ id: 'f', property: 'q', op: 'lt', value: 5 }] }], active_view: 'lv' } },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const linked = page.getByTestId('docs-database-linked');
  await expect(linked.locator('.docs-db-tr')).toHaveCount(1);
  await expect(linked).toContainText('Nuts');
  await expect(linked.locator('.docs-db-linked-src')).toBeVisible();
  // Editar desde la vista vinculada guarda en la base de origen.
  await linked.locator('.docs-db-tr', { hasText: 'Nuts' }).locator('[role="gridcell"]').nth(1).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await dbOf(request, src.id)).rows.find((r) => r.id === 'i2')?.values.q, { timeout: 10_000 }).toBe(4);
  // La vista de origen no cambió (las vistas son del bloque vinculado).
  expect((await dbOf(request, src.id)).views).toHaveLength(1);

  // /linked desde el editor: elegir la base.
  const picker = await pageWith(request, `Pick ${uid()}`, [{ id: 'p', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${picker.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('/linked');
  await page.keyboard.press('Enter');
  const pick = page.getByRole('group', { name: 'Linked view of a database' });
  await expect(pick).toBeVisible();
  await pick.getByRole('option', { name: /Inventory/ }).first().click();
  await expect(page.getByTestId('docs-database-linked')).toContainText('Bolts');
});

test('D2: automatización al agregar fila y botón con aviso, con registro de corridas', async ({ request, page }) => {
  const user = await me(request);
  const db: Db = {
    title: 'Requests',
    properties: [
      { id: 'n', name: 'Name', type: 'title' },
      { id: 'st', name: 'Status', type: 'select', options: [{ id: 'new', name: 'New' }, { id: 'ok', name: 'Approved' }] },
      { id: 'btn', name: 'Approve', type: 'button', button: { label: 'Approve', actions: [{ id: 'a1', type: 'set_prop', prop: 'st', value: 'ok' }, { id: 'a2', type: 'notify', people: [user.id], message: '{{title}} approved' }] } },
    ],
    rows: [row('r1', { n: 'Laptop' })],
    views: [{ id: 'v', name: '', type: 'table' }],
    automations: [{ id: 'au1', name: 'Mark new', enabled: true, trigger: { type: 'row_added' }, actions: [{ id: 'x', type: 'set_prop', prop: 'st', value: 'new' }, { id: 'y', type: 'notify', people: [user.id], message: 'New request {{title}}' }] }],
  };
  const doc = await pageWith(request, `Auto ${uid()}`, [{ id: 'db', type: 'database', content: '', db }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });

  await page.getByTestId('docs-database').locator('.docs-db-new:not(.docs-db-new-more)').click();
  await page.keyboard.type('Monitor');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Monitor', 1)).toHaveText('New');
  await expect
    .poll(async () => {
      const r = (await (await request.get('/api/notifications?type=db_automation&limit=50')).json()) as { rows: Array<{ title: string }> };
      return r.rows.map((x) => x.title);
    }, { timeout: 15_000 })
    .toContain('New request Monitor');

  // Botón: aprueba la fila y avisa.
  await cell(page, 'Laptop', 2).getByRole('button', { name: 'Approve' }).click();
  await expect(cell(page, 'Laptop', 1)).toHaveText('Approved');
  await expect(page.locator('.docs-db-notice')).toHaveText(/Done/);
  await expect
    .poll(async () => {
      const r = (await (await request.get('/api/notifications?type=db_automation&limit=50')).json()) as { rows: Array<{ title: string }> };
      return r.rows.map((x) => x.title);
    }, { timeout: 15_000 })
    .toContain('Laptop approved');

  // Panel de automatizaciones: la lista y el registro.
  await page.getByTestId('docs-db-more').click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: /Automations/ }).click();
  const panel = page.getByTestId('docs-db-automations');
  await expect(panel.getByTestId('docs-db-automation')).toHaveCount(1);
  await panel.getByText('Recent runs').click();
  await expect(panel.locator('.docs-db-runs-list li').first()).toContainText('Send notification');
  // Apagar la automatización se guarda.
  await panel.getByRole('checkbox', { name: 'Turn Mark new on or off' }).uncheck();
  await expect.poll(async () => ((await dbOf(request, doc.id)).automations as Array<{ enabled: boolean }>)[0].enabled, { timeout: 10_000 }).toBe(false);
});

test('D2: autocompletar con IA (modelo falso) y error claro sin IA', async ({ request, page, context }) => {
  const db: Db = {
    properties: [
      { id: 'n', name: 'Name', type: 'title' },
      { id: 'sum', name: 'Summary', type: 'text', ai: { mode: 'summary' } },
      { id: 'kind', name: 'Kind', type: 'select', options: [{ id: 'bug', name: 'Bug' }, { id: 'feat', name: 'Feature' }], ai: { mode: 'classify' } },
    ],
    rows: [row('r1', { n: 'Login fails' }, { body: [{ id: 'b1', type: 'paragraph', content: 'Bug: the login page crashes on submit' }] }), row('r2', { n: 'Dark mode' }, { body: [{ id: 'b2', type: 'paragraph', content: 'New feature request for themes' }] })],
    views: [{ id: 'v', name: '', type: 'table' }],
  };
  const doc = await pageWith(request, `AI ${uid()}`, [{ id: 'db', type: 'database', content: '', db }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-db-th-btn', { hasText: 'Summary' }).click();
  await page.getByTestId('docs-db-ai-fill').click();
  await expect(cell(page, 'Login fails', 1)).toContainText('Bug: the login page crashes');
  await page.keyboard.press('Escape');
  await page.locator('.docs-db-th-btn', { hasText: 'Kind' }).click();
  await page.getByTestId('docs-db-ai-fill').click();
  await expect(cell(page, 'Login fails', 2)).toHaveText('Bug');
  await expect(cell(page, 'Dark mode', 2)).toHaveText('Feature');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await dbOf(request, doc.id)).rows[1].values.kind, { timeout: 10_000 }).toBe('feat');

  // Sin IA: el error se ve.
  await context.addCookies([{ name: 'docs_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
  await page.locator('.docs-db-th-btn', { hasText: 'Summary' }).click();
  await page.getByTestId('docs-db-ai-fill').click();
  await expect(page.locator('.docs-db-notice')).toHaveText(/AI is not set up/);
});

test('D2: importar un CSV con mapeo y exportar la vista', async ({ request, page }) => {
  const db: Db = { title: 'Leads', properties: [{ id: 'n', name: 'Name', type: 'title' }, { id: 'amt', name: 'Amount', type: 'number' }], rows: [], views: [{ id: 'v', name: '', type: 'table' }] };
  const doc = await pageWith(request, `CSV ${uid()}`, [{ id: 'db', type: 'database', content: '', db }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('docs-db-more').click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: 'Import CSV' }).click();
  const csv = 'Name,Amount,Stage,Email\nAcme,1200,Lead,a@acme.com\nGlobex,800,Won,b@globex.com\nInitech,,Lead,c@initech.com\n';
  await page.getByTestId('docs-db-csv-file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const imp = page.getByTestId('docs-db-csv-import');
  await expect(imp).toContainText('leads.csv: 3 rows, 4 columns');
  await expect(imp.getByLabel('Where Stage goes')).toHaveValue('new:select');
  await expect(imp.getByLabel('Where Email goes')).toHaveValue('new:email');
  await page.getByTestId('docs-db-csv-confirm').click();
  await expect(page.locator('.docs-db-tr')).toHaveCount(3);
  await expect(cell(page, 'Acme', 2)).toHaveText('Lead');
  await expect.poll(async () => (await dbOf(request, doc.id)).properties.find((p) => p.name === 'Stage')?.options, { timeout: 10_000 }).toHaveLength(2);

  // Exportar la vista con un filtro (Amount > 1000).
  await page.getByRole('button', { name: 'Filter' }).click();
  const pop = page.locator('.docs-db-popover');
  await pop.getByRole('button', { name: 'Add a filter' }).click();
  await pop.getByLabel('Property').selectOption({ label: 'Amount' });
  await pop.getByLabel('Condition').selectOption('gt');
  await pop.getByLabel('Value').fill('1000');
  await page.keyboard.press('Escape');
  await page.getByTestId('docs-db-more').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.docs-db-popover').getByRole('menuitem', { name: 'Export this view as CSV' }).click()]);
  const body = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(body).toString('utf8').replace(/^﻿/, '');
  expect(text.trim().split('\r\n')).toEqual(['Name,Amount,Stage,Email', 'Acme,1200,Lead,a@acme.com']);
});

test('D2: calendario y timeline en 390px y oscuro sin scroll horizontal de la página', async ({ request, page }) => {
  const db: Db = {
    properties: [{ id: 'n', name: 'Name', type: 'title' }, { id: 'd', name: 'Date', type: 'date' }],
    rows: [row('r', { n: 'Event with a long title that should truncate', d: new Date().toISOString().slice(0, 10) })],
    views: [{ id: 'vc', name: 'Cal', type: 'calendar', date_by: 'd' }, { id: 'vt', name: 'TL', type: 'timeline', date_by: 'd' }],
    active_view: 'vc',
  };
  const doc = await pageWith(request, `Mobile ${uid()}`, [{ id: 'db', type: 'database', content: '', db }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('docs-db-calendar')).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: 'TL' }).click();
  await expect(page.getByTestId('docs-db-timeline')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
});
