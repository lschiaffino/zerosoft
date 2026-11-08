import http from 'http';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lo que se sumó a Analytics para acercarse a PostHog, de punta a punta: tipos
 * de insight, matemáticas, fórmula, acciones, anotaciones, experimentos con el
 * snippet en otro origen, flags por grupos con payload, cohortes estáticas,
 * alertas, links públicos (sin sesión), proxy inverso y gestión de datos.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.ANALYTICS_SHOTS_DIR;

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

test.describe.configure({ mode: 'serial' });

let projectId = '';
let publicKey = '';
const H = { origin: 'http://shop.test' };

async function send(request: APIRequestContext, event: string, distinctId: string, properties: Record<string, unknown> = {}, ago = 0) {
  const res = await request.post('/api/ingest/e', {
    headers: H,
    data: { api_key: publicKey, event, distinct_id: distinctId, properties, timestamp: new Date(Date.now() - ago).toISOString() },
  });
  expect(res.status()).toBe(200);
}

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/analytics/projects', { data: { name: `Parity ${uid()}` } });
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  const DAY = 86_400_000;
  for (const [d, ago] of [['ana', 2 * DAY], ['ana', DAY], ['ana', 1000], ['bob', DAY]] as Array<[string, number]>) await send(request, 'used_app', d, { total: 40 }, ago);
  await send(request, 'signup', 'ana', { $set: { email: 'ana@acme.com', plan: 'pro' } });
  await send(request, 'signup', 'bob', { $set: { email: 'bob@acme.com', plan: 'free' } });
  await send(request, 'paid', 'ana', { total: 100 });
  // Dos que convierten y dos que no, para que la correlación tenga con qué contar.
  await send(request, 'signup', 'carla', { $set: { email: 'carla@acme.com', plan: 'pro' } });
  await send(request, 'paid', 'carla', { total: 50 });
  await send(request, 'signup', 'dan', { $set: { email: 'dan@acme.com', plan: 'free' } });
  for (const who of ['ana', 'carla']) await send(request, 'watched_demo', who);
});

test('stickiness, ciclo de vida, matemáticas, fórmula y CSV en el editor', async ({ page, baseURL }) => {
  const errors = watchErrors(page);
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);

  await page.goto('/en/app/pulse/insights/new', { waitUntil: 'networkidle' });
  const result = page.getByTestId('an-result');

  // Suma de una propiedad.
  await page.getByRole('combobox', { name: 'Event' }).first().fill('used_app');
  await page.getByRole('combobox', { name: 'Aggregation' }).first().selectOption('sum');
  await expect(page.getByLabel('Numeric property, e.g. total').first()).toBeVisible();
  await page.getByLabel('Numeric property, e.g. total').first().fill('total');
    await expect(result).toContainText('sum of total', { timeout: 10_000 });

  // Fórmula entre dos series.
  await page.getByRole('combobox', { name: 'Aggregation' }).first().selectOption('total');
  await page.getByRole('button', { name: '+ Series' }).click();
  await page.getByRole('combobox', { name: 'Event' }).nth(1).fill('signup');
  await page.getByLabel('Formula').fill('A / B');
  await expect(result).toContainText('A / B', { timeout: 10_000 });
  await page.getByLabel('Formula').fill('A +');
  await expect(page.getByTestId('an-result').getByRole('alert')).toContainText('formula is not valid', { timeout: 10_000 });
  await page.getByLabel('Formula').fill('');

  // Stickiness.
  await page.getByRole('tab', { name: 'Stickiness' }).click();
  await page.getByRole('combobox', { name: 'Event' }).first().fill('used_app');
  await expect(result.getByRole('rowheader', { name: '3 days' })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'insight-stickiness');

  // Ciclo de vida.
  await page.getByRole('tab', { name: 'Lifecycle' }).click();
  await page.getByRole('combobox', { name: 'Event' }).first().fill('used_app');
  await expect(result.getByRole('columnheader', { name: 'Came back' })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'insight-lifecycle');

  // CSV de lo que se ve.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  // Sin reglas de gente interna, la casilla explica por qué está apagada y a dónde ir.
  await expect(page.getByRole('checkbox', { name: /internal and test/ })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Define them in settings' })).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('correlación en un embudo y embudo guardado como cohorte estática', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const { insight } = await (
    await request.post('/api/analytics/insights', {
      data: { projectId, name: `Signup ${uid()}`, query: { kind: 'funnel', steps: [{ event: 'signup' }, { event: 'paid' }] } },
    })
  ).json();
  await page.goto(`/en/app/pulse/insights/${insight.id}`, { waitUntil: 'networkidle' });
  const panel = page.getByTestId('an-correlation');
  await panel.getByRole('button', { name: 'Analyze' }).click();
  await expect(panel).toContainText('Converted (2)', { timeout: 15_000 });
  await expect(panel).toContainText('Dropped (2)');
  await expect(panel.getByRole('cell', { name: /watched_demo/ })).toBeVisible();
  await panel.getByRole('combobox').selectOption('properties');
  await expect(panel.getByRole('cell', { name: /plan = pro/ })).toBeVisible({ timeout: 15_000 });
  await shot(page, 'funnel-correlation');

  // Los que abandonaron se guardan como cohorte.
  await page.getByRole('link', { name: /dropped/ }).first().click();
  await expect(page).toHaveURL(/persons\?ids=/);
  const name = `Dropped ${uid()}`;
  await page.getByRole('button', { name: 'Save as cohort' }).click();
  await page.getByRole('textbox', { name: 'Cohort name' }).fill(name);
  await page.getByRole('button', { name: 'Save as cohort' }).last().click();
  await expect(page).toHaveURL(/cohorts\?open=/, { timeout: 15_000 });
  await expect(page.getByTestId('an-cohort-editor')).toContainText('2 people');
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('acción: se crea, se usa en una tendencia, se busca con Cmd+K y se borra', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const name = `Convirtió ${uid()}`;
  await page.goto('/en/app/pulse/actions', { waitUntil: 'networkidle' });
  await expect(page.getByText('No actions yet')).toBeVisible();
  await page.getByRole('button', { name: 'New action' }).first().click();
  await page.getByRole('dialog').getByRole('textbox').fill(name);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/actions\/aa_/, { timeout: 15_000 });
  await page.getByRole('combobox', { name: 'Event' }).first().fill('paid');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  const id = page.url().split('/').pop()!;

  const res = await request.post('/api/analytics/query', { data: { projectId, query: { kind: 'trends', series: [{ event: `@action:${id}` }], dateRange: { from: '-7d' } } } });
  const { result } = await res.json();
  expect(result.series[0]).toMatchObject({ label: name, total: 2 });

  const search = await request.get(`/api/search?q=${encodeURIComponent(name)}`);
  if (search.ok()) expect(JSON.stringify(await search.json())).toContain(name);

  await page.goto('/en/app/pulse/actions', { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name })).toBeVisible();
  await page.getByRole('button', { name: `Delete: ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('link', { name })).toHaveCount(0);
});

test('anotación: se ve en la lista y como marca en el gráfico', async ({ page, baseURL, request }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const note = `Lanzamiento ${uid()}`;
  await page.goto('/en/app/pulse/annotations', { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'Note' }).fill(note);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('cell', { name: note, exact: true })).toBeVisible();
  const { insight } = await (await request.post('/api/analytics/insights', { data: { projectId, name: `T ${uid()}`, query: { kind: 'trends', series: [{ event: 'used_app' }], dateRange: { from: '-7d' } } } })).json();
  await page.goto(`/en/app/pulse/insights/${insight.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.an-annotation-mark title').filter({ hasText: note })).toHaveCount(1);
  await page.goto('/en/app/pulse/annotations', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: `Delete: ${note}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('cell', { name: note, exact: true })).toHaveCount(0);
});

test('experimento con el snippet real en otro origen: exposición, conversión y a todos', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const name = `Botón ${uid()}`;
  await page.goto('/en/app/pulse/experiments', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New experiment' }).first().click();
  await page.getByRole('dialog').getByRole('textbox').fill(name);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/experiments\/ax_/, { timeout: 15_000 });
  await expect(page.getByTestId('an-experiment-results')).toContainText('once the experiment starts');
  await page.getByRole('combobox', { name: 'Event' }).first().fill('bought');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').first()).toContainText('Saved');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('an-experiment-results')).toContainText('Nobody has seen a variant yet', { timeout: 15_000 });
  const flagKey = (await page.locator('p.an-mono').first().textContent())!.trim();

  // El sitio del cliente lee el flag; se manda $feature_flag_called solo.
  const port = (Number(process.env.E2E_PORT) || 3210) + 8;
  const server = http.createServer((_q, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>s</title><script src="${baseURL}/zs.js"></script><script>
      window.zs.init('${publicKey}', { api_host: '${baseURL}' });
      window.zs.onFeatureFlags(function () { window.variant = window.zs.getFeatureFlag('${flagKey}'); window.zs.capture('bought'); window.zs.flush(); });
    </script>`);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await page.context().browser()!.newContext();
    const site = await ctx.newPage();
    await site.goto(`http://127.0.0.1:${port}/`);
    await expect.poll(() => site.evaluate(() => (window as unknown as { variant?: string }).variant), { timeout: 15_000 }).toBeTruthy();
    seen.push(String(await site.evaluate(() => (window as unknown as { variant?: string }).variant)));
    await site.waitForTimeout(400);
    await ctx.close();
  }
  server.close();
  expect(seen.every((v) => v === 'control' || v === 'test')).toBe(true);

  await expect
    .poll(
      async () => {
        await page.reload({ waitUntil: 'networkidle' });
        return page.getByTestId('an-experiment-results').textContent();
      },
      { timeout: 30_000 },
    )
    .toContain('4 people exposed');
  await expect(page.getByTestId('an-experiment-results').getByRole('columnheader', { name: 'Chance of being best' })).toBeVisible();
  await shot(page, 'experiment-results');

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Ship test' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ship test' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Ship test' }).click();
  await expect(page.getByText('Everyone gets test').first()).toBeVisible({ timeout: 15_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('un flag usado por un experimento no se borra, y explica por qué', async ({ request }) => {
  const { flags } = await (await request.get(`/api/analytics/flags?project=${projectId}`)).json();
  const flag = (flags as Array<{ id: string; key: string }>).find((f) => f.key.startsWith('exp-'));
  expect(flag).toBeTruthy();
  const res = await request.delete(`/api/analytics/flags/${flag!.id}`);
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe('flag_in_use');
});

test('flag con grupos de release y payload, y /decide', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const key = `promo-${uid()}`;
  const { flag } = await (await request.post('/api/analytics/flags', { data: { projectId, key } })).json();
  await page.goto(`/en/app/pulse/flags/${flag.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('an-flag-group').getByRole('button', { name: '+ Filter' }).click();
  await page.getByTestId('an-flag-group').getByLabel('Property').fill('plan');
  await page.getByTestId('an-flag-group').getByLabel('Value').fill('pro');
  await page.getByRole('button', { name: 'Add release group' }).click();
  await expect(page.getByTestId('an-flag-group')).toHaveCount(2);
  await page.getByTestId('an-flag-group').nth(1).getByRole('slider').fill('0');
  await page.getByText('Payloads (JSON)').click();
  await page.getByRole('textbox', { name: 'true' }).fill('{bad');
  await expect(page.getByText('is not valid JSON')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'true' }).fill('{"color":"green"}');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('Flag saved');
  await shot(page, 'flag-groups');
  // Los flags se guardan en caché unos segundos por instancia.
  await expect
    .poll(
      async () => {
        const r = await request.post('/api/ingest/decide', { headers: H, data: { api_key: publicKey, distinct_id: 'ana' } });
        const j = await r.json();
        return j.featureFlags[key];
      },
      { timeout: 25_000 },
    )
    .toBe(true);
  const ana = await (await request.post('/api/ingest/decide', { headers: H, data: { api_key: publicKey, distinct_id: 'ana' } })).json();
  expect(ana.featureFlagPayloads[key]).toEqual({ color: 'green' });
  const bob = await (await request.post('/api/ingest/decide', { headers: H, data: { api_key: publicKey, distinct_id: 'bob' } })).json();
  expect(bob.featureFlags[key]).toBe(false);
  await request.delete(`/api/analytics/flags/${flag.id}`);
});

test('link público: se ve sin sesión, sin la consulta ni personas, y revocar lo corta', async ({ page, request, baseURL, browser }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const { insight } = await (
    await request.post('/api/analytics/insights', {
      data: { projectId, name: `Público ${uid()}`, query: { kind: 'funnel', steps: [{ event: 'signup', filters: [{ key: 'email', op: 'not_contains', value: 'filtro-secreto', type: 'person' }] }, { event: 'paid' }] } },
    })
  ).json();
  await page.goto(`/en/app/pulse/insights/${insight.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('No public links yet.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create link' }).click();
  const url = await dialog.getByRole('textbox', { name: 'Public link' }).inputValue();
  expect(url).toMatch(/\/en\/stats\/a\/[A-Za-z0-9_-]{43}$/);
  await shot(page, 'share-dialog');

  const anon = await browser.newContext();
  const pub = await anon.newPage();
  const errors = watchErrors(pub);
  const res = await pub.goto(url, { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(pub.getByTestId('an-share-public')).toContainText(insight.name);
  await expect(pub.locator('.an-funnel-step')).toHaveCount(2);
  const html = await pub.content();
  expect(html).not.toContain('filtro-secreto');
  expect(html).not.toContain('ana@acme.com');
  expect(html).not.toContain('analytics_events');
  await shot(pub, 'share-public');
  // Embebido: sin marco y sin que nada lo prohíba.
  const embed = await pub.goto(`${url}?embed=1`, { waitUntil: 'networkidle' });
  expect(embed?.headers()['x-frame-options']).toBeUndefined();
  await expect(pub.locator('.an-share-public.is-embed')).toBeVisible();
  // Embebido va sin el marco del sitio.
  await expect(pub.locator('footer')).toHaveCount(0);
  await expect(pub.locator('header')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);

  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog.getByText('No public links yet.')).toBeVisible();
  const gone = await pub.goto(url, { waitUntil: 'networkidle' });
  expect(gone?.status()).toBe(404);
  await anon.close();
});

test('un insight SQL no se puede hacer público', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const { insight } = await (await request.post('/api/analytics/insights', { data: { projectId, name: `SQL ${uid()}`, query: { kind: 'sql', sql: 'SELECT distinct_id FROM events' } } })).json();
  const res = await request.post('/api/analytics/shares', { data: { projectId, insightId: insight.id } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('sql_not_shareable');
  await page.goto(`/en/app/pulse/insights/${insight.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Share' })).toBeDisabled();
});

test('alerta desde un insight: aparece en el panel y en la lista, se pausa y se borra', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  const { insight } = await (await request.post('/api/analytics/insights', { data: { projectId, name: `Alertable ${uid()}`, query: { kind: 'trends', series: [{ event: 'used_app' }], dateRange: { from: '-7d' } } } })).json();
  await page.goto(`/en/app/pulse/insights/${insight.id}`, { waitUntil: 'networkidle' });
  const panel = page.getByTestId('an-alerts-panel');
  await expect(panel.getByText('No alerts on this insight.')).toBeVisible();
  await panel.getByRole('spinbutton', { name: 'Value' }).fill('5');
  await panel.getByRole('button', { name: 'Add alert' }).click();
  await expect(panel.getByText('Goes above 5')).toBeVisible();
  await shot(page, 'alerts-panel');
  await panel.getByRole('button', { name: 'Pause' }).click();
  await expect(panel.getByText('Paused')).toBeVisible();
  await page.goto('/en/app/pulse/alerts', { waitUntil: 'networkidle' });
  const list = page.getByTestId('an-list-alerts');
  await expect(list).toContainText(insight.name);
  await list.getByRole('button', { name: /^Delete:/ }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No alerts yet')).toBeVisible();
});

test('proxy inverso real: el snippet y la ingesta pasan por otro origen', async ({ page, baseURL, request }) => {
  const base = new URL(baseURL!);
  const port = (Number(process.env.E2E_PORT) || 3210) + 9;
  const proxy = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><title>p</title><script src="/z/zs.js"></script><script>window.zs.init('${publicKey}', { api_host: location.origin + '/z', capture_pageview: false }); window.zs.capture('through_proxy'); window.zs.flush();</script>`);
      return;
    }
    const path = (req.url ?? '').replace(/^\/z/, '');
    const up = http.request({ host: base.hostname, port: base.port, path, method: req.method, headers: { ...req.headers, host: base.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
  });
  await new Promise<void>((resolve) => proxy.listen(port, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect
    .poll(
      async () => {
        const r = await request.get(`/api/analytics/events?project=${projectId}&event=through_proxy`);
        return ((await r.json()) as { events: unknown[] }).events.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  proxy.close();
});

test('gestión de datos: ocultar un evento lo saca de los selectores; exportar da CSV', async ({ page, request, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/pulse/data', { waitUntil: 'networkidle' });
  await page.getByRole('checkbox', { name: 'used_app hidden' }).check();
  await expect
    .poll(async () => ((await (await request.get(`/api/analytics/properties?project=${projectId}`)).json()) as { events: string[] }).events.includes('used_app'))
    .toBe(false);
  await shot(page, 'data-management');
  const csv = await request.get(`/api/analytics/export?project=${projectId}`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect((await csv.text()).split('\n')[0]).toContain('distinct_id');
});

test('otro workspace no alcanza nada de las rutas nuevas', async ({ browser, baseURL }) => {
  const anon = await browser.newContext({ baseURL });
  await anon.addCookies([{ name: 'zs_e2e_as', value: `stranger-${uid()}@darwin-e2e.io`, url: baseURL! }]);
  for (const path of ['actions', 'alerts', 'annotations', 'experiments', 'definitions', 'export', 'shares']) {
    const res = await anon.request.get(`/api/analytics/${path}?project=${projectId}`);
    expect([403, 404], path).toContain(res.status());
  }
  await anon.close();
});

test('zona horaria: se elige en ajustes y los días del gráfico cortan a medianoche de esa zona', async ({ page, request, baseURL }) => {
  const res = await request.post('/api/analytics/projects', { data: { name: `Zona ${uid()}` } });
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  await page.context().addCookies([{ name: 'zs_analytics_project', value: project.id, url: baseURL! }]);
  await page.goto('/en/app/pulse/settings', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-timezone')).toHaveValue('');
  await page.getByTestId('an-timezone').selectOption('Asia/Tokyo');
  await shot(page, 'settings-timezone');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-timezone')).toHaveValue('Asia/Tokyo');

  // Ayer 16:00 UTC ya es hoy en Tokio (UTC+9) y 14:00 UTC todavía es ayer: un evento en cada día local.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const stamp = (h: string) => `${yesterday}T${h}:00:00.000Z`;
  for (const [i, h] of ['14', '16'].entries()) {
    const r = await request.post('/api/ingest/e', { headers: H, data: { api_key: project.publicKey, event: 'tz_event', distinct_id: `tz${i}`, timestamp: stamp(h) } });
    expect(r.status()).toBe(200);
  }
  const { result } = await (
    await request.post('/api/analytics/query', { data: { projectId: project.id, query: { kind: 'trends', series: [{ event: 'tz_event' }], dateRange: { from: '-3d' } } } })
  ).json();
  const tokyoDay = (t: string) => new Date(Date.parse(t) + 9 * 3_600_000).toISOString().slice(0, 10);
  const counts = Object.fromEntries((result.buckets as string[]).map((b, i) => [b, result.series[0].data[i]]));
  expect(tokyoDay(stamp('14'))).not.toBe(tokyoDay(stamp('16')));
  expect(counts[tokyoDay(stamp('14'))]).toBe(1);
  expect(counts[tokyoDay(stamp('16'))]).toBe(1);
  await page.goto('/en/app/pulse/insights/new', { waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Event' }).first().fill('tz_event');
  await expect(page.getByTestId('an-result').getByRole('cell', { name: '2', exact: true })).toBeVisible({ timeout: 10_000 });
});

test('sin cookies con el snippet real: nada en el navegador, visitantes contados y consentimiento', async ({ browser, request, baseURL, page }) => {
  test.setTimeout(120_000);
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Cookieless ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  await page.context().addCookies([{ name: 'zs_analytics_project', value: project.id, url: baseURL! }]);
  await page.goto('/en/app/pulse/settings', { waitUntil: 'networkidle' });
  await page.getByTestId('an-cookieless').check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();
  await shot(page, 'settings-cookieless');
  const port = (Number(process.env.E2E_PORT) || 3210) + 10;
  let mode = 'always';
  const server = http.createServer((_q, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>s</title><a id="next" href="/two">Next</a><script src="${baseURL}/zs.js"></script><script>window.zs.init('${project.publicKey}', { api_host: '${baseURL}', cookieless_mode: '${mode}' });</script>`);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const events = async () => ((await (await request.get(`/api/analytics/events?project=${project.id}`)).json()) as { events: Array<{ event: string; distinctId: string; pathname: string | null }> }).events;
  const site = await browser.newContext();
  const a = await site.newPage();
  await a.goto(`http://127.0.0.1:${port}/one`);
  await expect.poll(async () => (await events()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await a.click('#next');
  await expect.poll(async () => (await events()).filter((e) => e.pathname === '/two').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  // Nada guardado en el navegador, y la misma persona en las dos páginas.
  expect(await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('zs_')))).toEqual([]);
  expect(await a.evaluate(() => document.cookie)).toBe('');
  const seen = await events();
  expect(new Set(seen.map((e) => e.distinctId)).size).toBe(1);
  expect(seen[0].distinctId).toMatch(/^ck_/);
  await site.close();
  const { result } = await (await request.post('/api/analytics/query', { data: { projectId: project.id, query: { kind: 'web', dateRange: { from: '-7d' } } } })).json();
  expect(result.stats.visitors.value).toBe(1);
  expect(result.stats.pageviews.value).toBe(2);
  expect(result.stats.sessions.value).toBe(1);

  // Con aviso de cookies: nada hasta decidir, y al rechazar sigue sin cookies.
  mode = 'on_reject';
  const before = (await events()).length;
  const ctx = await browser.newContext();
  const b = await ctx.newPage();
  await b.goto(`http://127.0.0.1:${port}/banner`);
  await b.waitForTimeout(2500);
  expect((await events()).length).toBe(before);
  expect(await b.evaluate(() => (window as unknown as { zs: { getConsentStatus: () => string } }).zs.getConsentStatus())).toBe('pending');
  expect(await b.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('zs_')))).toEqual([]);
  await b.evaluate(() => (window as unknown as { zs: { optOut: () => void } }).zs.optOut());
  await expect.poll(async () => (await events()).filter((e) => e.pathname === '/banner').length, { timeout: 15_000 }).toBe(1);
  expect((await events()).find((e) => e.pathname === '/banner')?.distinctId).toMatch(/^ck_/);
  await ctx.close();
  // Si acepta: id propio guardado.
  const ctx2 = await browser.newContext();
  const c = await ctx2.newPage();
  await c.goto(`http://127.0.0.1:${port}/accepted`);
  await c.evaluate(() => (window as unknown as { zs: { optIn: () => void } }).zs.optIn());
  await expect.poll(async () => (await events()).filter((e) => e.pathname === '/accepted').length, { timeout: 15_000 }).toBe(1);
  expect((await events()).find((e) => e.pathname === '/accepted')?.distinctId).not.toMatch(/^ck_/);
  expect(await c.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('_id')))).toBe(true);
  await ctx2.close();
  server.close();
});

test('API key de la ingesta de PostHog: /batch y /flags', async ({ request }) => {
  const batch = await request.post('/api/ingest/batch', { headers: H, data: { api_key: publicKey, batch: [{ event: 'from_sdk', distinct_id: 'sdk', properties: {} }] } });
  expect(batch.status()).toBe(200);
  const flags = await request.post('/api/ingest/flags?v=2', { headers: H, data: { token: publicKey, distinct_id: 'sdk' } });
  expect(flags.status()).toBe(200);
  expect(await flags.json()).toHaveProperty('flags');
});
