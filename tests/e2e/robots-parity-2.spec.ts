import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Robots, segunda tanda de paridad: autoaprendizaje de selectores en un sitio
 * que cambia su HTML, grabación en vivo, lotes en partes, corridas a la vez,
 * permisos de members y envío a un S3 falso local (nunca contra AWS real).
 */

const BASE = Number(process.env.E2E_PORT) || 3210;
const MOCK_PORT = BASE + 14;
const SITE = `http://127.0.0.1:${MOCK_PORT}`;
let server: Server;
let layout: 'a' | 'b' | 'gone' = 'a';
const s3Puts: Array<{ url: string; auth: string; body: string }> = [];

function shop(): string {
  const items = [
    { n: 'Product one', p: '$10' },
    { n: 'Product two', p: '$20' },
    { n: 'Product three', p: '$30' },
  ];
  if (layout === 'gone') return '<!doctype html><html><body><h1>Closed</h1><p>We moved.</p></body></html>';
  if (layout === 'a') {
    const cards = items.map((i) => `<li class="product"><h2 class="name"><a href="/i/${i.p.slice(1)}">${i.n}</a></h2><span class="price">${i.p}</span></li>`).join('');
    return `<!doctype html><html><head><title>Shop</title></head><body><main><h1 class="title">Shop</h1><ul class="products">${cards}</ul><a class="cta" href="/shop">See offers</a></main></body></html>`;
  }
  // Mismo contenido con otras clases y otra estructura de tarjeta.
  const cards = items.map((i) => `<article class="tile"><h2 class="tile-head"><a href="/i/${i.p.slice(1)}">${i.n}</a></h2><b class="tile-cost">${i.p}</b></article>`).join('');
  return `<!doctype html><html><head><title>Shop</title></head><body><main><h1 class="hero">Shop</h1><section class="grid">${cards}</section><a class="btn-primary" href="/shop">See offers</a></main></body></html>`;
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', SITE);
    if (req.method === 'PUT' && url.pathname.startsWith('/bucket-e2e/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        s3Puts.push({ url: url.pathname, auth: String(req.headers.authorization ?? ''), body });
        res.writeHead(200);
        res.end();
      });
      return;
    }
    if (url.pathname === '/shop') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shop());
      return;
    }
    if (url.pathname === '/form') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>Form</h1><input name="q" placeholder="Search"><input name="secret" type="password"><button id="go" onclick="location.href=\'/shop\'">Go</button></body></html>');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(MOCK_PORT, '127.0.0.1', () => r()));
});

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

test.beforeEach(() => {
  layout = 'a';
});

const sql = async (q: string, args: Array<string | number> = []) => {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: q, args })).rows;
  } finally {
    db.close();
  }
};

async function runNow(page: Page, id: string) {
  const res = await page.request.post(`/api/robots/run/${id}`, { data: {}, timeout: 120_000 });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { run: { id: string; status: string; error: string | null; output: Record<string, unknown>; exports: { healed?: Array<{ relearned?: boolean; saved?: boolean; to: string; field?: string }> } } }).run;
}

/** Member real del workspace demo, con la cookie de identidad de los e2e. */
async function member(browser: Browser, baseURL: string) {
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `robots-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["robots"]')`, [team, me]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [team, me]);
  return { ctx, page: p };
}

test('robots: reaprende selectores cuando el sitio cambia, lo guarda y lo muestra', async ({ page }) => {
  const created = await page.request.post('/api/robots', {
    data: {
      name: 'Self heal e2e',
      steps: [
        { type: 'goto', url: `${SITE}/shop` },
        { type: 'click', selector: '.cta', text: '' },
        { type: 'extract', selector: '.title', name: 'heading', mode: 'text' },
        {
          type: 'extract_list',
          selector: 'ul.products > li.product',
          name: 'items',
          max: 50,
          fields: [
            { name: 'title', selector: '.name', attribute: '' },
            { name: 'price', selector: '.price', attribute: '' },
            { name: 'link', selector: '.name a', attribute: 'href' },
          ],
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const { id, settings } = (await created.json()) as { id: string; settings: { selfHeal?: boolean } };
  expect(settings.selfHeal).toBe(true);

  const first = await runNow(page, id);
  expect(first.status, String(first.error)).toBe('success');
  expect(first.exports.healed ?? []).toEqual([]);

  // Otras clases y otra estructura: los selectores viejos ya no están.
  layout = 'b';
  const second = await runNow(page, id);
  expect(second.status, String(second.error)).toBe('success');
  const rows = second.output.items as Array<{ title: string; price: string; link: string }>;
  expect(rows.map((r) => r.title)).toEqual(['Product one', 'Product two', 'Product three']);
  expect(rows.map((r) => r.price)).toEqual(['$10', '$20', '$30']);
  expect(rows[1].link).toContain('/i/20');
  expect(second.output.heading).toBe('Shop');
  const healed = second.exports.healed ?? [];
  expect(healed.length).toBeGreaterThanOrEqual(3);
  expect(healed.every((h) => h.relearned && h.saved)).toBe(true);

  // Quedó guardado en los pasos, con el viejo como alternativo.
  const saved = (await (await page.request.get(`/api/robots/${id}`)).json()) as { robot: { steps: Array<{ selector?: string; fallbacks?: string[] }> } };
  expect(saved.robot.steps[1].selector).not.toBe('.cta');
  expect(saved.robot.steps[1].fallbacks).toContain('.cta');
  expect(saved.robot.steps[3].fallbacks).toContain('ul.products > li.product');

  // La corrida lo dice en la pantalla.
  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/no longer matched its selector/).first()).toBeVisible();
  await expect(page.getByText(/Saved in the robot/).first()).toBeVisible();

  // La tercera corrida ya no tiene nada que reaprender.
  const third = await runNow(page, id);
  expect(third.status).toBe('success');
  expect(third.exports.healed ?? []).toEqual([]);

  // Bloqueado: la página ya no tiene nada parecido. Falla y no toca los pasos.
  layout = 'gone';
  const before = JSON.stringify(((await (await page.request.get(`/api/robots/${id}`)).json()) as { robot: { steps: unknown } }).robot.steps);
  const fourth = await runNow(page, id);
  expect(fourth.status).toBe('failed');
  const after = JSON.stringify(((await (await page.request.get(`/api/robots/${id}`)).json()) as { robot: { steps: unknown } }).robot.steps);
  expect(after).toBe(before);
});

test('robots: con el autoaprendizaje apagado, el cambio de HTML hace fallar la corrida', async ({ page }) => {
  const created = await page.request.post('/api/robots', {
    data: { name: 'No heal e2e', steps: [{ type: 'goto', url: `${SITE}/shop` }, { type: 'extract', selector: '.title', name: 'heading', mode: 'text', timeoutMs: 1000 }] },
  });
  const { id } = (await created.json()) as { id: string };
  await page.request.patch(`/api/robots/${id}`, { data: { settings: { selfHeal: false }, timeoutSec: 20 } });
  expect((await runNow(page, id)).status).toBe('success');
  layout = 'b';
  expect((await runNow(page, id)).status).toBe('failed');
});

test('robots: graba en vivo desde el sitio y los pasos llegan al editor', async ({ page, context }) => {
  const created = await page.request.post('/api/robots', { data: { name: 'Live record e2e', steps: [{ type: 'goto', url: `${SITE}/shop` }] } });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/en/app/robots/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Record steps', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Waiting for steps')).toBeVisible();
  const link = dialog.getByTestId('robots-record-bookmarklet');
  await expect(link).toHaveAttribute('href', /^javascript:/);
  const href = (await link.getAttribute('href'))!;

  const site = await context.newPage();
  await site.goto(`${SITE}/form`);
  await site.evaluate(decodeURIComponent(href.slice('javascript:'.length)));
  await site.locator('input[name=q]').fill('shoes');
  await site.locator('input[name=q]').blur();
  await site.locator('input[name=secret]').fill('never-recorded');
  await site.locator('input[name=secret]').blur();

  await expect(dialog.getByTestId('robots-record-steps')).toContainText('input[name="q"]', { timeout: 15_000 });
  await expect(dialog.getByText(/3 steps received/)).toBeVisible();
  await dialog.getByRole('button', { name: /Add 3 steps/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await site.close();

  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect.poll(async () => ((await (await page.request.get(`/api/robots/${id}`)).json()) as { robot: { steps: unknown[] } }).robot.steps.length).toBe(4);
  const saved = await (await page.request.get(`/api/robots/${id}`)).text();
  expect(saved).not.toContain('never-recorded');
  expect(saved).toContain('{{credentials.LOGIN.password}}');
});

test('robots: la grabación rechaza token malo y solo la lee quien la abrió', async ({ page, browser, baseURL }) => {
  const created = await page.request.post('/api/robots', { data: { name: 'Rec guard e2e' } });
  const { id } = (await created.json()) as { id: string };
  const rec = (await (await page.request.post(`/api/robots/${id}/recording`)).json()) as { id: string; token: string; sendUrl: string };
  // Otro origen, sin sesión, con el token: entra. Es lo que hace el grabador.
  const anon = await browser.newContext();
  const ok = await anon.request.post(rec.sendUrl, { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ token: rec.token, steps: [{ type: 'goto', url: 'https://example.com' }] }) });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['access-control-allow-origin']).toBe('*');
  const bad = await anon.request.post(rec.sendUrl, { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ token: 'nope', steps: [] }) });
  expect(bad.status()).toBe(404);
  await anon.close();
  const m = await member(browser, baseURL!);
  expect((await m.ctx.request.get(`/api/robots/recordings/${rec.id}`)).status()).toBe(404);
  expect((await m.ctx.request.post(`/api/robots/${id}/recording`)).status()).toBe(403);
  await m.ctx.close();
  expect((await page.request.get(`/api/robots/recordings/${rec.id}`)).status()).toBe(200);
});

test('robots: la extensión descargada graba entre páginas', async ({ page }, testInfo) => {
  const zip = await page.request.get('/api/robots/recorder-extension');
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toContain('zip');
  const created = await page.request.post('/api/robots', { data: { name: 'Extension e2e' } });
  const { id } = (await created.json()) as { id: string };
  const rec = (await (await page.request.post(`/api/robots/${id}/recording`)).json()) as { id: string; token: string; sendUrl: string };

  // Se descomprime tal cual lo haría una persona.
  const fs = await import('node:fs');
  const dir = testInfo.outputPath('ext');
  fs.mkdirSync(dir, { recursive: true });
  const buf = await zip.body();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString();
    fs.writeFileSync(path.join(dir, name), buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size));
    at += 30 + nameLen + size;
  }
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  try {
    const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20_000 }));
    const extId = new URL(worker.url()).host;
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.locator('#code').fill(`${rec.sendUrl}#${rec.token}`);
    await popup.locator('#url').fill(`${SITE}/form`);
    const opened = ctx.waitForEvent('page');
    await popup.locator('#start').click();
    const site = await opened;
    await site.waitForURL(`${SITE}/form`);
    await expect(site.locator('[data-zerosoft-recorder]')).toHaveCount(1, { timeout: 15_000 });
    await site.locator('input[name=q]').fill('shoes');
    await site.locator('input[name=q]').blur();
    await site.locator('#go').click();
    await site.waitForURL(`${SITE}/shop`);
    // En la página nueva sigue grabando sin tocar nada.
    await expect(site.locator('[data-zerosoft-recorder]')).toHaveCount(1, { timeout: 15_000 });
    await site.locator('h1').click();
    await expect
      .poll(async () => ((await (await page.request.get(`/api/robots/recordings/${rec.id}`)).json()) as { steps: Array<{ type: string; url?: string }> }).steps.map((s) => s.type).join(','), { timeout: 15_000 })
      .toBe('goto,fill,click,click');
  } finally {
    await ctx.close();
  }
});

test('robots: lote de 2.500 filas en partes, avance y cancelar con confirmación', async ({ page }) => {
  const created = await page.request.post('/api/robots', {
    data: { name: 'Big batch e2e', steps: [{ type: 'goto', url: `${SITE}/shop?q={{inputs.q}}` }], inputs: [{ name: 'q', label: 'Q', kind: 'text' }] },
  });
  const { id } = (await created.json()) as { id: string };
  const puts: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/api/robots/${id}/bulk`)) puts.push(1);
  });
  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Bulk run' }).click();
  const csv = `q\n${Array.from({ length: 2500 }, (_, i) => `v${i}`).join('\n')}`;
  await page.locator('input[type=file]').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/2,500 rows found/)).toBeVisible();
  await page.getByRole('button', { name: /Queue 2,?500 runs/ }).click();
  await expect(page.getByTestId('robots-batch')).toContainText('of 2,500 finished', { timeout: 30_000 });
  expect(puts.length).toBe(3);
  await page.getByTestId('robots-batch').getByRole('button', { name: 'Cancel the rest' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/will not start/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  const rows = await sql("SELECT COUNT(*) AS n FROM robot_runs WHERE robot_id = ? AND status = 'queued'", [id]);
  expect(Number(rows[0].n)).toBeGreaterThan(2000);
  await page.getByTestId('robots-batch').getByRole('button', { name: 'Cancel the rest' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel the rest' }).click();
  await expect.poll(async () => Number((await sql("SELECT COUNT(*) AS n FROM robot_runs WHERE robot_id = ? AND status = 'queued'", [id]))[0].n)).toBe(0);
  await expect(page.getByTestId('robots-batch').getByRole('button', { name: 'Cancel the rest' })).toHaveCount(0);
});

test('robots: ajustes del workspace y permisos de members (permitido y bloqueado)', async ({ page, browser, baseURL }) => {
  await page.goto('/en/app/robots/settings', { waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Runs at once' }).selectOption('3');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(((await (await page.request.get('/api/robots/settings')).json()) as { concurrency: number }).concurrency).toBe(3);

  const adminRobot = (await (await page.request.post('/api/robots', { data: { name: 'Admin robot e2e', steps: [{ type: 'goto', url: `${SITE}/shop` }] } })).json()) as { id: string };
  const loginRobot = (await (
    await page.request.post('/api/robots', { data: { name: 'Login robot e2e', steps: [{ type: 'goto', url: `${SITE}/form` }, { type: 'fill', selector: '[name=q]', value: 'x' }] } })
  ).json()) as { id: string };
  await page.request.patch(`/api/robots/${loginRobot.id}`, { data: { persistSession: true } });

  const m = await member(browser, baseURL!);
  const req = m.ctx.request;
  try {
    // Sin el permiso: solo mira.
    expect((await req.post('/api/robots', { data: { name: 'Nope' } })).status()).toBe(403);
    expect((await req.post(`/api/robots/run/${adminRobot.id}`, { data: {} })).status()).toBe(403);
    expect((await req.patch('/api/robots/settings', { data: { concurrency: 1 } })).status()).toBe(403);
    await m.page.goto('/en/app/robots', { waitUntil: 'networkidle' });
    await expect(m.page.getByRole('button', { name: 'Create robot' })).toHaveCount(0);

    await page.getByLabel('Let members build and run robots').check();
    await expect.poll(async () => ((await (await page.request.get('/api/robots/settings')).json()) as { membersCanBuild: boolean }).membersCanBuild).toBe(true);

    // Con el permiso: crea, edita lo suyo, corre lo que no usa login.
    const mine = await req.post('/api/robots', { data: { name: 'Member robot e2e', steps: [{ type: 'goto', url: `${SITE}/shop` }] } });
    expect(mine.status()).toBe(201);
    const mineId = ((await mine.json()) as { id: string }).id;
    expect((await req.patch(`/api/robots/${mineId}`, { data: { name: 'Renamed by member' } })).status()).toBe(200);
    const ran = await req.post(`/api/robots/run/${adminRobot.id}`, { data: {}, timeout: 120_000 });
    expect(ran.status()).toBe(200);

    // Bloqueado aunque tenga el permiso.
    expect((await req.patch(`/api/robots/${adminRobot.id}`, { data: { name: 'Hacked' } })).status()).toBe(403);
    expect((await req.delete(`/api/robots/${adminRobot.id}`)).status()).toBe(403);
    expect((await req.post(`/api/robots/run/${loginRobot.id}`, { data: {} })).status()).toBe(403);
    expect((await req.post('/api/robots', { data: { name: 'x', steps: [{ type: 'fill', selector: '#p', value: '{{credentials.LOGIN.password}}' }] } })).status()).toBe(403);
    expect((await req.patch(`/api/robots/${mineId}`, { data: { persistSession: true } })).status()).toBe(403);
    expect(
      (await req.patch(`/api/robots/${mineId}`, { data: { settings: { destinations: [{ id: 'a', kind: 's3', credential: 'c', bucket: 'bucket-e2e' }] } } })).status(),
    ).toBe(403);
    expect((await req.patch('/api/robots/settings', { data: { membersCanBuild: false } })).status()).toBe(403);

    // La pantalla: el editor de un robot ajeno es de solo lectura pero se puede correr.
    await m.page.goto(`/en/app/robots/${adminRobot.id}`, { waitUntil: 'networkidle' });
    await expect(m.page.getByRole('button', { name: 'Run robot' })).toBeVisible();
    await expect(m.page.getByRole('button', { name: 'Record steps', exact: true })).toHaveCount(0);
    await m.page.goto(`/en/app/robots/${loginRobot.id}`, { waitUntil: 'networkidle' });
    await expect(m.page.getByRole('button', { name: 'Run robot' })).toHaveCount(0);
    await m.page.goto(`/en/app/robots/${mineId}`, { waitUntil: 'networkidle' });
    await expect(m.page.getByRole('button', { name: 'Record steps', exact: true })).toBeVisible();
  } finally {
    await page.getByLabel('Let members build and run robots').uncheck();
    await page.getByRole('combobox', { name: 'Runs at once' }).selectOption('1');
    await expect.poll(async () => ((await (await page.request.get('/api/robots/settings')).json()) as { concurrency: number }).concurrency).toBe(1);
    await m.ctx.close();
  }
});

test('robots: envía las filas a un S3 compatible (servidor falso local) firmado, y avisa si falla', async ({ page }) => {
  const credName = `s3-${Date.now()}`;
  const cred = await page.request.post('/api/flow/credentials', {
    data: { name: credName, type: 'basic', data: { username: 'AK-FAKE', password: 'secret-fake-value' } },
  });
  expect(cred.ok(), await cred.text()).toBe(true);
  const created = await page.request.post('/api/robots', {
    data: {
      name: 'S3 e2e',
      steps: [
        { type: 'goto', url: `${SITE}/shop` },
        { type: 'extract_list', selector: 'li.product', name: 'items', max: 10, fields: [{ name: 'title', selector: '.name', attribute: '' }] },
      ],
    },
  });
  const { id } = (await created.json()) as { id: string };
  const save = await page.request.patch(`/api/robots/${id}`, {
    data: {
      settings: {
        destinations: [{ id: 's3a', kind: 's3', credential: credName, endpoint: SITE, region: 'auto', bucket: 'bucket-e2e', prefix: 'exports', format: 'csv', variable: 'items' }],
      },
    },
  });
  expect(save.ok(), await save.text()).toBe(true);
  s3Puts.length = 0;
  const run = await runNow(page, id);
  expect(run.status).toBe('success');
  expect(s3Puts.length).toBe(1);
  expect(s3Puts[0].url).toContain(`/bucket-e2e/exports/S3-e2e/${run.id}.csv`);
  expect(s3Puts[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AK-FAKE\//);
  expect(s3Puts[0].auth).not.toContain('secret-fake-value');
  expect(s3Puts[0].body).toContain('Product two');

  // Un bucket que rechaza: la corrida avisa, y el token no aparece en lo que ve la persona.
  await page.request.patch(`/api/robots/${id}`, {
    data: { settings: { destinations: [{ id: 's3a', kind: 's3', credential: credName, endpoint: SITE, region: 'auto', bucket: 'other-bucket', format: 'csv', variable: 'items' }] } },
  });
  const bad = await runNow(page, id);
  expect(JSON.stringify(bad.exports)).toContain('s3_http_404');
  expect(JSON.stringify(bad)).not.toContain('secret-fake-value');

  await page.goto(`/en/app/robots/${id}?tab=integrations`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'S3 or compatible' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`robots: diálogo de grabación y ajustes en ${theme} a 390px, sin scroll horizontal`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    await page.setViewportSize({ width: 390, height: 844 });
    const { id } = (await (await page.request.post('/api/robots', { data: { name: `Rec ${theme}`, steps: [{ type: 'goto', url: `${SITE}/shop` }] } })).json()) as { id: string };
    await page.goto(`/en/app/robots/${id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Record steps', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Waiting for steps')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`record-${theme}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const url of [`/en/app/robots/settings`, `/en/app/robots/recorder`, `/en/app/robots/${id}?tab=advanced`]) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.screenshot({ path: testInfo.outputPath(`${url.replace(/\W+/g, '-')}-${theme}.png`), fullPage: true });
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll, `${url}: ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
    }
  });
}
