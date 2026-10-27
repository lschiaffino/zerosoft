import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import zlib from 'zlib';

/**
 * Paridad de Notes con Evernote: plantillas, búsquedas guardadas, pilas,
 * etiquetas anidadas, selección múltiple, notas bloqueadas, export ENEX,
 * modo foco, resaltado, IA del editor, escaneo, audio y offline.
 * DEMO_MODE con base nueva; IA con el modelo falso (DOCS_AI_FAKE).
 */

// Micrófono falso para grabar audio en Chromium.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

const uid = () => Math.random().toString(36).slice(2, 8);

async function newNote(request: APIRequestContext, data: Record<string, unknown>): Promise<{ id: string; updated_at: string }> {
  const res = await request.post('/api/notes', { data });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function getNote(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/notes/${id}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

const para = (content: string) => ({ id: crypto.randomUUID(), type: 'paragraph', content });

/** PNG chico (RGB) sin dependencias. */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill((x + y) % 2 ? 230 : 40, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function openNotes(page: Page, query = '') {
  await page.goto(`/en/app/notes${query}`);
  await expect(page.locator('.notes-app')).toBeVisible();
}

test('Notes: nota desde plantilla de fábrica, guardar como plantilla propia, renombrar y borrar', async ({ page }) => {
  await openNotes(page);
  await page.getByRole('button', { name: 'New from template' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Templates' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-template="meeting"]').click();
  await expect(page.locator('.note-body .docs-title')).toHaveText('Meeting notes');
  await expect(page.locator('.note-body')).toContainText('Action items');

  // Guardar como plantilla propia desde el menú de la nota.
  const name = `Mi plantilla ${uid()}`;
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Save as template' }).click();
  const prompt = page.getByRole('dialog', { name: 'Save as template' });
  await prompt.getByLabel('Template name').fill(name);
  await prompt.getByLabel('Template name').press('Enter');
  await expect(page.locator('.ui-toast')).toContainText(`Saved as template “${name}”`);

  await page.getByRole('button', { name: 'New from template' }).first().click();
  await expect(dialog.getByText(name)).toBeVisible();
  // Renombrar y borrar desde la galería, sin recargar.
  await dialog.getByRole('button', { name: `Template actions: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename' });
  await rename.getByLabel('Template name').fill(`${name} v2`);
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText(`${name} v2`)).toBeVisible();
  await dialog.getByRole('button', { name: `Template actions: ${name} v2` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(dialog.getByText(`${name} v2`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Notes: búsqueda guardada en el sidebar, se encuentra con ⌘K y se borra', async ({ page, request }) => {
  const word = `zq${uid()}`;
  await newNote(request, { title: `Con ${word}`, content: [para('texto')] });
  await openNotes(page);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill(`intitle:${word}`);
  await expect(page.locator('.notes-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save search' }).click();
  const prompt = page.getByRole('dialog', { name: 'Save search' });
  await prompt.getByLabel('Name for this search').fill(`Búsqueda ${word}`);
  await prompt.getByRole('button', { name: 'Save' }).click();
  const item = page.locator('.notes-nav').getByRole('button', { name: `Búsqueda ${word}` });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('aria-current', 'true');

  // Limpiar y volver a abrirla desde el sidebar.
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('');
  await page.locator('.notes-nav').getByRole('button', { name: 'All notes', exact: true }).click();
  await item.click();
  await expect(page.getByRole('searchbox', { name: 'Search notes' })).toHaveValue(`intitle:${word}`);
  await expect(page.locator('.notes-item')).toHaveCount(1);

  // ⌘K la encuentra por nombre.
  const search = await request.get(`/api/search?q=${encodeURIComponent(`Búsqueda ${word}`)}`);
  const items = ((await search.json()) as { items: Array<{ href: string }> }).items;
  expect(items.some((i) => i.href.startsWith('/app/notes?search='))).toBe(true);

  await page.getByRole('button', { name: `Saved search actions: Búsqueda ${word}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(item).toHaveCount(0);
});

test('Notes: pilas de libretas y etiquetas anidadas en el sidebar', async ({ page, request }) => {
  const stack = `Pila ${uid()}`;
  const nb = (await (await request.post('/api/notes/notebooks', { data: { name: `Libreta ${uid()}` } })).json()) as { id: string; name: string };
  const tag = `area${uid()}`;
  await newNote(request, { title: `En pila ${stack}`, notebook_id: nb.id, tags: [`${tag}/clientes`] });
  await openNotes(page);

  await page.locator('.notes-nav').getByRole('button', { name: nb.name }).click();
  await page.getByRole('button', { name: `Notebook actions: ${nb.name}` }).click();
  await page.getByRole('menuitem', { name: 'Move to stack…' }).click();
  const prompt = page.getByRole('dialog', { name: 'Move to stack…' });
  await prompt.getByLabel('Stack name').fill(stack);
  await prompt.getByRole('button', { name: 'Move' }).click();
  const stackBtn = page.locator('.notes-stack-name', { hasText: stack });
  await expect(stackBtn).toBeVisible();
  await stackBtn.click();
  await expect(page.locator('.notes-list-head h1')).toHaveText(stack);
  await expect(page.locator('.notes-item', { hasText: `En pila ${stack}` })).toBeVisible();
  // Plegar la pila oculta sus libretas.
  await page.getByRole('button', { name: `Show or hide ${stack}` }).click();
  await expect(page.locator('.notes-nav').getByRole('button', { name: nb.name })).toHaveCount(0);

  // Etiqueta anidada: el padre aparece y filtra también las hijas.
  const parent = page.locator('.notes-tag-row', { hasText: tag }).first();
  await expect(parent).toBeVisible();
  await parent.locator('.notes-nav-item').click();
  await expect(page.locator('.notes-item', { hasText: `En pila ${stack}` })).toBeVisible();
  // Renombrar la etiqueta padre renombra la hija.
  await page.getByRole('button', { name: `Tag actions: ${tag}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename tag' }).click();
  const rn = page.getByRole('dialog', { name: `Rename #${tag}` });
  await rn.getByLabel('New name').fill(`${tag}x`);
  await rn.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.notes-tag-row', { hasText: `${tag}x` }).first()).toBeVisible();
  const tags = ((await (await request.get('/api/notes/tags')).json()) as { tags: Array<{ tag: string }> }).tags.map((t) => t.tag);
  expect(tags).toContain(`${tag}x/clientes`);
});

test('Notes: seleccionar varias notas, etiquetarlas y mandarlas a la papelera', async ({ page, request }) => {
  const word = `bulk${uid()}`;
  const a = await newNote(request, { title: `${word} uno` });
  const b = await newNote(request, { title: `${word} dos` });
  await openNotes(page);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill(`intitle:${word}`);
  await expect(page.locator('.notes-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.notes-item').nth(0).click();
  await page.locator('.notes-item').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.notes-bulk-count')).toHaveText('2 selected');
  await page.getByRole('textbox', { name: 'Add tag' }).fill('lote');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.ui-toast')).toContainText('2 notes updated');
  expect((await getNote(request, a.id)).tags).toContain('lote');
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.locator('.notes-item')).toHaveCount(0);
  expect((await getNote(request, b.id)).trashed).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.notes-bulk')).toHaveCount(0);
});

test('Notes: bloquear con contraseña, abrir, editar y quitar el bloqueo', async ({ page, request }) => {
  const title = `Secreta ${uid()}`;
  const n = await newNote(request, { title, content: [para('clave del wifi 7788')] });
  await openNotes(page, `?note=${n.id}`);
  await expect(page.locator('.note-body')).toContainText('7788');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Lock note' }).click();
  const dlg = page.getByRole('dialog', { name: 'Lock this note' });
  await dlg.getByLabel('Password', { exact: true }).fill('abcd1234');
  await dlg.getByLabel('Confirm password').fill('abcd1234');
  await dlg.getByLabel('Hint (optional)').fill('la de siempre');
  await dlg.getByRole('button', { name: 'Lock note' }).click();
  await expect(page.locator('.note-locked')).toBeVisible();
  await expect(page.locator('.note-body')).not.toContainText('7788');
  await expect(page.getByText('Hint: la de siempre')).toBeVisible();
  // El servidor no tiene el texto.
  const server = await getNote(request, n.id);
  expect(JSON.stringify(server)).not.toContain('7788');
  expect(server.locked).toBe(true);

  // Contraseña equivocada y después la correcta (Enter confirma).
  const pw = page.getByPlaceholder('Password');
  await pw.fill('nope');
  await pw.press('Enter');
  await expect(page.getByText('Wrong password. Try again.')).toBeVisible();
  await pw.fill('abcd1234');
  await pw.press('Enter');
  await expect(page.locator('.note-body')).toContainText('7788');

  // Editar: lo que viaja es otro sobre cifrado.
  await page.locator('.note-body .docs-editable').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' y 9911');
  await expect.poll(async () => (await getNote(request, n.id)).lock.ct, { timeout: 10_000 }).not.toBe(server.lock.ct);
  expect(JSON.stringify(await getNote(request, n.id))).not.toContain('9911');

  // Al recargar vuelve a pedir la contraseña.
  await page.reload();
  await expect(page.locator('.note-locked')).toBeVisible();
  await page.getByPlaceholder('Password').fill('abcd1234');
  await page.getByPlaceholder('Password').press('Enter');
  await expect(page.locator('.note-body')).toContainText('9911');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove lock' }).click();
  await expect.poll(async () => (await getNote(request, n.id)).locked, { timeout: 10_000 }).toBe(false);
  expect(JSON.stringify((await getNote(request, n.id)).content)).toContain('9911');
});

test('Notes: exportar todo, una libreta y una nota (ENEX y HTML)', async ({ request }) => {
  const nb = (await (await request.post('/api/notes/notebooks', { data: { name: `Export ${uid()}` } })).json()) as { id: string };
  const title = `Exportable ${uid()}`;
  const n = await newNote(request, { title, notebook_id: nb.id, tags: ['viaje'], content: [para('<strong>valija</strong>')] });
  const all = await request.get('/api/notes/export');
  expect(all.headers()['content-disposition']).toContain('.enex');
  expect(await all.text()).toContain(`<title>${title}</title>`);
  const one = await (await request.get(`/api/notes/export?notebook=${nb.id}`)).text();
  expect(one).toContain('<tag>viaje</tag>');
  expect(one).toContain('<strong>valija</strong>');
  const html = await request.get(`/api/notes/${n.id}/export?format=html`);
  expect(html.headers()['content-type']).toContain('text/html');
  expect(await html.text()).toContain('<strong>valija</strong>');
});

test('Notes: modo foco, resaltado de la búsqueda e IA del editor', async ({ page, request }) => {
  const word = `resalt${uid()}`;
  await newNote(request, { title: 'Foco', content: [para(`Una frase con ${word} adentro`), para('')] });
  await openNotes(page);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill(word);
  await expect(page.locator('.notes-item')).toHaveCount(1);
  await page.locator('.notes-item').first().click();
  await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights?: Map<string, Set<unknown>> }).highlights?.get('notes-search')?.size ?? 0)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Focus mode' }).click();
  await expect(page.locator('.notes-nav')).toBeHidden();
  await expect(page.locator('.notes-list')).toBeHidden();
  await page.locator('.note-bar').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('.notes-list')).toBeVisible();

  // IA: espacio en una línea vacía abre el menú (modelo falso en e2e).
  await page.locator('.note-body .docs-editable').nth(1).click();
  await page.keyboard.press(' ');
  const menu = page.getByTestId('docs-ai-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docs-ai-preview')).toContainText('Summary');
  await page.getByTestId('docs-ai-insert').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.note-body')).toContainText('Summary');
});

test('Notes: escanear un documento y grabar audio agregan bloques a la nota', async ({ page, request }) => {
  const n = await newNote(request, { title: `Captura ${uid()}`, content: [para('inicio')] });
  await openNotes(page, `?note=${n.id}`);
  await page.getByRole('button', { name: 'Scan document' }).click();
  const dlg = page.getByRole('dialog', { name: 'Scan a document' });
  await dlg.locator('input[type=file]').setInputFiles({ name: 'hoja.png', mimeType: 'image/png', buffer: png(40, 60) });
  await expect(dlg.getByRole('button', { name: 'Page corner 1' })).toBeVisible();
  // Mover una esquina con el teclado.
  await dlg.getByRole('button', { name: 'Page corner 1' }).focus();
  await page.keyboard.press('ArrowRight');
  await dlg.getByRole('button', { name: 'Add to note' }).click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(async () => (await getNote(request, n.id)).content.some((b: { type: string }) => b.type === 'image'), { timeout: 10_000 }).toBe(true);

  await page.getByRole('button', { name: 'Record audio' }).click();
  await expect(page.getByText(/Recording 0:0/)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop and add' }).click();
  await expect.poll(async () => (await getNote(request, n.id)).content.some((b: { type: string }) => b.type === 'audio'), { timeout: 15_000 }).toBe(true);
});

test('Notes: sin conexión se leen y editan las notas del dispositivo, y se sincroniza al volver', async ({ page, context, request }) => {
  const title = `Offline ${uid()}`;
  const n = await newNote(request, { title, content: [para('antes')] });
  await openNotes(page);
  // La copia del dispositivo baja en segundo plano.
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const dbs = await indexedDB.databases();
        const name = dbs.find((d) => d.name?.startsWith('zs-notes:'))?.name;
        if (!name) return false;
        return new Promise<boolean>((resolve) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => {
            const g = r.result.transaction('notes').objectStore('notes').get(id);
            g.onsuccess = () => resolve(Boolean(g.result?.full));
            g.onerror = () => resolve(false);
          };
          r.onerror = () => resolve(false);
        });
      }, n.id),
    )
    .toBe(true);

  await context.setOffline(true);
  await expect(page.locator('.notes-offline-banner')).toBeVisible();
  await page.locator('.notes-item', { hasText: title }).click();
  await expect(page.locator('.note-body')).toContainText('antes');
  await page.locator('.note-body .docs-editable').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' y después');
  await expect(page.locator('.note-status')).toHaveText('Saved on this device');
  // Nota nueva sin red.
  await page.locator('.notes-list-head h1').click();
  await page.keyboard.press('n');
  await expect(page.locator('.note-body .docs-title')).toBeFocused();
  await page.keyboard.type(`Creada offline ${title}`);
  await expect(page.locator('.notes-item', { hasText: `Creada offline ${title}` })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator('.note-status')).toHaveText('Saved on this device');

  await context.setOffline(false);
  await expect(page.locator('.ui-toast')).toContainText('synced', { timeout: 15_000 });
  await expect(page.locator('.notes-offline-banner')).toHaveCount(0);
  expect(JSON.stringify((await getNote(request, n.id)).content)).toContain('después');
  await expect
    .poll(async () => {
      const list = (await (await request.get(`/api/notes?q=${encodeURIComponent('Creada offline')}`)).json()) as { notes: Array<{ title: string }> };
      return list.notes.some((x) => x.title === `Creada offline ${title}`);
    })
    .toBe(true);
  // Seguir escribiendo con red: guarda normal.
  await page.keyboard.type(' bis');
  await expect(page.locator('.note-status')).toHaveText('Saved', { timeout: 10_000 });
});

test('Notes: 390 px en oscuro sin scroll horizontal, con selección y diálogos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openNotes(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Notebooks' }).first().click();
  await page.getByRole('button', { name: 'New from template' }).click();
  await expect(page.getByRole('dialog', { name: 'Templates' })).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});
