import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

test('Link: carpetas, alta masiva con slug y título y página pública de analytics', async ({ page, request }) => {
  // Carpeta y un link adentro.
  const folder = await request.post('/api/links/folders', { data: { name: `Campaña ${uid()}`, defaultAccess: 'view' } });
  expect(folder.status(), await folder.text()).toBe(201);
  const { id: folderId } = (await folder.json()) as { id: string };
  const slug = `fold${uid()}`;
  const link = await request.post('/api/links', { data: { url: 'https://example.com/carpeta', slug, folderId } });
  expect(link.status()).toBe(201);
  const created = (await link.json()) as { id: string; folder_id: string };
  expect(created.folder_id).toBe(folderId);

  await page.goto(`/en/app/links?folder=${folderId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.links-table').getByText(slug).first()).toBeVisible();
  await page.goto('/en/app/links/folders', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('link-folder').first()).toBeVisible();

  // Alta masiva: slug y título por fila.
  const bulkSlug = `bk${uid()}`;
  const bulk = await request.post('/api/links/bulk', {
    data: { urls: `https://example.com/uno, ${bulkSlug}, Primera fila\nhttps://example.com/dos` },
  });
  expect(bulk.status()).toBe(201);
  const rows = ((await bulk.json()) as { results: Array<{ short_url: string; title?: string }> }).results;
  expect(rows[0].short_url.endsWith(`/${bulkSlug}`)).toBe(true);
  expect(rows[0].title).toBe('Primera fila');

  // Página pública: se abre sin sesión de por medio y deja de existir al revocarla.
  const share = await request.post('/api/links/shares', { data: { linkId: created.id } });
  expect(share.status()).toBe(201);
  const { id: shareId, path } = (await share.json()) as { id: string; path: string };
  await page.goto(`/en${path}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('link-public-stats')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(slug);
  expect((await request.delete(`/api/links/shares/${shareId}`)).status()).toBe(204);
  expect((await page.goto(`/en${path}`))?.status()).toBe(404);

  // Filtros de analytics por query.
  await page.goto(`/en/app/links/analytics?link=${created.id}&device=mobile&tz=America/New_York`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('analytics-filters')).toBeVisible();
  await expect(page.getByTestId('analytics-clicks')).toHaveText('0');
});
