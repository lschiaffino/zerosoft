import { expect, test, type Page } from '@playwright/test';

/**
 * Sign: una foto o un escaneo (JPEG o PNG) como documento. Se sube desde
 * "Sobre nuevo", queda como un PDF de una página que se ve y acepta campos, y
 * se puede reemplazar por un PNG desde el editor. Un archivo que no es PDF ni
 * imagen muestra el error sin crear nada.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

/** Una imagen real hecha con el canvas del navegador (una hoja con texto, vertical). */
async function canvasImage(page: Page, type: 'image/jpeg' | 'image/png', w: number, h: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ type, w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#222222';
      ctx.font = '28px sans-serif';
      ctx.fillText('Lease agreement (scan)', 40, 80);
      for (let y = 140; y < h - 60; y += 36) ctx.fillRect(40, y, w - 80, 4);
      return c.toDataURL(type, 0.85);
    },
    { type, w, h },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('Sign: una foto JPEG se sube como documento y se reemplaza por un PNG', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.goto('/en/app/sign/new', { waitUntil: 'networkidle' });
  const jpeg = await canvasImage(page, 'image/jpeg', 850, 1100);

  await page.getByLabel('Envelope title').fill(`Scan ${uid()}`);
  await page.getByTestId('sign-new-file').setInputFiles({ name: 'lease-scan.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/en\/app\/sign\/envelopes\/env_/);
  const envId = /envelopes\/(env_[\w-]+)/.exec(page.url())![1];

  const read = async () => ((await (await request.get(`/api/sign/envelopes/${envId}`)).json()) as { envelope: { documentName: string; pages: Array<{ w: number; h: number }> } }).envelope;
  const first = await read();
  expect(first.documentName).toBe('lease-scan.pdf');
  expect(first.pages).toHaveLength(1);
  expect(first.pages[0].h).toBeGreaterThan(first.pages[0].w);

  // El original se descarga como PDF.
  const original = await request.get(`/api/sign/envelopes/${envId}/document?v=original`);
  expect(original.headers()['content-type']).toBe('application/pdf');
  expect((await original.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // Un firmante y la página se dibuja para ubicar su campo.
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.locator('input[name="name-0"]').fill('Ana Foto');
  await page.locator('input[name="email-0"]').fill(`ana-${uid()}@example.com`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('[data-page="1"] .sg-page-overlay')).toBeVisible();
  await expect(page.locator('[data-page="2"]')).toHaveCount(0);

  // Reemplazar por un PNG apaisado desde el editor: la página pasa a horizontal.
  const png = await canvasImage(page, 'image/png', 1200, 700);
  const replaced = page.waitForResponse((r) => r.url().endsWith(`/api/sign/envelopes/${envId}/document`) && r.request().method() === 'POST');
  await page.getByTestId('sign-replace-file').setInputFiles({ name: 'whiteboard.png', mimeType: 'image/png', buffer: png });
  expect((await replaced).ok()).toBe(true);
  const second = await read();
  expect(second.documentName).toBe('whiteboard.pdf');
  expect(second.pages[0].w).toBeGreaterThan(second.pages[0].h);
});

test('Sign: un archivo que no es PDF ni imagen muestra el error', async ({ page }) => {
  await page.goto('/en/app/sign/new', { waitUntil: 'networkidle' });
  await page.getByTestId('sign-new-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some text, not a document') });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/en\/app\/sign\/new/);
});
