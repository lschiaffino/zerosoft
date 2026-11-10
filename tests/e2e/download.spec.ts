import { test, expect } from '@playwright/test';

/**
 * /download: la app de escritorio. El release viene de GitHub; en los e2e
 * DESKTOP_RELEASES_FAKE=1 devuelve uno fijo (desktop-v0.1.0).
 */
test.describe('/download', () => {
  test('links del último release, Mac primero en Mac y los pasos para abrir una build sin firmar', async ({ browser }) => {
    // El sistema lo dice el user agent: en Linux (CI) no hay instalador principal, así que se fija uno de Mac.
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    const page = await ctx.newPage();
    await page.goto('/en/download');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('zerosoft for your computer.');
    await expect(page).toHaveTitle(/Download zerosoft for Mac and Windows/);
    const primary = page.getByTestId('desktop-download');
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('href', /releases\/download\/desktop-v0\.1\.0\/zerosoft-0\.1\.0-mac-(arm64|x64)\.dmg$/);
    await expect(page.getByRole('link', { name: 'All files on GitHub' })).toHaveAttribute('href', /releases\/tag\/desktop-v0\.1\.0$/);
    // Los pasos de instalación de Mac, con "Abrir igualmente" y el clic derecho.
    await expect(page.getByTestId('desktop-steps')).toContainText('click Open Anyway');
    await expect(page.getByTestId('desktop-steps')).toContainText('right-click the app');
    await expect(page.getByRole('heading', { name: 'The builds are not signed yet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What the desktop app adds' })).toBeVisible();
    // Elegir Windows a mano cambia el instalador y los pasos (SmartScreen).
    await page.locator('.dd-opt', { hasText: 'Windows' }).click();
    await expect(primary).toHaveText('Download for Windows');
    await expect(primary).toHaveAttribute('href', /win-x64\.exe$/);
    await expect(page.getByTestId('desktop-steps')).toContainText('Run anyway');
    // El footer lleva acá.
    await expect(page.locator('footer').getByRole('link', { name: 'Desktop app' })).toHaveAttribute('href', '/en/download');
    await ctx.close();
  });

  test('en Linux y en el teléfono lo dice y deja elegir igual', async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    const page = await ctx.newPage();
    await page.goto('/en/download');
    await expect(page.getByTestId('desktop-off-computer')).toContainText('no Linux build');
    await expect(page.getByTestId('desktop-download')).toBeVisible();
    await ctx.close();
    const phone = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 } });
    const p2 = await phone.newPage();
    await p2.goto('/es/download');
    await expect(p2.getByTestId('desktop-off-computer')).toContainText('Abrí esta página en tu computadora');
    await expect(p2.getByRole('button', { name: 'Copiar link' })).toBeVisible();
    await phone.close();
  });

  test('elige el instalador según el sistema y el chip', async ({ browser }) => {
    const win = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    const p1 = await win.newPage();
    await p1.goto('/es/download');
    await expect(p1.getByTestId('desktop-download')).toHaveText('Descargar para Windows');
    await expect(p1.getByTestId('desktop-steps')).toContainText('Ejecutar de todas formas');
    await win.close();
    const mac = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' });
    // Safari: sin userAgentData y con la GPU enmascarada ("Apple GPU"): se asume Apple silicon y se explica cómo verlo.
    await mac.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
      const orig = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p: number) {
        return p === 0x9246 || p === 0x1f01 ? 'Apple GPU' : orig.call(this, p);
      };
    });
    const p2 = await mac.newPage();
    await p2.goto('/pt/download');
    await expect(p2.getByTestId('desktop-download')).toHaveText('Baixar para Mac');
    await expect(p2.getByTestId('desktop-download')).toHaveAttribute('href', /mac-arm64\.dmg$/);
    await expect(p2.getByText('Mais provável')).toBeVisible();
    await expect(p2.getByText(/Menu Apple › Sobre Este Mac/)).toBeVisible();
    await mac.close();
    // Chrome en un Mac Intel lo dice por UA-CH.
    const intel = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    await intel.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ getHighEntropyValues: async () => ({ architecture: 'x86' }) }) });
    });
    const p3 = await intel.newPage();
    await p3.goto('/en/download');
    await expect(p3.getByTestId('desktop-download')).toHaveText('Download for Mac (Intel)');
    await expect(p3.getByText('Detected')).toBeVisible();
    await intel.close();
  });

  test('390 px sin scroll horizontal, en claro y oscuro', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/en/download');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, scheme).toBeLessThanOrEqual(0);
    }
  });

  test('feed de actualizaciones con URLs absolutas', async ({ request }) => {
    const res = await request.get('/api/desktop/update/latest-mac.yml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('yaml');
    const yml = await res.text();
    expect(yml).toContain('version: 0.1.0');
    expect(yml).toContain('url: https://github.com/lschiaffino/zerosoft/releases/download/desktop-v0.1.0/zerosoft-0.1.0-mac-arm64.zip');
  });

  test('Ajustes y Cmd+K llevan a la app de escritorio', async ({ page }) => {
    await page.goto('/en/app/settings');
    const link = page.locator('.st-nav').getByRole('link', { name: 'Desktop app' });
    await expect(link).toHaveAttribute('href', '/en/app/settings/desktop');
    await link.click();
    await expect(page).toHaveURL(/\/en\/app\/settings\/desktop$/);
    // Fuera de la app: qué es, la última versión y la descarga.
    await expect(page.getByTestId('desktop-app-settings')).toBeVisible();
    await page.getByRole('link', { name: 'Download the app' }).click();
    await expect(page).toHaveURL(/\/en\/download$/);
  });

  test('el login del escritorio pide confirmar la cuenta y rechaza otro origen', async ({ request }) => {
    const challenge = 'c'.repeat(43);
    const state = 's'.repeat(24);
    const page = await request.get(`/api/desktop/login?challenge=${challenge}&state=${state}&locale=es`);
    expect(page.status()).toBe(200);
    expect(page.headers()['x-frame-options']).toBe('DENY');
    const html = await page.text();
    expect(html).toContain('va a entrar como');
    expect(html).toContain('Si alguien te mandó este link');
    const cross = await request.post('/api/desktop/login', { form: { challenge, state }, headers: { origin: 'https://evil.example' } });
    expect(cross.status()).toBe(403);
    const bad = await request.get('/api/desktop/login?challenge=x&state=y');
    expect(bad.status()).toBe(400);
  });
});
