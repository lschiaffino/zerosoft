import { readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Send de punta a punta: quien manda y quien abre sin cuenta, con los números
 * comparados contra lo que hizo el test. SEND_CAPTURES=<carpeta> guarda capturas.
 */
const CAP = process.env.SEND_CAPTURES;
if (CAP && !existsSync(CAP)) mkdirSync(CAP, { recursive: true });
const shot = async (page: Page, name: string) => {
  if (CAP) await page.screenshot({ path: path.join(CAP, `${name}.png`), fullPage: false });
};

async function pdf(pages: number, label = 'Doc'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`${label} page ${i}`, { x: 60, y: 690, size: 34, font, color: rgb(0.1, 0.1, 0.1) });
    for (let l = 0; l < 22; l++) p.drawRectangle({ x: 60, y: 640 - l * 24, width: 460 - (l % 5) * 40, height: 8, color: rgb(0.8, 0.8, 0.8) });
  }
  return Buffer.from(await doc.save());
}

async function makeDoc(request: APIRequestContext, title: string, bytes: Buffer, name = 'deck.pdf', mime = 'application/pdf'): Promise<{ id: string; versionId: string }> {
  const created = await request.post('/api/send/documents', { data: { title, file: { name, mime, size: bytes.length } } });
  expect(created.status()).toBe(201);
  const { document, version } = await created.json();
  const part = await request.put(`/api/send/versions/${version.id}/parts/0`, { data: bytes, headers: { 'content-type': 'application/octet-stream' } });
  expect(part.ok()).toBe(true);
  expect((await request.post(`/api/send/versions/${version.id}/complete`, { data: {} })).ok()).toBe(true);
  for (let i = 0; i < 30; i++) {
    const res = await request.post(`/api/send/versions/${version.id}/process`);
    const v = (await res.json()).version;
    if (v.status === 'ready') break;
    expect(v.status).toBe('processing');
  }
  return { id: document.id, versionId: version.id };
}

async function makeLink(request: APIRequestContext, documentId: string, data: Record<string, unknown>): Promise<{ id: string; url: string; token: string }> {
  const res = await request.post(`/api/send/documents/${documentId}/links`, { data });
  expect(res.status()).toBe(201);
  const { link } = await res.json();
  return { id: link.id, url: `/en${link.path}`, token: String(link.path).split('/').pop()! };
}

const analytics = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/send/documents/${id}/analytics`)).json()) as {
  totals: { visits: number; visitors: number; avgCompletion: number; downloads: number };
  visits: Array<{ email: string | null; emailVerified: boolean; forwarded: boolean; pagesSeen: number; pageTotal: number; completion: number; seconds: number; versionN: number; returning: boolean; pages: Array<{ page: number; seconds: number }> }>;
  pages: Array<{ page: number; avgSeconds: number; reach: number }>;
};

function mailsTo(to: string): Array<{ to: string; subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE;
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.to === to);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('de punta a punta: subir, armar un link, leer y ver los segundos por página', async ({ page, browser, request }) => {
  await page.goto('/en/app/send');
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await shot(page, 'home-empty');

  // Subir por la interfaz.
  await page.getByTestId('send-new').first().click();
  await page.waitForURL(/\/en\/app\/send\/new/);
  await page.getByTestId('send-file').setInputFiles({ name: 'Series A deck.pdf', mimeType: 'application/pdf', buffer: await pdf(4, 'Series A') });
  await shot(page, 'new-document');
  await page.getByTestId('send-create').click();
  await page.waitForURL(/\/en\/app\/send\/documents\/sd_/, { timeout: 90_000 });
  await expect(page.getByTestId('send-doc-title')).toHaveValue('Series A deck');
  const docId = page.url().split('/').pop()!.split('?')[0];

  // Link con email y sin descarga.
  await page.getByTestId('send-link-new').click();
  await page.getByTestId('link-name').fill('Acme');
  await page.getByTestId('link-recipient').fill('ana@acme.com');
  await page.getByTestId('link-require-email').check();
  await shot(page, 'link-dialog');
  await page.getByTestId('link-save').click();
  const row = page.getByTestId('send-link-row').first();
  await expect(row).toContainText('Acme');
  await expect(row).toContainText('No download');
  const path0 = await row.getByTestId('send-link-copy').getAttribute('data-url');
  expect(path0).toMatch(/^\/send\/[A-Za-z0-9_-]{32}$/);
  await shot(page, 'links');

  // Aparece en la lista sin recargar y se encuentra con Cmd+K.
  await page.goto('/en/app/send');
  await expect(page.getByTestId('send-doc-row').filter({ hasText: 'Series A deck' })).toBeVisible();
  await shot(page, 'home-list');
  const found = await (await request.get('/api/search?q=Series%20A')).json();
  expect(JSON.stringify(found)).toContain(`/app/send/documents/${docId}`);

  // Quien abre, sin cuenta y en otro contexto.
  const anon = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const v = await anon.newPage();
  await v.goto(`/en${path0}`);
  await expect(v).toHaveTitle(/Shared document/);
  expect(await v.content()).not.toContain('Series A deck');
  await expect(v.getByTestId('sv-gate-email')).toBeVisible();
  await shot(v, 'viewer-gate-390');
  await v.getByTestId('sv-input').fill('ana@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await expect(v.getByTestId('sv-page')).toHaveText('1 / 4');
  await expect(v.locator('figure[data-page="1"] img')).toBeVisible();
  await expect.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
  await shot(v, 'viewer-390');
  expect(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Nunca un PDF: el archivo no se ofrece y la imagen es WebP sin caché.
  const img = await anon.request.get(await v.locator('figure[data-page="1"] img').getAttribute('src').then((s) => new URL(s!, v.url()).toString()));
  expect(img.headers()['content-type']).toBe('image/webp');
  expect(img.headers()['cache-control']).toContain('no-store');
  expect(v.getByTestId('sv-download')).toHaveCount(0);
  const blocked = await anon.request.get(`/api/send/public/${path0!.split('/').pop()}/download?document=${docId}&piece=0`);
  expect(blocked.status()).toBe(403);

  // Página 1: ~6 s. Página 2: ~4 s. Las páginas 3 y 4 no se ven.
  await v.waitForTimeout(6000);
  const onPage2 = Date.now();
  await v.getByTestId('sv-next').click();
  await expect(v.getByTestId('sv-page')).toHaveText('2 / 4');
  await v.waitForTimeout(4000);

  // "Leyendo ahora", desde el panel.
  await page.goto(`/en/app/send/documents/${docId}`);
  await expect(page.getByTestId('send-live-bar')).toContainText('ana@acme.com', { timeout: 20_000 });
  await shot(page, 'live');

  await v.close();
  await anon.close();
  const secondsOnPage2 = (Date.now() - onPage2) / 1000;

  await expect
    .poll(async () => (await analytics(request, docId)).visits[0]?.seconds ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(7);
  const a = await analytics(request, docId);
  expect(a.totals.visits).toBe(1);
  const visit = a.visits[0];
  expect(visit.email).toBe('ana@acme.com');
  expect(visit.emailVerified).toBe(false);
  expect(visit.forwarded).toBe(false);
  expect(visit.pageTotal).toBe(4);
  expect(visit.pagesSeen).toBe(2);
  expect(visit.completion).toBe(50);
  const secs = new Map(visit.pages.map((p) => [p.page, p.seconds]));
  expect(secs.get(1)!).toBeGreaterThan(4);
  expect(secs.get(1)!).toBeLessThan(10);
  expect(secs.get(2)!).toBeGreaterThan(2.5);
  // Sigue en la página 2 hasta cerrar la pestaña: nunca más que el tiempo real, con el margen del aviso.
  expect(secs.get(2)!).toBeLessThan(secondsOnPage2 + 3);
  expect(secs.has(3)).toBe(false);
  expect(a.pages.map((p) => p.reach)).toEqual([100, 100, 0, 0]);

  // Lo mismo en pantalla.
  await page.getByTestId('send-tab-activity').click();
  await expect(page.getByTestId('kpi-visits')).toHaveText('1');
  await expect(page.getByTestId('send-visitors')).toContainText('Not verified');
  await page.getByTestId('send-visit-open').first().click();
  await expect(page.getByTestId('send-visit-detail').locator('li[data-page="1"]')).toBeVisible();
  await shot(page, 'activity');
  await page.getByTestId('send-tab-pages').click();
  await expect(page.getByTestId('send-page-stats').locator('li')).toHaveCount(4);
  await shot(page, 'pages');

  // CSV para admins.
  const csv = await request.get(`/api/send/documents/${docId}/export`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const lines = (await csv.text()).trim().split('\r\n');
  expect(lines[0]).toContain('page_4_seconds');
  expect(lines[1]).toContain('ana@acme.com');
  expect(lines[1]).toContain('unverified');

  // Aviso en la campana y por email, una sola vez.
  const notes = await (await request.get('/api/notifications?limit=20')).json();
  expect(JSON.stringify(notes)).toContain('is reading Series A deck');
  const owner = mailsTo('demo@zerosoft.ai').filter((m) => m.subject.includes('Series A deck'));
  expect(owner).toHaveLength(1);
});

test('un bot o un previsualizador no crea sesión ni visita ni aviso', async ({ browser, request, playwright, baseURL }) => {
  const { id } = await makeDoc(request, 'Bot target', await pdf(2));
  const link = await makeLink(request, id, { name: 'Open' });
  const slack = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' } });
  const res = await slack.get(link.url);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('Bot target');
  expect(res.headers()['set-cookie'] ?? '').not.toContain('zs_send_');

  // Sin sesión, ni la imagen.
  const version = (await (await request.get(`/api/send/documents/${id}`)).json()).document.currentVersionId;
  expect((await slack.get(`/api/send/public/${link.token}/pages/${version}/1`)).status()).toBe(401);

  // Un escáner que abre sesión y avisa, con su user agent: no cuenta.
  await slack.post(`/api/send/public/${link.token}`, { data: {} });
  const ping = await slack.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId: version, deltas: [{ page: 1, seconds: 10 }] } });
  expect(ping.ok()).toBe(true);
  expect((await ping.json()).counted).toBe(false);

  // Un navegador que se va antes de los 3 s tampoco.
  const quick = await browser.newContext();
  const q = await quick.newPage();
  await q.goto(link.url);
  await expect(q.getByTestId('sv-reader')).toBeVisible();
  await q.waitForTimeout(800);
  await q.close();
  await quick.close();
  await slack.dispose();

  const a = await analytics(request, id);
  expect(a.totals.visits).toBe(0);
  expect(JSON.stringify(await (await request.get('/api/notifications?limit=30')).json())).not.toContain('Bot target');
});

test('deshabilitar corta en el momento, también lo que ya estaba abierto; vencer igual', async ({ browser, request }) => {
  const { id } = await makeDoc(request, 'Cut me', await pdf(3));
  const version = (await (await request.get(`/api/send/documents/${id}`)).json()).document.currentVersionId;
  const link = await makeLink(request, id, { name: 'Soon cut' });
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  const image = `/api/send/public/${link.token}/pages/${version}/1`;
  expect((await ctx.request.get(image)).status()).toBe(200);

  expect((await request.patch(`/api/send/links/${link.id}`, { data: { disabled: true } })).ok()).toBe(true);
  expect((await ctx.request.get(image)).status()).toBe(410);
  // El visor abierto se cierra en el aviso siguiente.
  await expect(v.getByTestId('sv-closed')).toBeVisible({ timeout: 20_000 });
  await expect(v.getByTestId('sv-closed')).not.toContainText('Cut me');
  await shot(v, 'viewer-closed');

  expect((await request.patch(`/api/send/links/${link.id}`, { data: { disabled: false } })).ok()).toBe(true);
  expect((await ctx.request.get(image)).status()).toBe(200);

  // Vencido.
  expect((await request.patch(`/api/send/links/${link.id}`, { data: { expiresAt: new Date(Date.now() - 60_000).toISOString() } })).ok()).toBe(true);
  expect((await ctx.request.get(image)).status()).toBe(410);
  await v.goto(link.url);
  await expect(v.getByTestId('sv-closed')).toHaveAttribute('data-reason', 'expired');
  await ctx.close();

  // Borrado: como si nunca hubiera existido.
  expect((await request.delete(`/api/send/links/${link.id}`)).ok()).toBe(true);
  const gone = await browser.newContext();
  expect((await gone.request.get(`/api/send/public/${link.token}`)).status()).toBe(404);
  await gone.close();
});

test('código de acceso con tope, verificación por código y lista de permitidos', async ({ browser, request }) => {
  const { id } = await makeDoc(request, 'Locked', await pdf(1));
  const link = await makeLink(request, id, { name: 'Allow', passcode: 'open-sesame', accessMode: 'allow', accessList: ['acme.com'], requireEmail: true, verifyEmail: true });
  const stored = await (await request.get(`/api/send/documents/${id}/links`)).json();
  expect(JSON.stringify(stored)).not.toContain('open-sesame');
  expect(stored.links[0].hasPasscode).toBe(true);

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-gate-passcode')).toBeVisible();
  await shot(v, 'viewer-passcode');
  await v.getByTestId('sv-input').fill('wrong');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-error')).toContainText('passcode');
  await v.getByTestId('sv-input').fill('open-sesame');
  await v.getByTestId('sv-submit').click();

  // Email fuera de la lista: primero se verifica, recién ahí se niega (no se puede sondear la lista).
  await expect(v.getByTestId('sv-gate-email')).toBeVisible();
  await v.getByTestId('sv-input').fill('intruder@evil.io');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-gate-verify')).toBeVisible();
  await expect.poll(() => mailsTo('intruder@evil.io').length).toBeGreaterThan(0);
  const code = (mailsTo('intruder@evil.io').at(-1)!.subject.match(/\d{6}/) ?? [''])[0];
  await v.getByTestId('sv-input').fill(code);
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-denied')).toBeVisible();
  await shot(v, 'viewer-denied');

  // Otro email, con código mal y después bien.
  await v.getByTestId('sv-other-email').click();
  await expect(v.getByTestId('sv-gate-email')).toBeVisible();
  await v.getByTestId('sv-input').fill('ana@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-gate-verify')).toBeVisible();
  await expect.poll(() => mailsTo('ana@acme.com').filter((m) => /\d{6}/.test(m.subject)).length).toBeGreaterThan(0);
  await v.getByTestId('sv-input').fill('000000');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-error')).toBeVisible();
  await shot(v, 'viewer-verify');
  const ok = (mailsTo('ana@acme.com').filter((m) => /\d{6}/.test(m.subject)).at(-1)!.subject.match(/\d{6}/) ?? [''])[0];
  await v.getByTestId('sv-input').fill(ok);
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await v.waitForTimeout(4200);
  await expect.poll(async () => (await analytics(request, id)).visits[0]?.emailVerified ?? null, { timeout: 20_000 }).toBe(true);

  // Cambiar el código saca a quien ya entró.
  expect((await request.patch(`/api/send/links/${link.id}`, { data: { passcode: 'new-pass' } })).ok()).toBe(true);
  await v.reload();
  await expect(v.getByTestId('sv-gate-passcode')).toBeVisible();

  // Tope de intentos.
  const brute = await browser.newContext();
  await brute.request.post(`/api/send/public/${link.token}`, { data: {} });
  let status = 0;
  for (let i = 0; i < 10; i++) status = (await brute.request.post(`/api/send/public/${link.token}`, { data: { passcode: `nope${i}` } })).status();
  expect(status).toBe(429);
  await brute.close();
  await ctx.close();
});

test('watermark en la imagen y en la descarga; descarga permitida baja el archivo', async ({ browser, request }) => {
  const original = await pdf(2, 'Stamp');
  const { id } = await makeDoc(request, 'Stamped', original);
  const link = await makeLink(request, id, { name: 'WM', watermark: true, allowDownload: true });
  const plain = await makeLink(request, id, { name: 'Plain', allowDownload: true });

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await v.getByTestId('sv-input').fill('wm@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await expect(v.locator('figure[data-page="1"] img')).toBeVisible();
  await expect.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
  await shot(v, 'viewer-watermark');

  const version = (await (await request.get(`/api/send/documents/${id}`)).json()).document.currentVersionId;
  // La imagen con watermark no es la imagen guardada.
  const marked = await (await ctx.request.get(`/api/send/public/${link.token}/pages/${version}/1`)).body();
  const clean = await (await request.get(`/api/send/versions/${version}/pages/1`)).body();
  expect(marked.equals(clean)).toBe(false);
  expect(marked.length).toBeGreaterThan(clean.length);

  // La descarga con watermark es otro PDF.
  const dl = await ctx.request.get(`/api/send/public/${link.token}/download?document=${id}&piece=0`);
  expect(dl.ok()).toBe(true);
  const stamped = await dl.body();
  expect(stamped.subarray(0, 5).toString()).toBe('%PDF-');
  expect(stamped.equals(original)).toBe(false);
  const parsed = await PDFDocument.load(stamped);
  expect(parsed.getPageCount()).toBe(2);
  await ctx.close();

  // Sin watermark: el original, byte por byte.
  const other = await browser.newContext();
  const o = await other.newPage();
  await o.goto(plain.url);
  await expect(o.getByTestId('sv-download')).toBeVisible();
  const down = await other.request.get(`/api/send/public/${plain.token}/download?document=${id}&piece=0`);
  expect((await down.body()).equals(original)).toBe(true);
  await other.close();
});

test('reemplazar el archivo mantiene el link y separa los números por versión', async ({ browser, request }) => {
  const { id } = await makeDoc(request, 'Versioned', await pdf(2));
  const link = await makeLink(request, id, { name: 'V' });
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-page')).toHaveText('1 / 2');
  await v.waitForTimeout(4200);
  await expect.poll(async () => (await analytics(request, id)).totals.visits, { timeout: 15_000 }).toBe(1);

  const bytes = await pdf(3, 'Second');
  const start = await request.post(`/api/send/documents/${id}/versions`, { data: { file: { name: 'second.pdf', mime: 'application/pdf', size: bytes.length } } });
  expect(start.status()).toBe(201);
  const version = (await start.json()).version;
  await request.put(`/api/send/versions/${version.id}/parts/0`, { data: bytes });
  await request.post(`/api/send/versions/${version.id}/complete`, { data: {} });
  for (let i = 0; i < 20; i++) {
    const r = (await (await request.post(`/api/send/versions/${version.id}/process`)).json()).version;
    if (r.status === 'ready') break;
  }

  // El visor abierto pasa solo a la versión nueva, con el mismo link.
  await expect(v.getByTestId('sv-page')).toHaveText(/1 \/ 3/, { timeout: 20_000 });
  await v.waitForTimeout(4200);
  await expect.poll(async () => (await analytics(request, id)).totals.visits, { timeout: 15_000 }).toBe(2);
  const a = await analytics(request, id);
  expect(a.visits.map((x) => x.versionN).sort()).toEqual([1, 2]);
  const only = await (await request.get(`/api/send/documents/${id}/analytics?version=${version.id}`)).json();
  expect(only.totals.visits).toBe(1);
  expect(only.visits[0].pageTotal).toBe(3);
  await ctx.close();
});

test('un archivo que no es lo que dice se rechaza con un motivo', async ({ request, page }) => {
  const bad = Buffer.from('<html><script>alert(1)</script></html>');
  const created = await request.post('/api/send/documents', { data: { title: 'Fake', file: { name: 'evil.pdf', mime: 'application/pdf', size: bad.length } } });
  const { document, version } = await created.json();
  await request.put(`/api/send/versions/${version.id}/parts/0`, { data: bad });
  const res = await request.post(`/api/send/versions/${version.id}/complete`, { data: {} });
  expect(res.status()).toBe(415);
  await page.goto(`/en/app/send/documents/${document.id}`);
  await expect(page.getByTestId('send-failed')).toContainText('isn\'t what its name says');
  expect((await request.delete(`/api/send/documents/${document.id}`)).ok()).toBe(true);

  expect((await request.post('/api/send/documents', { data: { title: 'Exe', file: { name: 'a.exe', mime: 'application/octet-stream', size: 10 } } })).status()).toBe(415);
});

test('espacios: varios documentos detrás de un link, con números y acceso por persona', async ({ page, browser, request }) => {
  const a = await makeDoc(request, 'Pitch', await pdf(2));
  const b = await makeDoc(request, 'Financials', await pdf(1));
  const created = await request.post('/api/send/spaces', { data: { title: 'Series A room' } });
  const { space } = await created.json();
  expect((await request.patch(`/api/send/spaces/${space.id}`, { data: { items: [{ documentId: a.id, folder: 'Deck' }, { documentId: b.id, folder: 'Numbers' }] } })).ok()).toBe(true);
  expect((await request.put(`/api/send/spaces/${space.id}/access`, { data: { email: 'limited@acme.com', documentIds: [a.id] } })).ok()).toBe(true);
  const res = await request.post(`/api/send/spaces/${space.id}/links`, { data: { name: 'Room', requireEmail: true } });
  const { link } = await res.json();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(`/en${link.path}`);
  await v.getByTestId('sv-input').fill('limited@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-space')).toBeVisible();
  await expect(v.getByTestId('sv-space-doc')).toHaveCount(1);
  await shot(v, 'space-viewer-390');
  await v.getByTestId('sv-space-doc').first().click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await v.waitForTimeout(4200);
  await v.getByTestId('sv-back').click();
  await expect(v.getByTestId('sv-space')).toBeVisible();
  // El documento que no le toca no sale, ni pidiéndolo a mano.
  const token = String(link.path).split('/').pop();
  expect((await ctx.request.get(`/api/send/public/${token}/pages/${b.versionId}/1`)).status()).toBe(409);
  await ctx.close();

  const other = await browser.newContext();
  const w = await other.newPage();
  await w.goto(`/en${link.path}`);
  await w.getByTestId('sv-input').fill('all@acme.com');
  await w.getByTestId('sv-submit').click();
  await expect(w.getByTestId('sv-space-doc')).toHaveCount(2);
  await other.close();

  await page.goto(`/en/app/send/spaces/${space.id}`);
  await expect(page.getByTestId('send-space-item')).toHaveCount(2);
  await shot(page, 'space-detail');
  await page.getByTestId('send-space-tab-activity').click();
  await expect(page.getByTestId('send-space-docstats')).toContainText('Pitch');
  await expect(page.getByTestId('send-space-people')).toContainText('limited@acme.com');
  await shot(page, 'space-activity');
  await page.getByTestId('send-space-tab-access').click();
  await expect(page.getByTestId('send-access-row')).toContainText('limited@acme.com');
  await page.goto('/en/app/send/spaces');
  await expect(page.getByTestId('send-space-row').filter({ hasText: 'Series A room' })).toBeVisible();
  await shot(page, 'spaces');
});
