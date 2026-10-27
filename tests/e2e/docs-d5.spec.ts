import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'fs/promises';

/**
 * Docs D5 (clon de Notion): importar de Evernote, Confluence, Google Docs y
 * Word; exportar Markdown, HTML y PDF (página, subpáginas y workspace);
 * sitio publicado con dominio propio (DOCS_DOMAIN_FAKE), SEO, analítica y
 * "Duplicar"; vistas por página; celular (cajón y barra táctil) y sin conexión.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function pageWith(request: APIRequestContext, title: string, content: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title, ...extra } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Page options' }).click();
  return page.getByRole('menu', { name: 'Page options' });
}

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

test('D5: importar una libreta de Evernote desde la UI, con tareas y su imagen', async ({ page }) => {
  const tag = uid();
  const enex = `<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Nota ${tag}</title><content><![CDATA[<en-note><div>Hola ${tag}</div><div><en-todo checked="true"/>Hecho</div></en-note>]]></content></note><note><title>Otra ${tag}</title><content><![CDATA[<en-note><p>Dos</p></en-note>]]></content></note></en-export>`;
  await page.goto('/en/app/docs/import', { waitUntil: 'networkidle' });
  await page.getByTestId('docs-import-source').selectOption('evernote');
  await expect(page.getByTestId('docs-import-steps')).toContainText('Export notebook');
  await page.locator('#notion-file').setInputFiles({ name: `Libreta ${tag}.enex`, mimeType: 'application/xml', buffer: Buffer.from(enex) });
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  const preview = page.getByTestId('notion-import-preview');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toContainText(`Nota ${tag}`);
  await preview.getByRole('button', { name: /Import 3 pages/ }).click();
  const done = page.getByTestId('notion-import-done');
  await expect(done).toBeVisible({ timeout: 30_000 });
  await done.getByRole('link', { name: `Open Libreta ${tag}` }).click();
  await expect(page.locator('.docs-title')).toHaveText(`Libreta ${tag}`);
  // La nota es subpágina del cuaderno y se encuentra en el árbol.
  await expect(page.locator('.docs-sidebar, .docs-branch').getByText(`Nota ${tag}`).first()).toBeAttached();
});

test('D5: el import no acepta un teamspace de destino donde no se puede escribir', async ({ request }) => {
  // Sin teamspace al que pueda escribir: 403 si se manda uno inventado.
  const bad = await request.post('/api/import/jobs', { data: { app: 'docs', source: 'word', size: 100, teamspace_id: 'nope' } });
  expect(bad.status()).toBe(403);
});

test('D5: exportar una página como PDF, con subpáginas en HTML y el workspace en Markdown', async ({ request, page }) => {
  const tag = uid();
  const parent = await pageWith(request, `Export ${tag}`, [{ id: 'a', type: 'paragraph', content: `Texto ${tag} con ñ` }]);
  const child = await pageWith(request, `Hija ${tag}`, [{ id: 'b', type: 'paragraph', content: 'hija' }], { parent_id: parent.id });
  await page.goto(`/en/app/docs/${parent.id}`, { waitUntil: 'networkidle' });
  const menu = await openMenu(page);
  await menu.getByTestId('docs-export-open').click();
  const dialog = page.getByTestId('docs-export-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^PDF/).check();
  const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('docs-export-run').click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfBytes = await readFile((await pdf.path())!);
  expect(pdfBytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  await dialog.getByLabel(/^HTML/).check();
  await dialog.getByTestId('docs-export-subpages').check();
  const [zip] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('docs-export-run').click()]);
  expect(zip.suggestedFilename()).toMatch(/-html\.zip$/);
  const zipText = (await readFile((await zip.path())!)).toString('latin1');
  expect(zipText).toContain(`Hija ${tag} ${child.id.replace(/-/g, '').slice(0, 8)}.html`);
  expect(zipText).toContain('index.html');
  // Esc cierra el diálogo.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const ws = await request.get('/api/docs/export?format=md');
  expect(ws.status()).toBe(200);
  expect(ws.headers()['content-type']).toBe('application/zip');
  expect((await ws.body()).toString('latin1')).toContain(`Export ${tag}`);
  expect((await request.get('/api/docs/export?format=doc')).status()).toBe(400);
});

test('D5: sitio publicado con dominio propio, SEO, visitas y Duplicar a mi workspace', async ({ request, page }) => {
  const tag = uid();
  // Sin dominio de una corrida anterior: el link público es el de /h/<handle>.
  await request.delete('/api/docs/site/domain');
  const doc = await pageWith(request, `Plantilla ${tag}`, [{ id: 'a', type: 'paragraph', content: `Contenido ${tag}` }]);
  expect((await request.patch(`/api/docs/pages/${doc.id}`, { data: { published: true } })).ok()).toBeTruthy();

  // Compartir › Publicar: duplicar como plantilla y descripción.
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Share/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  const settings = dialog.getByTestId('docs-publish-settings');
  await expect(settings).toBeVisible();
  await settings.getByTestId('docs-allow-duplicate').check();
  await expect(settings.getByText('Saved.')).toBeVisible();
  await settings.getByLabel('Search description').fill(`Descripción ${tag}`);
  await settings.getByLabel('Search description').blur();
  await expect.poll(async () => ((await (await request.get(`/api/docs/pages/${doc.id}/site`)).json()) as { seo_description: string }).seo_description).toBe(`Descripción ${tag}`);
  const publicHref = (await dialog.locator('.docs-public-meta a').first().getAttribute('href'))!;
  await page.keyboard.press('Escape');

  // El artículo: meta description, JSON-LD y el botón Duplicar.
  await page.goto(publicHref, { waitUntil: 'networkidle' });
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', `Descripción ${tag}`);
  await expect(page.locator('script[type="application/ld+json"]')).toBeAttached();
  await page.getByTestId('help-duplicate').click();
  await expect(page.getByTestId('docs-duplicate-public')).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/en\/app\/docs\/[0-9a-f-]{36}$/);
  await expect(page.locator('.docs-title')).toHaveText(`Plantilla ${tag}`);
  expect(page.url()).not.toContain(doc.id);

  // Ajustes › Sitio: dominio propio (verificación de prueba) y visitas.
  await request.delete('/api/docs/site/domain');
  await page.goto('/en/app/docs/settings?tab=site', { waitUntil: 'networkidle' });
  const host = `docs-${tag}.acme.test`;
  await page.getByTestId('docs-site-domain-input').fill(host);
  await page.getByTestId('docs-site-domain-add').click();
  await expect(page.getByTestId('docs-site-domain-state')).toHaveText('Waiting for DNS');
  await expect(page.getByTestId('docs-site-domain').locator('.docs-dns')).toContainText('_zerosoft-verify');
  await page.getByTestId('docs-site-verify').click();
  await expect(page.getByTestId('docs-site-domain-state')).toHaveText('Verified and serving the site');
  await expect(page.getByTestId('docs-site-views')).toBeVisible();

  // El dominio sirve la portada y el artículo en la raíz, y su robots y sitemap.
  const slug = publicHref.split('/').pop()!;
  const home = await request.get('/', { headers: { host } });
  expect(home.status()).toBe(200);
  // Solo el sitio del cliente: nada del header ni del footer de marketing de zerosoft.
  const homeHtml = await home.text();
  expect(homeHtml).not.toContain('class="site-header');
  expect(homeHtml).not.toContain('class="site-footer"');
  expect(homeHtml).toContain('Help center');
  const article = await request.get(`/${slug}`, { headers: { host } });
  expect(article.status()).toBe(200);
  const html = await article.text();
  expect(html).toContain(`Contenido ${tag}`);
  expect(html).toContain(`https://${host}/${slug}`);
  expect((await request.get('/app/docs', { headers: { host } })).status()).toBe(404);
  expect(await (await request.get('/robots.txt', { headers: { host } })).text()).toContain(`https://${host}/sitemap.xml`);
  expect(await (await request.get('/sitemap.xml', { headers: { host } })).text()).toContain(`https://${host}/${slug}`);

  // Quitar el dominio (con confirmación).
  await page.getByRole('button', { name: 'Remove domain' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove domain' }).click();
  await expect(page.getByTestId('docs-site-domain-input')).toBeVisible();
});

test('D5: analítica de la página: vistas y quién la vio', async ({ request, page }) => {
  const doc = await pageWith(request, `Vistas ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'x' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const menu = await openMenu(page);
  await menu.getByTestId('docs-analytics-open').click();
  const panel = page.getByTestId('docs-analytics');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('docs-analytics-views')).not.toHaveText('0');
  await expect(panel.getByRole('heading', { name: 'Who viewed it' })).toBeVisible();
});

test('D5: a 390 px el árbol es un cajón, la barra táctil formatea y no hay scroll horizontal', async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tag = uid();
  const doc = await pageWith(request, `Móvil ${tag}`, [{ id: 'a', type: 'paragraph', content: `negrita ${tag}` }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await noHorizontalScroll(page);
  const drawer = page.getByTestId('docs-drawer');
  await expect(drawer).toBeHidden();
  await page.getByTestId('docs-drawer-toggle').click();
  await expect(drawer).toBeVisible();
  // Entra desde la izquierda (animación corta): termina pegado al borde.
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(340);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId('docs-drawer-toggle')).toBeFocused();
  // Barra táctil: aparece al editar y la negrita va por el mismo camino que Cmd+B.
  const block = page.locator('.docs-blocks .docs-editable', { hasText: `negrita ${tag}` }).first();
  await block.click();
  const bar = page.getByTestId('docs-touchbar');
  await expect(bar).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await bar.locator('[data-action="bold"]').click();
  await expect(block.locator('strong')).toHaveText(`negrita ${tag}`);
  await bar.locator('[data-action="done"]').click();
  await expect(bar).toBeHidden();
  await noHorizontalScroll(page);
  // Oscuro también.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByTestId('docs-drawer-toggle').click();
  await expect(drawer).toBeVisible();
  await page.getByTestId('docs-drawer-close').click();
  await expect(drawer).toBeHidden();
});

test('D5: sin conexión lo escrito queda en el dispositivo y se guarda al volver', async ({ request, page, context }) => {
  const tag = uid();
  const doc = await pageWith(request, `Offline ${tag}`, [{ id: 'a', type: 'paragraph', content: 'inicio' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(` sin red ${tag}`);
  await expect(page.getByTestId('docs-offline-banner')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('docs-save-status')).toHaveText('Saved on this device', { timeout: 10_000 });
  // El borrador es de esta persona en este workspace (la clave lleva el dueño).
  const findDraft = (id: string) => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('zs-docs-draft:') && k.endsWith(`|${id}`)) return localStorage.getItem(k);
    }
    return null;
  };
  const draft = await page.evaluate(findDraft, doc.id);
  expect(draft).toContain(`sin red ${tag}`);
  await context.setOffline(false);
  await expect
    .poll(async () => JSON.stringify(((await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { content: unknown }).content), { timeout: 15_000 })
    .toContain(`sin red ${tag}`);
  await expect(page.getByTestId('docs-offline-banner')).toBeHidden();
  expect(await page.evaluate(findDraft, doc.id)).toBeNull();
  // "Disponible sin conexión" queda marcado.
  const menu = await openMenu(page);
  await menu.getByTestId('docs-offline-toggle').click();
  const again = await openMenu(page);
  await expect(again.getByTestId('docs-offline-toggle')).toHaveAttribute('aria-checked', 'true');
});

test('D5: el cajón de Docs a 390 px no deja scroll horizontal en import ni ajustes del sitio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/en/app/docs/import', '/en/app/docs/settings?tab=site']) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
  }
});

