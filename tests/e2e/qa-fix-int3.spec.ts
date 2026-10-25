import { expect, test } from '@playwright/test';

/**
 * Arreglos menores de la QA de int-3: menú / con espacios, Enter en el
 * selector de ícono, encabezado de la lista general bajo Favoritos, Cmd+K
 * con Facturación y Dominios, y Notes sin 405 al abrir una nota.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

test('Docs: "/3 col" con espacio no cierra el menú y arma 3 columnas', async ({ request, page: p }) => {
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Cols ${uid()}` } })).json()) as { id: string };
  await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: [{ id: 'a', type: 'paragraph', content: '' }] } });
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-blocks .docs-editable').first().click();
  await p.keyboard.type('/3 col');
  await expect(p.locator('.docs-command-menu')).toBeVisible();
  await p.keyboard.press('Enter');
  await expect
    .poll(async () => ((await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { content: Array<{ type: string }> }).content.filter((b) => b.type === 'column').length)
    .toBe(3);
  // Lo que no coincide con nada sí lo cierra.
  await p.keyboard.type('/zz qq');
  await expect(p.locator('.docs-command-menu')).toHaveCount(0);
});

test('Docs: Enter en el selector de ícono elige el primer resultado', async ({ request, page: p }) => {
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Icono ${uid()}` } })).json()) as { id: string };
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await p.locator('.docs-page-header').hover();
  await p.getByRole('button', { name: 'Add icon' }).click();
  await p.getByRole('searchbox', { name: 'Search icons…' }).fill('rocket');
  await p.keyboard.press('Enter');
  await expect.poll(async () => ((await (await request.get(`/api/docs/pages/${doc.id}`)).json()) as { icon: string | null }).icon).toBe('🚀');
});

test('Docs: con Favoritos, la lista general tiene su encabezado', async ({ request, page: p }) => {
  const doc = (await (await request.post('/api/docs/pages', { data: { title: `Fav ${uid()}` } })).json()) as { id: string };
  await p.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  if ((await p.getByTestId('docs-favorite-button').getAttribute('aria-pressed')) !== 'true') await p.getByTestId('docs-favorite-button').click();
  await expect(p.getByTestId('docs-favorites')).toBeVisible();
  await expect(p.getByTestId('docs-tree-label')).toHaveText('Pages');
  await p.getByTestId('docs-favorite-button').click();
});

test('Cmd+K encuentra Facturación, Billing, Plan y Dominios', async ({ page }) => {
  await page.goto('/es/app/docs', { waitUntil: 'networkidle' });
  for (const [q, name] of [
    ['Facturación', /Plan y uso/],
    ['facturacion', /Plan y uso/],
    ['Billing', /Plan y uso/],
    ['Plan', /Plan y uso/],
    ['Dominios', /Dominios/],
    ['Domains', /Dominios/],
  ] as const) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('combobox') });
    await dialog.getByRole('combobox').fill(q);
    await expect(dialog.getByRole('option', { name }).first(), q).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('Notes: abrir una nota no pide la config de subida con 405', async ({ request, page: p }) => {
  const note = (await (await request.post('/api/notes', { data: { title: `Cfg ${uid()}`, content: [] } })).json()) as { id: string };
  const bad: string[] = [];
  p.on('response', (r) => {
    if (r.url().includes('/files') && r.status() === 405) bad.push(r.url());
  });
  const cfg = await request.get(`/api/notes/${note.id}/files`);
  expect(cfg.status()).toBe(200);
  expect(await cfg.json()).toMatchObject({ mode: 'server' });
  await p.goto(`/en/app/notes?note=${note.id}`, { waitUntil: 'networkidle' });
  await p.locator('.note-body .docs-blocks .docs-editable').first().click();
  expect(bad).toEqual([]);
});
