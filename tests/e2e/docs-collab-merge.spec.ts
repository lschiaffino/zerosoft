import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Docs: un solo mecanismo de fusión (el servidor fusiona contra la revisión
 * base, el editor suma lo fusionado y el pulso en vivo trae lo de las demás
 * personas) y arreglos de la QA de D2 (selector de relación, subgrupos,
 * centro de ayuda, foco del calendario).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const T = '2026-01-01T10:00:00.000Z';

type Row = { id: string; values: Record<string, unknown>; created_at: string; updated_at: string };
type Db = { title?: string; properties: Array<Record<string, unknown>>; rows: Row[]; views: Array<Record<string, unknown>>; active_view?: string; automations?: unknown[] };
type Block = { id: string; type: string; content: string; db?: Db; [k: string]: unknown };

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

const editable = (p: Page, text: string) => p.locator('.docs-blocks .docs-editable', { hasText: text }).first();
const cell = (p: Page, rowText: string, col: number) => p.locator('.docs-db-tr', { hasText: rowText }).locator('[role="gridcell"]').nth(col);

async function saved(p: Page) {
  await expect(p.locator('.docs-save-status')).toHaveText(/Saved/, { timeout: 15_000 });
}

test('Docs: dos personas en el mismo párrafo, cada una en otra parte de la frase: quedan las dos', async ({ browser, request }) => {
  const doc = await pageWith(request, `Mismo ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'centro' }]);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const conflicts: number[] = [];
  for (const p of [a, b]) {
    p.on('response', (r) => {
      if (r.url().endsWith(`/api/docs/pages/${doc.id}`) && r.request().method() === 'PATCH' && r.status() === 409) conflicts.push(409);
    });
  }
  await a.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await b.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  // A escribe al final y B al principio, a la vez.
  await editable(a, 'centro').click();
  await a.keyboard.press('End');
  await editable(b, 'centro').click();
  await b.keyboard.press('Home');
  await Promise.all([a.keyboard.type(' derecha'), b.keyboard.type('izquierda ')]);
  await expect.poll(async () => (await pageOf(request, doc.id)).content[0]?.content, { timeout: 20_000 }).toBe('izquierda centro derecha');
  // Cada pantalla ve lo de la otra sin recargar, y nadie ve un aviso.
  await expect(editable(a, 'izquierda centro derecha')).toBeVisible({ timeout: 15_000 });
  await expect(editable(b, 'izquierda centro derecha')).toBeVisible({ timeout: 15_000 });
  await expect(a.locator('.docs-banner-bad')).toHaveCount(0);
  await expect(b.locator('.docs-banner-bad')).toHaveCount(0);
  expect(conflicts).toEqual([]);
  // Deshacer en A deshace lo suyo, no lo de B.
  await editable(a, 'izquierda centro derecha').click();
  await a.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await pageOf(request, doc.id)).content[0]?.content, { timeout: 20_000 }).toBe('izquierda centro');
  await ctxA.close();
  await ctxB.close();
});

test('Docs: una automatización de la base mientras otra persona escribe: no se pierde nada', async ({ browser, request }) => {
  const doc = await pageWith(request, `Auto ${uid()}`, [{ id: 'p1', type: 'paragraph', content: 'Notas' }]);
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
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await b.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  // B escribe en el párrafo mientras A tilda la fila (dispara la automatización).
  await editable(b, 'Notas').click();
  await b.keyboard.press('End');
  const typing = b.keyboard.type(' de la reunión', { delay: 40 });
  await cell(a, 'One', 1).click();
  await typing;
  await saved(b);
  await expect
    .poll(async () => {
      const page = await pageOf(request, doc.id);
      const rows = page.content.find((x) => x.id === 'db')!.db!.rows;
      return [page.content.find((x) => x.id === 'p1')?.content, rows.find((r) => r.id === 'r1')?.values.done ?? false, rows.filter((r) => r.values.n === 'Log One').length];
    }, { timeout: 20_000 })
    .toEqual(['Notas de la reunión', true, 1]);
  // Las dos pantallas terminan iguales: la fila de la automatización y el texto.
  for (const p of [a, b]) {
    await expect(p.locator('.docs-db-tr', { hasText: 'Log One' })).toHaveCount(1, { timeout: 15_000 });
    await expect(editable(p, 'Notas de la reunión')).toBeVisible({ timeout: 15_000 });
  }
  await ctxA.close();
  await ctxB.close();
});

test('Docs: comentario y sugerencia de una persona le llegan a la otra en vivo', async ({ browser, request }) => {
  const doc = await pageWith(request, `Vivo ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Revisar el presupuesto' }]);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await b.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  // A sugiere un cambio: B ve lo subrayado sin recargar.
  await a.getByRole('button', { name: 'Page options' }).click();
  await a.getByTestId('docs-suggest-toggle').click();
  await editable(a, 'Revisar el presupuesto').click();
  await a.keyboard.press('End');
  await a.keyboard.type(' anual');
  await saved(a);
  await expect(b.locator('.docs-editor span[data-sug]')).toHaveCount(1, { timeout: 15_000 });
  await expect(b.locator('.docs-editor span[data-sug]')).toContainText('anual');
  // B comenta: a A se le actualiza el contador sin recargar.
  await b.getByRole('button', { name: /^Comments/ }).click();
  const box = b.locator('.docs-side textarea').first();
  await box.fill('¿Anual o trimestral?');
  await box.press('ControlOrMeta+Enter');
  await expect(b.locator('.docs-side')).toContainText('¿Anual o trimestral?');
  await a.getByRole('button', { name: /^Comments/ }).click();
  await expect(a.locator('.docs-side')).toContainText('¿Anual o trimestral?', { timeout: 15_000 });
  await ctxA.close();
  await ctxB.close();
});

test('QA D2: el selector de relación limpia la búsqueda al elegir con Enter (otro Enter no crea una fila)', async ({ request, page }) => {
  const target = await pageWith(request, `Projects ${uid()}`, [
    { id: 'db', type: 'database', content: '', db: { title: 'Projects', properties: [{ id: 'pn', name: 'Name', type: 'title' }], rows: [row('pa', { pn: 'Gamma' })], views: [{ id: 'v', name: '', type: 'table' }] } },
  ]);
  const src = await pageWith(request, `Tasks ${uid()}`, [
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
  await page.goto(`/en/app/docs/${src.id}`, { waitUntil: 'networkidle' });
  await cell(page, 'Write', 1).click();
  const picker = page.getByTestId('docs-db-relation-picker');
  await expect(picker.locator('input')).toBeFocused();
  await page.keyboard.type('Gam');
  await expect(picker.locator('.docs-db-option', { hasText: 'Gamma' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(picker.locator('.docs-db-relchip', { hasText: 'Gamma' })).toBeVisible();
  await expect(picker.locator('input')).toHaveValue('');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await saved(page);
  const rows = (await pageOf(request, target.id)).content.find((b) => b.id === 'db')!.db!.rows;
  expect(rows.map((r) => r.values.pn)).toEqual(['Gamma']);
});

test('QA D2: board con subgrupos: todos con las mismas columnas, alineadas', async ({ request, page }) => {
  const { rows: members } = (await (await request.get('/api/docs/members')).json()) as { rows: Array<{ id: string }> };
  const me = members[0].id;
  const doc = await pageWith(request, `Sub ${uid()}`, [
    {
      id: 'db',
      type: 'database',
      content: '',
      db: {
        title: 'Tasks',
        properties: [
          { id: 'n', name: 'Name', type: 'title' },
          { id: 'who', name: 'Owner', type: 'person' },
          { id: 'pr', name: 'Priority', type: 'select', options: [{ id: 'hi', name: 'High' }, { id: 'lo', name: 'Low' }] },
        ],
        rows: [row('r1', { n: 'Mine', who: [me], pr: 'hi' }), row('r2', { n: 'Nobody', pr: 'lo' })],
        views: [{ id: 'v', name: '', type: 'board', group_by: 'who', sub_group_by: 'pr' }],
      },
    },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const subs = page.getByTestId('docs-db-subgroups');
  await expect(subs.locator('.docs-db-subgroup')).toHaveCount(2);
  // Un solo encabezado de columnas; cada subgrupo con las mismas columnas en la misma x.
  await expect(subs.locator('.docs-db-subheads .docs-db-bcol')).toHaveCount(2);
  const xs = async (i: number) =>
    subs.locator('.docs-db-subgroup').nth(i).locator('.docs-db-bcol').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  const heads = await subs.locator('.docs-db-subheads .docs-db-bcol').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(await xs(0)).toEqual(heads);
  expect(await xs(1)).toEqual(heads);
  await page.screenshot({ path: test.info().outputPath('subgroups.png') });
});

test('QA D2: centro de ayuda con la vista por defecto y el espejo de dos vías con sus valores', async ({ request, page }) => {
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Help ${uid()}` } })).json()) as { id: string };
  const tasks: Db = {
    title: 'Tasks',
    properties: [
      { id: 'tn', name: 'Name', type: 'title' },
      { id: 'proj', name: 'Project', type: 'relation', relation: { page_id: doc.id, block_id: 'pdb', synced_prop: 'ptasks' } },
    ],
    rows: [row('t1', { tn: 'Write docs', proj: ['p1'] })],
    // La activa en el editor es la galería; la por defecto (primera), la tabla.
    views: [{ id: 'vt', name: '', type: 'table' }, { id: 'vg', name: 'Cards', type: 'gallery' }],
    active_view: 'vg',
  };
  const projects: Db = {
    title: 'Projects',
    properties: [
      { id: 'pn', name: 'Name', type: 'title' },
      { id: 'ptasks', name: 'Tasks', type: 'relation', relation: { page_id: doc.id, block_id: 'tdb', mirror_of: 'proj' } },
    ],
    rows: [row('p1', { pn: 'Launch' })],
    views: [{ id: 'v', name: '', type: 'table' }],
  };
  expect((await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: [{ id: 'tdb', type: 'database', content: '', db: tasks }, { id: 'pdb', type: 'database', content: '', db: projects }] } })).ok()).toBeTruthy();
  expect((await request.patch(`/api/docs/pages/${doc.id}`, { data: { published: true } })).ok()).toBeTruthy();
  const { slug } = (await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { slug: string };
  const { handle } = (await (await request.get('/api/calendar/config')).json()) as { handle: string };
  await page.goto(`/en/h/${handle}/${slug}`, { waitUntil: 'networkidle' });
  const ro = page.getByTestId('docs-database-readonly');
  await expect(ro).toHaveCount(2);
  await expect(ro.first().locator('table')).toHaveCount(1);
  await expect(ro.first().locator('.docs-db-gallery')).toHaveCount(0);
  // La relación y su espejo muestran los títulos de la otra base.
  await expect(ro.first()).toContainText('Launch');
  await expect(ro.nth(1).locator('tr', { hasText: 'Launch' })).toContainText('Write docs');
});

test('QA D2: al cerrar el panel el foco vuelve a la tarjeta del calendario', async ({ request, page }) => {
  const today = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const day = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(Math.min(today.getDate(), 20))}`;
  const doc = await pageWith(request, `Cal ${uid()}`, [
    {
      id: 'db',
      type: 'database',
      content: '',
      db: {
        title: 'Events',
        properties: [
          { id: 'n', name: 'Name', type: 'title' },
          { id: 'd', name: 'Date', type: 'date' },
        ],
        rows: [row('e1', { n: 'Kickoff', d: day })],
        views: [{ id: 'v', name: '', type: 'calendar', date_by: 'd' }],
      },
    },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const card = page.locator('.docs-db-calcard-open', { hasText: 'Kickoff' });
  await card.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('docs-db-rowpanel');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(card).toBeFocused();
  // Con el mouse y Close, igual.
  await card.click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeFocused();
});
