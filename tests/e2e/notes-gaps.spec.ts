import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createClient } from '@libsql/client';
import zlib from 'zlib';
import { clipBookmarklet } from '../../lib/notes-types';

/**
 * Notes contra Evernote, segunda tanda: tareas con fecha, inicio con widgets,
 * email a nota, recortes de artículo y página, pedir acceso, API y MCP, texto de
 * imágenes y PDF en la búsqueda, búsqueda por significado, transcribir, anotar,
 * escaneo con bordes y varias páginas, tablas con filtro y orden, consola de admin.
 * DEMO_MODE con base nueva; IA y transcripción falsas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const para = (content: string) => ({ id: crypto.randomUUID(), type: 'paragraph', content });

async function newNote(request: APIRequestContext, data: Record<string, unknown>): Promise<{ id: string; updated_at: string; content: Array<Record<string, unknown>> }> {
  const res = await request.post('/api/notes', { data });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** PNG liso sin dependencias: hoja clara sobre fondo oscuro si `sheet`. */
function png(w: number, h: number, sheet = false): Buffer {
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
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const inside = !sheet || (x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8);
      row.fill(inside ? 235 : 30, 1 + x * 3, 1 + x * 3 + 3);
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

async function upload(request: APIRequestContext, noteId: string, name: string, mimeType: string, buffer: Buffer) {
  const res = await request.post(`/api/notes/${noteId}/files`, { multipart: { file: { name, mimeType, buffer } } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { url: string; name: string; size: number; mime: string };
}

async function fileNote(request: APIRequestContext, title: string, name: string, mime: string, buf: Buffer, type: string) {
  const note = await newNote(request, { title, content: [para('x')] });
  const file = await upload(request, note.id, name, mime, buf);
  const res = await request.patch(`/api/notes/${note.id}`, { data: { content: [para('x'), { id: crypto.randomUUID(), type, content: '', ...file }] } });
  expect(res.ok()).toBeTruthy();
  return note.id;
}

async function openHome(page: Page) {
  await page.goto('/en/app/notes?view=home');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
}

test('Tareas: fecha desde el editor, vista por vencimiento y marcar hecha', async ({ page, request }) => {
  const title = `Plan ${uid()}`;
  const later = `Llamar ${uid()}`;
  const note = await newNote(request, { title, content: [{ id: crypto.randomUUID(), type: 'todo', content: later, checked: false }] });
  await page.goto(`/en/app/notes?note=${note.id}`);
  await page.locator('.docs-block-todo').hover();
  await page.getByRole('button', { name: 'Due date and assignee' }).click();
  const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Due date', { exact: true }).fill(yesterday);
  await expect(page.locator('.note-task-chip.is-overdue')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Notebooks' }).getByRole('button', { name: 'Tasks' }).click();
  const overdue = page.locator('.notes-tasks-group', { has: page.getByRole('heading', { name: /Overdue/ }) });
  await expect(overdue.getByText(later)).toBeVisible();
  // Al marcarla pasa a Hechas, plegada: click y no check, que espera ver el tilde.
  await overdue.getByRole('checkbox', { name: later }).click();
  await expect(page.getByRole('button', { name: /Show 1 completed task/ })).toBeVisible();
  await expect
    .poll(async () => ((await (await request.get(`/api/notes/${note.id}`)).json()) as { content: Array<{ checked?: boolean }> }).content[0].checked)
    .toBe(true);
  // La fecha sobrevive al autoguardado del editor.
  await page.reload();
  await expect(page.locator('.note-task-chip.is-set')).toBeVisible();
});

test('Bloc rápido: un borrador de otra cuenta o sobre un texto más viejo no se aplica', async ({ page, request }) => {
  await openHome(page);
  const box = page.getByRole('textbox', { name: 'Scratch pad' });
  const current = `Actual ${uid()}`;
  await box.fill(current);
  await expect(page.locator('[data-widget="scratch"]').getByRole('status')).toHaveText('Saved');
  const { draftScope } = (await (await request.get('/api/notes/prefs')).json()) as { draftScope: string };
  const plant = (draft: unknown) => page.evaluate((d) => localStorage.setItem('zs:notes:scratch-draft', JSON.stringify(d)), draft);
  const draftNow = () => page.evaluate(() => localStorage.getItem('zs:notes:scratch-draft'));

  await plant({ scope: 'otra:cuenta', base: current, text: 'privado de otra cuenta' });
  await page.reload();
  await expect(box).toHaveValue(current);
  expect(await draftNow()).toBeNull();

  await plant({ scope: draftScope, base: 'texto anterior', text: 'borrador viejo' });
  await page.reload();
  await expect(box).toHaveValue(current);
  expect(await draftNow()).toBeNull();

  // El borrador propio sobre el mismo texto sí se recupera y se guarda.
  const rescued = `${current} rescatado`;
  await plant({ scope: draftScope, base: current, text: rescued });
  await page.reload();
  await expect(box).toHaveValue(rescued);
  await expect.poll(async () => ((await (await request.get('/api/notes/prefs')).json()) as { scratch: string }).scratch).toBe(rescued);
  await expect.poll(draftNow).toBeNull();
  const final = await request.patch('/api/notes/prefs', { data: { scratch: '' } });
  expect(final.ok()).toBe(true);
});

test('Inicio: personalizar widgets, bloc rápido a nota y reunión de Cal', async ({ page, request }) => {
  await openHome(page);
  await expect(page.locator('[data-widget="scratch"]')).toBeVisible();
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page.locator('[data-widget="tags"]')).toBeVisible();
  await page.getByRole('button', { name: 'Hide Notebooks' }).click();
  await page.getByRole('button', { name: 'Move Tags up' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.locator('[data-widget="tags"]')).toBeVisible();
  await expect(page.locator('[data-widget="notebooks"]')).toHaveCount(0);

  const line = `Idea ${uid()}`;
  const box = page.getByRole('textbox', { name: 'Scratch pad' });
  await box.fill(line);
  await expect(page.locator('[data-widget="scratch"]').getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(box).toHaveValue(line);
  // Navegar enseguida no pierde lo escrito.
  const quick = `${line} apurada`;
  await box.fill(quick);
  await page.goto('/en/app/notes?view=home');
  await expect(box).toHaveValue(quick);
  await expect(page.locator('.band-section-name')).toHaveText('Home');
  await page.getByRole('button', { name: 'Save as note' }).click();
  await expect(page.locator('.note-pane')).toBeVisible();
  await expect(page.locator('.notes-list').getByText(quick).first()).toBeVisible();
  const prefs = (await (await request.get('/api/notes/prefs')).json()) as { scratch: string };
  expect(prefs.scratch).toBe('');
});

test('Email a nota: la dirección crea una nota con libreta y etiqueta', async ({ page, request }) => {
  await page.goto('/en/app/notes/settings');
  const address = await page.getByTestId('notes-email-address').inputValue();
  expect(address).toMatch(/^notes\+[a-z0-9]{24}@inbound\.zerosoft\.test$/);
  const nb = `Finanzas${uid()}`;
  expect((await request.post('/api/notes/notebooks', { data: { name: nb } })).ok()).toBeTruthy();
  const subject = `Factura ${uid()}`;
  const send = (emailId: string, to = address) =>
    request.post('/api/chat/inbound-email', {
      data: { type: 'email.received', data: { email_id: emailId, from: 'Ana <ana@cliente.test>', to: [to], subject: `Fwd: ${subject} @${nb} #recibos`, text: 'Total 10 USD', headers: {} } },
    });
  const id = `e-${uid()}`;
  expect((await (await send(id)).json()).notes).toBe('created');
  expect((await (await send(id)).json()).notes).toBe('skipped');
  await page.goto(`/en/app/notes?q=${encodeURIComponent(subject)}`);
  await page.locator('.notes-item', { hasText: subject }).first().click();
  await expect(page.getByText('Total 10 USD', { exact: true })).toBeVisible();
  await expect(page.locator('.note-tag', { hasText: 'recibos' })).toBeVisible();
  // Regenerar invalida la anterior.
  await page.goto('/en/app/notes/settings');
  await page.getByRole('button', { name: 'Get a new address' }).click();
  await expect(page.getByTestId('notes-email-address')).not.toHaveValue(address);
  expect((await (await send(`e-${uid()}`)).json()).reason).toBe('unknown_address');
});

test('Recortes: el bookmarklet real manda la página y guarda el artículo', async ({ page, context, baseURL }) => {
  const heading = `Titular ${uid()}`;
  const body = 'Cuerpo del artículo. '.repeat(20);
  await page.route('https://blog.test/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><title>${heading}</title></head><body><nav>Menu raro</nav><article><h1>${heading}</h1><p>${body}</p></article></body></html>` }),
  );
  await page.goto('https://blog.test/post');
  const popupPromise = context.waitForEvent('page');
  await page.evaluate(clipBookmarklet(baseURL!, 'en').replace(/^javascript:/, ''));
  const popup = await popupPromise;
  await expect(popup.getByLabel('Title')).toHaveValue(heading);
  await popup.getByRole('radio', { name: /Article/ }).check();
  // Sin el HTML del bookmarklet el servidor no podría bajar blog.test.
  await popup.getByRole('button', { name: 'Save note', exact: true }).click();
  await popup.getByRole('link', { name: 'Open note' }).click();
  await expect(popup.locator('.docs-editable', { hasText: 'Cuerpo del artículo.' }).first()).toBeVisible();
  await expect(popup.getByText('Menu raro')).toHaveCount(0);
});

test('Recortes: marcador y error claro si no se puede leer la página', async ({ page, request }) => {
  const title = `Marcador ${uid()}`;
  await page.goto(`/en/app/notes/clip?url=${encodeURIComponent('http://127.0.0.1:9/nada')}&title=${encodeURIComponent(title)}`);
  await page.getByRole('radio', { name: /Article/ }).check();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText("Couldn't read that page")).toBeVisible();
  await page.getByRole('radio', { name: /Bookmark/ }).check();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open note' })).toBeVisible();
  const notes = ((await (await request.get(`/api/notes?q=${encodeURIComponent(`intitle:"${title}"`)}`)).json()) as { notes: Array<{ title: string; source_url: string }> }).notes;
  expect(notes[0]?.source_url).toContain('127.0.0.1');
});

test('Búsqueda: encuentra texto dentro de un PDF y de una imagen', async ({ page, request }) => {
  const word = `factura${uid()}`;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 400]).drawText(`Total ${word}`, { x: 20, y: 300, font, size: 14 });
  const title = `Con PDF ${uid()}`;
  await fileNote(request, title, 'f.pdf', 'application/pdf', Buffer.from(await pdf.save()), 'pdf');
  await expect
    .poll(async () => ((await (await request.get(`/api/notes?q=${word}`)).json()) as { notes: Array<{ title: string }> }).notes.map((n) => n.title), { timeout: 20_000 })
    .toContain(title);
  // Leer imágenes se prende por workspace.
  expect((await request.post('/api/notes/admin', { data: { action: 'ocr', enabled: true } })).ok()).toBeTruthy();
  const imgTitle = `Con foto ${uid()}`;
  await fileNote(request, imgTitle, 'r.png', 'image/png', png(20, 20), 'image');
  // El OCR falso devuelve un texto fijo.
  await expect
    .poll(async () => ((await (await request.get('/api/notes?q=zebrafish')).json()) as { notes: Array<{ title: string }> }).notes.map((n) => n.title), { timeout: 20_000 })
    .toContain(imgTitle);
  await page.goto(`/en/app/notes?q=${word}`);
  await expect(page.locator('.notes-item', { hasText: title })).toBeVisible();
});

test('Búsqueda por significado: el botón cambia de motor', async ({ page, request }) => {
  const word = `tortuga${uid()}`;
  const title = `Semántica ${uid()}`;
  await newNote(request, { title, content: [para(`Una nota sobre ${word}`)] });
  await page.goto('/en/app/notes');
  const searchReq = page.waitForRequest((r) => r.url().includes('/api/notes/semantic'));
  await page.getByRole('button', { name: 'Search by meaning' }).click();
  await page.getByRole('searchbox').fill(word);
  await searchReq;
  await expect(page.locator('.notes-item', { hasText: title })).toBeVisible();
});

test('API v1 y MCP con scopes', async ({ request }) => {
  const key = ((await (await request.post('/api/keys', { data: { name: `notes ${uid()}`, scopes: ['notes:write'] } })).json()) as { key: string }).key;
  const readOnly = ((await (await request.post('/api/keys', { data: { name: `notes-r ${uid()}`, scopes: ['notes:read'] } })).json()) as { key: string }).key;
  const auth = (k: string) => ({ authorization: `Bearer ${k}` });
  const title = `API ${uid()}`;
  const created = await request.post('/api/v1/notes', { headers: auth(key), data: { title, markdown: '# Hola\n\n- [ ] tarea', tags: ['api'] } });
  expect(created.status()).toBe(201);
  const note = ((await created.json()) as { data: { id: string; markdown: string } }).data;
  expect(note.markdown).toContain('tarea');
  expect((await request.post('/api/v1/notes', { headers: auth(readOnly), data: { title: 'no' } })).status()).toBe(403);
  expect((await request.get('/api/v1/notes')).status()).toBe(401);
  const list = (await (await request.get('/api/v1/notes?tag=api', { headers: auth(readOnly) })).json()) as { data: Array<{ id: string }> };
  expect(list.data.map((n) => n.id)).toContain(note.id);
  const patched = await request.patch(`/api/v1/notes/${note.id}`, { headers: auth(key), data: { pinned: true } });
  expect(((await patched.json()) as { data: { pinned: boolean } }).data.pinned).toBe(true);
  expect((await request.get('/api/v1/notes/notebooks', { headers: auth(readOnly) })).ok()).toBeTruthy();
  const mcp = await request.post('/api/v1/notes/mcp', { headers: auth(readOnly), data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { noteId: note.id } } } });
  expect(((await mcp.json()) as { result: { content: Array<{ text: string }> } }).result.content[0].text).toContain(title);
  expect((await request.delete(`/api/v1/notes/${note.id}`, { headers: auth(key) })).ok()).toBeTruthy();
  expect(((await (await request.get(`/api/notes/${note.id}`)).json()) as { trashed: boolean }).trashed).toBe(true);
});

test('Anotar una imagen agrega una copia a la nota', async ({ page, request }) => {
  const id = await fileNote(request, `Anotar ${uid()}`, 'foto.png', 'image/png', png(200, 150), 'image');
  await page.goto(`/en/app/notes?note=${id}`);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Annotate image or PDF' }).click();
  const dlg = page.getByRole('dialog', { name: 'Annotate' });
  const canvas = dlg.getByTestId('annotate-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Save a copy' }).click();
  await expect(dlg).toHaveCount(0);
  await expect
    .poll(async () => ((await (await request.get(`/api/notes/${id}`)).json()) as { content: Array<{ name?: string }> }).content.filter((b) => b.name?.includes('annotated')).length, { timeout: 10_000 })
    .toBe(1);
});

test('Anotar un PDF guarda un PDF', async ({ page, request }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  const id = await fileNote(request, `PDF ${uid()}`, 'doc.pdf', 'application/pdf', Buffer.from(await pdf.save()), 'pdf');
  await page.goto(`/en/app/notes?note=${id}`);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Annotate image or PDF' }).click();
  const dlg = page.getByRole('dialog', { name: 'Annotate' });
  const canvas = dlg.getByTestId('annotate-canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await dlg.getByRole('button', { name: 'Box' }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 3 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Save a copy' }).click();
  await expect(dlg).toHaveCount(0);
  await expect
    .poll(async () => ((await (await request.get(`/api/notes/${id}`)).json()) as { content: Array<{ name?: string; type: string }> }).content.filter((b) => b.type === 'pdf' && b.name?.includes('annotated')).length, { timeout: 10_000 })
    .toBe(1);
});

test('Transcribir un audio de la nota, con hablantes', async ({ page, request }) => {
  const id = await fileNote(request, `Audio ${uid()}`, 'a.weba', 'audio/webm', Buffer.from('fake-audio-bytes'), 'audio');
  await page.goto(`/en/app/notes?note=${id}`);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Transcribe audio' }).click();
  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.docs-paragraph', { hasText: /Speaker/ }).first()).toBeVisible();
});

test('Escaneo: detecta los bordes y junta dos páginas en un PDF', async ({ page, request }) => {
  const note = await newNote(request, { title: `Scan ${uid()}`, content: [para('x')] });
  await page.goto(`/en/app/notes?note=${note.id}`);
  await page.getByRole('button', { name: 'Scan document' }).click();
  const dlg = page.getByRole('dialog', { name: 'Scan a document' });
  const input = dlg.locator('input[type=file]');
  const sheet = { name: 'p.png', mimeType: 'image/png', buffer: png(300, 200, true) };
  await input.setInputFiles(sheet);
  const stage = dlg.locator('.notes-scan-stage');
  await expect(stage).toBeVisible();
  // La primera esquina cae cerca del 20% de la hoja, no en el 5% de fábrica.
  const left = await stage.locator('.notes-scan-handle').first().evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(left).toBeGreaterThan(15);
  await dlg.getByRole('button', { name: 'Add another page' }).click();
  await expect(dlg.getByText('1 page')).toBeVisible();
  await input.setInputFiles(sheet);
  await expect(dlg.getByText('2 pages')).toBeVisible();
  await dlg.getByRole('button', { name: /^Add/ }).last().click();
  await expect(dlg).toHaveCount(0);
  await expect
    .poll(async () => ((await (await request.get(`/api/notes/${note.id}`)).json()) as { content: Array<{ type: string }> }).content.filter((b) => b.type === 'pdf').length, { timeout: 10_000 })
    .toBe(1);
});

test('Tablas en una nota: filtrar y ordenar una base, con fórmula', async ({ page, request }) => {
  const note = await newNote(request, {
    title: `Tabla ${uid()}`,
    content: [
      {
        id: 'db1',
        type: 'database',
        content: '',
        db: {
          properties: [
            { id: 'name', name: 'Item', type: 'title' },
            { id: 'qty', name: 'Qty', type: 'number' },
            { id: 'dbl', name: 'Double', type: 'formula', formula: 'prop("Qty") * 2' },
          ],
          rows: [
            { id: 'r1', values: { name: 'Manzana', qty: 2 }, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
            { id: 'r2', values: { name: 'Banana', qty: 9 }, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
          ],
          views: [{ id: 'v1', name: 'Table', type: 'table', sorts: [{ property: 'qty', direction: 'desc' }], filters: [] }],
        },
      },
    ],
  });
  await page.goto(`/en/app/notes?note=${note.id}`);
  const wrap = page.getByTestId('docs-database');
  await expect(wrap).toBeVisible();
  const rows = wrap.locator('tbody tr, [role=row]');
  await expect(wrap.getByText('Banana')).toBeVisible();
  await expect(wrap.getByText('18', { exact: true })).toBeVisible();
  const text = await wrap.innerText();
  expect(text.indexOf('Banana')).toBeLessThan(text.indexOf('Manzana'));
  expect(await rows.count()).toBeGreaterThan(0);
  await wrap.getByRole('button', { name: /Filter/ }).click();
  await expect(page.getByRole('dialog').or(page.locator('.docs-db-popover')).first()).toBeVisible();
});

async function teammate(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; email: string }> {
  const email = `par-${uid()}@notes-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  // Primer pedido: crea a la persona. Después se suma al equipo del usuario demo.
  await ctx.request.get('/api/notes');
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [String(team), email] });
  } finally {
    db.close();
  }
  return { ctx, email };
}

test('Pedir acceso: no se ve nada, el dueño aprueba y queda abierta', async ({ browser, page, request, baseURL }) => {
  const title = `Privada ${uid()}`;
  const note = await newNote(request, { title, content: [para('secreto interno')] });
  const { ctx, email } = await teammate(browser, baseURL!);
  const other = await ctx.newPage();
  await other.goto(`/en/app/notes?note=${note.id}`);
  const gate = other.getByTestId('note-access-gate');
  await expect(gate).toBeVisible();
  await expect(other.getByText('secreto interno')).toHaveCount(0);
  await expect(other.getByText(title)).toHaveCount(0);
  await gate.getByRole('button', { name: 'Request access' }).click();
  await expect(gate.getByText('Request sent')).toBeVisible();
  // Recargar mantiene la pantalla de pedido.
  await other.reload();
  await expect(other.getByTestId('note-access-gate').getByText('Request sent')).toBeVisible();
  await page.goto(`/en/app/notes?note=${note.id}&requests=1`);
  await page.getByRole('button', { name: 'Can edit' }).click();
  await expect(page.getByRole('button', { name: 'Can edit' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: `Access for ${email.split('@')[0]}` })).toHaveValue('edit');
  await other.goto(`/en/app/notes?note=${note.id}`);
  await expect(other.locator('.docs-editable', { hasText: 'secreto interno' })).toBeVisible();
  await ctx.close();
});

test('Tareas: asignar a un compañero se la muestra en su vista', async ({ browser, request, baseURL }) => {
  const text = `Revisar ${uid()}`;
  const blockId = crypto.randomUUID();
  const note = await newNote(request, { title: `Asignada ${uid()}`, content: [{ id: blockId, type: 'todo', content: text, checked: false }] });
  const { ctx, email } = await teammate(browser, baseURL!);
  const shares = (await (await request.get(`/api/notes/${note.id}/shares`)).json()) as { candidates: Array<{ id: string; email: string }> };
  const mate = shares.candidates.find((c) => c.email === email)!;
  expect((await request.patch('/api/notes/tasks', { data: { note_id: note.id, block_id: blockId, assignee_id: mate.id, due: '2030-01-02' } })).ok()).toBeTruthy();
  const other = await ctx.newPage();
  await other.goto('/en/app/notes?view=tasks');
  await expect(other.getByText(text)).toBeVisible();
  await ctx.close();
});

test('Consola de admin: uso, links públicos y sin contenido privado', async ({ page, request }) => {
  const title = `Pública ${uid()}`;
  const note = await newNote(request, { title, content: [para('cuerpo privado')] });
  expect((await request.post(`/api/notes/${note.id}/share`, { data: { shared: true } })).ok()).toBeTruthy();
  await page.goto('/en/app/notes/settings');
  const admin = page.getByTestId('notes-admin');
  await expect(admin.getByRole('link', { name: title })).toBeVisible();
  await expect(admin.getByText('cuerpo privado')).toHaveCount(0);
  const row = admin.locator('li', { hasText: title });
  await row.getByRole('button', { name: 'Turn off link' }).click();
  await expect(admin.getByRole('link', { name: title })).toHaveCount(0);
  const after = (await (await request.get(`/api/notes/${note.id}`)).json()) as { share_token: string | null };
  expect(after.share_token).toBeNull();
});

test('Los paneles nuevos caben a 390 px, en claro y oscuro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of ['/en/app/notes?view=home', '/en/app/notes?view=tasks', '/en/app/notes/settings', '/en/app/notes/clip?url=https%3A%2F%2Fej.test%2Fa&title=A']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${url} ${scheme}`).toBeLessThanOrEqual(0);
    }
  }
});
