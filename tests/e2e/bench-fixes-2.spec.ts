import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@libsql/client';

/**
 * Regresiones de la segunda pasada del benchmark (docs/benchmark/*.md, "Bugs
 * encontrados"): avisos de Docs en páginas cortas, snippet de tareas en ⌘K,
 * flecha del select en oscuro, barra y menú de Excalidraw, cambios de otros en
 * Board, botón activo de un grupo segmentado y menú por fila de Flow.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const shot = (file: string) => `${process.env.E2E_SHOTS ?? 'test-results'}/${file}`;

async function createDoc(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/docs/pages', { data: { title } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

// ---------- Docs ----------

test('Docs: el aviso de papelera no crece en una página corta', async ({ page, request }) => {
  const id = await createDoc(request, `Corta ${uid()}`);
  expect((await request.patch(`/api/docs/pages/${id}`, { data: { archived: true } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/app/docs/${id}`, { waitUntil: 'networkidle' });
  const banner = page.locator('.docs-banner').first();
  await expect(banner).toBeVisible();
  expect((await banner.boundingBox())!.height).toBeLessThan(80);
});

test('Docs: otra pestaña guarda primero y se fusiona sin aviso de conflicto', async ({ page, request }) => {
  const title = `Conflicto ${uid()}`;
  const id = await createDoc(request, title);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/app/docs/${id}`, { waitUntil: 'networkidle' });
  // Otra pestaña cambia el título y el contenido primero; lo que se escribe acá
  // se fusiona en el servidor contra la versión que vio este editor (el título
  // por tramos: lo de la otra pestaña y lo agregado acá quedan los dos).
  const other = await request.patch(`/api/docs/pages/${id}`, {
    data: { title: 'Desde otra pestaña', content: [{ id: 'b-other', type: 'paragraph', content: 'Desde otra pestaña' }] },
  });
  expect(other.ok()).toBe(true);
  await page.locator('.docs-title').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' editado');
  await expect
    .poll(async () => {
      const p = (await (await request.get(`/api/docs/pages/${id}`)).json()) as { title: string; content: Array<{ content: string }> };
      return [p.title, p.content.map((b) => b.content).join('|')];
    }, { timeout: 15_000 })
    .toEqual(['Desde otra pestaña editado', 'Desde otra pestaña']);
  await expect(page.locator('.docs-editable', { hasText: 'Desde otra pestaña' })).toBeVisible();
  await expect(page.locator('.docs-banner-bad')).toHaveCount(0);
  await page.screenshot({ path: shot('docs-conflict-merged.png') });
});

// ---------- Notes ----------

test('Notes: el snippet de ⌘K muestra las tareas como texto ("milk, eggs")', async ({ page, request }) => {
  const title = `Compras ${uid()}`;
  const res = await request.post('/api/notes', {
    data: {
      title,
      content: [
        { id: 't1', type: 'todo', content: 'milk', checked: false },
        { id: 't2', type: 'todo', content: 'eggs', checked: true },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto('/en/app/notes', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill(title);
  const option = dialog.getByRole('option', { name: new RegExp(title) }).first();
  await expect(option).toBeVisible();
  await expect(option).toContainText('milk, eggs');
  await expect(option).not.toContainText('[ ]');
  await expect(option).not.toContainText('[x]');
});

test('Notes: en oscuro el selector de orden conserva la flecha clara', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.goto('/en/app/notes', { waitUntil: 'networkidle' });
  const sort = page.locator('select.notes-sort');
  await expect(sort).toBeVisible();
  const bg = await sort.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain('ecebe6');
  await page.screenshot({ path: shot('notes-sort-dark.png') });
});

// ---------- Board ----------

async function openTemplateBoard(page: Page): Promise<string> {
  const res = await page.request.post('/api/boards', { data: { name: `Retro ${uid()}`, template: 'retro', locale: 'en' } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/en/app/board/${id}`);
  await expect(page.locator('.App-toolbar')).toBeVisible({ timeout: 30_000 });
  return id;
}

test('Board: la barra de formas va arriba del lienzo y el menú no trae los links de Excalidraw', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openTemplateBoard(page);
  const canvasTop = (await page.locator('.board-canvas').boundingBox())!.y;
  const toolbarTop = (await page.locator('.App-toolbar').boundingBox())!.y;
  expect(toolbarTop - canvasTop).toBeLessThan(40);
  // La ayuda de Excalidraw no queda debajo del botón de feedback.
  const help = await page.locator('.board-canvas .help-icon').boundingBox();
  const feedback = await page.locator('.fl-root .fl-button').boundingBox();
  if (help && feedback) expect(help.x + help.width).toBeLessThanOrEqual(feedback.x);
  await page.screenshot({ path: shot('board-toolbar.png') });

  await page.locator('.main-menu-trigger').click();
  const menu = page.locator('.dropdown-menu-container');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Export image');
  await expect(menu).toContainText('Canvas background');
  await expect(menu).not.toContainText('GitHub');
  await expect(menu).not.toContainText('Discord');
  await expect(menu).not.toContainText('Excalidraw links');
  await page.screenshot({ path: shot('board-main-menu.png') });
});

test('Board: los cambios de otra pestaña llegan solos y no rebotan versiones', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await openTemplateBoard(page);
  await expect(page.locator('.board-status')).toHaveText('Saved');
  const conflicts: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith(`/api/boards/${id}/scene`) && r.request().method() === 'PUT' && r.status() === 409) conflicts.push(409);
  });

  // "Otra persona" guarda una versión sin el título de la plantilla.
  const board = (await (await page.request.get(`/api/boards/${id}`)).json()) as {
    version: number;
    scene: { elements: Array<{ id: string; type: string }>; appState: Record<string, unknown>; files: Record<string, unknown> };
  };
  const removed = board.scene.elements.find((e) => e.type === 'text')!;
  const put = await page.request.put(`/api/boards/${id}/scene`, {
    data: { version: board.version, scene: { ...board.scene, elements: board.scene.elements.filter((e) => e.id !== removed.id) } },
  });
  expect(put.ok()).toBe(true);
  const remoteVersion = ((await put.json()) as { version: number }).version;

  // El sondeo (cada 12 s) la aplica sola y lo dice en el estado.
  await expect(page.locator('.board-status')).toHaveText('Updated with changes from Demo User', { timeout: 30_000 });
  await page.screenshot({ path: shot('board-remote-applied.png') });

  // Aplicar no cuenta como edición: no se vuelve a guardar.
  await page.waitForTimeout(4000);
  const after = (await (await page.request.get(`/api/boards/${id}/version`)).json()) as { version: number };
  expect(after.version).toBe(remoteVersion);

  // Lo próximo que se dibuja entra sin 409: el editor ya está en la versión nueva.
  await page.getByRole('button', { name: 'Stickies' }).click();
  await page.getByRole('button', { name: 'Add a sticky' }).click();
  await expect(page.locator('.board-status')).toHaveText('Saved', { timeout: 15_000 });
  expect(conflicts).toEqual([]);
  const saved = (await (await page.request.get(`/api/boards/${id}`)).json()) as { version: number; scene: { elements: Array<{ id: string }> } };
  expect(saved.version).toBe(remoteVersion + 1);
  expect(saved.scene.elements.some((e) => e.id === removed.id)).toBe(false);
});

// ---------- Robots ----------

test('Robots: el botón activo "Table" se lee (también al pasar el mouse)', async ({ page }) => {
  await page.goto('/en/app/robots', { waitUntil: 'networkidle' });
  const res = await page.request.post('/api/robots', { data: { name: `Tabla ${uid()}`, template: 'priceCheck' } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, output, logs, created_at, started_at, finished_at, duration_ms)
          VALUES (?, ?, 'demo', 'success', 'manual', ?, '[]', ?, ?, ?, 1200)`,
    args: [crypto.randomUUID(), id, JSON.stringify({ items: [{ title: 'Uno', price: '10' }, { title: 'Dos', price: '20' }] }), now, now, now],
  });
  db.close();

  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  const runItem = page.locator('.robots-run-item').first();
  if ((await page.locator('.robots-run-detail table').count()) === 0) await runItem.click();
  const table = page.getByRole('button', { name: 'Table', pressed: true });
  await expect(table).toBeVisible();
  const read = () =>
    table.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    });
  const idle = await read();
  expect(idle.color).not.toBe(idle.bg);
  await table.hover();
  await page.waitForTimeout(300);
  const hovered = await read();
  // Al pasar sigue siendo la placa de tinta con texto claro (antes: texto blanco sobre gris claro).
  expect(hovered.bg).toBe(idle.bg);
  expect(hovered.color).toBe(idle.color);
  await page.screenshot({ path: shot('robots-table-pressed-hover.png') });
});

// ---------- Flow ----------

async function createFlow(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/flow/flows', { data: { name } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

test('Flow: menú "…" por fila para renombrar, duplicar y eliminar', async ({ page, request }) => {
  const name = `Flow ${uid()}`;
  await createFlow(request, name);
  await page.goto('/en/app/flow', { waitUntil: 'networkidle' });

  // Renombrar en un modal (Enter guarda).
  await page.getByRole('button', { name: `Flow actions: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const renamed = `${name} renombrado`;
  const input = page.getByLabel('Name', { exact: true });
  await expect(input).toBeFocused();
  await input.fill(renamed);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible();

  // Duplicar: aparece la copia sin recargar.
  await page.getByRole('button', { name: `Flow actions: ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByRole('link', { name: `${renamed} (copy)`, exact: true })).toBeVisible();

  // Eliminar con el diálogo de la app (sin confirm() del navegador).
  page.on('dialog', () => {
    throw new Error('native dialog');
  });
  await page.getByRole('button', { name: `Flow actions: ${renamed} (copy)` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: shot('flow-row-delete.png') });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('link', { name: `${renamed} (copy)`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible();
});

test('Flow: "Delete flow" del editor usa el diálogo de la app', async ({ page, request }) => {
  const id = await createFlow(request, `Borrar ${uid()}`);
  let native = false;
  page.on('dialog', async (d) => {
    native = true;
    await d.dismiss();
  });
  await page.goto(`/en/app/flow/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Delete flow' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  // Esc cancela.
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await page.getByRole('button', { name: 'Delete flow' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/en\/app\/flow$/);
  expect(native).toBe(false);
});
