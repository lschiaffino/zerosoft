import { expect, test } from '@playwright/test';

/**
 * Notes y Board: teclado, estados vacíos, bookmarklet y
 * el menú de las pizarras. Corre en DEMO_MODE con una base nueva.
 */

test('Notes: N crea una nota, / busca y las flechas recorren la lista', async ({ page, request }) => {
  for (const title of ['Flechas uno', 'Flechas dos']) {
    const res = await request.post('/api/notes', { data: { title, content: [] } });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto('/en/app/notes');
  await expect(page.locator('.notes-item').first()).toBeVisible();

  // "/" enfoca la búsqueda; Esc la limpia.
  await page.locator('.notes-list-head h1').click();
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search notes' });
  await expect(search).toBeFocused();
  await page.keyboard.type('zzzz-nada');
  await expect(page.locator('.notes-no-results')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');

  // Flecha abajo desde la búsqueda pasa a la lista y abre la nota enfocada.
  await expect(page.locator('.notes-item')).not.toHaveCount(0);
  await search.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const second = page.locator('.notes-item').nth(1);
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-current', 'true');

  // N fuera de un campo crea una nota y enfoca el título.
  await second.blur();
  await page.locator('.notes-list-head h1').click();
  await page.keyboard.press('n');
  await expect(page.locator('.note-body .docs-title')).toBeFocused();
});

test('Notes: libreta vacía muestra su estado vacío y se renombra en el lugar', async ({ page, request }) => {
  const empty = `Vacía ${Date.now()}`;
  const renamed = `Renombrada ${Date.now()}`;
  const res = await request.post('/api/notes/notebooks', { data: { name: empty } });
  expect(res.ok()).toBeTruthy();
  await page.goto('/en/app/notes');
  await page.getByRole('button', { name: empty, exact: false }).first().click();
  await expect(page.locator('.notes-empty .ui-empty-title')).toBeVisible();

  // Renombrar vive en el menú "..." de la fila de la libreta.
  await page.getByRole('button', { name: `Notebook actions: ${empty}` }).click();
  await page.getByRole('menuitem', { name: 'Rename notebook' }).click();
  const input = page.getByRole('textbox', { name: 'New notebook name' });
  await input.fill(renamed);
  await input.press('Enter');
  await expect(page.locator('.notes-nav').getByText(renamed)).toBeVisible();
});

test('Notes: la página de recorte explica y deja copiar el bookmarklet', async ({ page }) => {
  await page.goto('/en/app/notes/clip');
  const bookmarklet = page.locator('.notes-bookmarklet');
  await expect(bookmarklet).toHaveAttribute('href', /^javascript:/);
  await expect(page.locator('.notes-clip-steps > li')).toHaveCount(3);
  // Clic en el botón no recorta nada: explica que hay que arrastrarlo.
  await bookmarklet.click();
  await expect(page.locator('.notes-bookmarklet-nudge')).not.toBeEmpty();
  await expect(page.getByRole('textbox', { name: 'Copy code' })).toHaveValue(/^javascript:/);
});

test('Board: el menú de la tarjeta se maneja con teclado', async ({ page, request }) => {
  const name = `Menú ${Date.now()}`;
  const res = await request.post('/api/boards', { data: { name } });
  expect(res.ok()).toBeTruthy();
  await page.goto('/en/app/board');
  const menuButton = page.getByRole('button', { name: `Board actions: ${name}` });
  await menuButton.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuButton).toBeFocused();
});

test('Board: el sidebar lista las pizarras y marca la abierta', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const name = `Sidebar board ${Date.now()}`;
  const res = await request.post('/api/boards', { data: { name } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto('/en/app/board');
  const branch = page.getByRole('navigation', { name: 'Boards' }).last();
  const link = branch.getByRole('link', { name });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(new RegExp(`/app/board/${id}`));
  await expect(branch.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
});
