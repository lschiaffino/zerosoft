import { readFileSync } from 'fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Send: índice numerado de un espacio (el "indexing" de las salas de datos de DocSend).
 * Se prende en el espacio, los números se ven ahí y en el visor, y los dos bajan el índice en CSV.
 */
async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) doc.addPage([612, 792]).drawText(`Page ${i}`, { x: 60, y: 690, size: 34, font, color: rgb(0.1, 0.1, 0.1) });
  return Buffer.from(await doc.save());
}

async function makeDoc(request: APIRequestContext, title: string, pages: number): Promise<string> {
  const bytes = await pdf(pages);
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

test.setTimeout(240_000);

test('índice numerado: se prende en el espacio, se ve en el visor y se baja en CSV', async ({ page, browser, request }) => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const deck = await makeDoc(request, `Deck ${suffix}`, 2);
  const pl = await makeDoc(request, `PL ${suffix}`, 1);
  const { space } = await (await request.post('/api/send/spaces', { data: { title: `Room ${suffix}` } })).json();
  expect((await request.patch(`/api/send/spaces/${space.id}`, { data: { items: [{ documentId: deck }, { documentId: pl, folder: 'Finance' }] } })).ok()).toBe(true);

  await page.goto(`/en/app/send/spaces/${space.id}`);
  await expect(page.getByTestId('send-space-item')).toHaveCount(2);
  await expect(page.getByTestId('send-space-index')).toHaveCount(0);
  await expect(page.getByTestId('send-space-index-download')).toHaveCount(0);

  const saved = page.waitForResponse((r) => r.url().includes(`/api/send/spaces/${space.id}`) && r.request().method() === 'PATCH');
  await page.getByTestId('send-space-numbered').check();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByTestId('send-space-index')).toHaveText(['1', '2.1']);

  // Se guarda: después de recargar sigue prendido.
  await page.reload();
  await expect(page.getByTestId('send-space-numbered')).toBeChecked();
  await expect(page.getByTestId('send-space-index')).toHaveText(['1', '2.1']);

  const [owner] = await Promise.all([page.waitForEvent('download'), page.getByTestId('send-space-index-download').click()]);
  expect(owner.suggestedFilename()).toMatch(/index\.csv$/);
  const csv = readFileSync(await owner.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  expect(csv[0]).toBe('index,folder,name,type,pages');
  expect(csv.slice(1, 4)).toEqual([`1,,Deck ${suffix},pdf,2`, '2,,Finance,folder,', `2.1,Finance,PL ${suffix},pdf,1`]);

  // Quien abre el link ve los mismos números y baja el índice.
  const { link } = await (await request.post(`/api/send/spaces/${space.id}/links`, { data: { name: 'Room' } })).json();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const v = await ctx.newPage();
  await v.goto(`/en${link.path}`);
  await expect(v.getByTestId('sv-space')).toBeVisible();
  await expect(v.getByTestId('sv-space-index')).toHaveText(['1', '2.1']);
  const [visitor] = await Promise.all([v.waitForEvent('download'), v.getByTestId('sv-index-download').click()]);
  expect(readFileSync(await visitor.path(), 'utf8')).toContain(`2.1,Finance,PL ${suffix},pdf,1`);
  await ctx.close();

  // Apagado, ni el espacio ni el visor muestran números.
  await page.getByTestId('send-space-numbered').uncheck();
  await expect(page.getByTestId('send-space-index')).toHaveCount(0);
  const v2 = await browser.newPage();
  await v2.goto(`/en${link.path}`);
  await expect(v2.getByTestId('sv-space')).toBeVisible();
  await expect(v2.getByTestId('sv-space-doc')).toHaveCount(2);
  await expect(v2.getByTestId('sv-space-index')).toHaveCount(0);
  await expect(v2.getByTestId('sv-index-download')).toHaveCount(0);
  await v2.close();
});
