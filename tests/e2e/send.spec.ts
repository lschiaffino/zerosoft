import { readFileSync, existsSync, mkdirSync } from 'fs';
import { e2eDb } from './helpers/db';
import path from 'path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib';

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

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Escribe el email y el código que llegó, y sigue. */
async function passEmail(v: Page, email: string) {
  await v.getByTestId('sv-input').fill(email);
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-gate-verify')).toBeVisible();
  const before = /\d{6}/;
  await slow.poll(() => mailsTo(email).filter((m) => before.test(m.subject)).length).toBeGreaterThan(0);
  await v.getByTestId('sv-input').fill(before.exec(mailsTo(email).filter((m) => before.test(m.subject)).at(-1)!.subject)![0]);
  await v.getByTestId('sv-submit').click();
}

function mailsTo(to: string): Array<{ to: string; subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE;
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.to === to);
}

test.setTimeout(240_000);
const slow = expect.configure({ timeout: 45_000 });

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
  await slow.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
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
  await slow.poll(() => mailsTo('intruder@evil.io').length).toBeGreaterThan(0);
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
  await slow.poll(() => mailsTo('ana@acme.com').filter((m) => /\d{6}/.test(m.subject)).length).toBeGreaterThan(0);
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
  await slow.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
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
  const suffix = Math.random().toString(36).slice(2, 7);
  expect((await request.put(`/api/send/spaces/${space.id}/access`, { data: { email: `limited${suffix}@acme.com`, documentIds: [a.id] } })).ok()).toBe(true);
  expect((await request.put(`/api/send/spaces/${space.id}/access`, { data: { email: `all${suffix}@acme.com`, documentIds: [a.id, b.id] } })).ok()).toBe(true);
  expect((await request.put(`/api/send/spaces/${space.id}/access`, { data: { email: 'all@acme.com', documentIds: [a.id, b.id] } })).ok()).toBe(true);
  // Un link sin ninguna regla: con lista, igual pide email verificado.
  const res = await request.post(`/api/send/spaces/${space.id}/links`, { data: { name: 'Room' } });
  const { link } = await res.json();
  const token = String(link.path).split('/').pop();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(`/en${link.path}`);
  await expect(v.getByTestId('sv-gate-email')).toBeVisible();
  await passEmail(v, `limited${suffix}@acme.com`);
  await expect(v.getByTestId('sv-space')).toBeVisible();
  await expect(v.getByTestId('sv-space-doc')).toHaveCount(1);
  await shot(v, 'space-viewer-390');
  await v.getByTestId('sv-space-doc').first().click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await v.waitForTimeout(4200);
  await v.getByTestId('sv-back').click();
  await expect(v.getByTestId('sv-space')).toBeVisible();
  // El documento que no le toca no sale, ni pidiéndolo a mano.
  expect((await ctx.request.get(`/api/send/public/${token}/pages/${b.versionId}/1`)).status()).toBe(409);
  // Escribir otra dirección de la lista no alcanza: pide otro código, y la anterior queda atrás.
  const typed = await ctx.request.post(`/api/send/public/${token}`, { data: { email: 'all@acme.com' } });
  expect((await typed.json()).step).toBe('verify');
  expect((await ctx.request.get(`/api/send/public/${token}/pages/${b.versionId}/1`)).status()).toBe(401);
  await ctx.close();

  // Quien no figura no entra, aunque verifique su email.
  const outsider = await browser.newContext();
  const o = await outsider.newPage();
  await o.goto(`/en${link.path}`);
  await passEmail(o, `outsider${suffix}@acme.com`);
  await expect(o.getByTestId('sv-denied')).toBeVisible();
  await outsider.close();

  const other = await browser.newContext();
  const w = await other.newPage();
  await w.goto(`/en${link.path}`);
  await passEmail(w, `all${suffix}@acme.com`);
  await expect(w.getByTestId('sv-space-doc')).toHaveCount(2);
  await other.close();

  await page.goto(`/en/app/send/spaces/${space.id}`);
  await expect(page.getByTestId('send-space-item')).toHaveCount(2);
  await shot(page, 'space-detail');
  await page.getByTestId('send-space-tab-activity').click();
  await expect(page.getByTestId('send-space-docstats')).toContainText('Pitch');
  await expect(page.getByTestId('send-space-people')).toContainText(`limited${suffix}@acme.com`);
  await shot(page, 'space-activity');
  const csv = await request.get(`/api/send/spaces/${space.id}/analytics?format=csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain(`limited${suffix}@acme.com`);
  await expect(page.getByTestId('send-space-denied')).toContainText(`outsider${suffix}@acme.com`);
  await page.getByTestId('send-space-tab-access').click();
  await expect(page.getByTestId('send-access-row').filter({ hasText: `limited${suffix}@acme.com` })).toBeVisible();
  await page.goto('/en/app/send/spaces');
  await expect(page.getByTestId('send-space-row').filter({ hasText: 'Series A room' })).toBeVisible();
  await shot(page, 'spaces');
});

test('tiempo y completado salen del servidor: avisos armados no suman', async ({ browser, request, playwright, baseURL }) => {
  const { id, versionId } = await makeDoc(request, 'Forged', await pdf(3));
  const link = await makeLink(request, id, { name: 'Forge' });
  const ctx = await browser.newContext();
  await ctx.request.post(`/api/send/public/${link.token}`, { data: {} });
  // Sin pedir ninguna página: no hay visita.
  await new Promise((r) => setTimeout(r, 2500));
  const blind = await ctx.request.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId, deltas: [{ page: 1, seconds: 3 }, { page: 2, seconds: 3 }, { page: 3, seconds: 3 }] } });
  expect((await blind.json()).counted).toBe(false);
  // Pide solo la primera, y manda 40 avisos de golpe, diciendo que leyó las tres.
  expect((await ctx.request.get(`/api/send/public/${link.token}/pages/${versionId}/1`)).ok()).toBe(true);
  const start = Date.now();
  for (let i = 0; i < 40; i++) await ctx.request.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId, deltas: [{ page: 1, seconds: 3 }, { page: 2, seconds: 3 }, { page: 3, seconds: 3 }] } });
  const elapsed = (Date.now() - start) / 1000;
  const a = await analytics(request, id);
  expect(a.visits).toHaveLength(1);
  // Lo del primer aviso (hasta 15 s), más lo que pasó de verdad.
  expect(a.visits[0].seconds).toBeLessThanOrEqual(15 + elapsed + 2);
  expect(a.visits[0].pagesSeen).toBe(1);
  expect(a.visits[0].completion).toBe(33);
  await ctx.close();
  // Una herramienta no cuenta.
  const curl = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': 'curl/8.4.0' } });
  await curl.post(`/api/send/public/${link.token}`, { data: {} });
  await curl.get(`/api/send/public/${link.token}/pages/${versionId}/1`);
  await new Promise((r) => setTimeout(r, 1000));
  expect((await (await curl.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId, deltas: [{ page: 1, seconds: 3 }] } })).json()).counted).toBe(false);
  await curl.dispose();
  expect((await analytics(request, id)).totals.visits).toBe(1);
});

test('otro email es otra persona: otra visita y otra copia con watermark', async ({ browser, request }) => {
  const { id, versionId } = await makeDoc(request, 'Switch', await pdf(1));
  const link = await makeLink(request, id, { name: 'Switch', watermark: true, allowDownload: true });
  const ctx = await browser.newContext();
  const api = ctx.request;
  await api.post(`/api/send/public/${link.token}`, { data: { email: 'first@acme.com' } });
  const first = await (await api.get(`/api/send/public/${link.token}/download?document=${id}&piece=0`)).body();
  await api.get(`/api/send/public/${link.token}/pages/${versionId}/1`);
  await new Promise((r) => setTimeout(r, 2500));
  await api.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId, deltas: [{ page: 1, seconds: 2.5 }] } });
  await api.post(`/api/send/public/${link.token}`, { data: { email: 'second@acme.com' } });
  const second = await (await api.get(`/api/send/public/${link.token}/download?document=${id}&piece=0`)).body();
  expect(second.equals(first)).toBe(false);
  await api.get(`/api/send/public/${link.token}/pages/${versionId}/1`);
  await new Promise((r) => setTimeout(r, 1000));
  await api.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId, deltas: [{ page: 1, seconds: 3 }] } });
  const a = await analytics(request, id);
  expect(a.visits.map((v) => v.email).sort()).toEqual(['first@acme.com', 'second@acme.com']);
  await ctx.close();
});

test('el visor: encabezados, mensaje después de entrar, código con espacio y volver a prender', async ({ browser, request }) => {
  const { id, versionId } = await makeDoc(request, 'Headers', await pdf(1));
  const link = await makeLink(request, id, { name: 'H', passcode: 'open-sesame', message: 'Hi there, private note.' });
  const ctx = await browser.newContext();
  const res = await ctx.request.get(link.url);
  const h = res.headers();
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(await res.text()).not.toContain('private note');
  const v = await ctx.newPage();
  const errors: string[] = [];
  v.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  await v.goto(link.url);
  await expect(v.getByTestId('sv-gate-passcode')).not.toContainText('private note');
  await v.getByTestId('sv-input').fill('open-sesame ');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toContainText('private note');
  expect(errors).toEqual([]);
  // Apagar y volver a prender: hay que pasar otra vez.
  await request.patch(`/api/send/links/${link.id}`, { data: { disabled: true } });
  await request.patch(`/api/send/links/${link.id}`, { data: { disabled: false } });
  expect((await ctx.request.get(`/api/send/public/${link.token}/pages/${versionId}/1`)).status()).toBe(401);
  await ctx.close();
});

test('una pestaña quieta se cierra sola al deshabilitar', async ({ browser, request }) => {
  const { id } = await makeDoc(request, 'Idle tab', await pdf(1));
  const link = await makeLink(request, id, { name: 'Idle' });
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await request.patch(`/api/send/links/${link.id}`, { data: { disabled: true } });
  await expect(v.getByTestId('sv-closed')).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});

test('los avisos tienen tope por link, y el resto va a un resumen', async ({ browser, request }) => {
  const { id, versionId } = await makeDoc(request, 'Flooded', await pdf(1));
  const link = await makeLink(request, id, { name: 'Flood' });
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext();
    await ctx.request.post(`/api/send/public/${link.token}`, { data: {} });
    await ctx.request.get(`/api/send/public/${link.token}/pages/${versionId}/1`);
    await new Promise((r) => setTimeout(r, 1000));
    await ctx.request.post(`/api/send/public/${link.token}/ping`, { data: { documentId: id, versionId, deltas: [{ page: 1, seconds: 3 }] } });
    await ctx.close();
  }
  expect((await analytics(request, id)).totals.visits).toBe(5);
  expect(mailsTo('demo@zerosoft.ai').filter((m) => m.subject.includes('Flooded'))).toHaveLength(3);
  const row = (await sql('SELECT alert_digest FROM send_links WHERE id = ?', [link.id]))[0];
  expect(Number(row.alert_digest)).toBe(2);
});

test('borrar un documento se lleva las copias con watermark y el email de quien lo abrió', async ({ browser, request }) => {
  const { id, versionId } = await makeDoc(request, 'Gone', await pdf(1));
  const link = await makeLink(request, id, { name: 'G', watermark: true, allowDownload: true });
  const email = `gone-${Math.random().toString(36).slice(2, 7)}@acme.com`;
  const ctx = await browser.newContext();
  await ctx.request.post(`/api/send/public/${link.token}`, { data: { email } });
  expect((await ctx.request.get(`/api/send/public/${link.token}/download?document=${id}&piece=0`)).ok()).toBe(true);
  expect(await sql('SELECT 1 FROM send_download_cache WHERE version_id = ?', [versionId])).toHaveLength(1);
  await ctx.close();
  expect((await request.delete(`/api/send/documents/${id}`)).ok()).toBe(true);
  expect(await sql('SELECT 1 FROM send_download_cache WHERE version_id = ?', [versionId])).toHaveLength(0);
  expect(await sql('SELECT 1 FROM send_visitors WHERE email = ?', [email])).toHaveLength(0);
});

test('un documento fallido lo dice en el encabezado', async ({ page, request }) => {
  const bad = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
  const created = await request.post('/api/send/documents', { data: { title: 'Broken', file: { name: 'b.pdf', mime: 'application/pdf', size: bad.length } } });
  const { document, version } = await created.json();
  await request.put(`/api/send/versions/${version.id}/parts/0`, { data: bad });
  await request.post(`/api/send/versions/${version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${version.id}/process`);
  await page.goto(`/en/app/send/documents/${document.id}`);
  await expect(page.getByTestId('send-failed')).toBeVisible();
  await expect(page.locator('.sd-doc-title .sd-rowmeta')).toHaveText('Failed');
});

test('un PDF con contraseña da su motivo', async ({ page, request }) => {
  const enc = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Filter/Standard/V 1/R 2/O(x)/U(y)/P -4>>endobj\ntrailer<</Root 1 0 R/Encrypt 2 0 R>>\n%%EOF');
  const created = await request.post('/api/send/documents', { data: { title: 'Locked file', file: { name: 'e.pdf', mime: 'application/pdf', size: enc.length } } });
  const { document, version } = await created.json();
  await request.put(`/api/send/versions/${version.id}/parts/0`, { data: enc });
  await request.post(`/api/send/versions/${version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${version.id}/process`);
  await page.goto(`/en/app/send/documents/${document.id}`);
  await expect(page.getByTestId('send-failed')).toContainText('has a password');
});

test('50 intentos de código a la vez: solo se comparan los del tope', async ({ browser, request }) => {
  const { id } = await makeDoc(request, 'Parallel', await pdf(1));
  const link = await makeLink(request, id, { name: 'P', passcode: 'open-sesame' });
  // Su propia IP: los 51 pedidos no gastan el tope por IP de los tests que siguen.
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.77.0.50' } });
  await ctx.request.post(`/api/send/public/${link.token}`, { data: {} });
  const all = await Promise.all(Array.from({ length: 50 }, (_, i) => ctx.request.post(`/api/send/public/${link.token}`, { data: { passcode: `wrong-${i}` } })));
  const statuses = all.map((r) => r.status());
  expect(statuses.filter((x) => x === 401).length).toBeLessThanOrEqual(8);
  expect(statuses.filter((x) => x === 429).length).toBeGreaterThanOrEqual(42);
  await ctx.close();
  // Un código corto no se acepta.
  expect((await request.post(`/api/send/documents/${id}/links`, { data: { passcode: '12345' } })).status()).toBe(400);
});

test('marca: un logo http se rechaza al guardar', async ({ request }) => {
  const res = await request.put('/api/send/settings', { data: { brandName: '', logoUrl: 'http://acme.example/logo.png', brandColor: '', siteUrl: '' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('logo_https');
});

test('un link con avisos apagados no avisa de un intento sin acceso', async ({ browser, request }) => {
  const title = `Quiet ${Math.random().toString(36).slice(2, 7)}`;
  const { id } = await makeDoc(request, title, await pdf(1));
  const link = await makeLink(request, id, { name: 'Q', notify: false, accessMode: 'block', accessList: ['blocked.example'] });
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`/api/send/public/${link.token}`, { data: { email: 'a@blocked.example' } });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).step).toBe('denied');
  await ctx.close();
  expect(JSON.stringify(await (await request.get('/api/notifications?limit=30')).json())).not.toContain(title);
});

test('sacar a la última persona del acceso pide confirmar y dice que se abre', async ({ page, request }) => {
  const created = await request.post('/api/send/spaces', { data: { title: 'Confirm room' } });
  const { space } = await created.json();
  expect((await request.put(`/api/send/spaces/${space.id}/access`, { data: { email: 'one@acme.com', documentIds: [] } })).ok()).toBe(true);
  await page.goto(`/en/app/send/spaces/${space.id}`);
  await page.getByTestId('send-space-tab-access').click();
  await page.getByTestId('send-access-remove').click();
  await expect(page.locator('dialog[open]')).toContainText('opens again');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('send-access-row')).toHaveCount(1);
  await page.getByTestId('send-access-remove').click();
  await page.getByRole('button', { name: 'Remove and open the space' }).click();
  await expect(page.getByTestId('send-access-row')).toHaveCount(0);
});

test('un link sin autor: quien lo abre ve que no está, el dueño ve por qué', async ({ browser, page, request }) => {
  const { id } = await makeDoc(request, 'Orphan link', await pdf(1));
  const link = await makeLink(request, id, { name: 'Orphan' });
  await sql('UPDATE send_links SET created_by = ? WHERE id = ?', ['someone-who-left', link.id]);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-closed')).toHaveAttribute('data-reason', 'unavailable');
  await expect(v.getByTestId('sv-closed')).toContainText('no longer available');
  await shot(v, 'viewer-unavailable-390');
  await ctx.close();
  await page.goto(`/en/app/send/documents/${id}`);
  await expect(page.getByTestId('send-link-problem')).toHaveText('Not serving');
  await expect(page.getByTestId('send-link-problem-text')).toContainText('left the workspace');
  await shot(page, 'link-not-serving');
});

test('links dentro del PDF: se tocan, abren afuera o saltan de página, y quedan en los números', async ({ browser, page, request }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  p1.drawText('See pricing', { x: 60, y: 705, size: 18, font });
  p1.drawText('Go to the appendix', { x: 60, y: 605, size: 18, font });
  p2.drawText('Appendix', { x: 60, y: 705, size: 24, font });
  const uri = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [55, 695, 260, 725], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.com/pricing') } });
  const jump = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [55, 595, 260, 625], Border: [0, 0, 0], Dest: [p2.ref, PDFName.of('Fit')] });
  p1.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(uri), doc.context.register(jump)]));
  const { id } = await makeDoc(request, 'Linked', Buffer.from(await doc.save()));
  const link = await makeLink(request, id, { name: 'With links', requireEmail: true });

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await v.getByTestId('sv-input').fill('clicker@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  const out = v.locator('figure[data-page="1"]').getByTestId('sv-page-link');
  await expect(out).toHaveAttribute('href', 'https://example.com/pricing');
  await expect(out).toHaveAttribute('rel', /noreferrer/);
  await expect(out).toHaveAttribute('target', '_blank');
  await v.waitForTimeout(4200);
  // Sin salir a internet ni abrir otra pestaña: se frena la navegación antes del clic, y el aviso sale igual.
  await v.evaluate(() => document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a[data-testid="sv-page-link"]')) e.preventDefault(); }, true));
  await out.click();
  await v.locator('figure[data-page="1"]').getByTestId('sv-page-jump').click();
  await expect(v.getByTestId('sv-page')).toHaveText('2 / 2');
  await shot(v, 'viewer-links');
  await v.waitForTimeout(1500);
  await ctx.close();

  // Un clic armado con un índice que no existe no se guarda.
  const other = await browser.newContext();
  await other.request.post(`/api/send/public/${link.token}`, { data: { email: 'x@acme.com' } });
  const version = (await (await request.get(`/api/send/documents/${id}`)).json()).document.currentVersionId;
  expect((await other.request.post(`/api/send/public/${link.token}/click`, { data: { documentId: id, versionId: version, page: 1, index: 9 } })).status()).toBe(404);
  await other.close();

  await slow.poll(async () => ((await (await request.get(`/api/send/documents/${id}/analytics`)).json()) as { linkClicks: unknown[] }).linkClicks.length).toBe(2);
  const a = (await (await request.get(`/api/send/documents/${id}/analytics`)).json()) as { linkClicks: Array<{ url: string | null; toPage: number | null; clicks: number }>; visits: Array<{ clicks: unknown[] }> };
  expect(a.linkClicks.map((c) => c.url ?? `#${c.toPage}`).sort()).toEqual(['#2', 'https://example.com/pricing']);
  expect(a.visits[0].clicks).toHaveLength(2);
  await page.goto(`/en/app/send/documents/${id}?tab=activity`);
  await expect(page.getByTestId('send-link-clicks')).toContainText('https://example.com/pricing');
  await page.getByTestId('send-visit-open').first().click();
  await expect(page.getByTestId('send-visit-clicks')).toContainText('Clicked on page 1');
  await shot(page, 'activity-link-clicks');
});

test('lista de permitidos desde un CSV: suma lo que sirve y dice qué salteó', async ({ page, request }) => {
  const { id } = await makeDoc(request, 'CSV list', await pdf(1));
  await page.goto(`/en/app/send/documents/${id}`);
  await page.getByTestId('send-link-new').click();
  await page.getByTestId('link-name').fill('From CSV');
  await page.getByTestId('link-access-mode').selectOption('allow');
  await page.getByTestId('link-access-list').fill('first@acme.com');
  await page.getByTestId('link-access-csv').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Email\nAna,ana@acme.com\nBruno,bruno@beta.io\nTeam,beta.io\nAna,first@acme.com\n') });
  await expect(page.getByTestId('link-access-csv-note')).toContainText('Added 3 entries');
  await expect(page.getByTestId('link-access-csv-note')).toContainText('Skipped 6 cells');
  await expect(page.getByTestId('link-access-count')).toHaveText('4 of 500');
  await expect(page.getByTestId('link-access-list')).toHaveValue('first@acme.com\nana@acme.com\nbruno@beta.io\nbeta.io');
  await shot(page, 'link-dialog-csv');
  await page.getByTestId('link-save').click();
  await expect(page.getByTestId('send-link-row').filter({ hasText: 'From CSV' })).toContainText('Allow list');
  const links = (await (await request.get(`/api/send/documents/${id}/links`)).json()) as { links: Array<{ name: string; accessList: string[] }> };
  expect(links.links.find((l) => l.name === 'From CSV')?.accessList).toEqual(['first@acme.com', 'ana@acme.com', 'bruno@beta.io', 'beta.io']);
  // Más de 500, rechazado por el servidor.
  const many = Array.from({ length: 501 }, (_, i) => `p${i}@acme.com`);
  const res = await request.post(`/api/send/documents/${id}/links`, { data: { accessMode: 'allow', accessList: many } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('too_many_entries');
});
