import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';

/**
 * Privacidad de archivos: la URL de un archivo (la que ve el navegador)
 * copiada a otro navegador sin cookies no abre, ni con otra cuenta. Docs,
 * CRM y la subida de Lines; Lines e Inbox de punta a punta están en
 * groups-media.spec.ts.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** Pide la URL sin cookies y con otra cuenta (otro workspace): ninguna de las dos abre. */
async function deniedElsewhere(browser: Browser, baseURL: string, url: string) {
  const anon = await browser.newContext({ baseURL });
  try {
    const res = await anon.request.get(url, { maxRedirects: 0 });
    expect([401, 404], `${url} sin sesión`).toContain(res.status());
    expect(await res.text()).not.toContain('blob.vercel-storage.com');
    await anon.addCookies([{ name: 'zs_e2e_as', value: `files-stranger-${uid()}@darwin-e2e.io`, url: baseURL }]);
    const other = await anon.request.get(url, { maxRedirects: 0 });
    expect([401, 404], `${url} con otra cuenta`).toContain(other.status());
  } finally {
    await anon.close();
  }
}

async function ok<T>(res: ReturnType<APIRequestContext['get']>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

test('Docs: la imagen de una página solo abre con sesión y acceso', async ({ request, browser, baseURL }) => {
  const doc = await ok<{ id: string }>(request.post('/api/docs/pages', { data: { title: `Privada ${uid()}` } }));
  const file = await ok<{ url: string; name: string; size: number; mime: string }>(
    request.post(`/api/docs/pages/${doc.id}/files`, { multipart: { file: { name: 'dot.png', mimeType: 'image/png', buffer: PNG } } }),
  );
  expect(file.url).toMatch(/^\/api\/files\//);
  await ok(request.patch(`/api/docs/pages/${doc.id}`, { data: { content: [{ id: 'img', type: 'image', content: '', ...file }] } }));
  const viaPage = `/api/docs/files/${doc.id}/img`;
  const mine = await request.get(viaPage);
  expect(mine.status()).toBe(200);
  expect(Buffer.from(await mine.body())).toEqual(PNG);
  // El archivo de una página es 'internal': ni el dueño lo abre por /api/files, solo por la página.
  expect((await request.get(file.url)).status()).toBe(404);
  await deniedElsewhere(browser, baseURL!, viaPage);
  await deniedElsewhere(browser, baseURL!, file.url);
});

test('CRM: el PDF de un documento solo abre con sesión (o con su link de seguimiento)', async ({ request, browser, baseURL }) => {
  const doc = await ok<{ id: string; url?: string }>(
    request.post('/api/crm/documents', { multipart: { file: { name: 'deck.pdf', mimeType: 'application/pdf', buffer: PDF }, name: `Deck ${uid()}` } }),
  );
  const viaApp = `/api/crm/documents/${doc.id}/file`;
  const mine = await request.get(viaApp, { headers: { range: 'bytes=0-3' } });
  expect([200, 206]).toContain(mine.status());
  expect(Buffer.from(await mine.body()).subarray(0, 4).toString()).toBe('%PDF');
  await deniedElsewhere(browser, baseURL!, viaApp);
  if (doc.url) await deniedElsewhere(browser, baseURL!, doc.url);
});

test('Lines: lo subido para mandar solo lo ve quien lo subió', async ({ request, browser, baseURL }) => {
  const up = await ok<{ url: string }>(request.post('/api/groups/upload', { multipart: { file: { name: 'foto.png', mimeType: 'image/png', buffer: PNG } } }));
  expect(up.url).toMatch(/^\/api\/files\//);
  const mine = await request.get(up.url);
  expect(mine.status()).toBe(200);
  expect(mine.headers()['cache-control']).toMatch(/^private/);
  expect(mine.headers()['x-content-type-options']).toBe('nosniff');
  await deniedElsewhere(browser, baseURL!, up.url);
});
