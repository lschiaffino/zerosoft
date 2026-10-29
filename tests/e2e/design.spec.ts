import { readFile } from 'fs/promises';
import { createClient } from '@libsql/client';
import { expect, test, type Page } from '@playwright/test';

/**
 * Design (como Canva) de punta a punta: crear desde una plantilla, editar un
 * texto en el lienzo, subir una imagen, exportar un PNG, compartir (workspace y
 * link público revocable) y comentar en el lienzo. Más el inicio, el kit de
 * marca, el teclado y 390px.
 */

// PNG real de 1×1 (se decodifica en el navegador al exportar).
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function designDoc(page: Page, id: string) {
  const r = await page.request.get(`/api/design/designs/${id}`);
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { design: { doc: { pages: Array<{ elements: Array<Record<string, unknown>> }> }; name: string } }).design;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('template → edit text → image → PNG → share → comment', async ({ page, browser, baseURL }) => {
  const errors = watchErrors(page);

  // 1. Desde una plantilla.
  await page.goto('/en/app/design/templates', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('design-template-list').locator('li')).toHaveCount(20);
  await page.getByTestId('design-template-ig-sale').click();
  await expect(page).toHaveURL(/\/en\/app\/design\/d[\w-]+$/);
  const id = page.url().split('/').pop()!;
  await expect(page.getByTestId('design-editor')).toBeVisible();
  await expect(page.getByTestId('design-name')).toHaveValue('Summer sale');

  // 2. Editar el texto en el lienzo (doble clic, escribir, Esc).
  const title = page.getByTestId('design-page').locator('g[data-el]').filter({ hasText: 'SUMMER' });
  await title.dblclick();
  const editor = page.getByTestId('design-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('MEGA\nSALE');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('design-page').locator('g[data-el]').filter({ hasText: 'MEGA' })).toHaveCount(1);
  await expect(page.getByTestId('design-save-status')).toHaveText('Saved', { timeout: 15_000 });
  await expect.poll(async () => JSON.stringify((await designDoc(page, id)).doc)).toContain('MEGA\\nSALE');

  // Deshacer y rehacer el cambio de texto.
  await page.getByTestId('design-undo').click();
  await expect(page.getByTestId('design-page').locator('g[data-el]').filter({ hasText: 'SUMMER' })).toHaveCount(1);
  await page.getByTestId('design-redo').click();
  await expect(page.getByTestId('design-page').locator('g[data-el]').filter({ hasText: 'MEGA' })).toHaveCount(1);

  // 3. Subir una imagen: queda en la página.
  await page.getByTestId('design-tab-uploads').click();
  await page.getByTestId('design-upload-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.getByTestId('design-upload-item').first()).toBeVisible();
  await expect(page.getByTestId('design-page').locator('image')).toHaveCount(1);
  await expect(page.getByTestId('design-save-status')).toHaveText('Saved', { timeout: 15_000 });
  await expect.poll(async () => (await designDoc(page, id)).doc.pages[0].elements.some((e) => e.type === 'image' && typeof e.src === 'string')).toBe(true);
  // Un SVG no se acepta (puede llevar scripts).
  const svg = await page.request.post('/api/design/files', { multipart: { file: { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') } } });
  expect(svg.status()).toBe(415);

  // 4. Exportar PNG (en el navegador).
  await page.getByTestId('design-download').click();
  const dialog = page.getByTestId('design-export');
  await expect(dialog).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('design-export-download').click()]);
  expect(download.suggestedFilename()).toBe('summer-sale.png');
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  await expect(dialog.getByTestId('design-export-status')).toContainText('summer-sale.png');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // 5. Compartir: el workspace puede ver y link público (revocable, noindex).
  await page.getByTestId('design-share-btn').click();
  const share = page.getByTestId('design-share');
  await share.getByTestId('design-share-workspace').selectOption('view');
  await expect(share.getByTestId('design-share-workspace')).toHaveValue('view');
  await share.getByTestId('design-share-link').check();
  const url = await share.getByTestId('design-share-url').inputValue();
  expect(url).toMatch(/\/en\/d\/[\w-]{16,}$/);
  // Otra persona (en DEMO_MODE toda request es el usuario demo salvo con esta cookie).
  const anon = await browser.newContext({ baseURL });
  await anon.addCookies([{ name: 'zs_e2e_as', value: `viewer-${uid()}@darwin-e2e.io`, url: baseURL! }]);
  const pub = await anon.newPage();
  const pubRes = await pub.goto(url, { waitUntil: 'networkidle' });
  expect(pubRes?.status()).toBe(200);
  await expect(pub.getByTestId('design-public')).toBeVisible();
  await expect(pub.getByRole('heading', { name: 'Summer sale' })).toBeVisible();
  await expect(pub.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  // La imagen se sirve con el token del link.
  const imgHref = await pub.getByTestId('design-public').locator('image').first().getAttribute('href');
  expect(imgHref).toMatch(/\?t=/);
  expect((await pub.request.get(imgHref!)).status()).toBe(200);
  // Revocar: el link deja de andar (y sus imágenes también).
  await share.getByTestId('design-share-link').uncheck();
  await expect(share.getByTestId('design-share-url')).toHaveCount(0);
  expect((await pub.goto(url))?.status()).toBe(404);
  expect((await pub.request.get(imgHref!)).status()).toBe(404);
  await anon.close();
  await share.getByRole('button', { name: 'Done' }).click();

  // 6. Comentar fijado en el lienzo.
  await page.getByTestId('design-comment-tool').click();
  await expect(page.getByTestId('design-comments')).toBeVisible();
  // El lienzo se reacomoda al abrir el panel: esperar a que la página quede quieta.
  let last = '';
  await expect
    .poll(async () => {
      const b = JSON.stringify(await page.getByTestId('design-page').boundingBox());
      const same = b === last;
      last = b;
      return same;
    })
    .toBe(true);
  const pageBox = (await page.getByTestId('design-page').boundingBox())!;
  await page.mouse.click(pageBox.x + pageBox.width * 0.7, pageBox.y + pageBox.height * 0.2);
  const composer = page.getByTestId('design-comment-new');
  await expect(composer).toBeVisible();
  await composer.locator('textarea').fill('Make the logo bigger');
  await composer.locator('textarea').press('Enter');
  const thread = page.getByTestId('design-thread').filter({ hasText: 'Make the logo bigger' });
  await expect(thread).toBeVisible();
  await expect(page.locator('[data-pin]')).toHaveCount(1);
  const comments = (await (await page.request.get(`/api/design/designs/${id}/comments`)).json()) as { comments: Array<{ body: string; x: number; y: number }> };
  expect(comments.comments[0]).toMatchObject({ body: 'Make the logo bigger' });
  expect(comments.comments[0].x).toBeGreaterThan(600);
  await thread.getByTestId('design-thread-resolve').click();
  await expect(page.locator('[data-pin]')).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('home: create from a preset, rename, star, folder, trash and restore', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/design', { waitUntil: 'networkidle' });
  await page.getByTestId('design-preset-presentation').click();
  await expect(page).toHaveURL(/\/en\/app\/design\/d[\w-]+$/);
  const id = page.url().split('/').pop()!;
  // Renombrar desde el editor: el sidebar lo muestra sin recargar.
  const name = `Deck ${Date.now()}`;
  await page.getByTestId('design-name').fill(name);
  await page.getByTestId('design-name').press('Enter');
  await expect(page.getByTestId('design-branch').getByRole('link', { name })).toBeVisible();
  await expect(page.getByTestId('design-branch').getByRole('link', { name })).toHaveAttribute('aria-current', 'page');

  // Teclado: T agrega un texto, Delete lo borra, Ctrl+Z lo vuelve a poner.
  await page.getByTestId('design-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('t');
  await expect(page.getByTestId('design-page').locator('g[data-el]')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('design-page').locator('g[data-el]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('design-page').locator('g[data-el]')).toHaveCount(1);
  // Páginas: agregar una segunda.
  await page.getByTestId('design-add-page').click();
  await expect(page.getByTestId('design-pages').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('design-save-status')).toHaveText('Saved', { timeout: 15_000 });

  await page.goto('/en/app/design?view=mine', { waitUntil: 'networkidle' });
  const card = page.getByTestId('design-card').filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 pages');
  // Carpeta nueva y mover.
  await page.getByTestId('design-view-recent').click();
  await expect(page).toHaveURL(/\/en\/app\/design$/);
  await expect(page.getByTestId('design-view-recent')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('design-new-folder').click();
  const folderName = `Folder ${Date.now()}`;
  await page.getByTestId('design-name-dialog').getByRole('textbox').fill(folderName);
  await page.getByTestId('design-name-dialog').getByRole('textbox').press('Enter');
  await expect(page.getByTestId('design-folder').filter({ hasText: folderName })).toBeVisible();
  await page.getByTestId('design-card').filter({ hasText: name }).getByTestId('design-card-menu').click();
  await page.getByRole('menuitem', { name: 'Move to folder' }).click();
  await page.getByRole('button', { name: folderName }).click();
  await page.getByTestId('design-folder').filter({ hasText: folderName }).click();
  await expect(page.getByTestId('design-card').filter({ hasText: name })).toBeVisible();
  // A la papelera y de vuelta.
  await page.getByTestId('design-card').filter({ hasText: name }).getByTestId('design-card-menu').click();
  await page.getByTestId('design-card-delete').click();
  await expect(page.getByTestId('design-card').filter({ hasText: name })).toHaveCount(0);
  await page.goto('/en/app/design?view=trash', { waitUntil: 'networkidle' });
  await page.getByTestId('design-card').filter({ hasText: name }).getByTestId('design-card-menu').click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByTestId('design-card').filter({ hasText: name })).toHaveCount(0);
  const r = await page.request.get(`/api/design/designs/${id}`);
  expect(r.ok()).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('brand kit: an admin adds a color and the editor applies it', async ({ page, request }) => {
  await page.goto('/en/app/design/brand', { waitUntil: 'networkidle' });
  const hex = page.getByTestId('design-brand-color').locator('input.dz-color-hex');
  await hex.fill('#ff5b3a');
  await hex.press('Enter');
  await page.getByTestId('design-brand-add-color').click();
  await page.getByTestId('design-brand-save').click();
  await expect(page.getByText('Brand kit saved.')).toBeVisible();
  const { design } = (await (await request.post('/api/design/designs', { data: { width: 500, height: 500, name: 'Brand test' } })).json()) as { design: { id: string } };
  await page.goto(`/en/app/design/${design.id}`, { waitUntil: 'networkidle' });
  // Elementos es la pestaña abierta al entrar.
  await page.getByTestId('design-add-shape-rect').click();
  await page.getByTestId('design-tab-brand').click();
  await page.getByRole('button', { name: 'Apply #ff5b3a' }).click();
  await expect(page.getByTestId('design-page').locator('g[data-el] path[fill="#ff5b3a"]')).toHaveCount(1);
});

test('public links: a made-up token is a 404; Cmd+K finds text inside designs', async ({ page, request }) => {
  // Un token inventado no abre nada.
  const res = await page.goto('/en/d/zzzzzzzzzzzzzzzzzzzzzzzz');
  expect(res?.status()).toBe(404);
  // Cmd+K encuentra un diseño por el texto de adentro.
  const { design } = (await (await request.post('/api/design/designs', { data: { template: 'a4-menu', locale: 'en' } })).json()) as { design: { id: string; name: string } };
  await page.goto('/en/app/design', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('Cinnamon roll');
  await expect(dialog.getByRole('option', { name: new RegExp(design.name) }).first()).toBeVisible();
});

test('390px: home and editor fit without horizontal scroll, light and dark', async ({ page, context, baseURL, request }) => {
  const { design } = (await (await request.post('/api/design/designs', { data: { template: 'story-poll', locale: 'en' } })).json()) as { design: { id: string } };
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ['/en/app/design', `/en/app/design/${design.id}`, '/en/app/design/templates', '/en/app/design/brand']) {
      const errors = watchErrors(page);
      await page.goto(url, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll, `${url} ${theme}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
      expect(errors, errors.join('\n')).toEqual([]);
    }
  }
});

test('per-app access: a member without Design sees no pages, APIs, search, files or key scopes', async ({ request, browser, baseURL }) => {
  test.setTimeout(120_000);
  const name = `No design ${uid()}`;
  const { design } = (await (await request.post('/api/design/designs', { data: { width: 500, height: 500, name } })).json()) as { design: { id: string } };
  await request.put(`/api/design/designs/${design.id}/share`, { data: { workspaceAccess: 'edit' } });
  const file = await request.post('/api/design/files', { multipart: { file: { name: 'dot.png', mimeType: 'image/png', buffer: PNG_1PX } } });
  const fileId = ((await file.json()) as { file: { id: string } }).file.id;

  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `nodesign-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["crm"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);

    await p.goto(`/en/app/design/${design.id}`, { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\?blocked=design/);
    expect(await p.content()).not.toContain(name);
    for (const path of ['/api/design/designs', `/api/design/designs/${design.id}`, '/api/design/brand', '/api/design/templates']) {
      expect((await ctx.request.get(path)).status(), path).toBe(401);
    }
    expect((await ctx.request.get(`/api/design/files/${fileId}`)).status()).toBe(404);
    const search = (await (await ctx.request.get(`/api/search?q=${encodeURIComponent(name)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.startsWith('/app/design'))).toEqual([]);
    expect((await ctx.request.post('/api/keys', { data: { name: 'nope', scopes: ['design:read'] } })).status()).toBe(403);
    // Con Design en sus apps, el diseño compartido con el workspace aparece.
    await sql(`UPDATE team_members SET apps = '["crm","design"]' WHERE team_id = ? AND user_id = ?`, [demoTeam, me]);
    expect((await ctx.request.get(`/api/design/designs/${design.id}`)).status()).toBe(200);
  } finally {
    await ctx.close();
  }
});

test('a viewer cannot publish a template, an editor cannot turn on the public link, and images follow the design', async ({ request, browser, baseURL }) => {
  test.setTimeout(120_000);
  type DocResp = { design: { doc: { pages: Array<{ background: { image: string | null } }> }; version: number } };
  const name = `Private ${uid()}`;
  const { design } = (await (await request.post('/api/design/designs', { data: { width: 500, height: 500, name } })).json()) as { design: { id: string } };
  const up = await request.post('/api/design/files', { multipart: { file: { name: 'dot.png', mimeType: 'image/png', buffer: PNG_1PX } } });
  const fileId = ((await up.json()) as { file: { id: string } }).file.id;
  const d = (await (await request.get(`/api/design/designs/${design.id}`)).json()) as DocResp;
  d.design.doc.pages[0].background.image = fileId;
  expect((await request.patch(`/api/design/designs/${design.id}`, { data: { doc: d.design.doc, version: d.design.version } })).status()).toBe(200);

  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `member-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["design"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);

    // Privado: ni el diseño ni su imagen.
    expect((await ctx.request.get(`/api/design/designs/${design.id}`)).status()).toBe(404);
    expect((await ctx.request.get(`/api/design/files/${fileId}`)).status()).toBe(404);

    // Con acceso de lectura ve la imagen, pero no publica el diseño como plantilla del workspace.
    expect((await request.put(`/api/design/designs/${design.id}/share`, { data: { members: [{ userId: me, role: 'view' }] } })).status()).toBe(200);
    expect((await ctx.request.get(`/api/design/files/${fileId}`)).status()).toBe(200);
    expect((await ctx.request.post(`/api/design/designs/${design.id}/template`, { data: { name: 'Leaked' } })).status()).toBe(403);
    expect(await (await ctx.request.get('/api/design/templates')).text()).not.toContain('Leaked');
    await p.goto(`/en/app/design/${design.id}`, { waitUntil: 'networkidle' });
    await p.getByTestId('design-more').click();
    await expect(p.getByTestId('design-save-template')).toHaveCount(0);

    // Con edición comparte, pero el link público lo maneja quien lo creó.
    expect((await request.put(`/api/design/designs/${design.id}/share`, { data: { members: [{ userId: me, role: 'edit' }] } })).status()).toBe(200);
    expect((await ctx.request.put(`/api/design/designs/${design.id}/share`, { data: { link: 'on' } })).status()).toBe(403);
    expect((await ctx.request.post(`/api/design/designs/${design.id}/template`, { data: { name: 'Leaked' } })).status()).toBe(403);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByTestId('design-share-btn').click();
    await expect(p.getByTestId('design-share-link')).toBeDisabled();

    // Una imagen que no puede ver no entra en un diseño suyo.
    const theirs = (await (await request.post('/api/design/files', { multipart: { file: { name: 'b.png', mimeType: 'image/png', buffer: PNG_1PX } } })).json()) as { file: { id: string } };
    const mine = (await (await ctx.request.post('/api/design/designs', { data: { width: 300, height: 300, name: 'Mine' } })).json()) as { design: { id: string } };
    const m = (await (await ctx.request.get(`/api/design/designs/${mine.design.id}`)).json()) as DocResp;
    m.design.doc.pages[0].background.image = theirs.file.id;
    expect((await ctx.request.patch(`/api/design/designs/${mine.design.id}`, { data: { doc: m.design.doc, version: m.design.version } })).status()).toBe(403);
  } finally {
    await ctx.close();
  }
});

test('a design that does not exist is a real 404', async ({ page }) => {
  const res = await page.goto('/en/app/design/dzzzzzzzzzzzzzzzz');
  expect(res?.status()).toBe(404);
});
