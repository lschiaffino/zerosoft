import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@libsql/client';

/**
 * Docs, tanda D1 (editor como Notion): archivos (video, PDF, imagen con
 * ancho/alineación/leyenda), columnas arrastrando al costado, links pegados
 * como bookmark o embed, bloques avanzados (sincronizado, ecuación, índice,
 * botón, breadcrumb), menciones de fecha con recordatorio, ícono y portada
 * subidos, favoritos y plantillas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

type Block = {
  id: string;
  type: string;
  content: string;
  indent?: number;
  [k: string]: unknown;
};

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok()).toBeTruthy();
  return doc;
}

async function content(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}

async function page(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/docs/pages/${id}`)).json()) as { icon: string | null; cover_url: string | null; cover_position?: number; title: string; content: Block[] };
}

const editable = (p: Page, text: string) => p.locator('.docs-blocks .docs-editable', { hasText: text });

async function slash(p: Page, query: string) {
  await p.keyboard.type(`/${query}`);
  await expect(p.locator('.docs-command-menu')).toBeVisible();
  await p.keyboard.press('Enter');
}

// PNG de 1×1 (válido) para imagen, ícono y portada.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('Docs: arrastrar un bloque al costado arma columnas; /columnas; en el teléfono se apilan', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Columnas ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Izquierda' },
    { id: 'b', type: 'paragraph', content: 'Abajo' },
    { id: 'c', type: 'paragraph', content: 'Derecha' },
  ]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const target = p.locator('.docs-block-outer[data-bi="0"]');
  const tBox = (await target.boundingBox())!;
  await p.locator('.docs-block-outer[data-bi="2"]').hover();
  const grip = p.locator('.docs-block-outer[data-bi="2"] .docs-block-grip');
  const gBox = (await grip.boundingBox())!;
  await p.mouse.move(gBox.x + gBox.width / 2, gBox.y + gBox.height / 2);
  await p.mouse.down();
  await p.mouse.move(gBox.x + 20, gBox.y - 10, { steps: 4 });
  await p.mouse.move(tBox.x + tBox.width - 10, tBox.y + tBox.height / 2, { steps: 8 });
  await expect(p.locator('.docs-drop-line.is-vertical')).toBeVisible();
  await p.mouse.up();
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => b.type), { timeout: 10_000 })
    .toEqual(['columns', 'column', 'paragraph', 'column', 'paragraph', 'paragraph']);
  await expect(p.getByTestId('docs-column')).toHaveCount(2);
  const [c1, c2] = await p.getByTestId('docs-column').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(Math.abs(c1 - c2)).toBeLessThan(4);

  // Separador con teclado: la primera columna crece.
  await p.locator('.docs-column-resizer').focus();
  await p.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await content(request, doc.id)).filter((b) => b.type === 'column').map((b) => b.ratio))
    .toEqual([1.1, 0.9]);

  // /3 columnas desde una línea vacía.
  await editable(p, 'Abajo').click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await slash(p, 'columns');
  await expect(p.getByTestId('docs-columns')).toHaveCount(2);

  // A 390px las columnas se apilan sin scroll horizontal.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: 'networkidle' });
  const tops = await p.getByTestId('docs-columns').first().getByTestId('docs-column').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(tops[1]).toBeGreaterThan(tops[0]);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('Docs: video, PDF e imagen con ancho, alineación y leyenda', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Archivos ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-blocks .docs-editable').first().click();
  await slash(p, 'video');
  await p.getByTestId('docs-file-input').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake video bytes') });
  await expect(p.getByTestId('docs-video-block').locator('video')).toBeVisible();
  await expect.poll(async () => (await content(request, doc.id)).map((b) => b.type)).toEqual(['video', 'paragraph']);
  // La ruta con permisos sirve el video en línea (y acepta rangos).
  const vid = (await content(request, doc.id))[0];
  const ranged = await request.get(`/api/docs/files/${doc.id}/${vid.id}`, { headers: { Range: 'bytes=0-3' } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['content-type']).toBe('video/mp4');
  expect(await ranged.text()).toBe('fake');

  await p.getByTestId('docs-video-block').focus();
  await p.keyboard.press('Enter');
  await slash(p, 'pdf');
  await p.getByTestId('docs-file-input').setInputFiles({ name: 'manual.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(p.getByTestId('docs-pdf-block').locator('iframe')).toBeVisible();

  await p.getByTestId('docs-pdf-block').focus();
  await p.keyboard.press('Enter');
  await slash(p, 'image');
  await p.getByTestId('docs-file-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  const img = p.getByTestId('docs-image-block');
  await expect(img.locator('img')).toBeVisible();
  await img.hover();
  await img.getByRole('button', { name: 'Align right' }).click();
  await img.locator('.docs-media-handle-right').focus();
  await p.keyboard.press('ArrowLeft');
  await img.getByRole('button', { name: 'Caption' }).click();
  await p.keyboard.type('Un punto');
  await p.keyboard.press('Enter');
  await expect
    .poll(async () => {
      const b = (await content(request, doc.id)).find((x) => x.type === 'image');
      return b ? [b.align, b.width, b.caption] : null;
    }, { timeout: 10_000 })
    .toEqual(['right', 95, 'Un punto']);
});

test('Docs: un link pegado se convierte en bookmark o embed', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Links ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const paste = async (text: string) =>
    p.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
  await p.locator('.docs-blocks .docs-editable').first().click();
  await paste('https://example.com/post');
  const menu = p.getByTestId('docs-paste-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Mention', 'Bookmark', 'Keep as link']);
  await menu.getByRole('menuitem', { name: 'Bookmark' }).click();
  await expect(p.getByTestId('docs-bookmark-card')).toContainText('example.com page');
  await expect(p.getByTestId('docs-bookmark-card')).toContainText('Preview of example.com');

  await p.locator('.docs-blocks .docs-editable').last().click();
  await paste('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(menu.getByRole('menuitem')).toHaveText(['Mention', 'Bookmark', 'Embed', 'Keep as link']);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  const frame = p.getByTestId('docs-embed-block').locator('iframe');
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect.poll(async () => (await content(request, doc.id)).map((b) => b.type)).toEqual(['bookmark', 'embed', 'paragraph']);

  // /embed con un link que no se puede embeber avisa.
  await p.locator('.docs-blocks .docs-editable').last().click();
  await slash(p, 'embed');
  await p.locator('.docs-link-url-input').fill('https://example.com/nope');
  await p.keyboard.press('Enter');
  await expect(p.locator('.docs-link-error')).toContainText("can't be embedded");
});

test('Docs: ecuación en bloque y en línea, índice, botón y breadcrumb', async ({ request, page: p }) => {
  const parent = await pageWith(request, `Padre ${uid()}`, [{ id: 'x', type: 'paragraph', content: '' }]);
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Avanzados ${uid()}`, parent_id: parent.id } })).json()) as { id: string };
  await request.patch(`/api/docs/pages/${doc.id}`, {
    data: {
      content: [
        { id: 'h1', type: 'heading', level: 1, content: 'Intro' },
        { id: 'h2', type: 'heading', level: 2, content: 'Detalle' },
        { id: 'a', type: 'paragraph', content: '' },
      ],
    },
  });
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-blocks .docs-editable').last().click();
  await slash(p, 'equation');
  await p.locator('.docs-equation-input').fill('E = mc^2');
  await p.getByRole('button', { name: 'Done' }).click();
  await expect(p.getByTestId('docs-equation-block').locator('.katex')).toBeVisible();

  await p.locator('.docs-blocks .docs-editable').last().click();
  await p.keyboard.type('Área $$\\pi r^2$$');
  await expect(p.locator('.docs-blocks span[data-tex]')).toHaveCount(1);

  await p.keyboard.press('Enter');
  await slash(p, 'toc');
  const toc = p.getByTestId('docs-toc-block');
  await expect(toc.getByRole('link')).toHaveText(['Intro', 'Detalle']);

  await p.locator('.docs-blocks .docs-editable').last().click();
  await slash(p, 'breadcrumb');
  await expect(p.getByTestId('docs-breadcrumb-block')).toContainText('Padre');

  await p.locator('.docs-blocks .docs-editable').last().click();
  await slash(p, 'button');
  const btn = p.getByTestId('docs-button-block');
  await btn.getByLabel('Button name').fill('Agregar tarea');
  await btn.getByLabel('Blocks to insert (Markdown)').fill('- [ ] Seguimiento');
  await btn.getByRole('button', { name: 'Save button' }).click();
  await btn.getByTestId('docs-button-run').click();
  await expect(editable(p, 'Seguimiento')).toBeVisible();

  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => b.type), { timeout: 10_000 })
    .toEqual(['heading', 'heading', 'equation', 'paragraph', 'toc', 'breadcrumb', 'button', 'todo', 'paragraph']);
  const blocks = await content(request, doc.id);
  expect(blocks.find((b) => b.type === 'paragraph' && String(b.content).includes('data-tex'))?.content).toContain('data-tex="\\pi r^2"');
});

test('Docs: bloque sincronizado: lo editado en una página se ve en la otra', async ({ request, page: p }) => {
  const syncedId = crypto.randomUUID();
  const synced = (text: string): Block[] => [
    { id: crypto.randomUUID(), type: 'synced', content: '', synced_id: syncedId },
    { id: crypto.randomUUID(), type: 'paragraph', content: text, indent: 1 },
  ];
  const a = await pageWith(request, `Sincro A ${uid()}`, synced('Original'));
  const b = await pageWith(request, `Sincro B ${uid()}`, synced('Original'));
  await p.goto(`/en/app/docs/${b.id}`, { waitUntil: 'networkidle' });
  await expect(p.getByTestId('docs-synced')).toBeVisible();
  await editable(p, 'Original').click();
  await p.keyboard.press('End');
  await p.keyboard.type(' editada');
  await expect.poll(async () => (await content(request, b.id))[1]?.content, { timeout: 10_000 }).toBe('Original editada');
  await p.goto(`/en/app/docs/${a.id}`, { waitUntil: 'networkidle' });
  await expect(editable(p, 'Original editada')).toBeVisible();

  // Desincronizar: el contenido queda como bloques comunes.
  await p.getByTestId('docs-synced').hover();
  await p.locator('.docs-synced-outer > .docs-block-grip').click();
  await p.getByRole('button', { name: 'Unsync' }).click();
  await expect.poll(async () => (await content(request, a.id)).map((x) => x.type)).toEqual(['paragraph']);
});

test('Docs: @mañana y un recordatorio que avisa a su hora', async ({ request, page: p }) => {
  const title = `Fecha ${uid()}`;
  const doc = await pageWith(request, title, [{ id: 'a', type: 'paragraph', content: '' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-blocks .docs-editable').first().click();
  await p.keyboard.type('Entrega @tomorrow');
  await expect(p.getByTestId('docs-date-option').first()).toContainText('Tomorrow');
  await p.keyboard.press('Enter');
  await expect(p.locator('.docs-blocks .docs-date-mention')).toHaveCount(1);
  await p.keyboard.type('y @remind tomorrow 9am');
  await expect(p.getByTestId('docs-date-option')).toHaveCount(1);
  await expect(p.getByTestId('docs-date-option')).toContainText('Remind me');
  await p.keyboard.press('Enter');
  await expect(p.locator('.docs-blocks .docs-date-mention.has-reminder')).toHaveCount(1);
  await expect.poll(async () => String((await content(request, doc.id))[0]?.content), { timeout: 10_000 }).toContain('data-remind=');

  // Se adelanta el recordatorio y corre el cron: llega a la campana.
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  await expect
    .poll(async () => Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM docs_reminders WHERE page_id = ?', args: [doc.id] })).rows[0].n), { timeout: 10_000 })
    .toBe(1);
  await db.execute({ sql: "UPDATE docs_reminders SET remind_at = '2020-01-01T00:00:00.000Z' WHERE page_id = ?", args: [doc.id] });
  db.close();
  const cron = await request.get('/api/cron/minute', { headers: { Authorization: 'Bearer e2e-cron' }, timeout: 120_000 });
  expect(cron.ok()).toBeTruthy();
  const notes = (await (await request.get('/api/notifications?limit=50')).json()) as { rows: Array<{ title: string; type: string }> };
  expect(notes.rows.some((n) => n.type === 'docs_reminder' && n.title.includes(title))).toBe(true);
});

test('Docs: ícono y portada subidos, galería de colores y reposicionar', async ({ request, page: p }) => {
  const title = `Portada ${uid()}`;
  const doc = await pageWith(request, title, [{ id: 'a', type: 'paragraph', content: 'Hola' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-page-header').hover();
  await p.getByRole('button', { name: 'Add cover' }).click();
  const picker = p.getByTestId('docs-cover-picker');
  await picker.getByRole('button', { name: 'Cover: Ocean' }).click();
  await expect(p.getByTestId('docs-cover')).toHaveClass(/docs-cover-color-ocean/);
  await expect.poll(async () => (await page(request, doc.id)).cover_url).toBe('color:ocean');

  await p.getByTestId('docs-cover').hover();
  await p.getByRole('button', { name: 'Change cover' }).click();
  await picker.getByRole('tab', { name: 'Upload' }).click();
  await picker.getByTestId('docs-cover-file').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await expect(p.getByTestId('docs-cover').locator('img')).toBeVisible();
  await expect.poll(async () => (await page(request, doc.id)).cover_url ?? '').toMatch(/^\/uploads\/docs\//);
  await p.getByTestId('docs-cover').hover();
  await p.getByRole('button', { name: 'Reposition' }).click();
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('Enter');
  await expect.poll(async () => (await page(request, doc.id)).cover_position).toBe(55);
  const cover = await request.get(`/api/docs/files/${doc.id}/cover`);
  expect(cover.headers()['content-type']).toBe('image/png');

  // Ícono: imagen subida desde el selector de emoji; se ve en el sidebar.
  await p.locator('.docs-page-header').hover();
  await p.getByRole('button', { name: 'Add icon' }).click();
  await p.getByTestId('docs-icon-file').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(async () => (await page(request, doc.id)).icon ?? '').toMatch(/^img:\/uploads\/docs\//);
  await expect(p.locator('.docs-page-header img.docs-icon-img')).toBeVisible();
  await p.reload({ waitUntil: 'networkidle' });
  await expect(p.getByTestId('docs-tree-row').filter({ hasText: title }).locator('img.docs-page-icon-img')).toBeVisible();
  // Oscuro: la portada y el ícono se siguen viendo.
  await p.emulateMedia({ colorScheme: 'dark' });
  await expect(p.getByTestId('docs-cover').locator('img')).toBeVisible();
});

test('Docs: favoritos con la estrella, en el sidebar y ordenables', async ({ request, page: p }) => {
  const one = await pageWith(request, `Fav uno ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  const two = await pageWith(request, `Fav dos ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await p.goto(`/en/app/docs/${one.id}`, { waitUntil: 'networkidle' });
  await p.getByTestId('docs-favorite-button').click();
  await expect(p.getByTestId('docs-favorite-button')).toHaveAttribute('aria-pressed', 'true');
  const favs = p.getByTestId('docs-favorites');
  await expect(favs.getByTestId('docs-favorite-row')).toHaveCount(1);
  await expect(favs.locator('[aria-current="page"]')).toHaveCount(1);
  await p.goto(`/en/app/docs/${two.id}`, { waitUntil: 'networkidle' });
  await p.getByTestId('docs-favorite-button').click();
  await expect(favs.getByTestId('docs-favorite-row')).toHaveCount(2);
  // Alt+↑ en el segundo lo sube.
  await favs.getByTestId('docs-favorite-row').nth(1).getByRole('link').focus();
  await p.keyboard.press('Alt+ArrowUp');
  await expect
    .poll(async () => ((await (await request.get('/api/docs/favorites')).json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id))
    .toEqual([two.id, one.id]);
  await p.getByTestId('docs-favorite-button').click();
  await expect(favs.getByTestId('docs-favorite-row')).toHaveCount(1);
});

test('Docs: galería de plantillas, página vacía con plantilla y plantillas de fila', async ({ request, page: p }) => {
  await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await p.getByTestId('docs-templates-open').click();
  const gallery = p.getByTestId('docs-template-gallery');
  await expect(gallery).toBeVisible();
  await gallery.getByRole('button', { name: 'Engineering', exact: true }).click();
  await gallery.getByTestId('docs-template-bug').click();
  await expect(gallery.locator('.docs-tg-preview-body')).toContainText('Steps to reproduce');
  await gallery.getByRole('button', { name: 'Work', exact: true }).click();
  await gallery.getByTestId('docs-template-project').click();
  await gallery.getByTestId('docs-template-use').click();
  await p.waitForURL(/\/app\/docs\/[0-9a-f-]{36}/);
  await expect(p.locator('.docs-title')).toHaveText('Project plan');
  await expect(p.locator('.docs-db-wrap')).toBeVisible();

  // Página vacía: empezar con una plantilla.
  const empty = (await (await request.post('/api/docs/pages', { data: { title: '' } })).json()) as { id: string };
  await p.goto(`/en/app/docs/${empty.id}`, { waitUntil: 'networkidle' });
  await p.getByTestId('docs-page-templates').click();
  await gallery.getByRole('button', { name: 'Personal', exact: true }).click();
  await gallery.getByTestId('docs-template-todo').click();
  await gallery.getByTestId('docs-template-use').click();
  await expect.poll(async () => (await page(request, empty.id)).title).toBe('To-do list');
  await p.keyboard.press('Escape');

  // Base: guardar una fila como plantilla y crear otra desde ella.
  const now = new Date().toISOString();
  const dbPage = await pageWith(request, `Base ${uid()}`, [
    {
      id: 'db1',
      type: 'database',
      content: '',
      db: {
        properties: [{ id: 'name', name: 'Name', type: 'title' }],
        rows: [{ id: 'r1', values: { name: 'Bug' }, body: [{ id: 'b1', type: 'paragraph', content: 'Pasos para reproducir' }], created_at: now, updated_at: now }],
        views: [{ id: 'v1', name: '', type: 'table' }],
      },
    },
  ]);
  await p.goto(`/en/app/docs/${dbPage.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-db-open').first().click({ force: true });
  const panel = p.getByTestId('docs-db-rowpanel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('docs-db-save-template').click();
  await expect(panel.getByTestId('docs-db-save-template')).toContainText('Saved as template');
  await panel.getByRole('button', { name: 'Close' }).click();
  await p.getByTestId('docs-db-templates').click();
  await p.getByRole('menuitem', { name: 'Bug' }).click();
  await expect(p.getByTestId('docs-db-rowpanel')).toContainText('Pasos para reproducir');
  await expect
    .poll(async () => {
      const db = (await content(request, dbPage.id)).find((x) => x.type === 'database')?.db as { rows: Array<{ body?: Block[] }>; templates?: unknown[] } | undefined;
      return db ? [db.rows.length, db.rows[1]?.body?.[0]?.content, db.templates?.length] : null;
    }, { timeout: 10_000 })
    .toEqual([2, 'Pasos para reproducir', 1]);
});

test('Docs y Notes: al terminar de subir, lo tipeado va a la línea de abajo (sin atajos globales)', async ({ request, page: p }) => {
  const doc = await pageWith(request, `Subir y tipear ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const url = p.url();
  await p.locator('.docs-blocks .docs-editable').first().click();
  const chooser = p.waitForEvent('filechooser');
  await slash(p, 'image');
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await expect(p.getByTestId('docs-image-block').locator('img')).toBeVisible();
  await expect(p.locator('.docs-blocks .docs-editable').last()).toBeFocused();
  // "c" crea una página si el foco quedó en body: acá tiene que escribir.
  await p.keyboard.type('cnsigo');
  await expect(p).toHaveURL(url);
  await expect
    .poll(async () => (await content(request, doc.id)).map((b) => [b.type, b.content]))
    .toEqual([['image', ''], ['paragraph', 'cnsigo']]);

  const note = (await (await request.post('/api/notes', { data: { title: `Nota subir ${uid()}`, content: [{ id: 'n1', type: 'paragraph', content: '' }] } })).json()) as { id: string };
  await p.goto(`/en/app/notes?note=${note.id}`, { waitUntil: 'networkidle' });
  await p.locator('.note-body .docs-blocks .docs-editable').first().click();
  const chooser2 = p.waitForEvent('filechooser');
  await slash(p, 'image');
  await (await chooser2).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await expect(p.locator('.note-body').getByTestId('docs-image-block').locator('img')).toBeVisible();
  await expect(p.locator('.note-body .docs-blocks .docs-editable').last()).toBeFocused();
  await p.keyboard.type('nsigo');
  await expect(p.locator('.note-body .docs-blocks .docs-editable').last()).toHaveText('nsigo');
});

test.describe('Docs: recordatorio con el idioma y la zona del navegador', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  test('el recordatorio guarda es + Asia/Tokyo', async ({ request, page: p }) => {
    const doc = await pageWith(request, `Zona ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
    await p.goto(`/es/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
    await p.locator('.docs-blocks .docs-editable').first().click();
    await p.keyboard.type('Llamar @recordar mañana 9:00');
    await expect(p.getByTestId('docs-date-option')).toHaveCount(1);
    await p.keyboard.press('Enter');
    await expect(p.locator('.docs-blocks .docs-date-mention.has-reminder')).toHaveCount(1);
    const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
    await expect
      .poll(
        async () => {
          const r = (await db.execute({ sql: 'SELECT locale, timezone FROM docs_reminders WHERE page_id = ?', args: [doc.id] })).rows[0];
          return r ? [r.locale, r.timezone] : null;
        },
        { timeout: 10_000 },
      )
      .toEqual(['es', 'Asia/Tokyo']);
    db.close();
  });
});
