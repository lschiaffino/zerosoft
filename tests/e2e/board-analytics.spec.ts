import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Board con el kit (el formato de Lines): pizarras creadas,
 * ediciones, colaboradores y comentarios de lo sembrado en una carpeta
 * propia, el cambio de período, el vacío y 390 px sin scroll horizontal. Las
 * pizarras y la carpeta se crean por la API; las marcas de edición y los
 * comentarios se siembran en la base.
 */

ownWorkspace('board-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const DAY = 86_400_000;
const hour = (ago: number) => new Date(Date.now() - ago).toISOString().slice(0, 13);
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let folder = '';

async function seed(page: Page) {
  if (folder) return;
  const f = await page.request.post('/api/boards/folders', { data: { name: `Analítica ${uid()}` } });
  expect(f.ok(), await f.text()).toBe(true);
  const folderId = ((await f.json()) as { id: string }).id;
  const create = async (name: string) => {
    const res = await page.request.post('/api/boards', { data: { name } });
    expect(res.ok(), await res.text()).toBe(true);
    const id = ((await res.json()) as { id: string }).id;
    await sql('UPDATE boards SET folder_id = ? WHERE id = ?', [folderId, id]);
    return id;
  };
  const a = await create(`Retro ${uid()}`);
  const b = await create(`Mapa ${uid()}`);
  const [row] = await sql('SELECT workspace_id FROM boards WHERE id = ?', [a]);
  const ws = String(row.workspace_id);
  await sql('UPDATE boards SET created_at = ? WHERE id = ?', [new Date(Date.now() - 20 * DAY).toISOString(), b]);
  for (const [id, ago] of [
    [a, DAY],
    [a, 2 * DAY],
    [b, 20 * DAY],
  ] as const) {
    await sql('INSERT INTO board_edit_marks (workspace_id, board_id, person_id, hour, saves) VALUES (?, ?, ?, ?, 1)', [ws, id, ws, hour(ago)]);
  }
  const thread = crypto.randomUUID();
  const at = new Date(Date.now() - DAY).toISOString();
  await sql('INSERT INTO board_comment_threads (id, board_id, workspace_id, x, y, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)', [thread, a, ws, ws, at, at]);
  await sql('INSERT INTO board_comments (id, thread_id, board_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), thread, a, ws, 'x', at, at]);
  folder = folderId;
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

test('Board: analítica con el kit, carpeta, período y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed(page);

  await page.goto('/en/app/board', { waitUntil: 'networkidle' });
  // El sidebar lleva a la analítica.
  await expect(page.locator('a[href$="/app/board/analytics"]').first()).toBeAttached();
  await page.goto('/en/app/board/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByRole('img', { name: /^Edits, new boards and comments per day/ })).toBeVisible();

  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Folder').selectOption(folder);
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/folder=/);
  expect(await kpi(page, 'Boards created')).toBe(2);
  expect(await kpi(page, 'Edits')).toBe(3);
  expect(await kpi(page, 'Boards edited')).toBe(2);
  expect(await kpi(page, 'Collaborators')).toBe(1);
  expect(await kpi(page, 'Comments')).toBe(1);
  await expect(page.getByRole('region', { name: 'When boards get edited' }).getByRole('img')).toBeVisible();
  await expect(page.getByRole('region', { name: 'By board' }).getByRole('row')).toHaveCount(3);

  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/days=7/);
  expect(await kpi(page, 'Boards created')).toBe(1);
  expect(await kpi(page, 'Edits')).toBe(2);

  await page.goto(`/en/app/board/analytics?from=2001-01-01&to=2001-01-31&folder=${folder}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/board/analytics?folder=${folder}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
