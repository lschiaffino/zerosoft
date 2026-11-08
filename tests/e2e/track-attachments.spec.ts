import { expect, test, type Page } from '@playwright/test';

/**
 * Adjuntos de Track de cualquier tipo y tamaño (lib/file-attachments.ts, modo
 * local en e2e: el archivo va cifrado a disco). Sube un .exe, un archivo de
 * más de 10 MB y una imagen; muestra el progreso, cancela una subida,
 * previsualiza la imagen, baja el .exe como descarga y quita un adjunto.
 */

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

// PNG de 2x2 rojo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);
const BIG = 12 * 1024 * 1024;

test.describe('Track: adjuntos de cualquier tipo y tamaño', () => {
  test('sube .exe y >10 MB con progreso, cancela, previsualiza, descarga y quita', async ({ page, request }) => {
    const team = (await (await request.post('/api/track/projects', { data: { name: `Adjuntos ${Date.now()}` } })).json()) as { id: string };
    const issue = (await (await request.post(`/api/track/projects/${team.id}/issues`, { data: { title: 'Con adjuntos' } })).json()) as { id: string };
    const base = `/api/track/issues/${issue.id}/attachments`;

    await page.goto(`/en/app/track/issues/${issue.id}`);
    await expect(page.getByTestId('track-attach')).toBeVisible();

    // La subida grande se demora en la red para ver el progreso y el botón de cancelar.
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const uploadOf = (name: string) => (url: URL) => url.pathname === `${base}/upload` && url.searchParams.get('name') === name;
    await page.route(uploadOf('big.bin'), async (route) => {
      await held;
      await route.continue();
    });

    const input = page.getByTestId('track-attach-input');
    await input.setInputFiles([
      { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ\x90\x00 not really an exe') },
      { name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(BIG, 1) },
      { name: 'captura.png', mimeType: 'image/png', buffer: PNG },
    ]);

    const section = page.getByTestId('track-attachments');
    const pending = section.getByTestId('track-attachment-upload').filter({ hasText: 'big.bin' });
    await expect(pending).toBeVisible();
    await expect(pending.getByRole('progressbar')).toBeVisible();
    await expect(pending.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(section.getByTestId('track-attachment').filter({ hasText: 'setup.exe' })).toBeVisible();
    await expect(section.getByTestId('track-attachment').filter({ hasText: 'captura.png' })).toBeVisible();
    await shot(page, 'track-attachments-uploading');
    release();
    const bigRow = section.getByTestId('track-attachment').filter({ hasText: 'big.bin' });
    await expect(bigRow).toBeVisible({ timeout: 30_000 });
    await expect(bigRow).toContainText('12.0 MB');
    await expect(pending).toHaveCount(0);

    // Cancelar mientras sube: no queda nada.
    // Esta no llega nunca al servidor: queda subiendo hasta que se cancela.
    await page.route(uploadOf('cancelado.zip'), () => undefined);
    await input.setInputFiles([{ name: 'cancelado.zip', mimeType: 'application/zip', buffer: Buffer.alloc(1024, 2) }]);
    const cancelling = section.getByTestId('track-attachment-upload').filter({ hasText: 'cancelado.zip' });
    await cancelling.getByRole('button', { name: 'Cancel' }).click();
    await expect(cancelling).toHaveCount(0);
    await expect(section.getByTestId('track-attachment').filter({ hasText: 'cancelado.zip' })).toHaveCount(0);

    await expect(section.getByTestId('track-attachment')).toHaveCount(3);
    await section.scrollIntoViewIfNeeded();
    await shot(page, 'track-attachments-list');
    // Oscuro y 390 px: sin scroll horizontal.
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, 'track-attachments-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await section.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, 'track-attachments-390-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await shot(page, 'track-attachments-390');
    await page.setViewportSize({ width: 1280, height: 720 });

    // Vista previa de la imagen, servida en línea por la ruta autorizada.
    await section.getByRole('button', { name: 'captura.png', exact: true }).click();
    const preview = page.getByTestId('track-attachment-preview');
    await expect(preview).toBeVisible();
    const img = preview.locator('img');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(2);
    await shot(page, 'track-attachments-preview');
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();

    // El .exe se baja como descarga (nunca en línea) con su nombre.
    const exeRow = section.getByTestId('track-attachment').filter({ hasText: 'setup.exe' });
    const [download] = await Promise.all([page.waitForEvent('download'), exeRow.getByTestId('track-attachment-download').click()]);
    expect(download.suggestedFilename()).toBe('setup.exe');
    const href = (await exeRow.getByTestId('track-attachment-download').getAttribute('href'))!;
    expect(href).toMatch(new RegExp(`^${base}/[0-9a-f-]{36}\\?download=1$`));
    const inline = await request.get(href.replace('?download=1', ''));
    expect(inline.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(inline.headers()['content-type']).toBe('application/octet-stream');
    expect(inline.headers()['x-content-type-options']).toBe('nosniff');
    expect((await inline.body()).toString('latin1')).toContain('not really an exe');

    // Quitar con confirmación.
    await exeRow.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('setup.exe');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(exeRow).toHaveCount(0);
    await expect(section.getByTestId('track-attachment')).toHaveCount(2);
    expect((await request.get(href)).status()).toBe(404);

    // Al recargar, la lista sigue igual.
    await page.reload();
    await expect(page.getByTestId('track-attachment')).toHaveCount(2);
  });
});
