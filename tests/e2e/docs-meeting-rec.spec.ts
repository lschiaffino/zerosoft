import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Notas de reunión con IA (tanda D4): grabar con el micrófono falso de
 * Chromium, mandar trozos a transcribir (transcripción falsa con DOCS_AI_FAKE)
 * y al parar escribir las notas. Archivo aparte: las opciones de lanzamiento
 * del navegador fuerzan un worker propio.
 */

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

const uid = () => Math.random().toString(36).slice(2, 8);

async function pageWith(request: APIRequestContext, title: string) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: [{ id: 'a', type: 'paragraph', content: '' }] } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

test('D4: grabar transcribe por trozos y al parar escribe las notas', async ({ request, page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __docsMeetingChunkMs: number }).__docsMeetingChunkMs = 1500;
  });
  const doc = await pageWith(request, `Rec ${uid()}`);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('/meeting');
  await page.keyboard.press('Enter');
  const block = page.getByTestId('docs-meeting-block');
  await block.getByTestId('docs-meeting-start').click();
  await expect(block.getByText(/Transcribing ·/)).toBeVisible();
  await page.waitForTimeout(3500);
  await block.getByTestId('docs-meeting-stop').click();
  await expect(block.getByTestId('docs-meeting-notes')).toContainText('ship the beta', { timeout: 20_000 });
});
