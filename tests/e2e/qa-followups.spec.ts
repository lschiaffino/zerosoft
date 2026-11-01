import { createServer, type Server } from 'node:http';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Pendientes de QA con navegador real: alternativos y login de Robots contra un
 * Chromium de verdad (el elemento se lee en la página), horas en la zona de quien
 * mira sin errores de hidratación, y el diálogo de Paneles con teclado.
 */

const BASE = Number(process.env.E2E_PORT) || 3210;
const A = BASE + 41;
const B = BASE + 42;
const uid = () => Math.random().toString(36).slice(2, 8);
const servers: Server[] = [];
const received: string[] = [];

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    await db.execute({ sql: statement, args });
  } finally {
    db.close();
  }
}

async function rows(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const html = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

test.beforeAll(async () => {
  const a = createServer((req, res) => {
    if (req.url === '/redirect-login') {
      res.writeHead(302, { location: `http://localhost:${B}/login` });
      return res.end();
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(`${req.url}:${body}`);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html('<h1>ok</h1>'));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url === '/login') return res.end(html('<form method="post" action="/sent"><input id="pw" name="pw" type="password"><button id="go">Go</button></form>'));
    if (req.url === '/meta') return res.end(`<!doctype html><html><head><meta http-equiv="refresh" content="1;url=http://localhost:${B}/login"></head><body><p>loading</p></body></html>`);
    if (req.url === '/js') return res.end(html(`<p>loading</p><script>setTimeout(()=>location.replace('http://localhost:${B}/login'),800)</script>`));
    if (req.url === '/frame') return res.end(html(`<iframe id="f" src="http://localhost:${B}/login" width="400" height="200"></iframe>`));
    if (req.url === '/danger') return res.end(html('<button class="btn" onclick="fetch(\'/deleted\',{method:\'POST\'})">Delete account</button>'));
    if (req.url === '/same') return res.end(html('<button class="btn" name="save" onclick="fetch(\'/saved\',{method:\'POST\'})">Save</button>'));
    res.end(html('<h1>home</h1>'));
  });
  const b = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(`evil${req.url}:${body}`);
        res.end('ok');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html('<form method="post" action="/stolen"><input id="pw" name="pw" type="password"><button id="go">Go</button></form>'));
  });
  await Promise.all([new Promise<void>((r) => a.listen(A, r)), new Promise<void>((r) => b.listen(B, r))]);
  servers.push(a, b);
});

test.afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function run(request: APIRequestContext, steps: unknown[]) {
  const made = await request.post('/api/robots', { data: { name: `QA ${uid()}`, steps } });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: string };
  const ran = await request.post(`/api/robots/run/${id}`, { data: {} });
  expect(ran.ok(), await ran.text()).toBe(true);
  return { id, run: ((await ran.json()) as { run: { status: string; error: string | null; logs: Array<{ detail?: string }> } }).run };
}

async function credential(request: APIRequestContext) {
  const name = `QA_${uid()}`;
  const res = await request.post('/api/flow/credentials', { data: { name, type: 'basic', data: { username: 'u', password: 'QA-SECRET-pw' } } });
  expect(res.ok(), await res.text()).toBe(true);
  return name;
}

test('robots: el alternativo de un clic no aprieta otro botón; con el mismo nombre visible, sí', async ({ request }) => {
  test.setTimeout(180_000);
  received.length = 0;
  const danger = await run(request, [
    { type: 'goto', url: `http://127.0.0.1:${A}/danger` },
    { type: 'click', selector: '#save', fallbacks: ['button.btn'], identity: { tag: 'button', type: '', name: 'Save' } },
  ]);
  expect(danger.run.status).toBe('failed');
  expect(received.join()).not.toContain('/deleted');
  const same = await run(request, [
    { type: 'goto', url: `http://127.0.0.1:${A}/same` },
    { type: 'click', selector: '#save', fallbacks: ['button[name="save"]'], identity: { tag: 'button', type: '', name: 'Save' } },
    { type: 'wait', ms: 300 },
  ]);
  expect(same.run.status, same.run.error ?? '').toBe('success');
  expect(received.join()).toContain('/saved');
});

test('robots: el login no se escribe si una redirección lleva a otro origen, y el error lo explica', async ({ request, page }) => {
  test.setTimeout(180_000);
  received.length = 0;
  const name = await credential(request);
  const { id, run: bad } = await run(request, [
    { type: 'goto', url: `http://127.0.0.1:${A}/redirect-login` },
    { type: 'fill', selector: '#pw', value: `{{credentials.${name}.password}}` },
    { type: 'click', selector: '#go', text: '' },
  ]);
  expect(bad.status).toBe('failed');
  expect(bad.error).toBe('2: credential_origin');
  expect(received.join()).not.toContain('QA-SECRET');
  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  await expect(page.locator('.robots-run-error').first()).toContainText('did not type the login');
  // En el sitio configurado, el mismo login llega.
  const { run: good } = await run(request, [
    { type: 'goto', url: `http://127.0.0.1:${A}/login` },
    { type: 'fill', selector: '#pw', value: `{{credentials.${name}.password}}` },
    { type: 'click', selector: '#go', text: '' },
    { type: 'wait', ms: 300 },
  ]);
  expect(good.status, good.error ?? '').toBe('success');
  expect(received.join()).toContain('/sent:pw=QA-SECRET-pw');
});

test('robots: un meta refresh, un location.replace o un iframe de otro origen no reciben el login', async ({ request }) => {
  test.setTimeout(240_000);
  const name = await credential(request);
  const fill = { type: 'fill', selector: '#pw', value: `{{credentials.${name}.password}}` };
  for (const path of ['/meta', '/js']) {
    received.length = 0;
    const { run: blocked } = await run(request, [{ type: 'goto', url: `http://127.0.0.1:${A}${path}` }, fill, { type: 'click', selector: '#go', text: '' }, { type: 'wait', ms: 300 }]);
    expect(blocked.status, path).toBe('failed');
    expect(blocked.error, path).toBe('2: credential_origin');
    expect(blocked.logs.at(-1)?.detail, path).toContain(`http://localhost:${B}`);
    expect(received.join(), path).not.toContain('QA-SECRET');
  }
  received.length = 0;
  const frame = 'iframe#f >> internal:control=enter-frame >> ';
  const { run: framed } = await run(request, [
    { type: 'goto', url: `http://127.0.0.1:${A}/frame` },
    { ...fill, selector: `${frame}#pw` },
    { type: 'click', selector: `${frame}#go`, text: '' },
    { type: 'wait', ms: 300 },
  ]);
  expect(framed.error).toBe('2: credential_origin');
  expect(received.join()).not.toContain('QA-SECRET');
});

test('robots: la corrida frenada nombra el destino y "Usar este sitio" lo guarda después de confirmar', async ({ request, page }) => {
  test.setTimeout(180_000);
  const name = await credential(request);
  const { id, run: blocked } = await run(request, [
    { type: 'goto', url: `http://127.0.0.1:${A}/redirect-login` },
    { type: 'fill', selector: '#pw', value: `{{credentials.${name}.password}}` },
  ]);
  expect(blocked.error).toBe('2: credential_origin');
  await page.goto(`/en/app/robots/${id}?tab=runs`, { waitUntil: 'networkidle' });
  const box = page.locator('.robots-run-error').first();
  await expect(box).toContainText(`http://localhost:${B}`);
  await expect(box).toContainText('Login site on step 2');
  await box.getByTestId('robots-use-site').click();
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasText: `http://localhost:${B}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Use this site' }).click();
  await expect(box).toContainText('Saved');
  const saved = (await (await request.get(`/api/robots/${id}`)).json()) as { robot: { steps: Array<{ origin?: string }> } };
  expect(saved.robot.steps[1].origin).toBe(`http://localhost:${B}`);
  const again = await request.post(`/api/robots/run/${id}`, { data: {} });
  expect(((await again.json()) as { run: { status: string } }).run.status).toBe('success');
});

test('robots: el admin se hace cargo solo si confirma, y el diálogo nombra a quien lo armó', async ({ request, page }) => {
  test.setTimeout(180_000);
  const name = await credential(request);
  const made = await request.post('/api/robots', {
    data: {
      name: `Takeover ${uid()}`,
      steps: [
        { type: 'goto', url: `http://127.0.0.1:${A}/login` },
        { type: 'fill', selector: '#pw', value: `{{credentials.${name}.password}}` },
      ],
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: string };
  // Quien lo armó ahora es member del workspace.
  const creator = `qa-creator-${uid()}`;
  await sql('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [creator, `${creator}@darwin-e2e.io`, 'Ana Creator']);
  await sql("INSERT INTO team_members (team_id, user_id, role) VALUES ((SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1), ?, 'member')", [creator]);
  await sql('UPDATE robots SET created_by = ? WHERE id = ?', [creator, id]);
  // Sin confirmar, la API rechaza y explica.
  const refused = await request.post(`/api/robots/run/${id}`, { data: {} });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toBe('takeover_required');
  // Guardar no transfiere.
  expect((await request.patch(`/api/robots/${id}`, { data: { name: 'Renamed' } })).ok()).toBe(true);
  await page.goto(`/en/app/robots/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run', exact: true }).first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Ana Creator');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/does not run until an admin takes over/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'Take over and run' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.robots-run-error')).toHaveCount(0);
  await expect.poll(async () => ((await (await request.get(`/api/robots/${id}/runs`)).json()) as { runs: unknown[] }).runs.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const notes = await rows("SELECT title FROM notifications WHERE user_id = ? AND type = 'robot_notice'", [creator]);
  expect(notes.length).toBe(1);
});

/** Errores de hidratación (#418, #423, #425) en la consola de la página. */
function hydrationErrors(page: Page) {
  const errors: string[] = [];
  const add = (t: string) => {
    if (/hydrat|#418|#423|#425/i.test(t)) errors.push(t);
  };
  page.on('pageerror', (e) => add(e.message));
  page.on('console', (m) => m.type() === 'error' && add(m.text()));
  return errors;
}

test.describe('horas en la zona de quien mira', () => {
  // Tokio queda a +9 de UTC: una hora armada en el servidor se ve distinta.
  test.use({ timezoneId: 'Asia/Tokyo', locale: 'en-US' });

  test('Docs y Leads muestran el día de Tokio; Docs, Link, Voice, CRM y Board sin errores de hidratación', async ({ page, request }) => {
    test.setTimeout(180_000);
    const errors = hydrationErrors(page);
    // 20:30 UTC del 15 es el 16 en Tokio: el servidor (UTC) escribiría el 15.
    const instant = '2030-03-15T20:30:00.000Z';
    const title = `QA tz ${uid()}`;
    const doc = await (await request.post('/api/docs/pages', { data: { title } })).json() as { id: string };
    await sql('UPDATE docs_pages SET updated_at = ? WHERE id = ?', [instant, doc.id]);
    const leadName = `QA lead ${uid()}`;
    const lead = await (await request.post('/api/crm/leads', { data: { name: leadName } })).json() as { id: string };
    await sql('UPDATE crm_leads SET created_at = ? WHERE id = ?', [instant, lead.id]);
    await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(page.locator('tr', { hasText: title }).first()).toContainText('Mar 16, 2030');
    await page.goto('/en/app/crm/leads', { waitUntil: 'networkidle' });
    await expect(page.locator('tr', { hasText: leadName }).first()).toContainText('Mar 16, 2030');
    for (const url of ['/en/app/link', '/en/app/voice', '/en/app/board']) {
      await page.goto(url, { waitUntil: 'networkidle' });
    }
    expect(errors).toEqual([]);
  });
});

test('CRM Paneles: Eliminar panel atrapa el foco, Esc cierra y Eliminar borra', async ({ page, request }) => {
  test.setTimeout(120_000);
  const made = await request.post('/api/crm/dashboards', { data: { name: `QA panel ${uid()}` } });
  expect(made.ok(), await made.text()).toBe(true);
  await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });
  const open = page.getByRole('button', { name: 'Delete dashboard' });
  await open.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await page.setViewportSize({ width: 390, height: 700 });
  await open.click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('.modal-card: en un teléfono bajo scrollea adentro y no se sale de la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/en/app/crm/dashboards', { waitUntil: 'networkidle' });
  const box = await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-card" id="qa-card"><div style="min-height:1500px">x</div><button id="qa-end">End</button></div>`;
    document.body.appendChild(overlay);
    const card = document.getElementById('qa-card')!;
    const r = card.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, scroll: card.scrollHeight, client: card.clientHeight, overflow: getComputedStyle(card).overflowY, width: document.documentElement.scrollWidth };
  });
  expect(box.overflow).toBe('auto');
  expect(box.scroll).toBeGreaterThan(box.client);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(480);
  expect(box.width).toBeLessThanOrEqual(390);
});
