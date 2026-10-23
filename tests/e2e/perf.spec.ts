import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Regresiones de los fixes de rendimiento (docs/benchmark/performance.md):
 * mensajes i18n por ruta, CSS por app, bloques de Docs en el HTML del
 * servidor, cookie tz sin router.refresh() y lista liviana de Docs.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

function watchIntlErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && /MISSING_MESSAGE|IntlError|could not be found/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test('cada app muestra sus textos y estilos con solo sus mensajes y su CSS', async ({ page }) => {
  const errors = watchIntlErrors(page);
  const apps: Array<[string, string]> = [
    ['/en/app/crm/contacts', '.crm-table, .ui-empty, .empty-state'],
    ['/en/app/links', 'main'],
    ['/en/app/track/issues', 'main'],
    ['/en/app/docs', 'main'],
    ['/en/app/notes', '.notes-app, main'],
    ['/en/app/board', 'main'],
    ['/en/app/flow', 'main'],
    ['/en/app/calendar/event-types', 'main'],
    ['/en/app/chat/inbox', 'main'],
    ['/en/app/agents', 'main'],
    ['/en/app/robots', 'main'],
    ['/en/app/settings', 'main'],
  ];
  for (const [path, sel] of apps) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator(sel).first()).toBeVisible();
    // Ningún texto quedó como clave cruda (lo que muestra next-intl si falta un mensaje).
    const body = await page.locator('main').innerText();
    expect(body, path).not.toMatch(/\b(crm|docs|track|notes|board|flow|calendar|chat|agents|robots|settings|link)\.[a-z]+\.[a-zA-Z.]+/);
  }
  // Cmd+K usa textos de Track, Notes y Board desde cualquier app.
  await page.goto('/en/app/robots', { waitUntil: 'networkidle' });
  await page.keyboard.press('Meta+k');
  await expect(page.locator('.cmdk-input')).toBeVisible();
  expect(errors).toEqual([]);
});

test('las páginas públicas no cargan los mensajes ni el CSS de las apps', async ({ request }) => {
  const html = await (await request.get('/en/book/demo-1/30min')).text();
  // Mensajes del CRM y de Flow (antes viajaban en todas las páginas).
  expect(html).not.toContain('formsPublic');
  expect(html).not.toContain('approvalPage');
  const app = await (await request.get('/en/app/robots')).text();
  expect(app).not.toContain('formsPublic');
});

test('Docs: el texto de los bloques viene en el HTML del servidor (sin saltos al hidratar)', async ({ page, request }) => {
  const title = `SSR ${uid()}`;
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const marker = `texto-ssr-${uid()}`;
  const blocks = [{ id: `b-${uid()}`, type: 'paragraph', content: `Primer párrafo ${marker}` }];
  expect((await request.patch(`/api/docs/pages/${doc.id}`, { data: { content: blocks } })).ok()).toBe(true);
  const html = await (await request.get(`/en/app/docs/${doc.id}`)).text();
  expect(html).toContain(marker);

  // Se puede seguir escribiendo al final del bloque sin que el texto se duplique.
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  const editable = page.locator('main [contenteditable]', { hasText: marker });
  await editable.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' más');
  await expect(editable).toHaveText(`Primer párrafo ${marker} más`);
});

test('primera visita sin cookie tz: la escribe y no vuelve a pedir la página entera', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York' });
  const page = await context.newPage();
  const rsc: string[] = [];
  page.on('request', (r) => {
    if (r.headers()['rsc'] === '1') rsc.push(r.url());
  });
  const dueCount = page.waitForRequest((r) => r.url().includes('/api/crm/tasks/due-count'));
  await page.goto('/en/app/robots', { waitUntil: 'networkidle' });
  await dueCount;
  await page.waitForTimeout(500);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'tz')?.value).toBe(encodeURIComponent('America/New_York'));
  // Solo prefetch de links (con ?_rsc y header de prefetch); ningún refresh del árbol de la página actual.
  const refreshes = rsc.filter((u) => new URL(u).pathname === '/en/app/robots');
  expect(refreshes).toEqual([]);
  await context.close();
});

test('primera visita a una página con fechas de "hoy": refresca una vez con la zona correcta', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  const refresh = page.waitForRequest((r) => r.headers()['rsc'] === '1' && new URL(r.url()).pathname === '/en/app/crm/tasks');
  await page.goto('/en/app/crm/tasks', { waitUntil: 'networkidle' });
  await refresh;
  await expect(page.locator('main')).toBeVisible();
  await context.close();
});

test('Docs API: lista sin contenido y paginada', async ({ request }) => {
  await request.post('/api/docs/pages', { data: { title: `Lista ${uid()}` } });
  const res = (await (await request.get('/api/docs/pages?limit=1')).json()) as { rows: Array<Record<string, unknown>>; nextOffset: number | null };
  expect(res.rows).toHaveLength(1);
  expect(res.rows[0]).not.toHaveProperty('content');
  expect(typeof res.nextOffset).toBe('number');
});

test('Board: apuntar a una pizarra de la lista precarga el lienzo', async ({ page, request }) => {
  await request.post('/api/boards', { data: { name: `Precarga ${uid()}` } });
  await page.goto('/en/app/board', { waitUntil: 'networkidle' });
  const scripts = () => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => (e as PerformanceResourceTiming).initiatorType === 'script').length);
  const before = await scripts();
  await page.locator('.board-card').first().hover();
  await expect.poll(scripts, { timeout: 10_000 }).toBeGreaterThan(before);
});
