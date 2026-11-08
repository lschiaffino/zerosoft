import { expect, test, type Page } from '@playwright/test';

/**
 * Board para el uso diario de un equipo: plantillas nuevas (flowchart y story
 * map) con conectores que siguen a sus formas, sticky con N y el siguiente con
 * Tab, reacciones, comentarios pegados a un objeto, minimapa, votación con
 * puntos, modo privado entre dos personas y export/import de stickies. DEMO_MODE.
 */

const shot = (file: string) => `${process.env.E2E_SHOTS ?? 'test-results'}/${file}`;

type El = { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; containerId?: string | null; customData?: Record<string, unknown>; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null; points?: number[][]; text?: string };

async function openEditor(page: Page, id: string) {
  await page.goto(`/es/app/board/${id}`);
  await expect(page.locator('.excalidraw')).toBeVisible();
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __boardApi?: unknown }).__boardApi));
}

const elements = (page: Page) =>
  page.evaluate(() => (window as unknown as { __boardApi: { getSceneElements: () => unknown[] } }).__boardApi.getSceneElements() as never) as Promise<El[]>;

/** Punto de la escena → píxel de la página. */
async function toScreen(page: Page, x: number, y: number) {
  return page.evaluate(
    ([sx, sy]) => {
      const api = (window as unknown as { __boardApi: { getAppState: () => Record<string, unknown> } }).__boardApi;
      const s = api.getAppState() as { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number };
      return { x: (sx + s.scrollX) * s.zoom.value + s.offsetLeft, y: (sy + s.scrollY) * s.zoom.value + s.offsetTop };
    },
    [x, y],
  );
}

/** Botón de la barra o, si la barra es angosta, el mismo ítem del menú "Más opciones". */
async function barAction(page: Page, name: string) {
  const btn = page.locator('.board-bar').getByRole('button', { name, exact: true });
  if (await btn.isVisible()) return btn.click();
  await page.getByRole('button', { name: 'Más opciones de la pizarra' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function fromTemplate(page: Page, template: string, name: string) {
  const res = await page.request.post('/api/boards', { data: { name, template, locale: 'es' } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

test('plantillas: flowchart con flechas que siguen a la forma al moverla, y story map desde la galería', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // La galería muestra las plantillas nuevas y crea la pizarra.
  await page.goto('/es/app/board');
  // Con pizarras en la lista la galería arranca plegada: se abre solo si hace falta.
  const storyMap = page.locator('.board-template').filter({ hasText: 'Mapa de historias de usuario' });
  await expect(page.locator('.board-templates-title').first()).toBeVisible();
  if (!(await storyMap.isVisible())) await page.locator('.board-templates-title').first().click();
  await expect(storyMap).toBeVisible();
  await expect(page.locator('.board-template').filter({ hasText: 'Diagrama de flujo' })).toBeVisible();
  await storyMap.click();
  await expect(page).toHaveURL(/\/app\/board\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.locator('.board-canvas')).toHaveAttribute('data-elements', /\d+/);
  await page.screenshot({ path: shot('board-storymap.png') });

  const id = await fromTemplate(page, 'flowchart', 'Flujo');
  await openEditor(page, id);
  const els = await elements(page);
  const labels = els.filter((e) => e.type === 'text' && e.containerId && els.find((a) => a.id === e.containerId)?.type === 'arrow').map((e) => e.text);
  expect(labels.sort()).toEqual(['No', 'Sí']);
  // Mover "Corregir": la flecha que sale de ahí lo sigue.
  const fixText = els.find((e) => e.type === 'text' && e.text === 'Corregir')!;
  const fix = els.find((e) => e.id === fixText.containerId)!;
  const arrow = els.find((e) => e.type === 'arrow' && e.startBinding?.elementId === fix.id)!;
  const before = arrow.x;
  const from = await toScreen(page, fix.x + 20, fix.y + 10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 160, from.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await elements(page)).find((e) => e.id === arrow.id)!.x).toBeGreaterThan(before + 100);
  const moved = (await elements(page)).find((e) => e.id === arrow.id)!;
  expect(moved.startBinding?.elementId).toBe(fix.id);
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
});

test('stickies: N crea uno en el cursor, Tab el siguiente, y se reacciona con emoji', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.request.post('/api/boards', { data: { name: 'Rápido' } });
  const id = ((await res.json()) as { id: string }).id;
  await openEditor(page, id);
  // Sin esperar el foco y a ritmo normal (30 ms por tecla): N, texto, Tab, texto… cinco veces.
  // Ninguna tecla se pierde ni dispara atajos (n, e, a, r) mientras abre cada sticky.
  await page.mouse.move(500, 400);
  const words = ['Primera nueva idea', 'Segunda era rara', 'Tercera nena', 'Cuarta nota', 'Quinta y ultima'];
  await page.keyboard.press('n');
  for (let i = 0; i < words.length; i++) {
    await page.keyboard.type(words[i], { delay: 30 });
    await page.keyboard.press(i < words.length - 1 ? 'Tab' : 'Escape');
  }
  await expect.poll(async () => (await elements(page)).filter((e) => e.customData?.sticky).length, { timeout: 10_000 }).toBe(words.length);
  const stickyTexts = async () => {
    const all = await elements(page);
    return all
      .filter((e) => e.customData?.sticky)
      .sort((a, b) => a.x - b.x)
      .map((s) => all.find((t) => t.containerId === s.id)?.text ?? '');
  };
  await expect.poll(stickyTexts, { timeout: 10_000 }).toEqual(words);
  const stickies = (await elements(page)).filter((e) => e.customData?.sticky).sort((a, b) => a.x - b.x);
  expect(stickies[1].x).toBeGreaterThan(stickies[0].x + stickies[0].width);
  expect(Math.abs(stickies[1].y - stickies[0].y)).toBeLessThan(2);
  expect(stickies[0].customData?.author).toBeTruthy();
  // Ningún atajo de herramienta se disparó: sigue la de selección.
  expect(await page.evaluate(() => (window as unknown as { __boardApi: { getAppState: () => { activeTool: { type: string } } } }).__boardApi.getAppState().activeTool.type)).toBe('selection');

  // Reaccionar a un sticky elegido (el último, que quedó a la vista).
  await page.evaluate((sid) => {
    (window as unknown as { __boardApi: { updateScene: (x: unknown) => void } }).__boardApi.updateScene({ appState: { selectedElementIds: { [sid]: true } } });
  }, stickies[stickies.length - 1].id);
  // El último quedó a la vista (la vista sigue al sticky nuevo).
  await page.getByTestId('board-react').click();
  await page.getByRole('button', { name: '🎉' }).click();
  const badge = page.locator('.board-reaction').filter({ hasText: '🎉' });
  await expect(badge).toContainText('1');
  await expect(badge).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.board-reaction').filter({ hasText: '🎉' })).toContainText('1', { timeout: 15_000 });
  await page.screenshot({ path: shot('board-reactions.png') });
});

test('comentario pegado a un sticky: el pin lo sigue cuando se mueve; minimapa', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await fromTemplate(page, 'retro', 'Retro con comentario');
  await openEditor(page, id);
  const els = await elements(page);
  const note = els.find((e) => e.type === 'rectangle' && e.width === 140)!;
  const at = await toScreen(page, note.x + 30, note.y + 30);
  await barAction(page, 'Comentar');
  await page.mouse.click(at.x, at.y);
  await page.getByRole('combobox', { name: 'Comentario nuevo' }).fill('¿Esto es de este sprint?');
  await page.locator('.board-thread').getByRole('button', { name: 'Comentar', exact: true }).click();
  const pin = page.locator('.board-pin.is-attached');
  await expect(pin).toHaveCount(1);
  await page.keyboard.press('Escape');
  const before = await pin.boundingBox();
  // Mover el sticky (como lo haría otra persona en vivo): el pin va con él.
  await page.evaluate((nid) => {
    const api = (window as unknown as { __boardApi: { getSceneElementsIncludingDeleted: () => Array<Record<string, unknown>>; updateScene: (s: unknown) => void } }).__boardApi;
    const els = api.getSceneElementsIncludingDeleted().map((e) =>
      e.id === nid || e.containerId === nid ? { ...e, x: (e.x as number) + 120, version: (e.version as number) + 1, versionNonce: 99 } : e,
    );
    api.updateScene({ elements: els });
  }, note.id);
  await expect.poll(async () => ((await pin.boundingBox())?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(40);

  // Minimapa: clic lleva la vista.
  const map = page.getByTestId('board-minimap');
  if (!(await map.isVisible())) await page.getByTestId('board-tool-minimap').click();
  await expect(map).toBeVisible();
  const scrollBefore = await page.evaluate(() => (window as unknown as { __boardApi: { getAppState: () => { scrollX: number } } }).__boardApi.getAppState().scrollX);
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __boardApi: { getAppState: () => { scrollX: number } } }).__boardApi.getAppState().scrollX))
    .not.toBe(scrollBefore);
  await page.keyboard.press('m');
  await expect(map).toHaveCount(0);
});

test('taller: votación con puntos, modo privado (en vivo en otra pestaña) y CSV de stickies ida y vuelta', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.request.post('/api/boards', { data: { name: 'Taller' } });
  const id = ((await res.json()) as { id: string }).id;
  await openEditor(page, id);
  // Dos stickies desde una lista pegada.
  await page.getByRole('button', { name: 'Stickies', exact: true }).click();
  await page.locator('#board-sticky-bulk').fill('Onboarding más corto #ux\nArreglar el export');
  await page.getByRole('button', { name: 'Agregar 2 stickies' }).click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.customData?.sticky).length).toBe(2);
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });

  // Votación: 2 votos cada uno, se cierra y se ven los totales.
  await barAction(page, 'Taller');
  await page.locator('.board-workshop-pop').getByRole('spinbutton').last().fill('2');
  await page.getByRole('button', { name: 'Abrir votación' }).click();
  await page.keyboard.press('Escape');
  const plus = page.locator('.board-vote-btn').filter({ hasText: '+' });
  await expect(plus).toHaveCount(2);
  await plus.first().click();
  await expect(page.locator('.board-vote-btn.is-mine')).toHaveCount(1);
  await page.locator('.board-vote-btn.is-mine').click();
  await expect(page.locator('.board-vote-btn.is-mine')).toHaveText('2');
  await barAction(page, 'Taller');
  await page.getByRole('button', { name: 'Cerrar y ver resultados' }).click();
  await expect(page.locator('.board-results-count').first()).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-vote-total.is-top')).toHaveText('2');

  // Modo privado: lo que ya estaba en la pizarra se sigue viendo (no se tapa); la otra
  // pestaña ve prenderse y apagarse el modo al instante (evento en vivo).
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await ctxB.newPage();
  await openEditor(b, id);
  await page.evaluate(() => {
    const api = (window as unknown as { __boardApi: { getSceneElementsIncludingDeleted: () => Array<Record<string, unknown>>; updateScene: (s: unknown) => void } }).__boardApi;
    const els = api.getSceneElementsIncludingDeleted();
    const mine = els.find((e) => (e.customData as { sticky?: boolean } | undefined)?.sticky)!;
    const other = { ...mine, id: 'ajeno', x: (mine.x as number) + 600, version: 1, versionNonce: 5, boundElements: null, customData: { sticky: true, author: 'otra-persona' } };
    api.updateScene({ elements: [...els, other] });
  });
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
  await barAction(page, 'Taller');
  await page.getByTestId('board-private-toggle').click();
  await expect(page.getByTestId('board-private-chip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-private-cover')).toHaveCount(0);
  await expect(b.getByTestId('board-private-chip')).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: shot('board-private.png') });
  await barAction(page, 'Taller');
  await page.getByTestId('board-private-toggle').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-private-cover')).toHaveCount(0);
  await expect(b.getByTestId('board-private-chip')).toHaveCount(0, { timeout: 5_000 });
  await ctxB.close();

  // CSV: exportar y volver a importar suma los mismos stickies.
  await page.getByRole('button', { name: 'Stickies', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('board-stickies-csv').click();
  const file = await download;
  const { readFileSync } = await import('node:fs');
  const csv = readFileSync((await file.path())!, 'utf8');
  expect(csv).toContain('Onboarding más corto');
  const count = (await elements(page)).filter((e) => e.customData?.sticky).length;
  await page.getByTestId('board-stickies-import-input').setInputFiles({ name: 'miro.csv', mimeType: 'text/csv', buffer: Buffer.from('"Idea desde Miro"\n"Otra idea"\n') });
  await expect.poll(async () => (await elements(page)).filter((e) => e.customData?.sticky).length).toBe(count + 2);
});

test('exportar el tablero a PNG y SVG desde el menú', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Sin el selector de archivos de Chromium, Excalidraw baja el archivo como descarga común.
  await page.addInitScript(() => {
    for (const key of ['showOpenFilePicker', 'showSaveFilePicker']) {
      delete (window as unknown as Record<string, unknown>)[key];
      delete (Window.prototype as unknown as Record<string, unknown>)[key];
    }
  });
  const id = await fromTemplate(page, 'retro', 'Para exportar');
  await openEditor(page, id);
  for (const kind of ['PNG', 'SVG'] as const) {
    await page.locator('.main-menu-trigger').click();
    await page.getByText('Exportar imagen...').click();
    const dialog = page.locator('.ImageExportModal');
    await expect(dialog).toBeVisible();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: `Exportar a ${kind}` }).click();
    const file = await download;
    expect(file.suggestedFilename().toLowerCase()).toMatch(kind === 'PNG' ? /\.png$/ : /\.svg$/);
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: shot('board-export.png') });
});

test('390 px táctil: se ve y se edita sin scroll horizontal', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const id = await fromTemplate(page, 'kanban', 'Kanban 390');
  await openEditor(page, id);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: shot('board-390.png') });
  await ctx.close();
});

test('oscuro: los stickies conservan su color claro con letra oscura; el resto del lienzo es oscuro', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const id = await fromTemplate(page, 'retro', 'Retro oscura');
  await openEditor(page, id);
  const note = (await elements(page)).find((e) => e.type === 'rectangle' && e.width === 140)!;
  // Arriba al centro: adentro del borde redondeado y lejos del texto.
  const at = await toScreen(page, note.x + note.width / 2, note.y + 12);
  const bg = await toScreen(page, note.x - 400, note.y - 300);
  // Pixel del canvas de la escena (sin filtro CSS): el sticky es el verde claro de la paleta y el fondo es oscuro.
  const px = await page.evaluate(
    ([p, q]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.excalidraw__canvas-wrapper canvas')!;
      const r = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d')!;
      const scale = canvas.width / r.width;
      const read = (pt: { x: number; y: number }) => [...ctx.getImageData(Math.round((pt.x - r.left) * scale), Math.round((pt.y - r.top) * scale), 1, 1).data].slice(0, 3);
      return { sticky: read(p), bg: read(q), filter: getComputedStyle(canvas).filter };
    },
    [at, bg],
  );
  expect(px.filter).toBe('none');
  expect(px.sticky[0] + px.sticky[1] + px.sticky[2]).toBeGreaterThan(600);
  expect(px.bg[0] + px.bg[1] + px.bg[2]).toBeLessThan(120);
  // La letra de las notas usa la tinta de stickies (queda oscura en oscuro).
  await expect
    .poll(async () => (await elements(page)).filter((e) => e.type === 'text' && e.containerId === note.id).map((e) => (e as unknown as { strokeColor: string }).strokeColor))
    .toEqual(['#1e1e1f']);
  await page.screenshot({ path: shot('board-dark-stickies.png') });
  await page.emulateMedia({ colorScheme: 'light' });
});

test('tablas: sumar y sacar filas y columnas; archivo adjunto como tarjeta', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.request.post('/api/boards', { data: { name: 'Tabla y archivo' } });
  const id = ((await res.json()) as { id: string }).id;
  await openEditor(page, id);
  await page.getByTestId('board-tool-table').click();
  const cells = async () => (await elements(page)).filter((e) => e.type === 'rectangle' && (e.customData as { table?: string } | undefined)?.table);
  await expect.poll(async () => (await cells()).length).toBe(12);
  const bar = page.getByTestId('board-table-bar');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Sumar una fila abajo' }).click();
  await expect.poll(async () => (await cells()).length).toBe(15);
  await bar.getByRole('button', { name: 'Sumar una columna a la derecha' }).click();
  await expect.poll(async () => (await cells()).length).toBe(20);
  await bar.getByRole('button', { name: 'Sacar la última fila' }).click();
  await expect.poll(async () => (await cells()).length).toBe(16);
  await bar.getByRole('button', { name: 'Sacar la última columna' }).click();
  await expect.poll(async () => (await cells()).length).toBe(12);
  // Sin huecos ni superposiciones: 4 filas por 3 columnas.
  const rows = new Set((await cells()).map((c) => (c.customData as { row: number }).row));
  const cols = new Set((await cells()).map((c) => (c.customData as { col: number }).col));
  expect([rows.size, cols.size]).toEqual([4, 3]);
  await page.keyboard.press('Escape');

  // Un PDF como tarjeta con su nombre; el link lo baja con su nombre.
  await page.getByTestId('board-file-input').setInputFiles({ name: 'Propuesta Q1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% prueba\n') });
  await expect.poll(async () => (await elements(page)).find((e) => (e.customData as { file?: unknown } | undefined)?.file)?.id ?? null).not.toBeNull();
  const card = (await elements(page)).find((e) => (e.customData as { file?: unknown } | undefined)?.file)! as unknown as { link: string };
  expect(card.link).toMatch(/^\/api\/boards\/[0-9a-f-]+\/files\/att_[0-9a-f]+$/);
  const texts = (await elements(page)).filter((e) => e.type === 'text').map((e) => e.text ?? '');
  expect(texts.some((tx) => tx.includes('Propuesta Q1.pdf') && tx.includes('PDF'))).toBe(true);
  const file = await page.request.get(card.link);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-disposition']).toContain('attachment');
  expect(file.headers()['content-disposition']).toContain('Propuesta%20Q1.pdf');
  // Un tipo no permitido se rechaza con un aviso.
  await page.getByTestId('board-file-input').setInputFiles({ name: 'script.html', mimeType: 'text/html', buffer: Buffer.from('<b>x</b>') });
  await expect(page.locator('.ui-toast')).toContainText('no puede ir a la pizarra');
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
  await page.screenshot({ path: shot('board-table-file.png') });
});

test('invitado del link de edición: escribe stickies rápido sin perder teclas', async ({ page, browser }) => {
  const res = await page.request.post('/api/boards', { data: { name: 'Invitado escribe' } });
  const id = ((await res.json()) as { id: string }).id;
  const access = await page.request.patch(`/api/boards/${id}/access`, { data: { guest: true } });
  const token = ((await access.json()) as { guest_token: string }).guest_token;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await ctx.newPage();
  await g.goto(`/es/b/e/${token}`);
  await expect(g.locator('.excalidraw')).toBeVisible();
  await g.waitForFunction(() => Boolean((window as unknown as { __boardApi?: unknown }).__boardApi));
  await g.mouse.move(400, 400);
  await g.keyboard.press('n');
  await g.keyboard.type('Nota del invitado', { delay: 30 });
  await g.keyboard.press('Tab');
  await g.keyboard.type('Otra nota rapida', { delay: 30 });
  await g.keyboard.press('Escape');
  await expect
    .poll(async () => {
      const all = await elements(g);
      return all
        .filter((e) => e.customData?.sticky)
        .sort((a, b) => a.x - b.x)
        .map((s) => all.find((t) => t.containerId === s.id)?.text ?? '');
    }, { timeout: 10_000 })
    .toEqual(['Nota del invitado', 'Otra nota rapida']);
  await ctx.close();
});

test('modo privado: las notas de plantilla se ven, lo que escribe el invitado se tapa hasta revelar', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await fromTemplate(page, 'retro', 'Retro privada');
  const res = await page.request.patch(`/api/boards/${id}/access`, { data: { guest: true } });
  const token = ((await res.json()) as { guest_token: string }).guest_token;
  await openEditor(page, id);
  const notes = (await elements(page)).filter((e) => e.type === 'rectangle' && e.width === 140).length;
  expect(notes).toBe(5);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await ctx.newPage();
  await g.goto(`/es/b/e/${token}`);
  await expect(g.locator('.excalidraw')).toBeVisible();
  await barAction(page, 'Taller');
  await page.getByTestId('board-private-toggle').click();
  await page.keyboard.press('Escape');
  // Las notas de ejemplo de la plantilla no son de nadie: se siguen viendo, para quien la creó y para el invitado.
  await expect(g.getByTestId('board-private-chip')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-private-cover')).toHaveCount(0);
  await expect(g.getByTestId('board-private-cover')).toHaveCount(0);

  // El invitado escribe en privado: a la persona le llega solo una tarjeta tapada, sin el texto
  // (ni en su escena, ni en la escena guardada, ni en la búsqueda).
  await g.waitForFunction(() => Boolean((window as unknown as { __boardApi?: unknown }).__boardApi));
  await g.mouse.move(300, 650);
  await g.keyboard.press('n');
  await g.keyboard.type('secreto del invitado', { delay: 30 });
  await g.keyboard.press('Escape');
  await expect(page.getByTestId('board-private-cover')).toHaveCount(1, { timeout: 15_000 });
  await g.screenshot({ path: shot('board-private-guest.png') });
  const textsA = async () => (await elements(page)).filter((e) => e.type === 'text').map((e) => e.text ?? '');
  expect((await textsA()).some((tx) => tx.includes('secreto'))).toBe(false);
  const saved = await (await page.request.get(`/api/boards/${id}`)).text();
  expect(saved).not.toContain('secreto del invitado');
  const search = await (await page.request.get(`/api/boards?q=${encodeURIComponent('secreto')}`)).text();
  expect(search).not.toContain('Retro privada');

  // Al revelar, entra a la pizarra y todos lo ven.
  await barAction(page, 'Taller');
  await page.getByTestId('board-private-toggle').click();
  await page.keyboard.press('Escape');
  await expect(g.getByTestId('board-private-cover')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await textsA()).some((tx) => tx.includes('secreto del invitado')), { timeout: 15_000 }).toBe(true);
  await ctx.close();
});

test('invitado del link de edición: vota con puntos y su voto cuenta en los resultados', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await fromTemplate(page, 'retro', 'Retro con invitado que vota');
  const access = await page.request.patch(`/api/boards/${id}/access`, { data: { guest: true } });
  const token = ((await access.json()) as { guest_token: string }).guest_token;
  const open = await page.request.post(`/api/boards/${id}/workshop`, { data: { vote: { action: 'start', votesPerPerson: 2 } } });
  expect(open.ok()).toBe(true);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await ctx.newPage();
  await g.goto(`/es/b/e/${token}`);
  await expect(g.locator('.excalidraw')).toBeVisible();
  const plus = g.locator('.board-vote-btn').filter({ hasText: '+' }).first();
  await expect(plus).toBeVisible({ timeout: 15_000 });
  await plus.click();
  await expect(g.locator('.board-vote-btn.is-mine')).toHaveCount(1);
  await expect(g.locator('.board-vote-btn.is-mine')).toHaveText('1');
  // Cuenta como una persona más y entra en los resultados al cerrar.
  const state = (await (await page.request.get(`/api/boards/${id}/workshop`)).json()) as { voting: { voters: number } };
  expect(state.voting.voters).toBe(1);
  await page.request.post(`/api/boards/${id}/workshop`, { data: { vote: { action: 'close' } } });
  const closed = (await (await page.request.get(`/api/boards/${id}/workshop`)).json()) as { voting: { results: Array<{ count: number }> } };
  expect(closed.voting.results[0].count).toBe(1);
  await ctx.close();
});
