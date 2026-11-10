import { createClient } from '@libsql/client';
import { expect, test, type Page } from '@playwright/test';

/**
 * "Descargar la app" en el sitio y en la app: el link del header según el
 * sistema, la columna del footer, el contador de clics que lleva a
 * /download/start (pasos de instalación), la sección del home y de los
 * productos, y la tarjeta del inicio de la app (quién la ve y cerrarla).
 * El release es el falso de DESKTOP_RELEASES_FAKE (desktop-v0.1.0).
 */

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/** Safari no tiene userAgentData (Chromium sí, y diría el chip de esta máquina). */
async function asSafari(page: Page) {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined }));
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('sitio en Mac', () => {
  test.use({ userAgent: UA.mac, viewport: { width: 1280, height: 900 } });

  test('header: Descargar para Mac lleva al instalador y a los pasos', async ({ page }) => {
    await asSafari(page);
    await page.goto('/en');
    const link = page.getByTestId('header-download');
    await expect(link).toHaveAttribute('title', 'Download for Mac');
    // A 1280 entra la versión corta ("Download"); la larga, desde 1321 px.
    await expect(link.locator('.hd-dl-short')).toBeVisible();
    await expect(link.locator('.hd-dl-long')).toBeHidden();
    // En /download ya está todo: el header no lo repite.
    await page.goto('/en/download');
    await expect(page.getByTestId('desktop-download')).toBeVisible();
    await expect(page.getByTestId('header-download')).toHaveCount(0);
    await page.goto('/en');
    await expect(link).toHaveAttribute('href', '/api/desktop/download?from=header&os=mac-arm&locale=en');
    await link.click();
    await expect(page).toHaveURL(/\/en\/download\/start\?os=mac-arm$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Downloading zerosoft for Mac (Apple silicon).');
    await expect(page.getByTestId('download-again')).toHaveAttribute('href', /zerosoft-0\.1\.0-mac-arm64\.dmg$/);
    await expect(page.getByTestId('install-steps').locator('li')).toHaveCount(4);
    await expect(page.getByText('System Settings › Privacy & Security › Open Anyway')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mac with an Intel chip? Get that version.' })).toHaveAttribute('href', /mac-x64\.dmg$/);
  });

  test('home: la sección de la app de escritorio con la barra de dictado', async ({ page }) => {
    await asSafari(page);
    await page.goto('/es');
    const section = page.locator('#desktop');
    await expect(section.getByRole('heading', { level: 2 })).toContainText('zerosoft en tu computadora.');
    await expect(section.getByRole('img', { name: /barra de dictado/ })).toBeVisible();
    await expect(page.getByTestId('home-desktop-cta')).toHaveText('Descargar para Mac');
    await expect(page.getByTestId('home-desktop-cta')).toHaveAttribute('href', '/api/desktop/download?from=home&os=mac-arm&locale=es');
  });

  test('productos: solo donde la app suma algo', async ({ page }) => {
    await page.goto('/en/products/voice');
    await expect(page.getByTestId('product-desktop').getByRole('heading', { level: 2 })).toContainText('Voice outside the browser.');
    await expect(page.getByTestId('product-desktop').getByRole('link', { name: 'Download for Mac' })).toHaveAttribute('href', /from=product&os=mac-(arm|intel)/);
    await page.goto('/en/products/talk');
    await expect(page.getByTestId('product-desktop')).toBeVisible();
    await page.goto('/en/products/link');
    await expect(page.getByTestId('product-desktop')).toHaveCount(0);
  });
});

test.describe('sitio en Windows', () => {
  test.use({ userAgent: UA.win, viewport: { width: 1280, height: 900 } });

  test('header en español y los pasos de Windows', async ({ page }) => {
    await page.goto('/es/products');
    const link = page.getByTestId('header-download');
    await expect(link).toHaveAttribute('title', 'Descargar para Windows');
    await link.click();
    await expect(page).toHaveURL(/\/es\/download\/start\?os=win$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bajando zerosoft para Windows.');
    await expect(page.getByTestId('download-again')).toHaveAttribute('href', /zerosoft-0\.1\.0-win-x64\.exe$/);
    await expect(page.getByText('Más información y después Ejecutar de todas formas')).toBeVisible();
  });
});

test.describe('sin app para el sistema', () => {
  test('Linux: sin link en el header, el footer igual ofrece todo y dice que Linux todavía no', async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: UA.linux, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/en');
    await expect(page.locator('.hd-right')).toBeVisible();
    await expect(page.getByTestId('header-download')).toHaveCount(0);
    const footer = page.getByTestId('footer-download');
    await expect(page.locator('footer').getByRole('heading', { name: 'Download' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Desktop app' })).toHaveAttribute('href', '/en/download');
    await expect(footer.getByRole('link', { name: 'Mac (Apple silicon)' })).toHaveAttribute('href', '/api/desktop/download?from=footer&os=mac-arm&locale=en');
    await expect(footer.getByRole('link', { name: 'Mac (Intel)' })).toHaveAttribute('href', '/api/desktop/download?from=footer&os=mac-intel&locale=en');
    await expect(footer.getByRole('link', { name: 'Windows' })).toHaveAttribute('href', '/api/desktop/download?from=footer&os=win&locale=en');
    await expect(footer.getByRole('link', { name: 'All releases' })).toHaveAttribute('href', /\/releases$/);
    await expect(footer.getByText('Linux: not yet')).toBeVisible();
    // El botón del home lleva a /download (que lo explica).
    await expect(page.getByTestId('home-desktop-cta')).toHaveAttribute('href', '/api/desktop/download?from=home&locale=en');
    await ctx.close();
  });

  test('teléfono: sin link en el header, sin scroll horizontal en claro y oscuro', async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: UA.iphone, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ['/es', '/es/products/voice', '/es/download/start?os=mac-arm']) {
        await page.goto(path);
        await expect(page.getByTestId('header-download')).toHaveCount(0);
        await noHorizontalScroll(page);
      }
    }
    await ctx.close();
  });

  test('el contador de clics: email va a /download en su idioma, sin salir del sitio', async ({ request }) => {
    const email = await request.get('/api/desktop/download?from=email&locale=pt', { maxRedirects: 0 });
    expect(email.status()).toBe(303);
    expect(new URL(email.headers().location).pathname).toBe('/pt/download');
    const odd = await request.get('/api/desktop/download?from=x&os=linux&locale=zz', { maxRedirects: 0 });
    expect(new URL(odd.headers().location).pathname).toBe('/en/download');
    const missing = await request.get('/en/download/start?os=beos');
    expect(missing.status()).toBe(200);
    expect(await missing.text()).toContain('find that installer');
  });
});

// La tarjeta del inicio: la marca de instalada y la de cerrada viven en lifecycle_events.
async function resetDesktopEvents() {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  await db.execute("DELETE FROM lifecycle_events WHERE event IN ('desktop_installed', 'desktop_hint_dismissed')");
  // Abrir el inicio con el puente del escritorio deja desktopSeenAt en el perfil, y con eso la tarjeta no vuelve.
  await db.execute("UPDATE users SET profile = json_remove(profile, '$.desktopSeenAt') WHERE json_valid(profile)");
  db.close();
}

test.describe('tarjeta del inicio de la app', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(resetDesktopEvents);
  test.afterAll(resetDesktopEvents);

  test.describe('en Mac', () => {
    test.use({ userAgent: UA.mac, viewport: { width: 1280, height: 900 } });

    test('se ve, se cierra con teclado y no vuelve al recargar', async ({ page }) => {
      await asSafari(page);
      await page.goto('/en/app', { waitUntil: 'networkidle' });
      const card = page.getByTestId('home-desktop');
      await expect(card).toBeVisible();
      await expect(card.getByRole('link', { name: 'Download for Mac' })).toHaveAttribute('href', '/api/desktop/download?from=in-app&os=mac-arm&locale=en');
      const hide = card.getByRole('button', { name: 'Hide' });
      await hide.focus();
      await page.keyboard.press('Enter');
      await expect(card).toHaveCount(0);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByTestId('home-desktop')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Recent', level: 2 })).toBeVisible();
    });

    test('quien ya instaló la app no la ve', async ({ page }) => {
      const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
      await db.execute("INSERT OR IGNORE INTO lifecycle_events (user_id, event, first_at) SELECT id, 'desktop_installed', '2026-11-01T00:00:00Z' FROM users");
      db.close();
      await page.goto('/en/app', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Recent', level: 2 })).toBeVisible();
      await expect(page.getByTestId('home-desktop')).toHaveCount(0);
    });

    test('dentro de la app de escritorio no aparece', async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { zerosoftDesktop: unknown }).zerosoftDesktop = { version: '0.3.0', platform: 'darwin', startLogin() {}, openSettings() {} };
      });
      await page.goto('/en/app', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Recent', level: 2 })).toBeVisible();
      await expect(page.getByTestId('home-desktop')).toHaveCount(0);
    });

    test('en oscuro se lee y el foco del botón cerrar se ve', async ({ page }) => {
      await asSafari(page);
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/en/app', { waitUntil: 'networkidle' });
      const hide = page.getByTestId('home-desktop').getByRole('button', { name: 'Hide' });
      await hide.focus();
      const outline = await hide.evaluate((el) => getComputedStyle(el).outlineStyle + getComputedStyle(el).boxShadow);
      expect(outline).not.toBe('nonenone');
    });
  });

  test('en Linux y en el teléfono no aparece', async ({ browser }) => {
    for (const [ua, viewport] of [
      [UA.linux, { width: 1280, height: 900 }],
      [UA.iphone, { width: 390, height: 844 }],
    ] as const) {
      const ctx = await browser.newContext({ userAgent: ua, viewport });
      const page = await ctx.newPage();
      await page.goto('/en/app', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Recent', level: 2 })).toBeVisible();
      await expect(page.getByTestId('home-desktop')).toHaveCount(0);
      await noHorizontalScroll(page);
      await ctx.close();
    }
  });
});
