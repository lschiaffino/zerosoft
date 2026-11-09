import http from 'http';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lo que estaba marcado como listo sin pasar por el navegador: retención y
 * comparación con números, persona con su línea de tiempo, Do Not Track en el
 * sitio y permisos de una API key.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;

test.describe.configure({ mode: 'serial' });

let projectId = '';
let publicKey = '';

async function send(request: APIRequestContext, event: string, who: string, ago: number, properties: Record<string, unknown> = {}) {
  const res = await request.post('/api/ingest/e', {
    headers: { origin: 'http://shop.test' },
    data: { api_key: publicKey, event, distinct_id: who, properties, timestamp: new Date(Date.now() - ago).toISOString() },
  });
  expect(res.status()).toBe(200);
}

test.beforeAll(async ({ request }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Audit ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  // Esta semana: 3 compras. La anterior: 1.
  await send(request, 'buy', 'ana', DAY, { $set: { email: 'ana@acme.com', plan: 'pro' } });
  await send(request, 'buy', 'bob', DAY);
  await send(request, 'buy', 'ana', 2 * DAY);
  await send(request, 'buy', 'carla', 9 * DAY);
  // Retención diaria: ana vuelve al día siguiente, bob no.
  await send(request, 'seen', 'ana', 2 * DAY);
  await send(request, 'seen', 'ana', DAY);
  await send(request, 'seen', 'bob', 2 * DAY);
});

test('comparar con el período anterior muestra los dos totales', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/pulse/insights/new', { waitUntil: 'networkidle' });
  await page.getByLabel('Event', { exact: true }).first().fill('buy');
  await page.getByLabel('Compare to previous period').check();
  const row = page.getByTestId('an-result').locator('tbody tr').first();
  await expect(row.locator('td.num').nth(0)).toHaveText('3', { timeout: 15_000 });
  await expect(row.locator('td.num').nth(1)).toHaveText('1');
  await expect(page.getByTestId('an-result').locator('.an-line-compare')).toHaveCount(1);
});

test('retención: el tamaño de la cohorte y quién volvió', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/pulse/insights/new?kind=retention', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Retention' }).click();
  await page.getByLabel('First event').first().fill('seen');
  await page.getByLabel('Return event').first().fill('seen');
  const period = page.getByLabel(/Period/).first();
  await period.selectOption('day');
  const result = page.getByTestId('an-result');
  // La cohorte de hace dos días: ana y bob; al otro día solo ana, 50%.
  const row = result.locator('tbody tr').filter({ has: page.locator('td', { hasText: /^2$/ }) }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('50%');
});

test('una persona: propiedades y sus eventos', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/pulse/persons', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'ana@acme.com' }).or(page.getByRole('link', { name: 'ana', exact: true })).first().click();
  await expect(page).toHaveURL(/persons\/.+/);
  await expect(page.getByText('plan', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('pro', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'buy', exact: true }).or(page.getByText('buy', { exact: true })).first()).toBeVisible();
  await expect(page.getByText('seen', { exact: true }).first()).toBeVisible();
});

test('Do Not Track y Global Privacy Control: lo que manda ese navegador no se guarda, lo de los demás sí', async ({ browser, request, baseURL }) => {
  const server = http.createServer((_, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>s</title><script src="${baseURL}/zs.js"></script><script>zs.init('${publicKey}', { api_host: '${baseURL}' });</script>`);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const visit = async (path: string, headers: Record<string, string>) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: headers });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/${path}`);
    await page.waitForTimeout(2500);
    await ctx.close();
  };
  const stored = async (path: string) => {
    const res = await request.post('/api/analytics/query', {
      data: { projectId, query: { kind: 'trends', series: [{ event: '$pageview', filters: [{ key: '$pathname', op: 'eq', value: `/${path}` }] }], dateRange: { from: '-1d' } } },
    });
    return ((await res.json()) as { result: { series: Array<{ total: number }> } }).result.series[0].total;
  };
  try {
    await visit('dnt-on', { DNT: '1' });
    await visit('gpc-on', { 'Sec-GPC': '1' });
    await visit('dnt-control', {});
    await expect.poll(() => stored('dnt-control'), { timeout: 15_000 }).toBe(1);
    expect(await stored('dnt-on')).toBe(0);
    expect(await stored('gpc-on')).toBe(0);
  } finally {
    server.close();
  }
});

test('API key: leer con analytics:read, escribir no; sin el permiso, nada', async ({ page, playwright, baseURL }) => {
  const create = async (scopes: string[]) => {
    const res = await page.request.post('/api/keys', { data: { name: `audit ${uid()}`, scopes } });
    expect(res.status()).toBeLessThan(300);
    const body = (await res.json()) as { key?: string | { secret?: string; token?: string }; secret?: string; token?: string };
    const k = typeof body.key === 'string' ? body.key : (body.key?.secret ?? body.key?.token ?? body.secret ?? body.token);
    expect(k).toBeTruthy();
    return String(k);
  };
  const read = await create(['analytics:read']);
  const other = await create(['crm:read']);
  const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const url = `/api/analytics/dashboards?project=${projectId}`;
  try {
    const ok = await anon.get(url, { headers: { authorization: `Bearer ${read}` } });
    expect(ok.status()).toBe(200);
    const write = await anon.post('/api/analytics/dashboards', { headers: { authorization: `Bearer ${read}` }, data: { projectId, name: 'nope' } });
    expect(write.status()).toBe(403);
    const none = await anon.get(url, { headers: { authorization: `Bearer ${other}` } });
    expect(none.status()).toBe(403);
  } finally {
    await anon.dispose();
  }
});
