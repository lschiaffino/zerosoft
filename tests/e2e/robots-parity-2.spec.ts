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
const received: string[] = [];

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
    if (url.pathname === '/hostile') {
      // Página hostil: pisa los globales y arma un DOM con plantillas.
      const v = url.searchParams.get('v') ?? '1';
      received.push(`hostile:${url.search}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><script>
        const real = JSON.stringify;
        JSON.stringify = function (x) { if (x && x.parts) return real({ parts: [{ t: 'a', c: ['buy'] }], fields: {} }).replace('"a"', '"a.buy, a[title=\\"{{credentials.QA.password}}\\"]"'); return real(x); };
        window.addEventListener('load', () => { document.querySelectorAll('[title]').forEach((a) => fetch('/leak?t=' + encodeURIComponent(a.title))); });
      </script></head><body><h1 class="${layout === 'a' ? 'title' : 'other'}">Heading</h1><a title="{{credentials.QA.password}}" class="buy">x</a></body></html>`);
      void v;
      return;
    }
    if (url.pathname === '/account') {
      received.push(`account:${url.search}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const buttons =
        layout === 'a'
          ? '<button id="save" class="btn" onclick="location.href=\'/account?did=save\'">Save</button>'
          : '<button id="wipe" class="btn" onclick="location.href=\'/account?did=DELETE\'">Delete account</button>';
      res.end(`<!doctype html><html><body><h1>Account</h1>${buttons}</body></html>`);
      return;
    }
    if (url.pathname === '/renamed') {
      received.push(`renamed:${url.search}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const id = layout === 'a' ? 'save' : 'save-2';
      res.end(`<!doctype html><html><body><button id="${id}" onclick="location.href='/renamed?did=ok'">Save</button></body></html>`);
      return;
    }
    if (url.pathname === '/login') {
      received.push(`login:${url.search}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const field = layout === 'a' ? '<input id="pwd" type="password" placeholder="Secret">' : '<input id="q2" type="text" name="search" placeholder="Secret">';
      res.end(`<!doctype html><html><body>${field}<button id="go" onclick="location.href='/login?sent='+encodeURIComponent(document.querySelector('input').value)">Go</button></body></html>`);
      return;
    }
    if (url.pathname === '/forged') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body><button id="real">Real</button><a id="evil" href="#" title="{{credentials.X.password}}">Evil</a>
        <input id="clave" name="clave"><input id="plain" name="city"></body></html>`);
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
  received.length = 0;
});

async function healRobot(page: Page, name: string, steps: unknown[]) {
  const created = await page.request.post('/api/robots', { data: { name, steps } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const on = await page.request.patch(`/api/robots/${id}`, { data: { settings: { selfHeal: true }, timeoutSec: 40 } });
  expect(on.ok(), await on.text()).toBe(true);
  return id;
}

const stepsOf = async (page: Page, id: string) => ((await (await page.request.get(`/api/robots/${id}`)).json()) as { robot: { steps: Array<Record<string, unknown>> } }).robot.steps;

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
  type Run = { id: string; status: string; error: string | null; output: Record<string, unknown>; exports: { healed?: Array<{ relearned?: boolean; saved?: boolean; review?: boolean; to: string; field?: string }> } };
  let run = ((await res.json()) as { run: Run }).run;
  // Si otra corrida ocupaba el cupo, esta quedó en cola: se espera a que termine.
  for (let i = 0; i < 120 && (run.status === 'queued' || run.status === 'running'); i++) {
    await page.waitForTimeout(1000);
    run = ((await (await page.request.get(`/api/robots/runs/${run.id}`)).json()) as { run: Run }).run;
  }
  return run;
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
  return { ctx, page: p, email };
}

test('robots: reaprende selectores cuando el sitio cambia, lo guarda y lo muestra', async ({ page }) => {
  test.setTimeout(240_000);
  const created = await page.request.post('/api/robots', {
    data: {
      name: 'Self heal e2e',
      steps: [
        { type: 'goto', url: `${SITE}/shop` },
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
  expect(settings.selfHeal).toBeUndefined();
  await page.request.patch(`/api/robots/${id}`, { data: { settings: { selfHeal: true } } });

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
  expect(healed.length).toBeGreaterThanOrEqual(2);
  expect(healed.every((h) => h.relearned && h.saved)).toBe(true);

  // Quedó guardado en los pasos, con el viejo como alternativo.
  const saved = (await (await page.request.get(`/api/robots/${id}`)).json()) as { robot: { steps: Array<{ selector?: string; fallbacks?: string[] }> } };
  expect(saved.robot.steps[1].fallbacks).toContain('.title');
  expect(saved.robot.steps[2].fallbacks).toContain('ul.products > li.product');

  // La corrida lo dice en la pantalla.
  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/used the most similar element/).first()).toBeVisible();
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

test('robots: hostil, JSON.stringify pisado y DOM con plantillas no llegan a los pasos ni al secreto', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `QA_${Date.now()}`;
  const cred = await page.request.post('/api/flow/credentials', { data: { name, type: 'basic', data: { username: 'u', password: 'QA-SECRET-hunter2' } } });
  expect(cred.ok(), await cred.text()).toBe(true);
  const id = await healRobot(page, 'Hostile e2e', [
    { type: 'goto', url: `${SITE}/hostile` },
    { type: 'extract', selector: 'h1.title', name: 'h', mode: 'text' },
  ]);
  expect((await runNow(page, id)).status).toBe('success');
  layout = 'b';
  const run = await runNow(page, id);
  const selector = String((await stepsOf(page, id))[1].selector);
  expect(selector).not.toContain('{{');
  expect(selector).not.toContain(',');
  expect(JSON.stringify(run.exports)).not.toContain('credentials');
  expect(JSON.stringify(run)).not.toContain('QA-SECRET-hunter2');
  expect(received.join()).not.toContain('QA-SECRET');
  // Un selector con credencial no se puede guardar ni, si ya estaba, correr.
  const bad = await page.request.patch(`/api/robots/${id}`, { data: { steps: [{ type: 'click', selector: `a[title="{{credentials.${name}.password}}"]`, text: '' }] } });
  expect(bad.status()).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toBe('credential_misuse');
});

test('robots: nunca escribe una contraseña en otro campo', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `PW_${Date.now()}`;
  await page.request.post('/api/flow/credentials', { data: { name, type: 'basic', data: { username: 'u', password: 'QA-PASSWORD-777' } } });
  const id = await healRobot(page, 'Password e2e', [
    { type: 'goto', url: `${SITE}/login` },
    { type: 'fill', selector: '#pwd', value: `{{credentials.${name}.password}}` },
    { type: 'click', selector: '#go', text: '' },
  ]);
  expect((await runNow(page, id)).status).toBe('success');
  received.length = 0;
  layout = 'b';
  const run = await runNow(page, id);
  expect(run.status).toBe('failed');
  expect(received.join()).not.toContain('QA-PASSWORD');
  expect((await stepsOf(page, id))[1].selector).toBe('#pwd');
});

test('robots: nunca cambia Guardar por Borrar cuenta; con el mismo nombre actúa y deja revisar', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await healRobot(page, 'Delete e2e', [{ type: 'goto', url: `${SITE}/account` }, { type: 'click', selector: '#save', text: '' }]);
  expect((await runNow(page, id)).status).toBe('success');
  received.length = 0;
  layout = 'b';
  const run = await runNow(page, id);
  expect(run.status).toBe('failed');
  expect(received.join()).not.toContain('DELETE');
  expect((await stepsOf(page, id))[1].selector).toBe('#save');

  layout = 'a';
  const same = await healRobot(page, 'Same name e2e', [{ type: 'goto', url: `${SITE}/renamed` }, { type: 'click', selector: '#save', text: '' }]);
  expect((await runNow(page, same)).status).toBe('success');
  layout = 'b';
  received.length = 0;
  const healed = await runNow(page, same);
  // Mismo nombre: igual no se toca. Falla, sugiere, y una persona aprueba.
  expect(healed.status).toBe('failed');
  expect(received.join()).not.toContain('did=ok');
  expect(healed.exports.healed?.[0]).toMatchObject({ relearned: true, review: true, to: expect.stringContaining('save-2') });
  expect((await stepsOf(page, same))[1].selector).toBe('#save');
  await page.goto(`/en/app/robots/${same}?tab=runs&run=${healed.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/nothing was clicked or typed/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByText('Approved and saved in the robot.').first()).toBeVisible();
  expect(String((await stepsOf(page, same))[1].selector)).toContain('save-2');
  expect((await stepsOf(page, same))[1].fallbacks).toContain('#save');
  const after = await runNow(page, same);
  expect(after.status).toBe('success');
  expect(received.join()).toContain('did=ok');
});

test('robots: lote en pausa avisa una vez con link, y el panel lo muestra', async ({ page, browser, baseURL }) => {
  // Otro workspace: sin minutos no afecta a las demás pruebas. Se llega al límite por la base.
  const owner = await member(browser, baseURL!);
  const req = owner.ctx.request;
  await sql("DELETE FROM team_members WHERE user_id = (SELECT id FROM users WHERE email = ?)", [owner.email]);
  await sql('UPDATE users SET active_team_id = NULL WHERE email = ?', [owner.email]);
  try {
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [owner.email]))[0].id);
    const created = await req.post('/api/robots', { data: { name: 'Paused e2e', steps: [{ type: 'goto', url: `${SITE}/shop?q={{inputs.q}}` }], inputs: [{ name: 'q', label: 'Q', kind: 'text' }] } });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const month = new Date().toISOString().slice(0, 7);
    await sql('INSERT OR REPLACE INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, 1, ?)', [me, month, 999 * 60_000]);
    await sql(
      "INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, created_by, batch_id, created_at) VALUES (?, ?, ?, 'queued', 'api', '{\"q\":\"x\"}', ?, 'paused-batch', ?)",
      [`paused-${Date.now()}`, id, me, me, new Date().toISOString()],
    );
    for (let i = 0; i < 2; i++) expect((await page.request.get('/api/cron/robots', { headers: { authorization: 'Bearer e2e-cron' }, timeout: 120_000 })).ok()).toBe(true);
    const list = await sql("SELECT href FROM notifications WHERE user_id = ? AND source_type = 'robot'", [me]);
    expect(list.length).toBe(1);
    expect(String(list[0].href)).toBe(`/app/robots/${id}?tab=runs`);
    await owner.page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
    await expect(owner.page.getByTestId('robots-batch')).toContainText('paused: no minutes left');
  } finally {
    await owner.ctx.close();
  }
});

test('robots: pantalla de lotes, estimación y revisión en claro, oscuro y 390px', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const { id } = (await (
    await page.request.post('/api/robots', { data: { name: 'Look e2e', steps: [{ type: 'goto', url: `${SITE}/shop?q={{inputs.q}}` }], inputs: [{ name: 'q', label: 'Q', kind: 'text' }] } })
  ).json()) as { id: string };
  const batch = (await (await page.request.post(`/api/robots/${id}/bulk`, { data: { inputs: Array.from({ length: 20 }, (_, i) => ({ q: String(i) })) } })).json()) as { batchId: string };
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1280, 390]) {
      await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: testInfo.outputPath(`look-batches-${theme}-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Bulk run' }).click();
      await page.getByRole('dialog').getByLabel('Or paste the CSV').fill('q\na\nb\nc');
      await expect(page.getByTestId('robots-batch-estimate')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`look-estimate-${theme}-${width}.png`) });
      await page.keyboard.press('Escape');
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(inner + 1);
    }
  }
  await page.request.delete(`/api/robots/batches/${batch.batchId}`);
  // Revisión: un paso marcado en el diálogo de grabación.
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1280, 390]) {
      await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/en/app/robots/${id}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Record steps', exact: true }).click();
      const rows = async () => sql('SELECT id FROM robot_recordings WHERE robot_id = ? ORDER BY updated_at DESC LIMIT 1', [id]);
      await expect(page.getByRole('dialog').getByTestId('robots-record-bookmarklet')).toBeVisible();
      await expect.poll(async () => (await rows()).length).toBeGreaterThan(0);
      const recId = String((await rows())[0].id);
      const href = (await page.getByTestId('robots-record-bookmarklet').getAttribute('href'))!;
      const token = /%22token%22%3A%22([^%]+)%22/.exec(href)?.[1] ?? '';
      await page.request.post(`/api/robots/recordings/${recId}/steps`, {
        headers: { 'content-type': 'text/plain' },
        data: JSON.stringify({ token, steps: [{ type: 'goto', url: `${SITE}/form` }, { type: 'fill', selector: '#pass', value: '{{credentials.LOGIN.password}}' }] }),
      });
      await expect(page.getByLabel('I checked the marked steps')).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: testInfo.outputPath(`look-review-${theme}-${width}.png`) });
      await page.keyboard.press('Escape');
    }
  }
});

test('robots: no cura entre orígenes', async ({ page }) => {
  test.setTimeout(180_000);
  const id = await healRobot(page, 'Origin e2e', [{ type: 'goto', url: `${SITE}/shop` }, { type: 'extract', selector: '.title', name: 'h', mode: 'text' }]);
  expect((await runNow(page, id)).status).toBe('success');
  // Mismo camino en otro origen (localhost contra 127.0.0.1), con otras clases.
  layout = 'b';
  const steps = await stepsOf(page, id);
  steps[0].url = `http://localhost:${MOCK_PORT}/shop`;
  await page.request.patch(`/api/robots/${id}`, { data: { steps } });
  const run = await runNow(page, id);
  expect(run.status).toBe('failed');
  expect((await stepsOf(page, id))[1].selector).toBe('.title');
});

test('robots: el grabador ignora eventos falsos y enmascara lo sensible', async ({ page, context }) => {
  const { id } = (await (await page.request.post('/api/robots', { data: { name: 'Forged e2e', steps: [{ type: 'goto', url: `${SITE}/shop` }] } })).json()) as { id: string };
  await page.goto(`/en/app/robots/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Record steps', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const link = dialog.getByTestId('robots-record-bookmarklet');
  await expect(link).toHaveAttribute('href', /^javascript:/);
  const href = (await link.getAttribute('href'))!;
  const site = await context.newPage();
  await site.goto(`${SITE}/forged?token=abc123`);
  await site.evaluate(decodeURIComponent(href.slice('javascript:'.length)));
  // La página dispara clics y cambios que la persona no hizo.
  await site.evaluate(() => {
    document.getElementById('evil')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (document.getElementById('plain') as HTMLInputElement).value = 'fake-value';
    document.getElementById('plain')!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await site.locator('#clave').click();
  await site.keyboard.type('my-secret');
  await site.keyboard.press('Tab');
  await site.keyboard.type('Rosario');
  await site.keyboard.press('Tab');
  await site.locator('#real').click();
  await expect(dialog.getByTestId('robots-record-steps').locator('li')).toHaveCount(4, { timeout: 15_000 });
  const rec = await sql('SELECT id FROM robot_recordings WHERE robot_id = ?', [id]);
  const got = (await (await page.request.get(`/api/robots/recordings/${String(rec[0].id)}`)).json()) as { steps: Array<Record<string, string>>; review: number[] };
  const text = JSON.stringify(got.steps);
  expect(text).not.toContain('abc123');
  expect(text).not.toContain('my-secret');
  expect(text).not.toContain('fake-value');
  expect(text).not.toContain('#evil');
  expect(text).toContain('Rosario');
  expect(got.review.length).toBeGreaterThan(0);
  // Con pasos marcados, agregar pide confirmar la revisión.
  const add = dialog.getByRole('button', { name: /^Add/ });
  await expect(add).toBeDisabled();
  await dialog.getByLabel('I checked the marked steps').check();
  await expect(add).toBeEnabled();
  await site.close();
});

test('robots: lote con mapeo cambiado o fila mala no arranca nada a medias', async ({ page }) => {
  const { id } = (await (
    await page.request.post('/api/robots', {
      data: { name: 'Mapping e2e', steps: [{ type: 'goto', url: `${SITE}/shop?q={{inputs.email}}` }], inputs: [{ name: 'email', label: 'Email', kind: 'text', required: true }] },
    })
  ).json()) as { id: string };
  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Bulk run' }).click();
  // Una fila vacía en la fila 1.200: nada se sube.
  const rows = Array.from({ length: 1500 }, (_, i) => (i === 1199 ? `,b${i}@x.test` : `a${i}@x.test,b${i}@x.test`));
  await page.locator('input[type=file]').setInputFiles({ name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(`first,second\n${rows.join('\n')}`) });
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/bulk')) posts.push(r.postData() ?? '');
  });
  await page.getByRole('dialog').getByLabel('Email').selectOption('first');
  await page.getByRole('button', { name: /Queue 1,?500 runs/ }).click();
  await expect(page.getByText(/Row 1,?200/)).toBeVisible();
  expect(posts.length).toBe(0);
  // Otro mapeo: es otro lote y todas las filas salen de la misma columna.
  await page.getByRole('dialog').getByLabel('Email').selectOption('second');
  await page.getByRole('button', { name: /Queue 1,?500 runs/ }).click();
  await expect(page.getByTestId('robots-batch')).toContainText('of 1,500 finished', { timeout: 30_000 });
  const inputs = await sql('SELECT input FROM robot_runs WHERE robot_id = ?', [id]);
  expect(inputs.length).toBe(1500);
  expect(inputs.every((r) => String(r.input).includes('"b'))).toBe(true);
  const b = await sql('SELECT COUNT(DISTINCT batch_id) AS n FROM robot_runs WHERE robot_id = ?', [id]);
  expect(Number(b[0].n)).toBe(1);
  await sql("UPDATE robot_runs SET status = 'failed', error = 'canceled' WHERE robot_id = ? AND status = 'queued'", [id]);
});

test('robots: un member sin CRM no manda filas al CRM ni emails afuera, ni cancela lotes ajenos', async ({ page, browser, baseURL }) => {
  await page.request.patch('/api/robots/settings', { data: { membersCanBuild: true } });
  const m = await member(browser, baseURL!);
  try {
    const mine = (await (await m.ctx.request.post('/api/robots', { data: { name: 'No CRM', steps: [{ type: 'goto', url: `${SITE}/shop` }] } })).json()) as { id: string };
    const crm = await m.ctx.request.patch(`/api/robots/${mine.id}`, { data: { settings: { destinations: [{ id: 'c', kind: 'crm', object: 'contacts', mapping: {} }] } } });
    expect(crm.status()).toBe(403);
    expect(((await crm.json()) as { error: string }).error).toBe('no_crm_access');
    const mail = await m.ctx.request.patch(`/api/robots/${mine.id}`, { data: { settings: { changeEmail: { enabled: true, to: ['outside@evil.test'] } } } });
    expect(mail.status()).toBe(403);
    // Guardado antes de perder el acceso: al correr tampoco entra.
    await sql('UPDATE robots SET settings = ? WHERE id = ?', [JSON.stringify({ destinations: [{ id: 'c', kind: 'crm', enabled: true, variable: 'items', object: 'contacts', mapping: { email: 'email' } }] }), mine.id]);
    const adminRobot = (await (await page.request.post('/api/robots', { data: { name: 'Admin batch', steps: [{ type: 'goto', url: `${SITE}/shop?q={{inputs.q}}` }], inputs: [{ name: 'q', label: 'Q', kind: 'text' }] } })).json()) as { id: string };
    const batch = (await (await page.request.post(`/api/robots/${adminRobot.id}/bulk`, { data: { inputs: Array.from({ length: 5 }, (_, i) => ({ q: String(i) })) } })).json()) as { batchId: string };
    expect((await m.ctx.request.delete(`/api/robots/batches/${batch.batchId}`)).status()).toBe(403);
    expect((await page.request.delete(`/api/robots/batches/${batch.batchId}`)).status()).toBe(200);
  } finally {
    await page.request.patch('/api/robots/settings', { data: { membersCanBuild: false } });
    await m.ctx.close();
  }
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
  await site.locator('input[name=q]').click();
  await site.keyboard.type('shoes');
  await site.keyboard.press('Tab');
  await site.keyboard.type('never-recorded');
  await site.keyboard.press('Tab');

  await expect(dialog.getByTestId('robots-record-steps')).toContainText('input[name="q"]', { timeout: 15_000 });
  await expect(dialog.getByText(/3 steps received/)).toBeVisible();
  await dialog.getByLabel('I checked the marked steps').check();
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
    await site.locator('input[name=q]').click();
    await site.keyboard.type('shoes');
    await site.keyboard.press('Tab');
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
