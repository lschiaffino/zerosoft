import http from 'http';
import { expect, test, type Browser, type Page } from '@playwright/test';

/** Lo que queda en el navegador al rechazar, sin consentimiento, sin cookies y con Do Not Track. */
const uid = () => Math.random().toString(36).slice(2, 8);

let publicKey = '';
let projectId = '';
let server: http.Server;
let port = 0;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request, baseURL }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Consent ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  publicKey = project.publicKey;
  projectId = project.id;
  await request.patch(`/api/analytics/projects/${projectId}`, { data: { cookieless: true } });
  server = http.createServer((req, res) => {
    const opts = new URL(req.url ?? '/', 'http://x').searchParams.get('o') ?? '{}';
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>s</title><script src="${baseURL}/zs.js"></script><script>zs.init('${publicKey}', Object.assign({ api_host: '${baseURL}' }, ${opts}));</script>`);
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as { port: number }).port;
});
test.afterAll(() => server.close());

const open = async (browser: Browser, opts: Record<string, unknown>, init?: (page: Page) => Promise<void>) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const decides: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ingest/decide')) decides.push(r.url());
  });
  if (init) await init(page);
  await page.goto(`http://127.0.0.1:${port}/?o=${encodeURIComponent(JSON.stringify(opts))}`, { waitUntil: 'load' });
  return { ctx, page, decides };
};
/** Nombres, sin el prefijo con la key, de lo que hay en localStorage y sessionStorage. */
const stored = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const area of [localStorage, sessionStorage]) for (let i = 0; i < area.length; i++) out.push((area.key(i) ?? '').replace(/^zs_[^_]+_[^_]*_?/, '').replace(/^.*_/, ''));
    return out.sort();
  });
const call = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).zs[f as string](...(a as unknown[])), [fn, args] as const);

test('on_reject: aceptar, identificarse y después rechazar deja solo la decisión', async ({ browser }) => {
  const { ctx, page } = await open(browser, { cookieless_mode: 'on_reject' });
  await call(page, 'optIn');
  await call(page, 'identify', 'ana@acme.com', { plan: 'pro' });
  await call(page, 'capture', 'x');
  await expect.poll(() => stored(page)).toContain('id');
  await call(page, 'optOut');
  expect(await stored(page)).toEqual(['consent']);
  expect(await call(page, 'getDistinctId')).toBe('$zs_cookieless');
  // Al volver sigue igual.
  await page.reload();
  expect(await stored(page)).toEqual(['consent']);
  await ctx.close();
});

test('opt_out_capturing_by_default y sin modo: rechazar borra el id, y aceptar arranca uno nuevo', async ({ browser }) => {
  for (const opts of [{ opt_out_capturing_by_default: true }, {}]) {
    const { ctx, page } = await open(browser, opts);
    await call(page, 'optIn');
    await call(page, 'identify', 'bob@acme.com');
    const before = await call(page, 'getDistinctId');
    await expect.poll(() => stored(page)).toContain('id');
    await call(page, 'optOut');
    expect(await stored(page)).toEqual(['consent']);
    await page.reload();
    expect(await stored(page)).toEqual(['consent']);
    await call(page, 'optIn');
    await expect.poll(() => stored(page)).toContain('id');
    expect(await call(page, 'getDistinctId')).not.toBe(before);
    await ctx.close();
  }
});

test('always: quien venía con un id lo pierde al cargar', async ({ browser }) => {
  const { ctx, page } = await open(browser, {});
  await call(page, 'identify', 'carla@acme.com');
  await expect.poll(() => stored(page)).toContain('id');
  await page.goto(`http://127.0.0.1:${port}/?o=${encodeURIComponent(JSON.stringify({ cookieless_mode: 'always' }))}`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  expect(await stored(page)).toEqual([]);
  await ctx.close();
});

test('sin decisión no sale /decide, y los flags quedan en su valor por defecto', async ({ browser }) => {
  const { ctx, page, decides } = await open(browser, { opt_out_capturing_by_default: true });
  await page.waitForTimeout(800);
  expect(decides).toEqual([]);
  expect(await call(page, 'getFeatureFlag', 'any')).toBeUndefined();
  const fired = await page.evaluate(() => new Promise<boolean>((resolve) => (window as unknown as { zs: { onFeatureFlags: (cb: () => void) => void } }).zs.onFeatureFlags(() => resolve(true))));
  expect(fired).toBe(true);
  await call(page, 'optIn');
  await expect.poll(() => decides.length).toBeGreaterThan(0);
  await ctx.close();
});

test('Global Privacy Control con el ajuste prendido: nada queda; con el ajuste apagado sí', async ({ browser, request }) => {
  const signal = (page: Page) => page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }));
  const on = await open(browser, {}, signal);
  await on.page.waitForTimeout(1200);
  expect(await stored(on.page)).toEqual([]);
  await on.ctx.close();
  await request.patch(`/api/analytics/projects/${projectId}`, { data: { respectDnt: false } });
  // La configuración se cachea un rato en el servidor: se espera a que el snippet la vea.
  await expect
    .poll(
      async () => {
        const off = await open(browser, {}, signal);
        await off.page.waitForTimeout(900);
        const keys = await stored(off.page);
        await off.ctx.close();
        return keys.includes('id');
      },
      { timeout: 45_000, intervals: [2000] },
    )
    .toBe(true);
  await request.patch(`/api/analytics/projects/${projectId}`, { data: { respectDnt: true } });
});
