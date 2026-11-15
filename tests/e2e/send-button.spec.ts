import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Send: botón propio del link (el "custom button" de DocSend). Se arma desde el
 * diálogo del link, aparece en el visor (arriba en escritorio, abajo en el
 * teléfono), abre afuera y el clic queda en los números. SEND_CAPTURES=<carpeta> guarda capturas.
 */
const CAP = process.env.SEND_CAPTURES;
if (CAP && !existsSync(CAP)) mkdirSync(CAP, { recursive: true });
const shot = async (page: Page, name: string) => {
  if (CAP) await page.screenshot({ path: path.join(CAP, `${name}.png`), fullPage: false });
};

async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Deck page ${i}`, { x: 60, y: 690, size: 34, font, color: rgb(0.1, 0.1, 0.1) });
  }
  return Buffer.from(await doc.save());
}

async function makeDoc(request: APIRequestContext, title: string, bytes: Buffer): Promise<string> {
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

type Analytics = { linkClicks: Array<{ url: string | null; button: string | null; clicks: number; people: number }>; visits: Array<{ clicks: Array<{ button: string | null }> }> };
const analytics = async (request: APIRequestContext, id: string, linkId?: string) =>
  (await (await request.get(`/api/send/documents/${id}/analytics${linkId ? `?link=${linkId}` : ''}`)).json()) as Analytics;

/** Frena la navegación del botón (no sale a internet ni abre otra pestaña); el aviso del clic sale igual. */
const stayHere = (v: Page) =>
  v.evaluate(() =>
    document.addEventListener(
      'click',
      (e) => {
        if ((e.target as HTMLElement).closest('a.sv-cta')) e.preventDefault();
      },
      true,
    ),
  );

test.setTimeout(240_000);
const slow = expect.configure({ timeout: 45_000 });

test('botón propio: se arma en el diálogo, se ve en el visor y el clic queda en los números', async ({ page, browser, request }) => {
  const id = await makeDoc(request, 'Button deck', await pdf(2));

  // Quien manda: arma el link con el botón desde el diálogo.
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`/en/app/send/documents/${id}`);
  await page.getByTestId('send-link-new').click();
  await page.getByTestId('link-name').fill('Investors');
  // Solo el texto, sin link: el diálogo lo frena antes de mandar.
  await page.getByTestId('link-button-label').fill('Book a call');
  await page.getByTestId('link-save').click();
  await expect(page.getByTestId('link-error')).toBeVisible();
  await expect(page.getByTestId('send-link-row')).toHaveCount(0);
  // Sin esquema se guarda como https.
  await page.getByTestId('link-button-url').fill('cal.example.com/demo');
  await shot(page, 'button-dialog');
  await page.getByTestId('link-save').click();
  await slow(page.getByTestId('send-link-row')).toHaveCount(1);
  const links = (await (await request.get(`/api/send/documents/${id}/links`)).json()).links as Array<{ id: string; path: string; buttonLabel: string; buttonUrl: string }>;
  expect(links[0]).toMatchObject({ buttonLabel: 'Book a call', buttonUrl: 'https://cal.example.com/demo' });
  const url = `/en${links[0].path}`;
  const token = links[0].path.split('/').pop()!;

  // Editar: el diálogo trae lo guardado.
  await page.getByTestId('send-link-edit').click();
  await expect(page.getByTestId('link-button-label')).toHaveValue('Book a call');
  await expect(page.getByTestId('link-button-url')).toHaveValue('https://cal.example.com/demo');
  await page.keyboard.press('Escape');

  // Quien abre, en escritorio: el botón está en la barra, abre afuera.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const v = await ctx.newPage();
  await v.goto(url);
  await slow(v.getByTestId('sv-reader')).toBeVisible();
  const cta = v.getByTestId('sv-button');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', 'https://cal.example.com/demo');
  await expect(cta).toHaveAttribute('target', '_blank');
  await expect(cta).toHaveAttribute('rel', /noopener/);
  await expect(v.getByTestId('sv-button-mobile')).toBeHidden();
  await shot(v, 'button-viewer-1280');
  // La visita cuenta tras unos segundos; el clic queda atado a ella.
  await v.waitForTimeout(4200);
  await stayHere(v);
  await cta.click();
  await slow.poll(async () => (await analytics(request, id)).linkClicks.filter((c) => c.button !== null).length).toBe(1);

  // En el teléfono: abajo, a lo ancho, y sin scroll horizontal.
  await v.setViewportSize({ width: 390, height: 780 });
  await expect(v.getByTestId('sv-button')).toBeHidden();
  const mobile = v.getByTestId('sv-button-mobile');
  await expect(mobile).toBeVisible();
  expect(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(v, 'button-viewer-390');
  await mobile.click();
  await slow.poll(async () => (await analytics(request, id)).linkClicks.find((c) => c.button !== null)?.clicks ?? 0).toBe(2);
  await ctx.close();

  // Oscuro: el visor sigue igual de legible (captura) y el botón visible.
  const dark = await browser.newContext({ viewport: { width: 390, height: 780 }, colorScheme: 'dark' });
  const d = await dark.newPage();
  await d.goto(url);
  await slow(d.getByTestId('sv-button-mobile')).toBeVisible();
  await shot(d, 'button-viewer-390-dark');
  await dark.close();

  // Números: una fila del botón con dos clics de una persona, y el clic en la visita.
  const a = await analytics(request, id);
  const row = a.linkClicks.find((c) => c.button !== null)!;
  expect(row).toMatchObject({ button: 'Book a call', url: 'https://cal.example.com/demo', clicks: 2, people: 1 });
  expect(a.visits.some((x) => x.clicks.some((c) => c.button === 'Book a call'))).toBe(true);
  await page.goto(`/en/app/send/documents/${id}?tab=activity`);
  await expect(page.getByTestId('send-link-clicks').locator('tr[data-kind="button"]')).toHaveCount(1);
  await page.getByTestId('send-link-clicks').scrollIntoViewIfNeeded();
  await shot(page, 'button-activity');
  // En el teléfono y en oscuro: el diálogo con el botón y sin scroll horizontal.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`/en/app/send/documents/${id}`);
  await page.getByTestId('send-link-edit').click();
  await page.getByTestId('link-button-url').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'button-dialog-390-dark');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('link-button-url')).toHaveCount(0);

  // Un clic armado sobre un documento que no es del link no se guarda.
  const other = await browser.newContext();
  await other.request.post(`/api/send/public/${token}`, { data: {} });
  expect((await other.request.post(`/api/send/public/${token}/click`, { data: { button: true, documentId: 'sd_nope' } })).status()).toBe(404);
  await other.close();

  // Sacar el botón: el visor deja de mostrarlo y un clic viejo no cuenta.
  expect((await request.patch(`/api/send/links/${links[0].id}`, { data: { buttonLabel: '', buttonUrl: '' } })).ok()).toBe(true);
  const after = await browser.newContext();
  const w = await after.newPage();
  await w.goto(url);
  await slow(w.getByTestId('sv-reader')).toBeVisible();
  await expect(w.getByTestId('sv-button')).toHaveCount(0);
  expect((await (await after.request.post(`/api/send/public/${token}/click`, { data: { button: true, documentId: id } })).json()).counted).toBe(false);
  await after.close();
});

test('botón propio: la API rechaza un link que no es web y un botón a medias', async ({ request }) => {
  const id = await makeDoc(request, 'Button rules', await pdf(1));
  for (const data of [
    { buttonLabel: 'Hi', buttonUrl: 'javascript:alert(1)' },
    { buttonLabel: 'Hi', buttonUrl: '' },
    { buttonLabel: '', buttonUrl: 'https://example.com' },
    { buttonLabel: 'x'.repeat(41), buttonUrl: 'https://example.com' },
  ]) {
    const res = await request.post(`/api/send/documents/${id}/links`, { data });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/^invalid_button_/);
  }
});

test('botón propio en un espacio: arriba en el índice y en cada documento', async ({ browser, request }) => {
  const docId = await makeDoc(request, 'Room deck', await pdf(1));
  const { space } = await (await request.post('/api/send/spaces', { data: { title: 'Button room' } })).json();
  expect((await request.patch(`/api/send/spaces/${space.id}`, { data: { items: [{ documentId: docId, folder: '' }] } })).ok()).toBe(true);
  const res = await request.post(`/api/send/spaces/${space.id}/links`, { data: { name: 'Room', buttonLabel: 'Talk to us', buttonUrl: 'https://example.com/contact' } });
  expect(res.status()).toBe(201);
  const { link } = await res.json();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(`/en${link.path}`);
  await slow(v.getByTestId('sv-space')).toBeVisible();
  await expect(v.getByTestId('sv-space').getByTestId('sv-button')).toHaveAttribute('href', 'https://example.com/contact');
  expect(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(v, 'button-space-390');
  await v.getByTestId('sv-space-doc').first().click();
  await expect(v.getByTestId('sv-reader')).toBeVisible();
  await expect(v.getByTestId('sv-button-mobile')).toBeVisible();
  await ctx.close();
});
