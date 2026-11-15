import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Send: aviso cuando alguien abre un link deshabilitado o vencido (como DocSend).
 * Lo manda el navegador desde la página cerrada; un previsualizador no avisa, la
 * misma persona avisa una vez por día, y un link con avisos apagados no avisa.
 * SEND_CAPTURES=<carpeta> guarda capturas.
 */
const CAP = process.env.SEND_CAPTURES;
if (CAP && !existsSync(CAP)) mkdirSync(CAP, { recursive: true });
const shot = async (page: Page, name: string) => {
  if (CAP) await page.screenshot({ path: path.join(CAP, `${name}.png`), fullPage: false });
};

async function pdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.addPage([612, 792]).drawText('Closed page', { x: 60, y: 690, size: 34, font, color: rgb(0.1, 0.1, 0.1) });
  return Buffer.from(await doc.save());
}

async function makeDoc(request: APIRequestContext, title: string): Promise<string> {
  const bytes = await pdf();
  const created = await request.post('/api/send/documents', { data: { title, file: { name: 'deck.pdf', mime: 'application/pdf', size: bytes.length } } });
  expect(created.status()).toBe(201);
  const { document, version } = await created.json();
  expect((await request.put(`/api/send/versions/${version.id}/parts/0`, { data: bytes, headers: { 'content-type': 'application/octet-stream' } })).ok()).toBe(true);
  expect((await request.post(`/api/send/versions/${version.id}/complete`, { data: {} })).ok()).toBe(true);
  for (let i = 0; i < 30; i++) {
    const v = (await (await request.post(`/api/send/versions/${version.id}/process`)).json()).version;
    if (v.status === 'ready') break;
    expect(v.status).toBe('processing');
  }
  return document.id;
}

async function makeLink(request: APIRequestContext, documentId: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/send/documents/${documentId}/links`, { data });
  expect(res.status()).toBe(201);
  const { link } = await res.json();
  return { id: link.id as string, url: `/en${link.path}`, token: String(link.path).split('/').pop()! };
}

/** Mails capturados en E2E_MAIL_FILE para una dirección. */
function mailsTo(to: string): Array<{ to: string; subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE;
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.to === to);
}

type Row = { source_type: string; source_id: string; href: string | null };
const alertsFor = async (request: APIRequestContext, linkId: string) =>
  ((await (await request.get('/api/notifications?limit=100&type=send_activity')).json()).rows as Row[]).filter((n) => n.source_type === 'send_link' && n.source_id === linkId);

type Denied = Array<{ email: string | null; reason: string; linkName: string }>;
const deniedOf = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/send/documents/${id}/analytics`)).json()).denied as Denied);

test.setTimeout(180_000);
const slow = expect.configure({ timeout: 45_000 });

test('abrir un link deshabilitado avisa una vez a quien lo mandó y queda en la actividad', async ({ page, browser, request }) => {
  const title = `Closed deck ${Math.random().toString(36).slice(2, 7)}`;
  const id = await makeDoc(request, title);
  const link = await makeLink(request, id, { name: 'Old investor link', requireEmail: true });

  // Alguien entró con su email cuando andaba; después se deshabilitó.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(link.url);
  await v.getByTestId('sv-input').fill('ana@acme.com');
  await v.getByTestId('sv-submit').click();
  await slow(v.getByTestId('sv-reader')).toBeVisible();
  expect((await request.patch(`/api/send/links/${link.id}`, { data: { disabled: true } })).ok()).toBe(true);
  // La pestaña abierta se cierra sola: eso no es "lo abrió", no avisa.
  await expect(v.getByTestId('sv-closed')).toBeVisible({ timeout: 25_000 });
  await v.waitForTimeout(1500);
  expect(await alertsFor(request, link.id)).toHaveLength(0);

  // Vuelve a abrirlo: ahora sí, con su email.
  await v.goto(link.url);
  await expect(v.getByTestId('sv-closed')).toHaveAttribute('data-reason', 'disabled');
  await shot(v, 'closed-390');
  await slow.poll(async () => (await alertsFor(request, link.id)).length).toBe(1);
  expect((await alertsFor(request, link.id))[0].href).toBe(`/app/send/documents/${id}`);
  // El mismo aviso por email, con el link al documento.
  await slow.poll(() => mailsTo('demo@zerosoft.ai').filter((m) => m.subject.includes(title)).length).toBe(1);
  expect(mailsTo('demo@zerosoft.ai').find((m) => m.subject.includes(title))!.text).toContain(`/app/send/documents/${id}`);
  await slow.poll(async () => (await deniedOf(request, id)).filter((d) => d.reason === 'disabled').length).toBe(1);
  expect((await deniedOf(request, id)).find((d) => d.reason === 'disabled')).toMatchObject({ email: 'ana@acme.com', linkName: 'Old investor link' });

  // La misma persona otra vez el mismo día: no repite.
  await v.reload();
  await expect(v.getByTestId('sv-closed')).toBeVisible();
  await v.waitForTimeout(2000);
  expect(await alertsFor(request, link.id)).toHaveLength(1);
  expect(mailsTo('demo@zerosoft.ai').filter((m) => m.subject.includes(title))).toHaveLength(1);
  await ctx.close();

  // Un previsualizador de links (solo GET, sin navegador) no avisa.
  const bot = await browser.newContext();
  expect((await bot.request.get(link.url, { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' } })).ok()).toBe(true);
  expect((await bot.request.post(`/api/send/public/${link.token}`, { data: { closedOpen: true }, headers: { 'user-agent': 'curl/8.0' } })).ok()).toBe(true);
  await bot.close();
  expect(await alertsFor(request, link.id)).toHaveLength(1);

  // Quien mandó el link lo ve en la actividad del documento y en la campana, en claro y oscuro.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`/en/app/send/documents/${id}?tab=activity`);
    const row = page.getByTestId('send-denied').locator('li[data-reason="disabled"]');
    await slow(row).toHaveCount(1);
    await row.scrollIntoViewIfNeeded();
    await shot(page, `closed-activity-${scheme}`);
    await page.locator('button.side-bell').click();
    await expect(page.locator(`.side-bell-panel a[href$="/app/send/documents/${id}"]`).first()).toBeVisible();
    await shot(page, `closed-bell-${scheme}`);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 780 });
    await row.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `closed-activity-390-${scheme}`);
  }
});

test('un link vencido también avisa, y uno con avisos apagados solo lo registra', async ({ browser, request }) => {
  const id = await makeDoc(request, 'Expired deck');
  const expired = await makeLink(request, id, { name: 'Expired', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  expect((await request.patch(`/api/send/links/${expired.id}`, { data: { expiresAt: new Date(Date.now() - 60_000).toISOString() } })).ok()).toBe(true);
  const quiet = await makeLink(request, id, { name: 'Quiet', notify: false });
  expect((await request.patch(`/api/send/links/${quiet.id}`, { data: { disabled: true } })).ok()).toBe(true);

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(expired.url);
  await slow(v.getByTestId('sv-closed')).toHaveAttribute('data-reason', 'expired');
  await slow.poll(async () => (await alertsFor(request, expired.id)).length).toBe(1);
  await v.goto(quiet.url);
  await expect(v.getByTestId('sv-closed')).toHaveAttribute('data-reason', 'disabled');
  await slow.poll(async () => (await deniedOf(request, id)).filter((d) => d.linkName === 'Quiet').length).toBe(1);
  expect(await alertsFor(request, quiet.id)).toHaveLength(0);
  await ctx.close();
  const reasons = (await deniedOf(request, id)).map((d) => d.reason).sort();
  expect(reasons).toEqual(['disabled', 'expired']);

  // Un link activo no acepta el aviso: no hay nada que registrar.
  const active = await makeLink(request, id, { name: 'Active' });
  const other = await browser.newContext();
  expect((await other.request.post(`/api/send/public/${active.token}`, { data: { closedOpen: true } })).ok()).toBe(true);
  await other.close();
  expect(await alertsFor(request, active.id)).toHaveLength(0);
});
