import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/** Detalles del editor que el dueño encontró usándolo: el globo de comentar, la caja de foco y el bloque botón. */

const uid = () => Math.random().toString(36).slice(2, 8);

type Block = { id: string; type: string; content: string; checked?: boolean; button?: unknown };

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok()).toBeTruthy();
  return doc;
}

async function content(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}

const editable = (page: Page, text: string) => page.locator('.docs-blocks .docs-editable', { hasText: text });

test('Docs: el globo de comentar sigue visible al llevarle el mouse y abre el comentario del bloque', async ({ request, page }) => {
  const doc = await pageWith(request, `Globo ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Reunión con el equipo' },
    { id: 'b', type: 'paragraph', content: 'Otra línea' },
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const outer = page.locator('.docs-blocks .docs-block-outer', { has: page.locator('.docs-editable', { hasText: 'Reunión' }) }).first();
  const box = (await outer.boundingBox())!;
  // Mouse real (sin hover forzado): entra al bloque y cruza el hueco hasta el globo.
  await page.mouse.move(box.x + box.width - 20, box.y + 12);
  const btn = outer.getByRole('button', { name: 'Comment on this block' });
  await expect(btn).toHaveCSS('opacity', '1');
  const b = (await btn.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await expect(btn).toHaveCSS('opacity', '1');

  // Lo mismo hacia el asa de la izquierda.
  const grip = outer.locator('.docs-block-grip');
  await page.mouse.move(box.x + 8, box.y + 12, { steps: 12 });
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 8 });
  await expect(grip).toHaveCSS('opacity', '1');

  // El puente del asa no tapa el principio del renglón: un click en el primer píxel cae en el texto.
  await editable(page, 'Reunión').click({ position: { x: 1, y: 6 } });
  await expect(editable(page, 'Reunión')).toBeFocused();

  // Vuelve al texto y cruza otra vez para hacer click en el globo.
  await page.mouse.move(box.x + box.width - 20, box.y + 12, { steps: 12 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.down();
  await page.mouse.up();
  const composer = page.getByRole('textbox', { name: 'Add a comment…' });
  await expect(composer).toBeFocused();
  await composer.fill('Sobre este bloque');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByTestId('docs-comment-thread')).toHaveCount(1);
  await expect
    .poll(async () =>
      ((await (await request.get(`/api/docs/pages/${doc.id}/comments`)).json()) as { rows: Array<{ block_id: string | null }> }).rows.map(
        (r) => r.block_id,
      ),
    )
    .toEqual(['a']);
});

test('Docs: el título y el párrafo en los que se escribe no llevan caja de foco', async ({ request, page }) => {
  const doc = await pageWith(request, `Foco ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.click();
  await expect(title).toHaveCSS('outline-style', 'none');
  // Con el teclado (Enter pasa al primer bloque) tampoco hay caja.
  await page.keyboard.press('Enter');
  const para = page.locator('.docs-blocks .docs-editable').first();
  await expect(para).toBeFocused();
  await expect(para).toHaveCSS('outline-style', 'none');
  await expect(para).toHaveCSS('box-shadow', 'none');
  // Los botones sí muestran el foco de teclado.
  const grip = page.locator('.docs-block-grip').first();
  await grip.focus();
  await expect(grip).not.toHaveCSS('outline-style', 'none');
});

const buttonBlock = (markdown: string): Block => ({
  id: 'btn',
  type: 'button',
  content: '',
  button: { label: 'Agregar', action: 'insert', markdown },
});

test('Docs: el botón inserta to-dos con los atajos [] y [x]', async ({ request, page }) => {
  const doc = await pageWith(request, `Botón tareas ${uid()}`, [buttonBlock('[]Tarea extra\n[x] Hecha\n- [ ] Otra')]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('docs-button-run').click();
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => [b.type, b.content, b.checked ?? false]), { timeout: 10_000 })
    .toEqual([
      ['button', '', false],
      ['todo', 'Tarea extra', false],
      ['todo', 'Hecha', true],
      ['todo', 'Otra', false],
    ]);
  // La configuración explica la sintaxis.
  await page.getByRole('button', { name: 'Button settings' }).click();
  await expect(page.getByLabel('Blocks to insert (Markdown)')).toHaveAccessibleDescription(/\[\] to-do/);
});

test('Docs: el botón se borra desde su configuración, con Backspace y desde el asa, y deshacer lo trae', async ({ request, page }) => {
  const doc = await pageWith(request, `Botón borrar ${uid()}`, [
    { id: 'p', type: 'paragraph', content: 'Arriba' },
    buttonBlock('- [ ] Algo'),
  ]);
  const types = async () => (await content(request, doc.id)).map((b) => b.type);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const block = page.getByTestId('docs-button-block');

  // 1. Desde la configuración.
  await block.getByRole('button', { name: 'Button settings' }).click();
  await block.getByRole('button', { name: 'Delete button' }).click();
  await expect(block).toHaveCount(0);
  await expect.poll(types, { timeout: 10_000 }).toEqual(['paragraph']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block).toHaveCount(1);
  await expect.poll(types, { timeout: 10_000 }).toEqual(['paragraph', 'button']);

  // 2. Bloque seleccionado (foco en la tarjeta) + Backspace.
  await block.focus();
  await page.keyboard.press('Backspace');
  await expect(block).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block).toHaveCount(1);

  // Supr hace lo mismo; con el foco en el botón de adentro no borra nada.
  await block.focus();
  await page.keyboard.press('Delete');
  await expect(block).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block).toHaveCount(1);
  await block.getByTestId('docs-button-run').focus();
  await page.keyboard.press('Backspace');
  await expect(block).toHaveCount(1);

  // 3. Menú del asa, también cuando es el único bloque de la página.
  await editable(page, 'Arriba').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await expect.poll(types, { timeout: 10_000 }).toEqual(['button']);
  const outer = page.locator('.docs-block-outer', { has: block });
  await outer.hover();
  await outer.locator('.docs-block-grip').click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await expect(block).toHaveCount(0);
  await expect.poll(types, { timeout: 10_000 }).toEqual(['paragraph']);
});
