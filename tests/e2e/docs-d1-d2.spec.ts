import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Docs D1 (editor) y D2 (bases) juntas: plantilla de fila en una base con
 * fórmula y relación, menú "/" con los comandos de las dos tandas y una base
 * creada adentro de un bloque sincronizado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const T = '2026-01-01T10:00:00.000Z';

type Block = { id: string; type: string; content: string; indent?: number; [k: string]: unknown };
type Row = { id: string; values: Record<string, unknown>; body?: Block[]; created_at: string; updated_at: string };
type Db = { properties: Array<{ id: string; type: string; relation?: { page_id: string } }>; rows: Row[]; templates?: Array<{ name: string; values: Record<string, unknown> }> };

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function content(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}

const editable = (p: Page, text: string) => p.locator('.docs-blocks .docs-editable', { hasText: text });

test('D1+D2: plantilla de fila en una base con fórmula, ID único y relación', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Plantilla D2 ${uid()}`, [
    {
      id: 'db',
      type: 'database',
      content: '',
      db: {
        properties: [
          { id: 'name', name: 'Name', type: 'title' },
          { id: 'pts', name: 'Points', type: 'number' },
          { id: 'dbl', name: 'Double', type: 'formula', formula: 'prop("Points") * 2' },
          { id: 'uid', name: 'Ticket', type: 'unique_id', prefix: 'T' },
          { id: 'rel', name: 'Parent', type: 'relation', relation: { page_id: 'self', block_id: 'db' } },
        ],
        rows: [
          { id: 'r0', values: { name: 'Epic' }, created_at: T, updated_at: T },
          { id: 'r1', values: { name: 'Bug', pts: 4, rel: ['r0'] }, body: [{ id: 'b1', type: 'paragraph', content: 'Pasos' }], created_at: T, updated_at: T },
        ],
        views: [{ id: 'v1', name: '', type: 'table' }],
      },
    },
  ]);
  // La relación apunta a la misma base: el id real de la página.
  const blocks = await content(request, doc.id);
  const db = blocks[0].db as Db;
  db.properties.find((x) => x.id === 'rel')!.relation!.page_id = doc.id;
  await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: blocks } });

  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const table = p.getByTestId('docs-database');
  await expect(table.locator('.docs-db-tr', { hasText: 'Bug' })).toContainText('8');
  await p.locator('.docs-db-title-text', { hasText: 'Bug' }).click();
  const panel = p.getByTestId('docs-db-rowpanel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('docs-db-save-template').click();
  await expect(panel.getByTestId('docs-db-save-template')).toContainText('Saved as template');
  await p.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await p.getByTestId('docs-db-templates').click();
  await p.getByRole('menuitem', { name: 'Bug' }).click();
  await expect(p.getByTestId('docs-db-rowpanel')).toContainText('Pasos');
  await p.keyboard.press('Escape');

  await expect
    .poll(async () => {
      const d = (await content(request, doc.id))[0].db as Db;
      return d.rows.map((r) => [r.values.name, r.values.pts, r.values.uid, (r.values.rel as string[] | undefined)?.join(',') ?? null]);
    }, { timeout: 10_000 })
    .toEqual([
      ['Epic', undefined, 1, null],
      ['Bug', 4, 2, 'r0'],
      ['Bug', 4, 3, 'r0'],
    ]);
  const saved = (await content(request, doc.id))[0].db as Db;
  expect(Object.keys(saved.templates![0].values).sort()).toEqual(['name', 'pts', 'rel']);
  // La fila nueva calcula su fórmula y muestra la relación.
  const rows = table.locator('.docs-db-tr', { hasText: 'Bug' });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('8');
  await expect(rows.nth(1)).toContainText('T-3');
  await expect(rows.nth(1)).toContainText('Epic');
});

test('D1+D2: el menú / tiene los comandos de las dos tandas y /linked abre el selector', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Menu ${uid()}`, [
    { id: 'a', type: 'paragraph', content: '' },
    { id: 'b', type: 'paragraph', content: 'Abajo' },
  ]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-blocks .docs-editable').first().click();
  await p.keyboard.type('/');
  const menu = p.locator('.docs-command-menu');
  await expect(menu).toBeVisible();
  for (const label of ['Database', 'Linked view of database', 'Video', 'Audio', 'PDF', '2 columns', 'Synced block', 'Block equation', 'Table of contents', 'Button', 'Breadcrumb']) {
    await expect(menu.locator('.docs-command-label', { hasText: label }).first()).toBeAttached();
  }
  await p.keyboard.type('linked');
  await expect(menu.locator('.docs-command-item').first()).toContainText('Linked view of database');
  await p.keyboard.press('Enter');
  await expect(p.getByText('Linked view of a database').first()).toBeVisible();

  // Después, columnas desde el mismo menú.
  await p.keyboard.press('Escape');
  await editable(p, 'Abajo').click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.keyboard.type('/2 col');
  await expect(menu).toBeVisible();
  await p.keyboard.press('Enter');
  await expect.poll(async () => (await content(request, doc.id)).map((b) => b.type), { timeout: 10_000 }).toContain('columns');
  expect((await content(request, doc.id)).some((b) => b.type === 'database' && b.linked)).toBeTruthy();
});

test('D1+D2: una base creada adentro de un sincronizado queda debajo y no se pierde al recargar', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Sync base ${uid()}`, [
    { id: crypto.randomUUID(), type: 'synced', content: '', synced_id: crypto.randomUUID() },
    { id: crypto.randomUUID(), type: 'paragraph', content: 'Compartido', indent: 1 },
  ]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await editable(p, 'Compartido').click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.keyboard.type('/database');
  await expect(p.locator('.docs-command-menu')).toBeVisible();
  await p.keyboard.press('Enter');
  await expect(p.getByTestId('docs-database')).toBeVisible();
  // La base no queda adentro del recuadro del sincronizado.
  await expect(p.getByTestId('docs-synced').getByTestId('docs-database')).toHaveCount(0);
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => [b.type, b.indent ?? 0]).filter(([t]) => t !== 'paragraph'), { timeout: 10_000 })
    .toEqual([
      ['synced', 0],
      ['database', 0],
    ]);
  // Escribir en la base y recargar: sigue ahí.
  await p.getByTestId('docs-database').locator('.docs-db-tr').first().locator('[role="gridcell"]').first().click({ position: { x: 150, y: 10 } });
  await p.keyboard.type('Fila real');
  await p.keyboard.press('Enter');
  await expect
    .poll(async () => JSON.stringify((await content(request, doc.id)).find((b) => b.type === 'database')?.db), { timeout: 10_000 })
    .toContain('Fila real');
  await p.reload({ waitUntil: 'networkidle' });
  await expect(p.getByTestId('docs-synced')).toBeVisible();
  await expect(p.getByTestId('docs-database')).toContainText('Fila real');
  await expect(editable(p, 'Compartido')).toBeVisible();
});
