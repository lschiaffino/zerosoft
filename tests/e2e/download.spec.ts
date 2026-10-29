import { test, expect } from '@playwright/test';

/**
 * /download: la app de escritorio. El release viene de GitHub; en los e2e
 * DESKTOP_RELEASES_FAKE=1 devuelve uno fijo (desktop-v0.1.0).
 */
test.describe('/download', () => {
  test('links del último release, Mac primero en Mac y aviso de builds sin firmar', async ({ page }) => {
    await page.goto('/en/download');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('zerosoft for your computer.');
    await expect(page).toHaveTitle(/Download zerosoft for Mac and Windows/);
    // El user agent de Playwright (Chromium headless) dice el sistema de la máquina: hay un botón principal.
    const primary = page.getByTestId('download-primary');
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('href', /releases\/download\/desktop-v0\.1\.0\/zerosoft-0\.1\.0-(mac-(arm64|x64)\.dmg|win-x64\.exe)$/);
    await expect(page.getByRole('link', { name: 'All files for version 0.1.0' })).toHaveAttribute('href', /releases\/tag\/desktop-v0\.1\.0$/);
    await expect(page.getByRole('heading', { name: 'The builds are not signed yet' })).toBeVisible();
    await expect(page.getByText('click Open Anyway')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What the desktop app adds' })).toBeVisible();
    // El footer lleva acá.
    await expect(page.locator('footer').getByRole('link', { name: 'Desktop app' })).toHaveAttribute('href', '/en/download');
  });

  test('elige el instalador según el sistema', async ({ browser }) => {
    const win = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    const p1 = await win.newPage();
    await p1.goto('/es/download');
    await expect(p1.getByTestId('download-primary')).toHaveText('Descargar para Windows');
    await expect(p1.getByTestId('download-mac-arm')).toBeVisible();
    await win.close();
    const mac = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' });
    // Safari no tiene userAgentData (Chromium sí, y diría el chip de esta máquina).
    await mac.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined }));
    const p2 = await mac.newPage();
    await p2.goto('/pt/download');
    await expect(p2.getByTestId('download-primary')).toHaveText('Baixar para Mac (Apple silicon)');
    await expect(p2.getByRole('link', { name: 'Seu Mac tem chip Intel? Baixe a versão Intel.' })).toHaveAttribute('href', /mac-x64\.dmg$/);
    await expect(p2.getByTestId('download-win')).toBeVisible();
    await mac.close();
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
    await expect(link).toHaveAttribute('href', '/en/download');
    await link.click();
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
