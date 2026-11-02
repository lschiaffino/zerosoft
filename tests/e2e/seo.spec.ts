import { expect, test } from '@playwright/test';

/**
 * SEO del sitio público: cada página con título propio, canonical a sí misma,
 * hreflang de los tres idiomas con x-default, og:image PNG, JSON-LD válido y
 * sin scroll horizontal a 390 px. Más sitemap, robots, llms.txt, feeds e
 * imágenes OG.
 */

const PATHS = [
  '',
  '/products',
  '/products/crm',
  '/products/link',
  '/compare',
  '/compare/zerosoft-vs-hubspot',
  '/compare/notion-alternative',
  '/compare/zerosoft-vs-excalidraw-plus',
  '/tools',
  '/blog',
  '/blog/migrar-de-linear-a-track',
  '/blog/zerosoft-crm-vs-hubspot',
  '/blog/author/zerosoft',
  '/changelog',
  '/docs',
  '/download',
  '/videos',
  '/terms',
  '/privacy',
  '/security',
];

const LOCALES = ['en', 'es', 'pt'] as const;

test.describe.configure({ mode: 'serial' });

test('títulos únicos, canonical y hreflang en cada página pública', async ({ page }) => {
  test.setTimeout(600_000);
  for (const locale of LOCALES) {
    // Únicos por idioma: entre idiomas los une hreflang.
    const titles = new Map<string, string>();
    for (const path of PATHS) {
      const url = `/${locale}${path}`;
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), url).toBe(200);

      const title = await page.title();
      expect(title.length, `${url} título`).toBeGreaterThan(5);
      expect(titles.get(title), `${url} repite el título de ${titles.get(title)}`).toBeUndefined();
      titles.set(title, url);

      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      expect(desc?.length ?? 0, `${url} description`).toBeGreaterThan(40);

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(new URL(canonical!).pathname, `${url} canonical`).toBe(url);

      const langs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) =>
        els.map((e) => [e.getAttribute('hreflang'), new URL(e.getAttribute('href')!).pathname]),
      );
      const map = Object.fromEntries(langs);
      expect(map['x-default'], `${url} x-default`).toBeTruthy();
      expect(map[locale], `${url} hreflang propio`).toBe(url);

      const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
      expect(og, `${url} og:image`).toMatch(/\/api\/og\//);

      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      for (const block of ld) expect(() => JSON.parse(block), `${url} JSON-LD`).not.toThrow();
      expect(await page.locator('h1').count(), `${url} un h1`).toBe(1);
    }
  }
});

test('sin scroll horizontal a 390 px (claro y oscuro)', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const path of PATHS) {
      const url = `/es${path}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${url} (${scheme})`).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  }
});

test('los temas del índice son indexables y están en el sitemap', async ({ page, request }) => {
  await page.goto('/es/blog', { waitUntil: 'domcontentloaded' });
  const href = await page.locator('.blog-tags a').first().getAttribute('href');
  await page.goto(href!);
  expect(await page.locator('meta[name="robots"]').count()).toBe(0);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(href!);
});

test('sitemap, robots, llms.txt y feeds', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('/es/compare/zerosoft-vs-hubspot');
  expect(xml).toContain('hreflang="x-default"');
  expect(xml).toContain('/pt/blog/migrar-de-calendly-a-cal');

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Sitemap:');
  expect(robots).toMatch(/Disallow: \/api\//);

  const llms = await request.get('/llms.txt');
  expect(llms.status()).toBe(200);
  expect(llms.headers()['content-type']).toContain('text/markdown');
  expect(await llms.text()).toMatch(/^# zerosoft\n\n> /);
  expect((await request.get('/llms-full.txt')).status()).toBe(200);

  const rss = await request.get('/es/blog/rss.xml');
  expect(rss.status()).toBe(200);
  expect(await rss.text()).toContain('<rss version="2.0"');
  const atom = await request.get('/en/blog/atom.xml');
  expect(await atom.text()).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
});

test('imágenes OG en PNG por página', async ({ request }) => {
  for (const path of [
    '/api/og/home',
    '/api/og/product/crm/es',
    '/api/og/blog/es/migrar-de-linear-a-track',
    '/api/og/blog/zerosoft-crm-vs-hubspot',
    '/api/og/compare/pt/zerosoft-vs-notion',
    '/api/og/page/en/blog',
    '/api/og/tool/hub/es',
    '/api/og/changelog/en',
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type'], path).toBe('image/png');
  }
  expect((await request.get('/api/og/compare/en/zerosoft-vs-nadie')).status()).toBe(404);
});

test('el índice del blog no trae las tapas dentro del HTML', async ({ page, request }) => {
  const html = await (await request.get('/en/blog')).text();
  expect(html.length).toBeLessThan(1_000_000);
  const cover = await request.get('/api/og/cover/migrar-de-linear-a-track');
  expect(cover.headers()['content-type']).toContain('image/svg+xml');
  expect((await request.get('/api/og/cover/no-existe')).status()).toBe(404);
  await page.goto('/es/blog/migrar-de-linear-a-track');
  const size = await page.locator('.blog-post-cover img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return img.naturalWidth;
  });
  expect(size).toBeGreaterThan(0);
});

test('en /compare los dos links quedan dentro de la fila de su app', async ({ page }) => {
  await page.goto('/es/compare');
  for (const row of await page.locator('.cmp-index tbody tr').all()) {
    const box = (await row.boundingBox())!;
    const links = (await row.locator('.cmp-links').boundingBox())!;
    expect(links.y + links.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
});

test('un tag que no existe en ese idioma lleva al blog; uno que no existe en ninguno da 404', async ({ page }) => {
  await page.goto('/es/blog/tag/migration');
  await expect(page).toHaveURL(/\/es\/blog$/);
  const res = await page.goto('/es/blog/tag/no-existe-en-ninguno');
  expect(res?.status()).toBe(404);
});

test('el blog y el home no se mueven al cargar (CLS menor a 0,1 a 390 px)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const path of ['/en/blog', '/en']) {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) w.__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(path, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, path).toBeLessThan(0.1);
    await page.close();
  }
  await ctx.close();
});

test('una comparación que no existe da 404', async ({ page }) => {
  const res = await page.goto('/en/compare/zerosoft-vs-nadie');
  expect(res?.status()).toBe(404);
});

test('una raíz con punto no es un idioma: 404, y los feeds de la raíz llevan al feed real', async ({ request }) => {
  for (const path of ['/wp-login.php', '/foo.bar', '/.env']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(await res.text(), path).not.toContain(`lang="${path.slice(1)}"`);
  }
  for (const path of ['/rss.xml', '/feed.xml']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(308);
    expect(res.headers().location, path).toBe('/en/blog/rss.xml');
  }
});

test('índices con datos estructurados y descripciones que entran en el buscador', async ({ page }) => {
  for (const url of ['/en', '/en/products', '/es/products', '/pt/products', '/en/changelog', '/en/docs', '/en/tools']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length ?? 0, `${url} description`).toBeLessThanOrEqual(160);
    if (url !== '/en' && url !== '/en/tools') expect(await page.locator('script[type="application/ld+json"]').count(), url).toBeGreaterThan(0);
  }
});

test('/feed sigue siendo de los links cortos: un link con ese slug resuelve', async ({ request }) => {
  const made = await request.post('/api/links', { data: { url: 'https://example.com/feed-target', slug: 'feed' } });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: string };
  const res = await request.get('/feed', { maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(301);
  expect(res.status()).toBeLessThan(400);
  expect(res.headers().location).toContain('example.com/feed-target');
  await request.delete(`/api/links/${id}`);
});

test('/favicon.ico existe', async ({ request }) => {
  const res = await request.get('/favicon.ico');
  expect(res.status()).toBe(200);
});

