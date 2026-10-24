import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

type Block = { id: string; type: string; content: string; indent?: number; collapsed?: boolean; toggle?: boolean };

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

test('Docs: Tab anida, Shift+Tab desanida y el toggle pliega a sus hijos', async ({ request, page }) => {
  const doc = await pageWith(request, `Anidado ${uid()}`, [
    { id: 'a', type: 'toggle', content: 'Detalles' },
    { id: 'b', type: 'paragraph', content: 'Adentro' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await editable(page, 'Adentro').click();
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await content(request, doc.id))[1]?.indent ?? 0, { timeout: 10_000 }).toBe(1);

  // Plegar el toggle esconde al hijo.
  await page.locator('.docs-blocks').getByRole('button', { name: 'Collapse' }).click();
  await expect(editable(page, 'Adentro')).toBeHidden();
  await expect.poll(async () => (await content(request, doc.id))[0]?.collapsed, { timeout: 10_000 }).toBe(true);
  await page.locator('.docs-blocks').getByRole('button', { name: 'Expand' }).click();
  await expect(editable(page, 'Adentro')).toBeVisible();

  await editable(page, 'Adentro').click();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(async () => (await content(request, doc.id))[1]?.indent ?? 0, { timeout: 10_000 }).toBe(0);
});

test('Docs: Esc selecciona bloques; Shift+↓ extiende, Cmd+D duplica, Alt+Shift+↑ mueve y Backspace borra', async ({ request, page }) => {
  const doc = await pageWith(request, `Selección ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Uno' },
    { id: 'b', type: 'paragraph', content: 'Dos' },
    { id: 'c', type: 'paragraph', content: 'Tres' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await editable(page, 'Uno').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.docs-block-outer.is-selected')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.docs-block-outer.is-selected')).toHaveCount(2);

  await page.keyboard.press('ControlOrMeta+d');
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => b.content), { timeout: 10_000 })
    .toEqual(['Uno', 'Dos', 'Uno', 'Dos', 'Tres']);

  // La selección queda en la copia: baja un lugar (salta "Tres") y se borra.
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => b.content), { timeout: 10_000 })
    .toEqual(['Uno', 'Dos', 'Tres', 'Uno', 'Dos']);
  await page.keyboard.press('Backspace');
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => b.content), { timeout: 10_000 })
    .toEqual(['Uno', 'Dos', 'Tres']);
});

test('Docs: pegar Markdown crea bloques reales', async ({ request, page }) => {
  const doc = await pageWith(request, `Pegar ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '## Plan\n\n- uno\n  - dos\n- [ ] tarea\n\n> [!TIP]\n> Ojo');
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => [b.type, b.content, b.indent ?? 0]), { timeout: 10_000 })
    .toEqual([
      ['heading', 'Plan', 0],
      ['bulleted_list_item', 'uno', 0],
      ['bulleted_list_item', 'dos', 1],
      ['todo', 'tarea', 0],
      ['callout', 'Ojo', 0],
    ]);
});

test('Docs: responder un comentario arma el hilo', async ({ request, page }) => {
  const doc = await pageWith(request, `Hilo ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Texto' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Comments/ }).click();
  await page.getByRole('textbox', { name: 'Add a comment…' }).fill('Primera');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const thread = page.getByTestId('docs-comment-thread');
  await expect(thread).toHaveCount(1);
  await thread.getByRole('button', { name: 'Reply' }).click();
  const reply = page.getByTestId('docs-comment-reply-composer');
  await reply.getByRole('textbox').fill('Respuesta');
  await reply.getByRole('button', { name: 'Reply' }).click();
  await expect(thread.locator('.docs-comment-reply')).toHaveCount(1);
  await expect(thread).toHaveCount(1);
  const rows = ((await (await request.get(`/api/docs/pages/${doc.id}/comments`)).json()) as { rows: Array<{ parent_id: string | null }> }).rows;
  expect(rows.filter((r) => r.parent_id)).toHaveLength(1);
});

test('Docs: guardar una página como plantilla del workspace', async ({ request, page }) => {
  const name = `Plantilla ${uid()}`;
  const doc = await pageWith(request, name, [{ id: 'a', type: 'callout', content: 'Base' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Page options' }).click();
  await page.getByRole('menuitem', { name: 'Save as template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  await expect(dialog.getByLabel('Name')).toHaveValue(name);
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog.getByRole('status')).toBeVisible();
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  const tpl = page.getByTestId('docs-workspace-templates').getByRole('button', { name: new RegExp(`^${name}`) });
  await expect(tpl).toBeVisible();
  await tpl.click();
  await expect(page).toHaveURL(/\/en\/app\/docs\/[^/]+$/);
  await expect(page.locator('.docs-block-callout .docs-editable')).toHaveText('Base');
});

test('Docs: una pizarra embebida se anida, se selecciona, se duplica y se borra con el resto', async ({ request, page }) => {
  const doc = await pageWith(request, `Pizarra ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Arriba' },
    { id: 'b', type: 'board', content: '' },
    { id: 'c', type: 'paragraph', content: 'Abajo' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const types = async () => (await content(request, doc.id)).map((b) => `${b.type}:${b.indent ?? 0}`);

  // Tab con la pizarra enfocada la anida debajo del párrafo.
  await page.getByTestId('docs-board-block').focus();
  await page.keyboard.press('Tab');
  await expect.poll(types, { timeout: 10_000 }).toEqual(['paragraph:0', 'board:1', 'paragraph:0']);

  // Seleccionada junto con su padre: Cmd+D copia los dos, se mueven y Backspace los borra.
  await editable(page, 'Arriba').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+d');
  await expect
    .poll(types, { timeout: 10_000 })
    .toEqual(['paragraph:0', 'board:1', 'paragraph:0', 'board:1', 'paragraph:0']);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await page.keyboard.press('Backspace');
  await expect.poll(types, { timeout: 10_000 }).toEqual(['paragraph:0', 'board:1', 'paragraph:0']);
});

test('Docs: una imagen subida carga en el editor por la ruta con permisos', async ({ request, page }) => {
  const doc = await pageWith(request, `Imagen ${uid()}`, [{ id: 'p', type: 'paragraph', content: 'Arriba' }]);
  // Sin Blob se guarda en public/uploads, que `next start` no sirve si no estaba en el build.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = await request.post(`/api/docs/pages/${doc.id}/files`, { multipart: { file: { name: 'dot.png', mimeType: 'image/png', buffer: png } } });
  expect(up.ok()).toBeTruthy();
  const file = (await up.json()) as { url: string; name: string; size: number; mime: string };
  const saved = await request.patch(`/api/docs/pages/${doc.id}`, {
    data: { content: [{ id: 'p', type: 'paragraph', content: 'Arriba' }, { id: 'img', type: 'image', content: '', ...file }] },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const img = page.getByTestId('docs-image-block').locator('img');
  await expect(img).toHaveAttribute('src', new RegExp(`/api/docs/files/${doc.id}/img`));
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)), { timeout: 15_000 }).toBeGreaterThan(0);
});
