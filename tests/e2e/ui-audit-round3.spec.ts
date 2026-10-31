import { expect, test, type Browser } from '@playwright/test';

/** Tercera ronda de la auditoría de UI: hidratación fuera de UTC, listas a 390 y metadatos para compartir. */
const uid = () => Math.random().toString(36).slice(2, 8);

/** Rutas con fechas escritas en el cliente durante el SSR. Las zonas están a distinto lado de UTC. */
const ROUTES = [
  '/es/app',
  '/es/app/sign',
  '/es/app/sign/templates',
  '/es/app/settings/api',
  '/es/app/rec',
  '/es/app/track/issues',
  '/es/app/track/my-tasks',
  '/es/app/crm',
  '/es/app/crm/deals',
  '/es/app/crm/contacts',
  '/es/app/groups/list',
  '/es/app/groups/tasks',
  '/es/app/groups/tickets',
  '/es/app/books/invoices',
  '/es/app/people',
  '/es/app/hiring/reports',
  '/es/app/social',
  '/es/app/shop/orders',
  '/es/app/forms',
  '/es/app/calendar/bookings',
  '/pt/app/docs',
  '/en/app/notes',
];

async function hydrationErrors(browser: Browser, baseURL: string, timezoneId: string, locale: string, routes: string[]) {
  const ctx = await browser.newContext({ baseURL, timezoneId, locale, viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  const page = await ctx.newPage();
  let current = '';
  page.on('pageerror', (e) => {
    if (/#4(18|23|25)|ydrat/.test(e.message)) errors.push(`${current} (${timezoneId}): ${e.message.slice(0, 100)}`);
  });
  for (const route of routes) {
    current = route;
    await page.goto(route, { waitUntil: 'networkidle' });
  }
  await ctx.close();
  return errors;
}

test.describe('hidratación fuera de UTC', () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ request }) => {
    // Registros con fecha para que las listas no estén vacías.
    await request.post('/api/sign/envelopes', { data: { title: `Contrato ${uid()}` } });
    await request.post('/api/keys', { data: { name: `qa-${uid()}` } });
  });

  for (const [zone, locale] of [
    ['America/Argentina/Buenos_Aires', 'es-AR'],
    ['Asia/Tokyo', 'ja-JP'],
  ] as const) {
    test(`sin #418 en ${zone}`, async ({ browser, baseURL }) => {
      expect(await hydrationErrors(browser, baseURL!, zone, locale, ROUTES)).toEqual([]);
    });
  }

  test('la fecha se ve en la zona del navegador y sin quedar oculta', async ({ browser, baseURL, request }) => {
    const title = `Zona ${uid()}`;
    await request.post('/api/sign/envelopes', { data: { title } });
    const ctx = await browser.newContext({ baseURL, timezoneId: 'Asia/Tokyo', locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto('/en/app/sign', { waitUntil: 'networkidle' });
    await expect(page.getByText(title).first()).toBeVisible();
    const hidden = await page.evaluate(() => [...document.querySelectorAll('main span[style*="hidden"]')].length);
    expect(hidden).toBe(0);
    await ctx.close();
  });
});

test.describe('listas a 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Books y Groups muestran todo sin scroll lateral', async ({ page }) => {
    for (const route of ['/es/app/books/invoices', '/es/app/books/contacts', '/es/app/groups/list', '/es/app/groups/tasks', '/es/app/groups/templates', '/es/app/groups/broadcasts']) {
      await page.goto(route, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.table-stack')].filter((w) => w.scrollWidth > w.clientWidth + 1).length);
      expect(overflow, route).toBe(0);
      const doc = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(doc, route).toBeLessThanOrEqual(391);
    }
  });
});

test('/en trae las etiquetas para compartir', async ({ request }) => {
  const html = await (await request.get('/en')).text();
  for (const prop of ['og:title', 'og:description', 'og:image', 'og:type', 'og:site_name']) {
    expect(html, prop).toContain(`property="${prop}"`);
  }
  expect(html).toContain('twitter:card');
  const image = await request.get('/api/og/home');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toContain('image/png');
});
