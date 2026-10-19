import { expect, test, type APIRequestContext } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

async function createPage(request: APIRequestContext, data: Record<string, unknown>) {
  return (await (await request.post('/api/docs/pages', { data })).json()) as { id: string; title: string; slug?: string };
}

test('Docs: el árbol es como Notion (flecha, ícono, sangría) y marca la página abierta', async ({ request, page }) => {
  const parent = await createPage(request, { title: `Madre ${uid()}` });
  const child = await createPage(request, { title: `Hija ${uid()}`, parent_id: parent.id });
  await page.goto(`/en/app/docs/${child.id}`, { waitUntil: 'networkidle' });

  const active = page.locator('.docs-tree-row.active');
  await expect(active).toHaveCount(1);
  await expect(active.locator('.docs-tree-link')).toHaveAttribute('aria-current', 'page');
  await expect(active).toContainText(child.title);
  // Sin ícono elegido va el documento genérico (no un emoji de fábrica) y no hay estaciones.
  await expect(active.locator('.docs-tree-icon svg')).toBeVisible();
  await expect(page.locator('.docs-tree')).not.toContainText('📄');
  await expect(page.locator('.docs-tree-station')).toHaveCount(0);
  // La madre tiene flecha de plegado; la hija está sangrada un nivel más.
  const parentRow = page.locator('.docs-tree-row', { hasText: parent.title });
  await expect(parentRow.locator('.docs-tree-chevron')).toHaveAttribute('aria-expanded', 'true');
  const [px, cx] = await Promise.all([
    parentRow.locator('.docs-tree-icon').boundingBox(),
    active.locator('.docs-tree-icon').boundingBox(),
  ]);
  expect(cx!.x - px!.x).toBeGreaterThanOrEqual(12);
  // "+" crea una subpágina al pasar el mouse.
  await active.hover();
  await expect(active.locator('.docs-tree-add')).toBeVisible();
  // El sidebar del shell ya tiene Nuevo y Papelera: el árbol no los repite al pie.
  await expect(page.locator('.docs-sidebar-foot')).toHaveCount(0);
});

test('Docs: Compartir agrupa Personas y Publicar; la IA va en Avanzado; Esc cierra', async ({ request, page }) => {
  const doc = await createPage(request, { title: `Share ${uid()}` });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const shareBtn = page.getByRole('button', { name: /^Share/ });
  await shareBtn.click();

  const dialog = page.getByRole('dialog', { name: 'Share' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Publish' })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Email, member or team' })).toBeFocused();

  // "La IA puede usarla" está detrás de Avanzado.
  const ai = dialog.getByRole('switch', { name: /AI can use it/ });
  await expect(ai).toBeHidden();
  await dialog.getByRole('button', { name: /Advanced/ }).click();
  await expect(ai).toBeVisible();

  // Publicar muestra el link público derivado del título.
  await dialog.getByRole('switch', { name: /Publish to help center/ }).check();
  await expect(dialog.getByLabel('Public link')).toHaveValue(/\/en\/h\/[^/]+\/share-/);
  await expect(page.locator('.docs-published')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(shareBtn).toBeFocused();
});

test('Docs: el menú "…" se maneja con teclado y Esc devuelve el foco', async ({ request, page }) => {
  const doc = await createPage(request, { title: `Menu ${uid()}` });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const trigger = page.getByRole('button', { name: 'Page options' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Page options' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Docs: una página nueva no trae ícono y se le puede agregar uno', async ({ request, page }) => {
  const doc = await createPage(request, { title: `Icon ${uid()}` });
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-page-header .docs-icon')).toHaveCount(0);
  await page.locator('.docs-title').hover();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.locator('.emoji-picker-item').first().click();
  await expect(page.locator('.docs-page-header .docs-icon')).toBeVisible();
  await expect
    .poll(async () => (await (await request.get(`/api/docs/pages/${doc.id}`)).json()).icon, { timeout: 10_000 })
    .toBeTruthy();
});

test('Centro de ayuda: colecciones en lista, artículo con feedback y búsqueda vacía', async ({ request, page }) => {
  const tag = uid();
  const coll = await createPage(request, { title: `Guías ${tag}` });
  const art = await createPage(request, { title: `Primer paso ${tag}`, parent_id: coll.id });
  for (const p of [coll, art]) {
    await request.patch(`/api/docs/pages/${p.id}`, {
      data: { published: true, content: [{ id: 'b1', type: 'paragraph', content: `Texto ${tag}` }] },
    });
  }
  // El handle del workspace sale del link público de la página publicada (/en/h/<handle>/<slug>).
  await page.goto(`/en/app/docs/${coll.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Share/ }).click();
  const publicHref = await page.locator('.docs-public-meta a').first().getAttribute('href');
  expect(publicHref).toMatch(/^\/en\/h\/[^/]+\/[^/]+$/);
  const helpHref = publicHref!.replace(/\/[^/]+$/, '');

  await page.goto(helpHref!, { waitUntil: 'networkidle' });
  const stop = page.locator('.help-collection', { hasText: `Guías ${tag}` });
  await expect(stop).toBeVisible();
  await expect(page.locator('.help-station')).toHaveCount(0);
  await stop.getByRole('link', { name: `Primer paso ${tag}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Primer paso ${tag}` })).toBeVisible();
  await expect(page.getByText('Was this article helpful?')).toBeVisible();

  await page.goto(`${helpHref}?q=zzz${tag}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: `No articles match “zzz${tag}”` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See all articles' })).toHaveAttribute('href', helpHref!);
});

test('Docs: [[ inserta un link a la página que sobrevive al recargar y navega al click', async ({ request, page }) => {
  const tag = uid();
  const target = await createPage(request, { title: `Destino ${tag}` });
  const source = await createPage(request, { title: `Origen ${tag}` });
  await page.goto(`/en/app/docs/${source.id}`, { waitUntil: 'networkidle' });

  await page.locator('.docs-editable').first().click();
  await page.keyboard.type(`Ver [[Destino ${tag}`);
  const option = page.locator('.docs-mention-item', { hasText: `Destino ${tag}` });
  await expect(option).toBeVisible();
  await option.click();

  const link = page.locator('.docs-editable a[data-page]');
  await expect(link).toHaveText(`Destino ${tag}`);
  await expect(link).toHaveAttribute('data-page', target.id);
  await expect(page.locator('.docs-editable').first()).not.toContainText('[[');
  // Se guarda como link (no como texto "[Título]").
  await expect
    .poll(async () => JSON.stringify((await (await request.get(`/api/docs/pages/${source.id}`)).json()).content), {
      timeout: 10_000,
    })
    .toContain(`data-page=\\"${target.id}\\"`);

  await page.reload({ waitUntil: 'networkidle' });
  const saved = page.locator('.docs-editable a[data-page]');
  await expect(saved).toHaveText(`Destino ${tag}`);
  await expect(saved).toHaveAttribute('href', `/en/app/docs/${target.id}`);
  await saved.click();
  await expect(page).toHaveURL(new RegExp(`/en/app/docs/${target.id}$`));
  await expect(page.locator('.docs-title')).toHaveText(`Destino ${tag}`);
  // La página destino lista quién la enlaza.
  await expect(page.locator('.docs-backlinks')).toContainText(`Origen ${tag}`);
});
