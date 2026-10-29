import { createClient } from '@libsql/client';
import { expect, test, type Page } from '@playwright/test';

/**
 * Analytics (PostHog) de punta a punta: un proyecto, una página de prueba con
 * el snippet (en otro origen, como el sitio de un cliente), los eventos en
 * vivo, una tendencia, un embudo de 2 pasos, un flag creado y evaluado, la
 * privacidad de la ingesta y una persona sin la app que queda afuera.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.ANALYTICS_SHOTS_DIR;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Errores de JS, de consola y respuestas 5xx. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Página del "sitio del cliente" (otro origen) con el snippet de zerosoft. */
function siteHtml(base: string, key: string): string {
  return `<!doctype html><html><head><title>Shop</title>
<script src="${base}/zs.js" defer></script>
<script>window.zs = window.zs || []; zs.push(['init', '${key}', { api_host: '${base}' }]);</script>
</head><body>
<h1>Shop</h1>
<button id="buy" class="cta">Buy now</button>
<form id="news" onsubmit="event.preventDefault()"><input name="email" type="email"><button type="submit">Join</button></form>
<input id="secret" type="password" class="zs-no-capture">
</body></html>`;
}

test.describe.configure({ mode: 'serial' });

let projectId = '';
let publicKey = '';

test('proyecto, snippet en otro sitio y eventos en vivo', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const res = await request.post('/api/analytics/projects', { data: { name: `Shop ${uid()}` } });
  expect(res.status()).toBe(201);
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  expect(publicKey).toMatch(/^zsp_/);

  // El proyecto nuevo pasa a ser el que se mira.
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);

  // El sitio del cliente: otro origen servido por Playwright, el snippet y la ingesta van a la app.
  const site = await page.context().newPage();
  await site.route('http://shop.test/**', (route) => route.fulfill({ contentType: 'text/html', body: siteHtml(baseURL!, publicKey) }));
  const ingest = site.waitForResponse((r) => r.url().includes('/api/ingest/e') && r.status() === 200);
  await site.goto('http://shop.test/pricing?utm_source=newsletter');
  await ingest;
  await site.evaluate(() => {
    const w = window as unknown as { zs: { capture: (e: string, p?: Record<string, unknown>) => void; flush: () => void } };
    w.zs.capture('signed_up', { plan: 'pro' });
  });
  await site.click('#buy');
  await site.fill('#secret', 'hunter2');
  await site.evaluate(() => (window as unknown as { zs: { flush: () => void } }).zs.flush());
  await expect
    .poll(async () => Number((await sql('SELECT count(*) AS n FROM analytics_events WHERE project_id = ?', [projectId]))[0].n), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);
  // Autocapture: el click con su texto, nunca el valor de un campo ni el de contraseña.
  const auto = await sql("SELECT properties FROM analytics_events WHERE project_id = ? AND event = '$autocapture'", [projectId]);
  expect(auto.length).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(auto)).toContain('Buy now');
  expect(JSON.stringify(auto)).not.toContain('hunter2');
  const pv = await sql("SELECT pathname, utm_source, referring_domain FROM analytics_events WHERE project_id = ? AND event = '$pageview'", [projectId]);
  expect(pv[0]).toMatchObject({ pathname: '/pricing', utm_source: 'newsletter' });
  await site.close();

  await page.goto('/en/app/analytics/events', { waitUntil: 'networkidle' });
  const table = page.getByTestId('an-live-table');
  await expect(table.getByRole('button', { name: '$pageview' }).first()).toBeVisible();
  await expect(table.getByRole('button', { name: 'signed_up' })).toBeVisible();
  // Detalle de un evento.
  await table.getByRole('button', { name: 'signed_up' }).click();
  await expect(page.locator('.an-live-detail')).toContainText('pro');
  await shot(page, 'events-live');

  // Lo nuevo aparece sin recargar (polling).
  await request.post('/api/ingest/e', { data: { api_key: publicKey, event: 'late_event', distinct_id: 'server-1' }, headers: { origin: 'http://shop.test' } });
  await expect(table.getByRole('button', { name: 'late_event' })).toBeVisible({ timeout: 15_000 });

  // Web analytics.
  await page.goto('/en/app/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.an-stat').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '/pricing' }).first()).toBeVisible();
  await shot(page, 'web-overview');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('ingesta: dominios permitidos, Do Not Track, tope de tamaño y key secreta', async ({ request }) => {
  const patch = await request.patch(`/api/analytics/projects/${projectId}`, { data: { allowedDomains: ['shop.test'] } });
  expect(patch.ok()).toBe(true);
  const body = { api_key: publicKey, event: 'x', distinct_id: 'd' };
  // El caché de proyectos por key dura 30 s por instancia: la lista nueva puede tardar.
  await expect
    .poll(async () => (await request.post('/api/ingest/e', { data: body, headers: { origin: 'https://evil.test' } })).status(), { timeout: 45_000, intervals: [2_000] })
    .toBe(403);
  expect((await request.post('/api/ingest/e', { data: body, headers: { origin: 'https://shop.test' } })).status()).toBe(200);
  const dnt = await (await request.post('/api/ingest/e', { data: body, headers: { origin: 'https://shop.test', dnt: '1' } })).json();
  expect(dnt).toMatchObject({ stored: 0, reason: 'dnt' });
  const big = await request.post('/api/ingest/e', { data: { api_key: publicKey, event: 'x', distinct_id: 'd', properties: { s: 'x'.repeat(600_000) } }, headers: { origin: 'https://shop.test' } });
  expect(big.status()).toBe(413);
  expect((await request.post('/api/ingest/e', { data: { api_key: 'zsp_nope', event: 'x', distinct_id: 'd' } })).status()).toBe(401);

  // Servidor con key secreta: sin origen, lote y borrado de una persona.
  const { secret } = (await (await request.post(`/api/analytics/projects/${projectId}/secret`)).json()) as { secret: string };
  const batch = await request.post('/api/ingest/e', {
    headers: { authorization: `Bearer ${secret}` },
    data: { batch: [{ event: 'order_paid', distinct_id: 'srv-user', properties: { amount: 49 } }, { event: 'order_paid', distinct_id: 'srv-user' }] },
  });
  expect(await batch.json()).toMatchObject({ stored: 2 });
  const del = await request.post('/api/ingest/delete', { headers: { authorization: `Bearer ${secret}` }, data: { distinct_id: 'srv-user' } });
  expect(await del.json()).toMatchObject({ deleted: true, events: 2 });
  await request.patch(`/api/analytics/projects/${projectId}`, { data: { allowedDomains: [] } });
});

test('tendencia y embudo de 2 pasos desde el editor', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/analytics/insights/new', { waitUntil: 'networkidle' });
  const result = page.getByTestId('an-result');
  // Tendencia por defecto: $pageview de los últimos 7 días.
  await expect(result.locator('svg[role="img"]')).toBeVisible();
  await expect(result.getByRole('row', { name: /\$pageview/ })).toContainText('1');
  await shot(page, 'insight-trend');
  await page.getByRole('button', { name: 'Save insight' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Pageviews this week');
  await dialog.getByLabel('Name').press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/analytics\/insights\/ai_/);
  await expect(page.getByLabel('Name')).toHaveValue('Pageviews this week');

  // Embudo: $pageview → signed_up.
  await page.goto('/en/app/analytics/insights/new?kind=funnel', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Funnel' }).click();
  await page.getByLabel('Step 2').fill('signed_up');
  await expect(result.locator('.an-funnel-step')).toHaveCount(2);
  await expect(result.locator('.an-funnel-step').nth(1)).toContainText('signed_up');
  await expect(result.locator('.an-funnel-total')).toContainText('1 of');
  await shot(page, 'insight-funnel');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('feature flag: crear, ajustar y evaluar (UI y /decide)', async ({ page, request, baseURL }) => {
  const errors = watchErrors(page);
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const key = `new-checkout-${uid()}`;
  await page.goto('/en/app/analytics/flags?new=1', { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Key').fill(key);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/en\/app\/analytics\/flags\/af_/);
  await expect(page.getByRole('heading', { name: key })).toBeVisible();
  await page.getByLabel('Description').fill('New checkout');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Flag saved' })).toBeVisible();
  await page.getByLabel('Distinct ID to test').fill('user-123');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByTestId('an-flag-test')).toHaveText('Value: true');
  await shot(page, 'flag');

  const decide = await request.post('/api/ingest/decide', { data: { api_key: publicKey, distinct_id: 'user-123' }, headers: { origin: 'http://shop.test' } });
  const json = (await decide.json()) as { featureFlags: Record<string, boolean | string> };
  expect(json.featureFlags[key]).toBe(true);
  // En la lista, con su estado.
  await page.goto('/en/app/analytics/flags', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-list-flags')).toContainText(key);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('SQL: lee el proyecto y rechaza otras tablas', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/analytics/sql', { waitUntil: 'networkidle' });
  const editor = page.getByLabel('Query');
  await editor.fill("SELECT event, count() AS n FROM events WHERE event = 'signed_up' GROUP BY event");
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('an-sql-result')).toContainText('signed_up');
  await shot(page, 'sql');
  await editor.fill('SELECT * FROM users');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('an-sql-result').getByRole('alert')).toContainText('Only the tables');
});

test('acceso por app: una persona sin Analytics no ve páginas, APIs ni búsqueda', async ({ browser, baseURL, request }) => {
  test.setTimeout(90_000);
  // Algo con nombre buscable en el workspace demo.
  const name = `Secret dashboard ${uid()}`;
  await request.post('/api/analytics/dashboards', { data: { projectId, name } });
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `noanalytics-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["crm"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);

    await p.goto('/en/app/analytics', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\?blocked=analytics/);
    await p.goto(`/en/app/analytics/flags`, { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\?blocked=analytics/);
    for (const path of ['/api/analytics/projects', `/api/analytics/dashboards?project=${projectId}`, `/api/analytics/events?project=${projectId}`]) {
      expect((await ctx.request.get(path)).status(), path).toBe(401);
    }
    expect((await ctx.request.post('/api/analytics/query', { data: { projectId, query: { kind: 'sql', sql: 'SELECT 1' } } })).status()).toBe(401);
    const search = (await (await ctx.request.get(`/api/search?q=${encodeURIComponent(name)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.startsWith('/app/analytics'))).toEqual([]);
    // La app no aparece en su inicio.
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(p.locator('a[href$="/app/analytics"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
