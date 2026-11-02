import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { buildZip } from '../../lib/zip-reader';

/**
 * Send, el resto de lo que se comparte y lo que se conecta: Word, PowerPoint, video,
 * una página de Docs, el NDA con Sign, el contacto del CRM, los roles y el visor en
 * oscuro. SEND_CAPTURES=<carpeta> guarda capturas.
 */
const CAP = process.env.SEND_CAPTURES;
if (CAP && !existsSync(CAP)) mkdirSync(CAP, { recursive: true });
const shot = async (page: Page, name: string, fullPage = false) => {
  if (CAP) await page.screenshot({ path: path.join(CAP, `${name}.png`), fullPage });
};
const uid = () => Math.random().toString(36).slice(2, 8);

test.setTimeout(240_000);
const slow = expect.configure({ timeout: 45_000 });

function docx(): Buffer {
  const p = (text: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  return buildZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('Master services agreement', 'Heading1')}${p('This agreement is between Acme and the client. Niño, açúcar and résumé keep their accents.')}${p('Scope', 'Heading2')}${p('The work is described in the attached order.')}</w:body></w:document>`,
    },
  ]);
}

function pptx(): Buffer {
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const rel = (items: Array<[string, string, string]>) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const slide = (title: string, bullets: string[], bg = '') => `<?xml version="1.0"?><p:sld ${ns}><p:cSld>${bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill></p:bgPr></p:bg>` : ''}<p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${bullets.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="8000000" y="4500000"/><a:ext cx="3000000" cy="1500000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>+42%</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  const ph = (type: string, x: number, y: number, w: number, h: number, idx = '') => `<p:sp><p:nvSpPr><p:cNvPr id="9" name="p"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr></p:sp>`;
  const tree = `<p:cSld><p:spTree>${ph('title', 838200, 365125, 10515600, 1325563)}${ph('body', 838200, 1825625, 6800000, 4351338, '1')}</p:spTree></p:cSld>`;
  return buildZip([
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0"?><p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: rel([['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml']]) },
    { name: 'ppt/slides/slide1.xml', data: slide('Q3 results', ['Revenue up', 'Churn down', 'Two new markets']) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]) },
    { name: 'ppt/slides/slide2.xml', data: slide('Next steps', ['Hire', 'Ship'], 'F2F2F2') },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0"?><p:sldLayout ${ns}>${tree}</p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rel([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0"?><p:sldMaster ${ns}>${tree}</p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rel([['rId1', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: `<?xml version="1.0"?><a:theme ${ns}><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="1F1F1F"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="0B7285"/></a:accent1></a:clrScheme></a:themeElements></a:theme>` },
  ]);
}

async function uploadThroughUi(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<string> {
  await page.goto('/en/app/send/new');
  await page.getByTestId('send-file').setInputFiles(file);
  await page.getByTestId('send-create').click();
  await page.waitForURL(/\/en\/app\/send\/documents\/sd_/, { timeout: 120_000 });
  return page.url().split('/').pop()!.split('?')[0];
}

async function linkFor(request: APIRequestContext, id: string, data: Record<string, unknown> = {}): Promise<{ id: string; url: string; token: string }> {
  const res = await request.post(`/api/send/documents/${id}/links`, { data: { name: 'L', ...data } });
  expect(res.status()).toBe(201);
  const { link } = await res.json();
  return { id: link.id, url: `/en${link.path}`, token: String(link.path).split('/').pop()! };
}

const analytics = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/send/documents/${id}/analytics`)).json()) as { totals: { visits: number }; visits: Array<{ email: string | null; seconds: number; pagesSeen: number; pageTotal: number; pages: Array<{ page: number; seconds: number }> }> };

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function member(browser: Browser, baseURL: string, label: string, apps: string): Promise<BrowserContext> {
  const email = `${label}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  await expect.poll(async () => (await sql('SELECT id FROM users WHERE email = ?', [email])).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await p.close();
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [id]);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)`, [demoTeam, id, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return ctx;
}

function mails(to: string): Array<{ to: string; subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE;
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.to === to);
}

async function plainPdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 60, y: 700, size: 24 });
  return Buffer.from(await doc.save());
}

test('Word: se convierte con un aviso, y quien abre ve páginas', async ({ page, browser, request }) => {
  const id = await uploadThroughUi(page, { name: 'Agreement.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx() });
  await expect(page.getByTestId('send-simplified')).toContainText('simplified layout');
  await page.getByTestId('send-tab-preview').click();
  await slow.poll(() => page.getByTestId('send-preview').locator('img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);
  await shot(page, 'word-preview');
  const link = await linkFor(request, id, { allowDownload: true });
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-reader')).toHaveAttribute('data-kind', 'word');
  await slow.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
  await shot(v, 'word-viewer');
  // Sin watermark, la descarga es el .docx original.
  const down = await ctx.request.get(`/api/send/public/${link.token}/download?document=${id}&piece=0`);
  expect(down.ok()).toBe(true);
  expect((await down.body()).subarray(0, 2).toString()).toBe('PK');
  await ctx.close();
});

test('PowerPoint: dibuja texto, formas y fondos, heredando de la plantilla', async ({ page, browser, request }) => {
  const id = await uploadThroughUi(page, { name: 'Q3 results.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptx() });
  await expect(page.getByTestId('send-simplified')).toContainText('simplified renderer');
  const link = await linkFor(request, id, { watermark: true, allowDownload: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const v = await ctx.newPage();
  await v.goto(link.url);
  await v.getByTestId('sv-input').fill('deck@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toHaveAttribute('data-kind', 'slides');
  await expect(v.getByTestId('sv-page')).toHaveText('1 / 2');
  await slow.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
  expect(await v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalHeight)).toBe(900);
  await shot(v, 'pptx-viewer');
  // Con watermark, la descarga es un PDF armado con las páginas.
  const down = await ctx.request.get(`/api/send/public/${link.token}/download?document=${id}&piece=0`);
  expect(down.ok()).toBe(true);
  const pdf = await PDFDocument.load(await down.body());
  expect(pdf.getPageCount()).toBe(2);
  await ctx.close();
});

test('Video: se sube, se ve por rangos, y el tiempo cae en el tramo que se reprodujo', async ({ page, browser, request }) => {
  const buffer = readFileSync(path.join(__dirname, '../fixtures/send-sample.webm'));
  const id = await uploadThroughUi(page, { name: 'Demo.webm', mimeType: 'video/webm', buffer });
  await expect(page.locator('.sd-rowmeta').first()).toContainText('Video');
  const link = await linkFor(request, id, {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-reader')).toHaveAttribute('data-kind', 'video');
  const video = v.getByTestId('sv-video');
  await slow.poll(() => video.evaluate((el: HTMLVideoElement) => el.duration)).toBeGreaterThan(20);
  // Rango: 206 y solo lo pedido.
  const version = (await (await request.get(`/api/send/documents/${id}`)).json()).document.currentVersionId;
  const range = await ctx.request.get(`/api/send/public/${link.token}/video/${version}`, { headers: { range: 'bytes=0-99' } });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(100);
  expect(range.headers()['content-range']).toBe(`bytes 0-99/${buffer.length}`);
  await video.evaluate((el: HTMLVideoElement) => {
    el.muted = true;
    return el.play();
  });
  await v.waitForTimeout(5000);
  await shot(v, 'video-viewer-390');
  await video.evaluate((el: HTMLVideoElement) => el.pause());
  await v.waitForTimeout(600);
  await v.close();
  await ctx.close();
  await expect.poll(async () => (await analytics(request, id)).totals.visits, { timeout: 15_000 }).toBe(1);
  const a = await analytics(request, id);
  expect(a.visits[0].pageTotal).toBe(3);
  expect(a.visits[0].pages[0].page).toBe(1);
  expect(a.visits[0].pages[0].seconds).toBeGreaterThan(2);
  expect(a.visits[0].seconds).toBeLessThan(9);
  // Deshabilitado: el video corta.
  expect((await request.patch(`/api/send/links/${link.id}`, { data: { disabled: true } })).ok()).toBe(true);
  const after = await browser.newContext();
  expect((await after.request.get(`/api/send/public/${link.token}/video/${version}`)).status()).toBe(410);
  await after.close();
});

test('Una página de Docs se comparte como copia en PDF', async ({ page, browser, request }) => {
  const title = `Handbook ${uid()}`;
  expect((await request.post('/api/docs/pages', { data: { title } })).ok()).toBe(true);
  await page.goto('/en/app/send/new');
  await page.getByTestId('send-source-docs').click();
  await page.getByTestId('send-docs-q').fill(title);
  await page.getByRole('option', { name: title }).click();
  await page.getByTestId('send-create').click();
  await page.waitForURL(/\/en\/app\/send\/documents\/sd_/, { timeout: 90_000 });
  await expect(page.getByTestId('send-doc-title')).toHaveValue(title);
  const id = page.url().split('/').pop()!.split('?')[0];
  const link = await linkFor(request, id, {});
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await expect(v.getByTestId('sv-reader')).toHaveAttribute('data-kind', 'docs');
  await ctx.close();
});

test('NDA con Sign: sin firmar no se ve; firmado, el visor sigue solo', async ({ browser, request }) => {
  const created = await (await request.post('/api/sign/templates', { data: { name: `NDA ${uid()}` } })).json();
  const tid = created.template.id;
  expect((await request.post(`/api/sign/templates/${tid}/document`, { multipart: { file: { name: 'nda.pdf', mimeType: 'application/pdf', buffer: await plainPdf() } } })).ok()).toBe(true);
  const roles = [{ key: 'signer', name: 'Signer', role: 'signer', order: 1 }];
  const fields = [{ roleKey: 'signer', kind: 'signature', page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.06, required: true }];
  const patched = await request.patch(`/api/sign/templates/${tid}`, { data: { otpRequired: false, roles, fields } });
  expect(patched.ok()).toBe(true);

  const bytes = await plainPdf(2);
  const made = await (await request.post('/api/send/documents', { data: { title: 'Secret plan', file: { name: 'plan.pdf', mime: 'application/pdf', size: bytes.length } } })).json();
  await request.put(`/api/send/versions/${made.version.id}/parts/0`, { data: bytes });
  await request.post(`/api/send/versions/${made.version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${made.version.id}/process`);
  const link = await linkFor(request, made.document.id, { ndaTemplateId: tid });

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await v.getByTestId('sv-input').fill(`signer-${uid()}@acme.com`);
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-gate-nda')).toBeVisible();
  await shot(v, 'viewer-nda');
  expect(await v.content()).not.toContain('Secret plan');
  expect((await ctx.request.get(`/api/send/public/${link.token}/pages/${made.version.id}/1`)).status()).toBe(401);
  await v.getByTestId('sv-nda-name').fill('Ana Signer');
  const [signing] = await Promise.all([ctx.waitForEvent('page'), v.getByTestId('sv-nda-start').click()]);
  await signing.waitForLoadState('networkidle');
  await signing.getByLabel('I agree to use electronic records and signatures for this document.').check();
  await signing.getByRole('button', { name: /sign here/i }).first().click();
  const dialog = signing.getByRole('dialog', { name: 'Adopt your signature' });
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click();
  await signing.getByRole('button', { name: 'Finish' }).first().click();
  await expect(signing.getByText(/signed|done|finished/i).first()).toBeVisible({ timeout: 30_000 });
  // El visor original sigue solo.
  await expect(v.getByTestId('sv-reader')).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

test('CRM: la visita queda en la línea de tiempo del contacto con ese email', async ({ page, browser, request }) => {
  const email = `contact-${uid()}@acme.com`;
  const contact = await (await request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: 'Contact', email } })).json();
  const contactId = contact.contact?.id ?? contact.id;
  const bytes = await plainPdf(1);
  const made = await (await request.post('/api/send/documents', { data: { title: 'Proposal for CRM', file: { name: 'p.pdf', mime: 'application/pdf', size: bytes.length } } })).json();
  await request.put(`/api/send/versions/${made.version.id}/parts/0`, { data: bytes });
  await request.post(`/api/send/versions/${made.version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${made.version.id}/process`);
  const link = await linkFor(request, made.document.id, { requireEmail: true });
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link.url);
  await v.getByTestId('sv-input').fill(email);
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await v.waitForTimeout(4500);
  await ctx.close();
  await expect.poll(async () => (await analytics(request, made.document.id)).totals.visits, { timeout: 15_000 }).toBe(1);
  await page.goto(`/en/app/crm/contacts/${contactId}`);
  await expect(page.getByText('Opened Proposal for CRM in Send')).toBeVisible();
  await shot(page, 'crm-timeline');
  await page.goto(`/en/app/send/documents/${made.document.id}?tab=activity`);
  await expect(page.getByTestId('send-visitors').getByRole('link', { name: 'CRM contact' })).toBeVisible();
});

test('Volver, mensaje, marca apagada y números por link', async ({ browser, request }) => {
  const saved = await request.put('/api/send/settings', { data: { brandName: 'Acme Capital', logoUrl: '', brandColor: '', siteUrl: '' } });
  expect(saved.ok()).toBe(true);
  const bytes = await plainPdf(1);
  const made = await (await request.post('/api/send/documents', { data: { title: 'Returning', file: { name: 'r.pdf', mime: 'application/pdf', size: bytes.length } } })).json();
  await request.put(`/api/send/versions/${made.version.id}/parts/0`, { data: bytes });
  await request.post(`/api/send/versions/${made.version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${made.version.id}/process`);
  const id = made.document.id;
  const a = await linkFor(request, id, { name: 'With brand', message: 'Hi Ana, here is the plan.', requireEmail: true });
  const b = await linkFor(request, id, { name: 'No brand', useBranding: false });

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(a.url);
  await expect(v.getByTestId('sv-gate-email')).toContainText('Hi Ana, here is the plan.');
  await expect(v.getByTestId('sv-gate-email')).toContainText('Acme Capital');
  await v.getByTestId('sv-input').fill('back@acme.com');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await v.waitForTimeout(4200);
  await slow.poll(async () => (await analytics(request, id)).totals.visits).toBe(1);
  await v.close();
  // Media hora después, con la misma sesión: otra visita, marcada como vuelta, sin pedir el email de nuevo.
  await sql('UPDATE send_visits SET started_at = ?, last_ping_at = ? WHERE document_id = ?', [new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() - 3600_000).toISOString(), id]);
  const again = await ctx.newPage();
  await again.goto(a.url);
  await expect(again.getByTestId('sv-reader')).toBeVisible();
  await again.waitForTimeout(4200);
  await slow.poll(async () => (await analytics(request, id)).totals.visits).toBe(2);
  const data = (await (await request.get(`/api/send/documents/${id}/analytics`)).json()) as { totals: { visitors: number }; visits: Array<{ returning: boolean }> };
  expect(data.totals.visitors).toBe(1);
  expect(data.visits.map((x) => x.returning)).toEqual([true, false]);
  await again.close();
  await ctx.close();

  const other = await browser.newContext();
  const o = await other.newPage();
  await o.goto(b.url);
  await expect(o.getByTestId('sv-reader')).toBeVisible();
  await expect(o.getByTestId('sv-reader')).not.toContainText('Acme Capital');
  await other.close();
  // Por link: el segundo todavía no tiene visitas.
  const byLink = await (await request.get(`/api/send/documents/${id}/analytics?link=${b.id}`)).json();
  expect(byLink.totals.visits).toBe(0);
  const byA = await (await request.get(`/api/send/documents/${id}/analytics?link=${a.id}`)).json();
  expect(byA.totals.visits).toBe(2);
  await request.put('/api/send/settings', { data: { brandName: '', logoUrl: '', brandColor: '', siteUrl: '' } });
});

test('Roles: un member ve lo suyo y lo compartido, y no exporta', async ({ browser, request, baseURL }) => {
  const bytes = await plainPdf(1);
  const adminTitle = `Admin doc ${uid()}`;
  const made = await (await request.post('/api/send/documents', { data: { title: adminTitle, file: { name: 'a.pdf', mime: 'application/pdf', size: bytes.length } } })).json();
  await request.put(`/api/send/versions/${made.version.id}/parts/0`, { data: bytes });
  await request.post(`/api/send/versions/${made.version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${made.version.id}/process`);
  const id = made.document.id;
  const link = await linkFor(request, id, { name: 'Owner link' });

  const m = await member(browser, baseURL!, 'send-member', '["send"]');
  const privateList = await (await m.request.get('/api/send/documents')).json();
  expect(JSON.stringify(privateList)).not.toContain(adminTitle);
  expect((await m.request.get(`/api/send/documents/${id}`)).status()).toBe(404);
  expect((await m.request.get(`/api/send/documents/${id}/analytics`)).status()).toBe(404);
  expect((await m.request.get(`/api/send/versions/${made.version.id}/pages/1`)).status()).toBe(404);
  expect((await m.request.post(`/api/send/documents/${id}/links`, { data: {} })).status()).toBe(404);

  // Compartido: lee y arma sus links, pero no borra, no renombra y no exporta.
  expect((await request.patch(`/api/send/documents/${id}`, { data: { sharing: 'workspace' } })).ok()).toBe(true);
  expect((await m.request.get(`/api/send/documents/${id}`)).status()).toBe(200);
  expect((await m.request.patch(`/api/send/documents/${id}`, { data: { title: 'Hacked' } })).status()).toBe(403);
  expect((await m.request.delete(`/api/send/documents/${id}`)).status()).toBe(403);
  expect((await m.request.get(`/api/send/documents/${id}/export`)).status()).toBe(403);
  expect((await m.request.patch(`/api/send/links/${link.id}`, { data: { disabled: true } })).status()).toBe(403);
  const own = await m.request.post(`/api/send/documents/${id}/links`, { data: { name: 'Mine' } });
  expect(own.status()).toBe(201);
  expect((await m.request.put('/api/send/settings', { data: { brandName: 'X', logoUrl: '', brandColor: '', siteUrl: '' } })).status()).toBe(403);
  await m.close();

  // Sin la app: nada.
  const n = await member(browser, baseURL!, 'no-send', '["crm"]');
  expect((await n.request.get('/api/send/documents')).status()).toBe(401);
  await n.close();
});

test('Se ve bien: oscuro, 390 px y marca propia', async ({ page, browser, request }) => {
  const saved = await request.put('/api/send/settings', { data: { brandName: 'Acme Capital', logoUrl: '', brandColor: '#7c3aed', siteUrl: 'https://acme.example' } });
  expect(saved.ok()).toBe(true);
  const bytes = await plainPdf(3);
  const title = 'A proposal with a very long title that has to wrap politely on small screens without pushing anything out of place';
  const made = await (await request.post('/api/send/documents', { data: { title, file: { name: 'p.pdf', mime: 'application/pdf', size: bytes.length } } })).json();
  await request.put(`/api/send/versions/${made.version.id}/parts/0`, { data: bytes });
  await request.post(`/api/send/versions/${made.version.id}/complete`, { data: {} });
  await request.post(`/api/send/versions/${made.version.id}/process`);
  const id = made.document.id;
  const link = await linkFor(request, id, { name: 'A very long link name for a very long campaign that keeps going past the end', requireEmail: true, allowDownload: true, watermark: true, passcode: 'abcd1234', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });

  const dark = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 780 } });
  const v = await dark.newPage();
  await v.goto(link.url);
  await shot(v, 'dark-gate-390');
  await v.getByTestId('sv-input').fill('abcd1234');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-gate-email')).toBeVisible();
  await v.getByTestId('sv-input').fill('a-very-long-email-address-for-testing-wrap@some-long-company-domain.example');
  await v.getByTestId('sv-submit').click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await slow.poll(() => v.locator('figure[data-page="1"] img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
  await shot(v, 'dark-viewer-390');
  expect(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await v.waitForTimeout(4000);
  await dark.close();

  for (const [scheme, w, name] of [['dark', 1280, 'dark-1280'], ['dark', 390, 'dark-390'], ['light', 390, 'light-390']] as const) {
    const c = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: 800 } });
    const p = await c.newPage();
    await p.goto(`/en/app/send/documents/${id}?tab=links`);
    await expect(p.getByTestId('send-link-row').first()).toBeVisible();
    await shot(p, `doc-links-${name}`);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await p.getByTestId('send-tab-activity').click();
    await expect(p.getByTestId('send-activity')).toBeVisible();
    await shot(p, `doc-activity-${name}`, true);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await p.getByTestId('send-tab-links').click();
    await p.getByTestId('send-link-edit').first().click();
    await expect(p.getByTestId('link-save')).toBeVisible();
    await p.waitForTimeout(400);
    await shot(p, `link-dialog-${name}`);
    // Esc cierra.
    await p.keyboard.press('Escape');
    await expect(p.getByTestId('link-save')).toHaveCount(0);
    await p.goto('/en/app/send');
    await shot(p, `home-${name}`);
    await p.goto('/en/app/send/settings');
    await shot(p, `settings-${name}`);
    await c.close();
  }
  await page.goto('/en/products/send');
  await shot(page, 'product-page', true);
  await request.put('/api/send/settings', { data: { brandName: '', logoUrl: '', brandColor: '', siteUrl: '' } });
});
