import { expect, test, type Page } from '@playwright/test';

/**
 * Board: barra del editor (título y estado legibles con las herramientas
 * plegadas en "…"), stickies pegados en un hueco libre, panel de propiedades
 * sobre la barra de zoom, miniatura al día, lista con las pizarras primero,
 * borrar con el modal de la app, acceso sin compañeros y el botón de
 * feedback lejos de los toasts. Corre en DEMO_MODE con una base nueva.
 */

/** Capturas para revisar a ojo (E2E_SHOTS=<carpeta> las deja fuera de test-results, que se borra). */
const shot = (file: string) => `${process.env.E2E_SHOTS ?? 'test-results'}/${file}`;

async function newBoard(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/boards', { data: { name } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

/** El texto entra entero en su caja (sin "Piz…"). */
async function fullyVisible(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  const { scroll, client } = await el.evaluate((n) => ({ scroll: n.scrollWidth, client: n.clientWidth }));
  expect(scroll, `${selector} recortado`).toBeLessThanOrEqual(client + 1);
}

async function addSticky(page: Page) {
  await page.getByRole('button', { name: 'Stickies' }).click();
  await page.getByRole('button', { name: 'Agregar un sticky' }).click();
}

async function waitSaved(page: Page) {
  await expect(page.locator('.board-status')).toHaveText('Guardado', { timeout: 15_000 });
}

test('Board: con timer y comentarios, el título y el estado se leen y lo demás pasa a "…"', async ({ page }) => {
  const name = 'Retro del equipo';
  const id = await newBoard(page, name);
  const timer = await page.request.post(`/api/boards/${id}/workshop`, { data: { timer: { action: 'start', seconds: 300 } } });
  expect(timer.ok()).toBe(true);
  const comment = await page.request.post(`/api/boards/${id}/comments`, { data: { x: 0, y: 0, body: 'Revisar' } });
  expect(comment.ok()).toBe(true);

  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/es/app/board/${id}`);
    await expect(page.getByRole('timer')).toBeVisible();
    await expect(page.locator('.board-bar-count').first()).toHaveText('1');
    await fullyVisible(page, 'input.board-name');
    await fullyVisible(page, '.board-status');
    await expect(page.locator('.board-status')).toHaveText('Guardado');
    // Track, Taller, Comentar e Historial viven en el menú.
    await expect(page.getByRole('button', { name: 'Historial' })).toBeHidden();
    await page.getByRole('button', { name: 'Más opciones de la pizarra' }).click();
    const menu = page.getByRole('menu', { name: 'Más opciones de la pizarra' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Track', 'Taller', 'Comentar', 'Historial']);
    await menu.getByRole('menuitem', { name: 'Taller' }).click();
    const pop = page.getByRole('dialog', { name: 'Herramientas de taller' });
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('Temporizador');
    await expect(pop).not.toContainText('Timer');
    if (width === 1280) await page.screenshot({ path: shot('board-bar-1280.png') });
    await page.keyboard.press('Escape');
  }

  // Teléfono: una sola línea, el nombre entero y sin scroll horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/es/app/board/${id}`);
  await expect(page.getByRole('timer')).toBeVisible();
  await page.screenshot({ path: shot('board-bar-390.png') });
  await fullyVisible(page, 'input.board-name');
  const bar = await page.locator('.board-bar').boundingBox();
  expect(bar!.height).toBeLessThan(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Compartir' })).toBeInViewport({ ratio: 1 });
  // Comentarios (con su cuenta) también pasa al menú.
  await page.getByRole('button', { name: 'Más opciones de la pizarra' }).click();
  await page.getByRole('menuitem', { name: 'Comentarios (1)' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.screenshot({ path: shot('board-bar-390.png') });

  // Pantalla ancha (sin sidebar plegado): todo a la vista, sin menú.
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(`/es/app/board/${id}`);
  await expect(page.getByRole('button', { name: 'Historial' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Más opciones de la pizarra' })).toBeHidden();
  await fullyVisible(page, 'input.board-name');
});

test('Board: una lista pegada cae en un hueco libre y los tags no se pisan', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newBoard(page, 'Pegado');
  await page.goto(`/es/app/board/${id}`);
  // Excalidraw en español, sin las ayudas de usted.
  await expect(page.locator('.board-excalidraw')).toHaveAttribute('data-lang', 'es-ES');
  await addSticky(page);
  await waitSaved(page);
  await page.getByRole('button', { name: 'Stickies' }).click();
  await page.locator('#board-sticky-bulk').fill('Idea uno #ux #backend\nIdea dos #ux #backend\nIdea tres #ux #backend\nIdea cuatro #ux #backend');
  await page.getByRole('button', { name: 'Agregar 4 stickies' }).click();
  await expect(page.locator('.board-tags')).toHaveCount(4);
  await expect(page.locator('.HintViewer')).toBeHidden();
  await waitSaved(page);
  await page.screenshot({ path: shot('board-bulk.png') });

  // En la escena: ningún sticky pisa a otro, con aire para la línea de tags.
  const board = (await (await page.request.get(`/api/boards/${id}`)).json()) as {
    scene: { elements: Array<{ id: string; type: string; x: number; y: number; width: number; height: number; containerId?: string | null }> };
  };
  const boxes = board.scene.elements.filter((e) => e.type === 'rectangle');
  expect(boxes).toHaveLength(5);
  for (const a of boxes) {
    for (const b of boxes) {
      if (a === b) continue;
      const apart = a.x + a.width + 8 <= b.x || b.x + b.width + 8 <= a.x || a.y + a.height + 24 <= b.y || b.y + b.height + 24 <= a.y;
      expect(apart, `${a.id} pisa ${b.id}`).toBe(true);
    }
  }
  // En pantalla: las insignias de tags no se superponen.
  const chips = await page.locator('.board-tags').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      const a = chips[i];
      const b = chips[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap).toBe(false);
    }
  }

  // Con los stickies seleccionados, el panel de propiedades termina arriba de la barra de zoom.
  const panel = await page.locator('.App-menu__left').boundingBox();
  const zoom = await page.locator('.App-menu_bottom').boundingBox();
  expect(panel && zoom).toBeTruthy();
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(zoom!.y);

  // La miniatura sigue a la última edición (no se queda con el primer sticky).
  await expect
    .poll(
      async () => {
        const list = (await (await page.request.get('/api/boards')).json()) as { boards: Array<{ id: string; thumbnail: string | null }> };
        const thumb = list.boards.find((b) => b.id === id)?.thumbnail ?? '';
        return thumb.includes('Nueva idea') && thumb.includes('Idea cuatro');
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test('Board: la lista muestra primero las pizarras, las plantillas se pliegan y borrar usa el modal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const name = `Lista ${Date.now()}`;
  await newBoard(page, name);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.goto('/es/app/board');
  const card = page.locator('.board-card').filter({ hasText: name });
  const templates = page.locator('.board-templates');
  const cardBox = await card.boundingBox();
  const tplBox = await templates.boundingBox();
  expect(cardBox!.y).toBeLessThan(tplBox!.y);
  // Sin huecos grandes entre el encabezado y las pizarras.
  const header = await page.locator('.ui-page-header').boundingBox();
  expect(cardBox!.y - (header!.y + header!.height)).toBeLessThan(48);
  await page.screenshot({ path: shot('board-list.png'), fullPage: true });

  const summary = page.locator('.board-templates-title');
  await summary.click();
  await expect(page.locator('.board-templates-grid')).toBeHidden();
  await page.reload();
  await expect(page.locator('.board-templates-grid')).toBeHidden();
  await page.locator('.board-templates-title').click();
  await expect(page.locator('.board-templates-grid')).toBeVisible();

  await page.getByRole('button', { name: `Acciones de la pizarra: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Borrar' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Borrar pizarra' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(name);
  // Después de la animación de entrada del modal.
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('board-delete-confirm.png') });
  // Esc cancela; Enter (foco en Borrar) confirma.
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: `Acciones de la pizarra: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Borrar' }).click();
  await expect(confirm.getByRole('button', { name: 'Borrar' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('Board: "Solo las personas que invites" sin compañeros explica cómo sumar al equipo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newBoard(page, 'Acceso');
  await page.goto(`/es/app/board/${id}`);
  await page.getByRole('button', { name: 'Compartir' }).click();
  const restricted = page.getByRole('radio', { name: /Solo las personas que invites/ });
  await restricted.click();
  // El radio sigue al servidor: queda marcado cuando vuelve el PATCH.
  await expect(restricted).toBeChecked();
  const pop = page.getByRole('dialog', { name: 'Compartir por link' });
  const members = (await (await page.request.get(`/api/boards/${id}/access`)).json()) as { candidates: Array<{ id: string }>; created_by: string };
  if (members.candidates.every((c) => c.id === members.created_by)) {
    await expect(pop.getByRole('link', { name: 'Invitar al workspace' })).toBeVisible();
  } else {
    await expect(pop.getByRole('combobox', { name: 'Invitar' })).toBeVisible();
  }
  await page.screenshot({ path: shot('board-access.png') });
});

test('Feedback: el botón no tapa las acciones de un toast (escritorio y 390px)', async ({ page }) => {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await newBoard(page, `Toast ${Date.now()}`);
    await page.goto('/es/app/board');
    await page.route('**/api/boards', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, body: '{}' }) : route.fallback()));
    await page.getByRole('button', { name: 'Nueva pizarra' }).click();
    const action = page.locator('.ui-toast .ui-toast-action');
    await expect(action).toBeVisible();
    const a = (await action.boundingBox())!;
    const fl = (await page.locator('.fl-button').boundingBox())!;
    const overlap = a.x < fl.x + fl.width && fl.x < a.x + a.width && a.y < fl.y + fl.height && fl.y < a.y + a.height;
    expect(overlap, `toast tapado a ${size.width}px`).toBe(false);
    if (size.width === 390) {
      // Pestaña angosta pegada al borde.
      expect(fl.width).toBeLessThanOrEqual(28);
      expect(fl.x + fl.width).toBeGreaterThanOrEqual(389);
    }
    await page.screenshot({ path: shot(`feedback-toast-${size.width}.png`) });
    await action.click();
    await expect(action).toBeHidden();
    await page.unroute('**/api/boards');
  }
});
