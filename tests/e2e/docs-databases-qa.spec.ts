import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Bases de Docs: arreglos de la QA de D2. Acciones a medio armar que no traban
 * el guardado, escrituras del servidor sobre la base abierta sin falso
 * conflicto (una pestaña y dos), y el teclado de los selectores y paneles.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const T = '2026-01-01T10:00:00.000Z';

type Row = { id: string; values: Record<string, unknown>; created_at: string; updated_at: string };
type Prop = { id: string; name: string; type: string; [k: string]: unknown };
type Db = { title?: string; properties: Prop[]; rows: Row[]; views: Array<Record<string, unknown>>; active_view?: string; automations?: unknown[] };
type Block = { id: string; type: string; content: string; db?: Db };

const row = (id: string, values: Record<string, unknown>): Row => ({ id, values, created_at: T, updated_at: T });

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function pageOf(request: APIRequestContext, id: string): Promise<{ content: Block[]; title: string }> {
  return (await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[]; title: string };
}

async function dbOf(request: APIRequestContext, id: string, blockId = 'db'): Promise<Db> {
  return (await pageOf(request, id)).content.find((b) => b.id === blockId)!.db!;
}

const cell = (page: Page, rowText: string, col: number) => page.locator('.docs-db-tr', { hasText: rowText }).locator('[role="gridcell"]').nth(col);
const para = (page: Page, text: string) => page.locator('.docs-blocks .docs-editable', { hasText: text }).first();

/** Espera a que el editor diga "Saved" (sin error ni conflicto). */
async function saved(page: Page) {
  await expect(page.locator('.docs-save-status')).toHaveText(/Saved/, { timeout: 15_000 });
  await expect(page.locator('.docs-banner-bad')).toHaveCount(0);
}

test('QA D2: una acción "Add row to" sin base elegida no traba el guardado de la página', async ({ request, page }) => {
  const doc = await pageWith(request, `Draft ${uid()}`, [
    { id: 'p1', type: 'paragraph', content: 'Hola' },
    { id: 'db', type: 'database', content: '', db: { title: 'Tasks', properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [row('r1', { n: 'One' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  const bad: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes(`/api/docs/pages/${doc.id}`) && r.request().method() === 'PATCH' && !r.ok()) bad.push(r.status());
  });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('docs-db-more').click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: /Automations/ }).click();
  const panel = page.getByTestId('docs-db-automations');
  await panel.getByRole('button', { name: 'New automation' }).click();
  await panel.getByRole('button', { name: 'Add action' }).click();
  await panel.getByRole('menuitem', { name: 'Add row to' }).click();
  await expect(panel.getByTestId('docs-db-action-incomplete')).toBeVisible();
  await page.keyboard.press('Escape');
  // El resto de la página se sigue guardando.
  await para(page, 'Hola').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' mundo');
  await saved(page);
  expect(bad).toEqual([]);
  const after = await pageOf(request, doc.id);
  expect(after.content.find((b) => b.id === 'p1')?.content).toBe('Hola mundo');
  const autos = after.content.find((b) => b.id === 'db')!.db!.automations as Array<{ actions: Array<{ type: string; target: { page_id: string } }> }>;
  expect(autos[0].actions[0]).toMatchObject({ type: 'add_row', target: { page_id: '' } });
  // Al volver a abrir queda como borrador, con su aviso.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('docs-db-more').click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: /Automations/ }).click();
  await page.getByTestId('docs-db-automation').getByRole('button', { name: 'Untitled automation', exact: true }).click();
  await expect(page.getByTestId('docs-db-action-incomplete')).toBeVisible();
});

test('QA D2: automatización "cambia → agregar fila en esta base" sin falso conflicto (una pestaña)', async ({ request, page }) => {
  const doc = await pageWith(request, `Self ${uid()}`, [{ id: 'p1', type: 'paragraph', content: 'Notas' }]);
  const db: Db = {
    title: 'Tasks',
    properties: [
      { id: 'n', name: 'Name', type: 'title' },
      { id: 'done', name: 'Done', type: 'checkbox' },
    ],
    rows: [row('r1', { n: 'One' })],
    views: [{ id: 'v', name: '', type: 'table' }],
    automations: [
      { id: 'au', name: 'Log', enabled: true, trigger: { type: 'prop_changed', prop: 'done', to: true }, view: null, actions: [{ id: 'a', type: 'add_row', target: { page_id: doc.id, block_id: 'db' }, title: 'Log {{title}}' }] },
    ],
  };
  await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: [{ id: 'p1', type: 'paragraph', content: 'Notas' }, { id: 'db', type: 'database', content: '', db }] } });
  const conflicts: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes(`/api/docs/pages/${doc.id}`) && r.request().method() === 'PATCH' && r.status() === 409) conflicts.push(409);
  });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await cell(page, 'One', 1).click();
  // La fila de la automatización aparece sin recargar.
  await expect(page.locator('.docs-db-tr', { hasText: 'Log One' })).toHaveCount(1, { timeout: 15_000 });
  await saved(page);
  // Seguir editando: guarda sin "Someone else edited".
  await para(page, 'Notas').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' finales');
  await saved(page);
  // Destildar y volver a tildar (guardando entre medio) dispara otra vez.
  await cell(page, 'One', 1).click();
  await expect.poll(async () => (await dbOf(request, doc.id)).rows.find((r) => r.id === 'r1')?.values.done ?? false, { timeout: 10_000 }).toBe(false);
  await cell(page, 'One', 1).click();
  await expect(page.locator('.docs-db-tr', { hasText: 'Log One' })).toHaveCount(2, { timeout: 15_000 });
  await saved(page);
  expect(conflicts).toEqual([]);
  const after = await dbOf(request, doc.id);
  // Una fila por cada vez que se tildó, ninguna perdida ni duplicada.
  expect(after.rows.filter((r) => r.values.n === 'Log One')).toHaveLength(2);
  expect((await pageOf(request, doc.id)).content.find((b) => b.id === 'p1')?.content).toBe('Notas finales');
});

test('QA D2: fila creada desde una relación en otra página no da conflicto en la pestaña abierta; el conflicto real fusiona al sobrescribir', async ({ request, browser }) => {
  const target = await pageWith(request, `Projects ${uid()}`, [
    { id: 'p1', type: 'paragraph', content: 'Plan' },
    { id: 'db', type: 'database', content: '', db: { title: 'Projects', properties: [{ id: 'pn', name: 'Name', type: 'title' }], rows: [row('pa', { pn: 'Alpha' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  const source = await pageWith(request, `Tasks ${uid()}`, [
    {
      id: 'db',
      type: 'database',
      content: '',
      db: {
        title: 'Tasks',
        properties: [
          { id: 'n', name: 'Name', type: 'title' },
          { id: 'rel', name: 'Project', type: 'relation', relation: { page_id: target.id, block_id: 'db' } },
        ],
        rows: [row('t1', { n: 'Write' })],
        views: [{ id: 'v', name: '', type: 'table' }],
      },
    },
  ]);
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tabA = await ctx.newPage();
  const tabB = await ctx.newPage();
  const tabC = await ctx.newPage();
  const conflictsB: number[] = [];
  tabB.on('response', (r) => {
    if (r.url().includes(`/api/docs/pages/${target.id}`) && r.request().method() === 'PATCH' && r.status() === 409) conflictsB.push(409);
  });
  // B y C tienen abierta la página de proyectos desde antes.
  // (Con varias pestañas en el mismo contexto un pedido del shell puede quedar
  // abierto: se espera a la base pintada, no a networkidle.)
  const open = async (tab: Page, id: string) => {
    await tab.goto(`/en/app/docs/${id}`);
    await expect(tab.getByTestId('docs-database')).toBeVisible({ timeout: 20_000 });
    await expect(tab.locator('.docs-save-status')).toBeAttached();
  };
  await open(tabB, target.id);
  await open(tabC, target.id);
  // A crea un proyecto desde el selector de relación de la otra base.
  await open(tabA, source.id);
  await cell(tabA, 'Write', 1).click();
  const picker = tabA.getByTestId('docs-db-relation-picker');
  await expect(picker.locator('input')).toBeFocused();
  await tabA.keyboard.type('Gamma');
  await tabA.keyboard.press('Enter');
  await expect(picker.locator('.docs-db-relchip', { hasText: 'Gamma' })).toBeVisible();
  // Enter con el valor puesto no lo quita.
  await tabA.keyboard.press('Enter');
  await expect(picker.locator('.docs-db-relchip', { hasText: 'Gamma' })).toBeVisible();
  await tabA.keyboard.press('Escape');
  await expect.poll(async () => (await dbOf(request, target.id)).rows.map((r) => r.values.pn), { timeout: 10_000 }).toContain('Gamma');

  // B edita su página (con la versión vieja): guarda sin conflicto y trae la fila nueva.
  await tabB.bringToFront();
  await para(tabB, 'Plan').click();
  await tabB.keyboard.press('End');
  await tabB.keyboard.type(' 2027');
  await saved(tabB);
  expect(conflictsB).toEqual([]);
  await expect(tabB.locator('.docs-db-tr', { hasText: 'Gamma' })).toHaveCount(1, { timeout: 10_000 });
  const afterB = await pageOf(request, target.id);
  expect(afterB.content.find((b) => b.id === 'p1')?.content).toBe('Plan 2027');
  expect(afterB.content.find((b) => b.id === 'db')!.db!.rows.map((r) => r.values.pn)).toEqual(['Alpha', 'Gamma']);

  // C editó el mismo párrafo sobre la versión vieja: conflicto real.
  await tabC.bringToFront();
  await para(tabC, 'Plan').click();
  await tabC.keyboard.press('End');
  await tabC.keyboard.type(' Q1');
  await expect(tabC.locator('.docs-banner-bad')).toBeVisible({ timeout: 15_000 });
  // Sobrescribir gana el párrafo pero no borra la fila que agregó el otro lado.
  await tabC.locator('.docs-banner-bad').getByRole('button', { name: 'Overwrite' }).click();
  await expect(tabC.locator('.docs-banner-bad')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await pageOf(request, target.id)).content.find((b) => b.id === 'p1')?.content, { timeout: 10_000 }).toBe('Plan Q1');
  expect((await dbOf(request, target.id)).rows.map((r) => r.values.pn)).toEqual(['Alpha', 'Gamma']);
  await expect(tabC.locator('.docs-db-tr', { hasText: 'Gamma' })).toHaveCount(1, { timeout: 10_000 });
  await ctx.close();
});

test('QA D2: teclado en el panel de fila, el selector /linked, propiedad nueva, fórmula y calendario', async ({ request, page }) => {
  const invName = `Inventory${uid()}`;
  const other = await pageWith(request, `Source ${uid()}`, [
    { id: 'db', type: 'database', content: '', db: { title: invName, properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [row('i1', { n: 'Bolt' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  void other;
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(Math.min(today.getDate(), 20))}`;
  const doc = await pageWith(request, `Keys ${uid()}`, [
    {
      id: 'db',
      type: 'database',
      content: '',
      db: {
        title: 'Plan',
        properties: [
          { id: 'n', name: 'Name', type: 'title' },
          { id: 'due', name: 'Due', type: 'date' },
          { id: 'st', name: 'Status', type: 'status', options: [{ id: 'ns', name: 'Not started', group: 'todo' }, { id: 'ip', name: 'In progress', group: 'in_progress' }, { id: 'dn', name: 'Done', group: 'done' }] },
        ],
        rows: [row('r1', { n: 'Kickoff', due: day })],
        views: [
          { id: 'v', name: '', type: 'table' },
          { id: 'c', name: '', type: 'calendar', date_by: 'due' },
        ],
        active_view: 'v',
      },
    },
    { id: 'p1', type: 'paragraph', content: '' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });

  // Panel de fila: Esc desde el título y desde el cuerpo.
  await page.locator('.docs-db-title-text', { hasText: 'Kickoff' }).click();
  const panel = page.getByTestId('docs-db-rowpanel');
  await expect(panel).toBeVisible();
  await panel.locator('.docs-title').click();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.locator('.docs-db-title-text', { hasText: 'Kickoff' }).click();
  await panel.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('Agenda');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Fila nueva arranca en "Not started".
  await page.getByTestId('docs-database').locator('.docs-db-new:not(.docs-db-new-more)').click();
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Second', 2)).toHaveText('Not started');

  // Propiedad nueva: el foco va al nombre y Esc cierra.
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.locator('.docs-db-popover').getByRole('menuitem', { name: 'Formula' }).click();
  await expect(page.getByRole('textbox', { name: 'Property name' })).toBeFocused();
  // Fórmula inválida: error legible y no se guarda.
  await page.getByRole('textbox', { name: 'Formula' }).fill('prop("Nope") + 1');
  await expect(page.getByTestId('docs-db-formula-status')).toHaveText(/there is no property called “Nope”/);
  await page.getByRole('button', { name: 'Save formula' }).click();
  await expect(page.getByTestId('docs-db-formula-blocked')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.docs-db-popover')).toHaveCount(0);
  const saved1 = await dbOf(request, doc.id);
  expect(saved1.properties.find((x) => x.type === 'formula')?.formula ?? '').toBe('');

  // Calendario: Alt+→ dos veces seguidas y Enter abre la fila.
  await page.getByRole('tab', { name: /Calendar/ }).click();
  const card = page.locator('.docs-db-calcard', { hasText: 'Kickoff' }).locator('.docs-db-calcard-open');
  await card.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.docs-db-calcard-open:focus')).toHaveText('Kickoff');
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + 2);
  const movedKey = moved.toISOString().slice(0, 10);
  await expect(page.locator(`.docs-db-cal-day[data-day="${movedKey}"]`)).toContainText('Kickoff');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docs-db-rowpanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('docs-db-rowpanel')).toHaveCount(0);

  // /linked: flechas y Enter eligen la base.
  await page.locator('.docs-blocks .docs-editable').last().click();
  await page.keyboard.type('/linked');
  await page.keyboard.press('Enter');
  const linkedInput = page.getByRole('combobox', { name: /Search databases/ });
  await expect(linkedInput).toBeFocused();
  await page.keyboard.type(invName);
  await expect(page.getByRole('option', { name: new RegExp(invName) })).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docs-database-linked').locator('.docs-db-tr', { hasText: 'Bolt' })).toBeVisible({ timeout: 10_000 });
});

test('QA D2: a 390px la fila se abre como página con Cerrar a mano y "atrás" la cierra', async ({ request, page }) => {
  const doc = await pageWith(request, `Mobile ${uid()}`, [
    { id: 'db', type: 'database', content: '', db: { title: 'T', properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [row('r1', { n: 'Phone row' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-db-title-text', { hasText: 'Phone row' }).click();
  const panel = page.getByTestId('docs-db-rowpanel');
  await expect(panel).toBeVisible();
  const close = panel.getByRole('button', { name: 'Close' });
  await expect(close).toBeInViewport();
  const box = (await close.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await page.locator('.docs-db-title-text', { hasText: 'Phone row' }).click();
  await panel.getByRole('button', { name: 'Close' }).tap().catch(() => panel.getByRole('button', { name: 'Close' }).click());
  await expect(panel).toHaveCount(0);
});
