import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Board, tanda de paridad con Excalidraw+ y Miro: dos navegadores en la misma
 * pizarra (cursores, cambios en vivo, seguir y traer a todos), presentar
 * frames y exportarlos a PDF, IA con el modelo falso (y apagada), carpetas,
 * búsqueda por contenido, papelera e importar .excalidraw. DEMO_MODE.
 */

const shot = (file: string) => `${process.env.E2E_SHOTS ?? 'test-results'}/${file}`;

async function newBoard(page: Page, name: string, elements: unknown[] = []): Promise<string> {
  const res = await page.request.post('/api/boards', { data: { name } });
  expect(res.ok()).toBe(true);
  const id = ((await res.json()) as { id: string }).id;
  if (elements.length) {
    const put = await page.request.put(`/api/boards/${id}/scene`, { data: { version: 1, scene: { elements, appState: {}, files: {} } } });
    expect(put.ok()).toBe(true);
  }
  return id;
}

const frame = (id: string, x: number, name: string) => ({ id, type: 'frame', name, x, y: 0, width: 400, height: 300, angle: 0, version: 1, versionNonce: 1, isDeleted: false, strokeColor: '#bbb', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, boundElements: null, updated: 1, link: null, locked: false });
const rect = (id: string, x: number, y: number, frameId: string | null = null) => ({ ...frame(id, x, ''), type: 'rectangle', y, width: 120, height: 80, frameId, name: undefined, backgroundColor: '#a5d8ff' });

async function openEditor(page: Page, id: string) {
  await page.goto(`/es/app/board/${id}`);
  await expect(page.locator('.excalidraw')).toBeVisible();
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
}

async function twoEditors(browser: Browser, page: Page, id: string) {
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await ctxB.newPage();
  await openEditor(page, id);
  await openEditor(b, id);
  return { b, close: () => ctxB.close() };
}

test('tiempo real: el otro ve el cursor y el trazo sin recargar, se lo sigue y trae a todos', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newBoard(page, 'En vivo', [rect('r0', 0, 0)]);
  const { b, close } = await twoEditors(browser, page, id);
  // Se ven (la misma persona demo en dos navegadores: el avatar del otro aparece).
  await page.mouse.move(640, 420);
  await page.mouse.move(660, 430);
  await expect(b.getByTestId('board-presence').locator('.board-avatar')).toHaveCount(1, { timeout: 10_000 });
  await expect(b.locator('.UserList')).toBeAttached();
  await expect(b.locator('.board-canvas')).toHaveAttribute('data-elements', '1');

  // A dibuja un rectángulo: B lo tiene antes de que A guarde (el guardado espera 1,2 s).
  const started = Date.now();
  await page.locator('label[title^="Rectángulo"]').click();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(620, 380, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.board-canvas')).toHaveAttribute('data-elements', '2');
  await expect(b.locator('.board-canvas')).toHaveAttribute('data-elements', '2', { timeout: 5_000 });
  const ms = Date.now() - started;
  test.info().annotations.push({ type: 'live-latency-ms', description: String(ms) });
  // B no lo guarda como propio y queda "Guardado" con la versión de A.
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
  await expect(b.locator('.board-status')).toHaveText(/Guardado|Actualizada/, { timeout: 15_000 });
  await b.screenshot({ path: shot('board-live-b.png') });

  // Seguir a la otra persona desde la lista de presentes.
  await b.getByTestId('board-presence').click();
  const pop = b.getByRole('dialog', { name: 'En esta pizarra' });
  await pop.getByRole('button', { name: 'Seguir' }).click();
  await expect(b.locator('.board-follow-notice')).toContainText('Siguiendo a');
  await b.locator('.board-follow-notice').getByRole('button', { name: 'Dejar de seguir' }).click();
  await expect(b.locator('.board-follow-notice')).toHaveCount(0);

  // Traer a todos: A llama, B pasa a seguirla.
  await page.getByTestId('board-presence').click();
  await page.getByRole('button', { name: 'Traer a todos a mi vista' }).click();
  await expect(page.getByText('Ahora todos siguen tu vista.')).toBeVisible();
  await expect(b.locator('.board-follow-notice')).toContainText('Siguiendo a', { timeout: 5_000 });
  await b.keyboard.press('Escape');
  await expect(b.locator('.board-follow-notice')).toHaveCount(0);
  await close();
});

test('invitado del link de edición: se ven en vivo y el invitado aparece como "Invitado"', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newBoard(page, 'Con invitado');
  const res = await page.request.patch(`/api/boards/${id}/access`, { data: { guest: true } });
  const token = ((await res.json()) as { guest_token: string }).guest_token;
  await openEditor(page, id);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await ctx.newPage();
  await g.goto(`/es/b/e/${token}`);
  await expect(g.locator('.excalidraw')).toBeVisible();
  await g.mouse.move(600, 400);
  await g.mouse.move(610, 410);
  await page.getByTestId('board-presence').click();
  await expect(page.getByRole('dialog', { name: 'En esta pizarra' }).getByText('Invitado')).toBeVisible({ timeout: 10_000 });
  // Al apagar el link, el invitado pierde la conexión en vivo.
  await page.request.patch(`/api/boards/${id}/access`, { data: { guest: false } });
  await expect(g.getByText('Ya no tenés acceso a esta pizarra')).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

test('presentar frames con el teclado y exportarlos a PDF', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const id = await newBoard(page, 'Deck', [frame('f2', 600, 'Dos'), frame('f1', 0, 'Uno'), rect('a', 40, 40, 'f1'), rect('b', 640, 40, 'f2')]);
  await openEditor(page, id);
  await page.getByTestId('board-present').click();
  const bar = page.locator('.board-present-bar');
  await expect(bar).toContainText('1 / 2');
  await expect(bar).toContainText('Uno');
  await expect(page.locator('.board-bar')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(bar).toContainText('2 / 2');
  await expect(bar).toContainText('Dos');
  await page.keyboard.press('ArrowRight');
  await expect(bar).toContainText('2 / 2');
  await page.keyboard.press('Home');
  await expect(bar).toContainText('1 / 2');
  await page.screenshot({ path: shot('board-present.png') });
  const download = page.waitForEvent('download');
  await bar.getByRole('button', { name: 'Exportar frames a PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Deck.pdf');
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  expect(bytes.toString('latin1')).toContain('/Count 2');
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-present')).toHaveCount(0);
  await expect(page.locator('.board-bar')).toBeVisible();
});

test('IA: agrupar stickies por tema (modelo falso) y error claro con la IA apagada', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const sticky = (id: string, text: string, x: number) => [
    { ...rect(id, x, 0), width: 200, height: 150, customData: { sticky: true }, boundElements: [{ type: 'text', id: `${id}t` }] },
    { ...rect(`${id}t`, x + 10, 10), type: 'text', text, originalText: text, containerId: id, fontSize: 18, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', lineHeight: 1.25, autoResize: true, width: 150, height: 24 },
  ];
  const id = await newBoard(page, 'Brainstorm IA', [...sticky('s1', 'Precio alto', 0), ...sticky('s2', 'Precio confuso', 260), ...sticky('s3', 'App lenta', 520)]);
  // Texto a diagrama por la ruta (el diálogo de Excalidraw la usa igual).
  const diagram = await page.request.post(`/api/boards/${id}/ai`, { data: { kind: 'diagram', prompt: 'registro, verificar email, tablero' } });
  expect(diagram.ok()).toBe(true);
  expect(((await diagram.json()) as { mermaid: string }).mermaid).toMatch(/^flowchart/);

  await openEditor(page, id);
  await page.locator('.main-menu-trigger, [data-testid="main-menu-trigger"]').first().click();
  await page.getByTestId('board-menu-cluster').click();
  await expect(page.locator('.ui-toast')).toContainText('Stickies agrupados en 2 temas', { timeout: 15_000 });
  await expect(page.locator('.board-canvas')).toHaveAttribute('data-elements', /^(9|1\d)$/);

  await context.addCookies([{ name: 'board_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
  await page.locator('.main-menu-trigger, [data-testid="main-menu-trigger"]').first().click();
  await page.getByTestId('board-menu-cluster').click();
  await expect(page.locator('.ui-toast')).toContainText('La IA no está configurada');
});

test('lista: carpetas, mover, buscar adentro, papelera e importar .excalidraw, a 390 px sin scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const word = `kiwi${Date.now()}`;
  const id = await newBoard(page, 'Para buscar', [{ ...rect('t', 0, 0), type: 'text', text: `Idea ${word}`, originalText: `Idea ${word}`, fontSize: 20, fontFamily: 5, lineHeight: 1.25, containerId: null }]);
  await page.goto('/es/app/board');
  // Carpeta nueva desde la lista (Enter confirma).
  const folder = `Carpeta ${Date.now()}`;
  await page.getByTestId('board-new-folder').click();
  await page.getByTestId('board-folder-name').fill(folder);
  await page.keyboard.press('Enter');
  await expect(page.locator('.board-folder-tab[aria-current="page"]')).toContainText(folder);
  await expect(page.getByText('Esta carpeta está vacía')).toBeVisible();
  await expect(page).toHaveURL(/folder=/);
  // Aparece en el sidebar.
  await expect(page.locator('.board-branch').getByText(folder)).toBeVisible();
  // Mover una pizarra a la carpeta.
  await page.getByRole('button', { name: 'Todas' }).click();
  await page.getByRole('button', { name: 'Acciones de la pizarra: Para buscar' }).click();
  await page.getByRole('menuitem', { name: 'Mover a carpeta' }).click();
  await page.getByTestId('board-move-select').selectOption({ label: folder });
  await page.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(page.locator('.ui-toast')).toContainText(`pasó a ${folder}`);
  await page.locator('.board-folder-tab').filter({ hasText: folder }).click();
  await expect(page.locator('.board-card').filter({ hasText: 'Para buscar' })).toBeVisible();

  // Buscar por el texto de adentro: la tarjeta muestra la línea.
  await page.getByTestId('board-search').fill(word);
  const hit = page.locator('.board-card').filter({ hasText: 'Para buscar' });
  await expect(hit.locator('.board-card-match')).toHaveText(`Idea ${word}`);
  // Cmd+K también lo encuentra por el contenido.
  await page.getByTestId('board-search').fill('');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type(word);
  await expect(page.getByRole('option', { name: /Para buscar/ }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Importar un .excalidraw: abre la pizarra nueva.
  const file = { type: 'excalidraw', version: 2, elements: [rect('imp', 0, 0)], appState: { viewBackgroundColor: '#ffffff' }, files: {} };
  await page.getByTestId('board-import-input').setInputFiles({ name: 'Viejo flujo.excalidraw', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page).toHaveURL(/\/app\/board\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.locator('input.board-name')).toHaveValue('Viejo flujo');

  // Papelera a 390 px y en oscuro: sin scroll horizontal.
  await page.request.delete(`/api/boards/${id}`);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/es/app/board?view=trash');
  await expect(page.locator('.board-trash-item').filter({ hasText: 'Para buscar' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: shot('board-trash-390-dark.png'), fullPage: true });
  await page.locator('.board-trash-item').filter({ hasText: 'Para buscar' }).getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.locator('.ui-toast')).toContainText('volvió a tus pizarras');
  await page.emulateMedia({ colorScheme: 'light' });
});

test('editor a 390 px táctil: presencia y presentar sin scroll horizontal', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const id = await newBoard(page, 'Móvil', [frame('f1', 0, 'Uno')]);
  await openEditor(page, id);
  // Sola en el teléfono, la presencia no ocupa lugar en la barra (el nombre entra entero).
  await expect(page.getByTestId('board-presence')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Más opciones de la pizarra' }).tap();
  await page.getByRole('menuitem', { name: 'Presentar' }).tap();
  await expect(page.locator('.board-present-bar')).toContainText('1 / 1');
  await page.screenshot({ path: shot('board-present-390.png') });
  await page.getByRole('button', { name: 'Salir' }).tap();
  await expect(page.locator('.board-present')).toHaveCount(0);
  await ctx.close();
});
