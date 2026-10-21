import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Editor de bloques (Docs y Notes): deshacer/rehacer propio, Enter en un
 * bloque anidado vacío, fechas de comentarios, plantillas del workspace y
 * los detalles de Notes (placeholder del título y "crear nota" en [[).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

type Block = { id: string; type: string; content: string; indent?: number };

async function newDoc(request: APIRequestContext, title: string, content?: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  if (content) expect((await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } })).ok()).toBeTruthy();
  return doc;
}

async function docContent(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}

const texts = (page: Page) => page.locator('.docs-blocks .docs-editable').allTextContents();

/** Tipea uno/dos/tres en párrafos, borra "dos" con Esc + Backspace y deshace. */
async function undoAfterBlockDelete(page: Page) {
  const first = page.locator('.docs-blocks .docs-editable').first();
  await first.click();
  await page.keyboard.type('uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('dos');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tres');
  await expect.poll(() => texts(page)).toEqual(['uno', 'dos', 'tres']);

  await page.locator('.docs-blocks .docs-editable', { hasText: 'dos' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.docs-block-outer.is-selected')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect.poll(() => texts(page)).toEqual(['uno', 'tres']);

  // Cmd+Z: vuelve "dos" sin tocar los otros bloques.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => texts(page)).toEqual(['uno', 'dos', 'tres']);
  // Otro Cmd+Z deshace el último tipeo ("tres"); nunca vacía "uno" ni "dos".
  await page.keyboard.press('ControlOrMeta+z');
  const after = await texts(page);
  expect(after.slice(0, 2)).toEqual(['uno', 'dos']);
  // Rehacer (Cmd+Shift+Z) dos veces vuelve al estado con el bloque borrado.
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => texts(page)).toEqual(['uno', 'dos', 'tres']);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => texts(page)).toEqual(['uno', 'tres']);
  // Y Cmd+Z otra vez recupera "dos" (lo que queda guardado).
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => texts(page)).toEqual(['uno', 'dos', 'tres']);
}

test('Docs: Cmd+Z después de borrar un bloque lo recupera sin vaciar los demás', async ({ request, page }) => {
  const doc = await newDoc(request, `Deshacer ${uid()}`);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await undoAfterBlockDelete(page);
  // Lo guardado es lo que se ve (antes se guardaba la página vacía).
  await expect
    .poll(async () => (await docContent(request, doc.id)).map((b) => b.content), { timeout: 10_000 })
    .toEqual(['uno', 'dos', 'tres']);
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => texts(page)).toEqual(['uno', 'dos', 'tres']);
});

test('Docs: Cmd+Z deshace mover, duplicar, anidar y cambiar el tipo', async ({ request, page }) => {
  const doc = await newDoc(request, `Estructura ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Alfa' },
    { id: 'b', type: 'paragraph', content: 'Beta' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const beta = page.locator('.docs-blocks .docs-editable', { hasText: 'Beta' });
  await beta.click();
  // Anidar con Tab y deshacer.
  await page.keyboard.press('Tab');
  await expect(page.locator('.docs-block-outer[data-indent="1"]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.docs-block-outer[data-indent="1"]')).toHaveCount(0);
  // Duplicar con Cmd+D y deshacer.
  await beta.click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect.poll(() => texts(page)).toEqual(['Alfa', 'Beta', 'Beta']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => texts(page)).toEqual(['Alfa', 'Beta']);
  // Mover arriba con Alt+Shift+↑ y deshacer (Ctrl/Cmd+Y rehace).
  await beta.click();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expect.poll(() => texts(page)).toEqual(['Beta', 'Alfa']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => texts(page)).toEqual(['Alfa', 'Beta']);
  await page.keyboard.press('ControlOrMeta+y');
  await expect.poll(() => texts(page)).toEqual(['Beta', 'Alfa']);
  // Cambiar el tipo con markdown ("# ") y deshacer.
  await page.locator('.docs-blocks .docs-editable', { hasText: 'Alfa' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# ');
  await expect(page.locator('.docs-blocks .docs-h1')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.docs-blocks .docs-h1')).toHaveCount(0);
});

test('Docs: Enter en un bloque anidado vacío lo saca un nivel', async ({ request, page }) => {
  const doc = await newDoc(request, `Enter anidado ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Madre' },
    { id: 'b', type: 'paragraph', content: 'Hija', indent: 1 },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable', { hasText: 'Hija' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  // El nuevo nace anidado como su hermano.
  await expect(page.locator('.docs-block-outer[data-indent="1"]')).toHaveCount(2);
  await page.keyboard.press('Enter');
  // Enter sobre el vacío anidado: sube a nivel 0 en vez de crear otro anidado.
  await expect(page.locator('.docs-block-outer[data-indent="1"]')).toHaveCount(1);
  await expect(page.locator('.docs-blocks .docs-editable')).toHaveCount(3);
  await page.keyboard.type('Afuera');
  await expect
    .poll(async () => (await docContent(request, doc.id)).map((b) => [b.content, b.indent ?? 0]), { timeout: 10_000 })
    .toEqual([['Madre', 0], ['Hija', 1], ['Afuera', 0]]);
});

test('Docs: la fecha de un comentario es relativa, no "2026-10-21"', async ({ request, page }) => {
  const doc = await newDoc(request, `Comentado ${uid()}`);
  const res = await request.post(`/api/docs/pages/${doc.id}/comments`, { data: { body: 'Revisar esto' } });
  expect(res.ok()).toBeTruthy();
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Comments/ }).click();
  const date = page.locator('.docs-comment-date').first();
  await expect(date).toBeVisible();
  await expect(date).not.toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await expect(date).toHaveText(/now|second|minute/);
  await expect(date).toHaveAttribute('title', /\d{4}/);
});

test('Docs: una plantilla del workspace se renombra y se borra desde el inicio', async ({ request, page }) => {
  const tag = uid();
  const base = await newDoc(request, `Base ${tag}`);
  const tpl = await request.post('/api/docs/templates', { data: { page_id: base.id, title: `Plantilla ${tag}` } });
  expect(tpl.status()).toBe(201);
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });

  const list = page.getByTestId('docs-workspace-templates');
  const card = list.locator('.docs-template-item', { hasText: `Plantilla ${tag}` });
  await card.getByRole('button', { name: `Options for template Plantilla ${tag}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = list.getByRole('textbox', { name: 'Template name' });
  await expect(input).toBeFocused();
  await input.fill(`Renombrada ${tag}`);
  await input.press('Enter');
  await expect(list).toContainText(`Renombrada ${tag}`);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(list).toContainText(`Renombrada ${tag}`);

  // Esc cancela el renombre.
  const renamed = list.locator('.docs-template-item', { hasText: `Renombrada ${tag}` });
  await renamed.getByRole('button', { name: /^Options for template/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await list.getByRole('textbox', { name: 'Template name' }).fill('No va');
  await page.keyboard.press('Escape');
  await expect(list).toContainText(`Renombrada ${tag}`);

  page.once('dialog', (d) => void d.accept());
  await renamed.getByRole('button', { name: /^Options for template/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.locator('.docs-template-item', { hasText: `Renombrada ${tag}` })).toHaveCount(0);
  const rows = ((await (await request.get('/api/docs/templates')).json()) as { rows: { title: string }[] }).rows;
  expect(rows.some((r) => r.title.endsWith(tag))).toBe(false);
});

test('Notes: Cmd+Z también deshace el borrado de bloques, con placeholder de nota', async ({ request, page }) => {
  const res = await request.post('/api/notes', { data: { title: '', content: [] } });
  const note = (await res.json()) as { id: string };
  await page.goto(`/en/app/notes?note=${note.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.note-body .docs-title')).toHaveAttribute('data-placeholder', 'Untitled note');
  await undoAfterBlockDelete(page);
});

test('Notes: [[ ofrece crear una nota nueva con lo tipeado', async ({ request, page }) => {
  const tag = uid();
  const res = await request.post('/api/notes', { data: { title: `Origen ${tag}`, content: [] } });
  const note = (await res.json()) as { id: string };
  await page.goto(`/en/app/notes?note=${note.id}`, { waitUntil: 'networkidle' });
  await page.locator('.note-body .docs-blocks .docs-editable').first().click();
  await page.keyboard.type(`Ver [[Idea ${tag}`);
  const create = page.locator('.docs-mention-create');
  await expect(create).toHaveText(`Create note “Idea ${tag}”`);
  await page.keyboard.press('Enter');
  const link = page.locator('.note-body .docs-editable a[data-page]');
  await expect(link).toHaveText(`Idea ${tag}`);
  // La nota nueva existe y aparece en la lista sin recargar.
  await expect(page.locator('.notes-item', { hasText: `Idea ${tag}` })).toBeVisible();
  const found = (await (await request.get(`/api/notes?q=${encodeURIComponent(`Idea ${tag}`)}`)).json()) as {
    notes: { title: string }[];
  };
  expect(found.notes.map((n) => n.title)).toContain(`Idea ${tag}`);
});
