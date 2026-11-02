import http from 'http';
import { gunzipSync } from 'zlib';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Session replay y heatmaps de punta a punta con una página real en otro
 * origen: apagado por defecto, prender desde los ajustes, grabar clics, abrir
 * el reproductor y ver el DOM de la página adentro del iframe; una grabación
 * hostil que no corre; otro workspace y una persona sin la app afuera; borrar;
 * y el heatmap sobre la página real y sobre un sitio que no se deja enmarcar.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.ANALYTICS_REPLAY_SHOTS_DIR;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource|Blocked script execution|Refused to display|Content Security Policy/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string, fullPage = true) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'scroll horizontal').toBeLessThanOrEqual(0);
}

function siteHtml(base: string, key: string, title: string): string {
  return `<!doctype html><html><head><title>${title}</title>
<script src="${base}/zs.js" defer></script>
<script>window.zs = window.zs || []; zs.push(['init', '${key}', { api_host: '${base}' }]);</script>
<style>body{font:16px sans-serif;margin:0} .tall{height:2400px;background:#eef}</style>
</head><body>
<h1 id="site-title">${title}</h1>
<button id="buy" class="cta">Buy now</button>
<a id="docs" href="/docs">Read the docs</a>
<p id="plain">Some plain paragraph</p>
<input id="secret" type="password">
<input id="mail" type="email">
<input id="csrf" type="hidden" value="CSRFSECRET">
<div id="ed" contenteditable="true">TYPEDSECRET</div>
<select id="sel"><option value="OPTVALUESECRET">OPTLABELSECRET</option></select>
<a id="tok" href="/x?token=LINKSECRET&page=2">Link</a>
<div class="zs-no-capture" id="private-block">Private customer note</div>
<div class="tall"></div>
<button id="bottom">Bottom button</button>
</body></html>`;
}

let projectId = '';
let publicKey = '';
let server: http.Server | null = null;
let sitePort = 0;
let recordingId = '';
let sessionId = '';

test.describe.configure({ mode: 'serial' });

async function startSite(baseURL: string) {
  sitePort = (Number(process.env.E2E_PORT) || 3210) + 7;
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    if (path === '/locked') headers['x-frame-options'] = 'DENY';
    if (path === '/csp') headers['content-security-policy'] = "frame-ancestors 'none'";
    res.writeHead(200, headers);
    res.end(siteHtml(baseURL, publicKey, path === '/locked' ? 'Locked' : 'Shop'));
  });
  await new Promise<void>((resolve) => server!.listen(sitePort, '127.0.0.1', resolve));
}

test.afterAll(() => {
  server?.close();
});

async function decide(request: APIRequestContext) {
  const res = await request.post('/api/ingest/decide', { data: { api_key: publicKey, distinct_id: 'probe' }, headers: { origin: 'http://shop.test' } });
  return (await res.json()) as { config: { replay: unknown; heatmaps: boolean } };
}

function chunkBody(events: unknown[], over: Record<string, unknown> = {}) {
  return { session_id: `hostile-${uid()}-session`, window_id: 'window-hostile', seq: 0, distinct_id: 'hostile-user', sent_at: Date.now(), events, ...over };
}

async function browserAs(browser: Browser, baseURL: string, email: string) {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

test('apagado por defecto: nada se graba y la página explica cómo prenderlo', async ({ page, request, baseURL }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const res = await request.post('/api/analytics/projects', { data: { name: `Replay ${uid()}` } });
  expect(res.status()).toBe(201);
  const { project } = (await res.json()) as { project: { id: string; publicKey: string; replayEnabled: boolean; heatmapsEnabled: boolean } };
  projectId = project.id;
  publicKey = project.publicKey;
  expect(project).toMatchObject({ replayEnabled: false, heatmapsEnabled: false });
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await startSite(baseURL!);

  const off = await decide(request);
  expect(off.config).toMatchObject({ replay: false, heatmaps: false });
  const rejected = await request.post(`/api/ingest/replay?k=${publicKey}`, { data: JSON.stringify(chunkBody([{ type: 4, timestamp: Date.now(), data: { href: 'http://x.test', width: 1, height: 1 } }])), headers: { 'content-type': 'text/plain' } });
  expect(rejected.status()).toBe(403);

  // El sitio con el snippet no baja el grabador.
  const site = await page.context().newPage();
  const asked: string[] = [];
  site.on('request', (r) => asked.push(r.url()));
  const decided = site.waitForResponse((r) => r.url().includes('/api/ingest/decide'));
  await site.goto(`http://127.0.0.1:${sitePort}/pricing`);
  await decided;
  await site.waitForTimeout(500);
  expect(asked.some((u) => u.includes('zs-replay.js'))).toBe(false);
  await site.close();

  await page.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Session replay is off' })).toBeVisible();
  await shot(page, 'recordings-off');
  await page.getByRole('link', { name: 'Open settings' }).click();
  await expect(page).toHaveURL(/analytics\/settings#replay/);

  await page.goto('/en/app/analytics/heatmaps', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Heatmaps are off' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

// Cada test mira el proyecto de esta suite, aunque otras suites hayan creado proyectos antes.
test.beforeEach(async ({ page, baseURL }) => {
  if (projectId) await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
});

test('prender desde los ajustes, grabar en otro origen y reproducir', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('/en/app/analytics/settings', { waitUntil: 'networkidle' });
  await page.getByTestId('an-replay-enabled').check();
  // Texto sin enmascarar para este test: se comprueba el DOM de la página.
  await page.getByLabel('Mask all text').uncheck();
  await page.getByTestId('an-heatmaps-enabled').check();
  await shot(page, 'settings');
  await page.locator('#replay').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#replay').getByText('Saved')).toBeVisible();
  await expect.poll(async () => (await decide(request)).config.replay, { timeout: 45_000, intervals: [2000] }).toMatchObject({ enabled: true, maskAllText: false });

  const site = await page.context().newPage();
  const loaded = site.waitForResponse((r) => r.url().endsWith('/zs-replay.js'));
  const firstChunk = site.waitForResponse((r) => r.url().includes('/api/ingest/replay') && r.status() === 200, { timeout: 30_000 });
  await site.goto(`http://127.0.0.1:${sitePort}/pricing`);
  await loaded;
  await site.fill('#secret', 'hunter2-password');
  await site.fill('#mail', 'ana-secret@example.com');
  await firstChunk;
  await site.click('#buy');
  await site.waitForTimeout(1200);
  await site.click('#docs', { noWaitAfter: true, trial: true });
  await site.click('#plain');
  await site.evaluate(() => window.scrollTo(0, 1500));
  await site.waitForTimeout(400);
  await site.click('#bottom');
  // Una ruta de app de una página: queda en la lista de páginas, sin su token.
  await site.evaluate(() => history.pushState({}, '', '/reset?token=ROUTESECRET'));
  await site.waitForTimeout(300);
  // Salir de la página manda lo que quede.
  await site.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    (window as unknown as { zs: { flush: () => void } }).zs.flush();
  });

  await expect
    .poll(async () => Number((await sql('SELECT clicks FROM analytics_replay_recordings WHERE project_id = ?', [projectId]))[0]?.clicks ?? 0), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(2);
  const [rec] = await sql('SELECT id, session_id, distinct_id, first_url, has_snapshot, active_seconds FROM analytics_replay_recordings WHERE project_id = ?', [projectId]);
  recordingId = String(rec.id);
  sessionId = String(rec.session_id);
  expect(rec.has_snapshot).toBe(1);
  expect(String(rec.first_url)).toContain('/pricing');
  expect(Number(rec.active_seconds)).toBeGreaterThanOrEqual(1);

  // Los campos nunca van en claro; el bloque zs-no-capture no va; el texto sí (acá sin enmascarar).
  const chunks = await sql('SELECT data FROM analytics_replay_chunks WHERE recording_id = ?', [recordingId]);
  const dump = chunks.map((c) => gunzipSync(Buffer.from(c.data as ArrayBuffer)).toString()).join('');
  expect(dump).toContain('Buy now');
  expect(dump).not.toContain('hunter2');
  expect(dump).not.toContain('ana-secret');
  expect(dump).not.toContain('Private customer note');
  await site.close();

  // Lista.
  await page.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  const row = page.getByTestId('an-recording-row').first();
  await expect(row).toContainText('/pricing');
  await shot(page, 'recordings-list');
  await row.hover();
  await shot(page, 'recordings-row-hover', false);
  // Filtros.
  await page.getByLabel('Filter by URL').fill('/no-such-page');
  await expect(page.getByText('No recordings match these filters')).toBeVisible();
  await page.getByLabel('Filter by URL').fill('/pricing');
  await expect(page.getByTestId('an-recording-row')).toHaveCount(1);
  await page.getByLabel('Filter by URL').fill('');

  // Reproductor: el DOM de la página real está dentro del iframe.
  await page.getByTestId('an-recording-row').first().getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(new RegExp(`/replay/${recordingId}`));
  const iframe = page.locator('.replayer-wrapper iframe');
  await expect(iframe).toHaveCount(1, { timeout: 30_000 });
  await expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin');
  const frame = page.frameLocator('.replayer-wrapper iframe');
  await expect(frame.locator('#buy')).toHaveText('Buy now');
  await expect(frame.locator('#site-title')).toHaveText('Shop');
  await expect(frame.locator('body')).not.toContainText('Private customer note');
  // Con el grabador real, lo que no tiene que salir del navegador no está en lo que se reconstruye.
  const rebuilt = await frame.locator('html').innerHTML();
  for (const secret of ['CSRFSECRET', 'TYPEDSECRET', 'OPTVALUESECRET', 'OPTLABELSECRET', 'LINKSECRET']) expect(rebuilt, secret).not.toContain(secret);
  // La ruta de la app se encuentra filtrando por URL.
  const byUrl = (await (await request.get(`/api/analytics/replay?project=${projectId}&url=${encodeURIComponent('/reset')}`)).json()) as { recordings: Array<{ pages?: string[] }> };
  expect(byUrl.recordings.length).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(byUrl)).not.toContain('ROUTESECRET');

  // Eventos de la sesión, marcas y sincronía.
  const list = page.getByTestId('an-replay-events');
  await expect(list).toContainText('$pageview');
  await expect(list).toContainText('$autocapture');
  await expect(page.locator('.an-replay-mark-pageview').first()).toBeAttached();
  await expect(page.locator('.an-replay-mark-click').first()).toBeAttached();
  await expect(page.locator('.an-replay-event[aria-current="true"]')).toHaveCount(1, { timeout: 15_000 });
  await shot(page, 'player');

  // Controles: pausa con espacio, flechas, velocidad y saltar inactividad.
  const play = page.getByTestId('an-replay-play');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const state = await play.textContent();
  await page.keyboard.press('Space');
  await expect(play).not.toHaveText(state!);
  if ((await play.textContent()) === 'Play') await page.keyboard.press('Space');
  await expect(play).toHaveText('Pause');
  await page.keyboard.press('Space');
  await expect(play).toHaveText('Play');
  const clock = page.getByTestId('an-replay-time');
  await page.getByLabel('Recording timeline').fill('0');
  const before = await clock.textContent();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect(clock).not.toHaveText(before!);
  await page.getByLabel('Speed').selectOption('4');
  await page.getByLabel('Skip inactivity').uncheck();
  await page.getByLabel('Skip inactivity').check();
  // Click en un evento: mueve el tiempo al de ese evento.
  await list.getByRole('button').last().click();
  await expect(page.locator('.an-replay-event[aria-current="true"]').first()).toBeAttached();

  // 390 px: sin scroll horizontal.
  await page.setViewportSize({ width: 390, height: 800 });
  await noHorizontalScroll(page);
  await shot(page, 'player-390');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Esc vuelve a la lista.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/analytics\/replay$/);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('links desde eventos en vivo y desde la persona', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/app/analytics/events', { waitUntil: 'networkidle' });
  const link = page.getByTestId('an-event-recording').first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute('href', new RegExp(`/app/analytics/replay/${recordingId}$`));
  await shot(page, 'events-link');

  const [row] = await sql(
    `SELECT m.person_id FROM analytics_replay_recordings r JOIN analytics_person_ids m ON m.project_id = r.project_id AND m.distinct_id = r.distinct_id WHERE r.id = ?`,
    [recordingId],
  );
  await page.goto(`/en/app/analytics/persons/${row.person_id}`, { waitUntil: 'networkidle' });
  const section = page.getByTestId('an-person-recordings');
  await expect(section.getByRole('link').first()).toHaveAttribute('href', new RegExp(`/app/analytics/replay/${recordingId}$`));
  await shot(page, 'person-recordings');
});

test('grabación hostil: el <script> y los manejadores inline no corren', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const t0 = Date.now() - 4000;
  // Lo grabado apunta a un servidor de afuera: el navegador de quien mira no tiene que pedirle nada.
  const outside: string[] = [];
  const outsidePort = (Number(process.env.E2E_PORT) || 3210) + 21;
  const outsideServer = http.createServer((req, res) => {
    outside.push(req.url ?? '');
    res.writeHead(200);
    res.end();
  });
  await new Promise<void>((resolve) => outsideServer.listen(outsidePort, '127.0.0.1', resolve));
  let id = 10;
  const el = (tagName: string, attributes: Record<string, unknown>, childNodes: unknown[] = []) => ({ type: 2, tagName, attributes, childNodes, id: id++ });
  const text = (textContent: string) => ({ type: 3, textContent, id: id++ });
  // Un sitio hostil que arma su propia foto de rrweb, sin pasar por el grabador.
  const pwn = "window.top.__pwned='script';document.title='pwned'";
  const snapshot = {
    type: 0,
    id: 1,
    childNodes: [
      {
        type: 2,
        tagName: 'html',
        attributes: { onmouseover: "window.top.__pwned='html'" },
        id: 2,
        childNodes: [
          el('head', {}, [el('script', {}, [text(pwn)])]),
          el('body', { onload: "window.top.__pwned='onload'" }, [
            el('div', { id: 'hostile-marker' }, [text('Hostile page')]),
            el('img', { src: `http://127.0.0.1:${outsidePort}/pixel.png` }),
            el('link', { rel: 'stylesheet', href: `http://127.0.0.1:${outsidePort}/style.css` }),
            el('img', { id: 'bad-img', src: 'data:image/png;base64,nope', onerror: "window.top.__pwned='onerror'" }),
            el('script', {}, [text(pwn)]),
            el('a', { id: 'bad-link', href: "javascript:window.top.__pwned='href'" }, [text('click me')]),
            el('iframe', { id: 'bad-frame', srcdoc: "<script>window.top.__pwned='srcdoc'</script>", src: "javascript:window.top.__pwned='src'" }),
            el('svg', { id: 'bad-svg', onload: "window.top.__pwned='svg'" }),
          ]),
        ],
      },
    ],
  };
  const events = [
    { type: 4, timestamp: t0, data: { href: `http://127.0.0.1:${sitePort}/hostile`, width: 800, height: 600 } },
    { type: 2, timestamp: t0 + 1, data: { node: snapshot, initialOffset: { top: 0, left: 0 } } },
    // Un script agregado después por una mutación.
    {
      type: 3,
      timestamp: t0 + 500,
      data: {
        source: 0,
        removes: [],
        texts: [],
        attributes: [{ id: 2, attributes: { onclick: "window.top.__pwned='attr'" } }],
        adds: [{ parentId: 5, nextId: null, node: el('img', { src: 'x:', onerror: "window.top.__pwned='added'" }) }],
      },
    },
    { type: 3, timestamp: t0 + 2500, data: { source: 2, type: 2, id: 2, x: 5, y: 5 } },
  ];
  const session = `hostile-${uid()}-session`;
  const res = await request.post(`/api/ingest/replay?k=${publicKey}`, {
    data: JSON.stringify(chunkBody(events, { session_id: session, sent_at: Date.now() })),
    headers: { 'content-type': 'text/plain', origin: 'http://shop.test' },
  });
  expect(res.status(), await res.text()).toBe(200);
  const [rec] = await sql('SELECT id FROM analytics_replay_recordings WHERE project_id = ? AND session_id = ?', [projectId, session]);

  // Entrando por la lista: navegación del lado del cliente, sin el encabezado de la página.
  await page.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  await page.locator(`a[href*="/analytics/replay/${rec.id}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/replay/${rec.id}`));
  const frame = page.frameLocator('.replayer-wrapper iframe');
  await expect(frame.locator('#hostile-marker')).toHaveText('Hostile page', { timeout: 30_000 });
  await expect(page.locator('.replayer-wrapper iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
  await page.waitForTimeout(1500);
  expect(outside, outside.join(', ')).toEqual([]);
  outsideServer.close();
  // Dejamos que termine de reproducir: la mutación y el clic ya pasaron.
  await page.waitForTimeout(4000);
  // Si algo corriera, tocaría window.top; los manejadores tampoco corren disparándolos a mano.
  const pwned = await page.evaluate(() => {
    const doc = (document.querySelector('.replayer-wrapper iframe') as HTMLIFrameElement).contentDocument!;
    (doc.querySelector('#bad-link') as HTMLElement | null)?.click();
    doc.documentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    doc.documentElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    doc.querySelector('#bad-img')?.dispatchEvent(new Event('error'));
    return (window as unknown as { __pwned?: string }).__pwned ?? null;
  });
  expect(pwned).toBeNull();
  expect(await page.title()).not.toContain('pwned');
  await expect(page).toHaveURL(new RegExp(`/replay/${rec.id}`));
  expect(errors.filter((e) => /pwned/.test(e)), errors.join('\n')).toEqual([]);

  // Chunks que no son rrweb: rechazados, con estado claro.
  const bad = await request.post(`/api/ingest/replay?k=${publicKey}`, {
    data: JSON.stringify(chunkBody([{ type: 99, timestamp: Date.now(), data: {} }])),
    headers: { 'content-type': 'text/plain', origin: 'http://shop.test' },
  });
  expect(bad.status()).toBe(400);
  const big = await request.post(`/api/ingest/replay?k=${publicKey}`, { data: 'x'.repeat(600_000), headers: { 'content-type': 'text/plain', origin: 'http://shop.test' } });
  expect(big.status()).toBe(413);
  // Y el borrado limpia también esta.
  expect((await request.delete(`/api/analytics/replay/${rec.id}`)).status()).toBe(200);
});

test('accesos: otro workspace 404, sin la app 403, miembro sin borrar', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  // Otro workspace: la misma grabación no existe.
  const strangerEmail = `stranger-${uid()}@darwin-e2e.io`;
  const stranger = await browserAs(browser, baseURL!, strangerEmail);
  for (const path of [`/api/analytics/replay/${recordingId}`, `/api/analytics/replay/${recordingId}/chunks`]) {
    expect((await stranger.request.get(path)).status(), path).toBe(404);
  }
  expect((await stranger.request.delete(`/api/analytics/replay/${recordingId}`)).status()).toBe(404);
  expect((await stranger.request.get(`/api/analytics/replay?project=${projectId}`)).status()).toBe(404);
  expect((await stranger.request.get(`/api/analytics/replay/sessions?project=${projectId}&ids=${sessionId}`)).status()).toBe(404);
  expect((await stranger.request.get(`/api/analytics/heatmaps?project=${projectId}`)).status()).toBe(404);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [strangerEmail]);
  const strangerPage = await stranger.newPage();
  const res = await strangerPage.goto(`/en/app/analytics/replay/${recordingId}`);
  expect(`${res?.status()} ${strangerPage.url()}`).toMatch(/^404 /);
  await stranger.close();

  // Del workspace pero sin la app, o guest: afuera. Miembro con la app: mira pero no borra.
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const join = async (email: string, role: string, apps: string) => {
    const ctx = await browserAs(browser, baseURL!, email);
    const p = await ctx.newPage();
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, me, role, apps]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);
    return { ctx, p };
  };
  const reads = [
    `/api/analytics/replay?project=${projectId}`,
    `/api/analytics/replay/${recordingId}`,
    `/api/analytics/replay/${recordingId}/chunks`,
    `/api/analytics/replay/sessions?project=${projectId}&ids=${sessionId}`,
    `/api/analytics/heatmaps?project=${projectId}`,
    `/api/analytics/heatmaps/frame?project=${projectId}&url=${encodeURIComponent(`http://127.0.0.1:${sitePort}/pricing`)}`,
  ];
  for (const [label, role, apps] of [
    ['crm', 'member', '["crm"]'],
    ['guest', 'guest', '["analytics"]'],
  ] as const) {
    const { ctx, p } = await join(`${label}-${uid()}@darwin-e2e.io`, role, apps);
    // Un invitado no entra al workspace: su proyecto no existe para él (404). Sin la app: 403.
    for (const path of reads) expect([401, 403, 404], `${label} ${path}`).toContain((await ctx.request.get(path)).status());
    expect([401, 403, 404]).toContain((await ctx.request.delete(`/api/analytics/replay/${recordingId}`)).status());
    // Sin la app redirige; un invitado ve un 404. En ningún caso aparece el reproductor.
    const pageRes = await p.goto(`/en/app/analytics/replay/${recordingId}`, { waitUntil: 'networkidle' });
    expect(pageRes?.status() === 404 || !new RegExp(`/replay/${recordingId}`).test(p.url())).toBe(true);
    await expect(p.locator('.replayer-wrapper')).toHaveCount(0);
    await ctx.close();
  }
  const { ctx: memberCtx, p: member } = await join(`member-${uid()}@darwin-e2e.io`, 'member', '["analytics"]');
  // Ver grabaciones es de admins: API, lista y reproductor.
  for (const path of [`/api/analytics/replay/${recordingId}`, `/api/analytics/replay/${recordingId}/chunks`, `/api/analytics/replay?project=${projectId}`, `/api/analytics/replay/sessions?project=${projectId}&ids=${sessionId}`]) {
    expect((await memberCtx.request.get(path)).status(), path).toBe(403);
  }
  expect((await memberCtx.request.delete(`/api/analytics/replay/${recordingId}`)).status()).toBe(403);
  await member.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await member.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  await expect(member.getByText('Only admins can watch recordings')).toBeVisible();
  await expect(member.getByTestId('an-recording-row')).toHaveCount(0);
  expect((await member.goto(`/en/app/analytics/replay/${recordingId}`))?.status()).toBe(404);
  // Ajustes de solo lectura para un miembro.
  await member.goto('/en/app/analytics/settings', { waitUntil: 'networkidle' });
  await expect(member.getByTestId('an-replay-enabled')).toBeDisabled();
  // Y con otro proyecto apagado, el miembro lee que tiene que pedírselo a un admin.
  const fresh = await request.post('/api/analytics/projects', { data: { name: `Off ${uid()}` } });
  const offId = ((await fresh.json()) as { project: { id: string } }).project.id;
  await member.context().addCookies([{ name: 'zs_analytics_project', value: offId, url: baseURL! }]);
  await member.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  await expect(member.getByText('Only admins can watch recordings')).toBeVisible();
  await member.goto('/en/app/analytics/heatmaps', { waitUntil: 'networkidle' });
  await expect(member.getByText('Ask an admin of your workspace to turn on heatmaps')).toBeVisible();
  // Exportar todos los eventos y empezar, terminar, pasar o borrar un experimento también son de admins.
  expect((await memberCtx.request.get(`/api/analytics/export?project=${projectId}`)).status()).toBe(403);
  const { flag } = await (await request.post('/api/analytics/flags', { data: { projectId, key: `perm-${uid()}`, active: false, variants: [{ key: 'control', rollout: 50 }, { key: 'test', rollout: 50 }] } })).json();
  const { experiment } = await (await request.post('/api/analytics/experiments', { data: { projectId, name: `Perm ${uid()}`, flagId: flag.id, metrics: [{ event: 'x' }] } })).json();
  for (const data of [{ action: 'start' }, { action: 'stop' }, { ship: 'test' }]) {
    expect((await memberCtx.request.patch(`/api/analytics/experiments/${experiment.id}`, { data })).status(), JSON.stringify(data)).toBe(403);
  }
  expect((await memberCtx.request.delete(`/api/analytics/experiments/${experiment.id}`)).status()).toBe(403);
  await memberCtx.close();
});

test('heatmaps sobre la página real, con valores hostiles ignorados', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await expect.poll(async () => (await decide(request)).config.heatmaps, { timeout: 45_000, intervals: [2000] }).toBe(true);

  // Visitas reales: clics con posición y scroll al salir.
  const site = await page.context().newPage();
  await site.setViewportSize({ width: 1280, height: 720 });
  // Se escucha antes de navegar: la respuesta puede llegar antes de que goto termine.
  const decided1 = site.waitForResponse((r) => r.url().includes('/api/ingest/decide'), { timeout: 20_000 }).catch(() => null);
  await site.goto(`http://127.0.0.1:${sitePort}/heat`);
  await decided1;
  await site.waitForTimeout(800);
  await site.click('#buy');
  await site.click('#buy');
  await site.click('#plain');
  await site.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await site.waitForTimeout(200);
  await site.click('#bottom');
  // Una salida de verdad: el navegador deja la página y lo último se va por sendBeacon.
  await site.goto('about:blank');
  await expect
    .poll(async () => Number((await sql("SELECT count(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$pageleave' AND pathname = '/heat'", [projectId]))[0].n), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(async () => Number((await sql("SELECT count(*) AS n FROM analytics_events WHERE project_id = ? AND pathname = '/heat' AND event = '$pageleave'", [projectId]))[0].n), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  const [clickRow] = await sql("SELECT properties FROM analytics_events WHERE project_id = ? AND pathname = '/heat' AND event = '$autocapture' LIMIT 1", [projectId]);
  const props = JSON.parse(String(clickRow.properties));
  expect(props.$click_x).toBeGreaterThanOrEqual(0);
  expect(props.$click_x).toBeLessThanOrEqual(1);
  expect(props.$click_y).toBeGreaterThan(0);
  expect(props.$document_height).toBeGreaterThan(2000);
  await site.goto(`http://127.0.0.1:${sitePort}/locked`);
  await site.waitForTimeout(800);
  await site.click('#buy');
  await site.evaluate(() => (window as unknown as { zs: { flush: () => void } }).zs.flush());
  await site.waitForTimeout(500);
  await site.close();

  // Un cliente hostil manda basura.
  const hostile = await request.post('/api/ingest/e', {
    data: {
      api_key: publicKey,
      batch: [
        { event: '$pageview', distinct_id: 'evil', properties: { $current_url: `http://127.0.0.1:${sitePort}/heat`, $pathname: '/heat' } },
        { event: '$autocapture', distinct_id: 'evil', properties: { $pathname: '/heat', $event_type: 'click', $click_x: 999, $click_y: -4, $viewport_width: 1280, $el_tag: 'img', $el_text: '<img src=x onerror=alert(1)>' } },
        { event: '$autocapture', distinct_id: 'evil', properties: { $pathname: '/heat', $event_type: 'click', $click_x: 'NaN', $click_y: 'x', $viewport_width: 'y' } },
        { event: '$pageleave', distinct_id: 'evil', properties: { $pathname: '/heat', $max_scroll_pct: 100000, $viewport_width: 1280 } },
      ],
    },
    headers: { origin: 'http://shop.test' },
  });
  expect(hostile.ok()).toBe(true);

  const pageviews = async () => Number((await sql("SELECT count(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$pageview'", [projectId]))[0].n);
  const beforeViews = await pageviews();

  await page.goto('/en/app/analytics/heatmaps', { waitUntil: 'networkidle' });
  await page.getByTestId('an-heat-path').selectOption('/heat');
  await expect(page.getByTestId('an-heat-summary')).toContainText('4 clicks');
  await expect(page.getByTestId('an-heat-summary')).toContainText('2 clicks with invalid values ignored');
  const elements = page.getByTestId('an-heat-elements');
  await expect(elements).toContainText('Buy now');
  await expect(elements.locator('tr', { hasText: 'Buy now' })).toContainText('2');
  await expect(page.getByTestId('an-heat-scroll')).toContainText('Reached 100%');
  // Iframe: sandbox sin allow-same-origin, con la URL del propio proyecto.
  const iframe = page.getByTestId('an-heat-frame');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveAttribute('src', new RegExp(`^http://127\\.0\\.0\\.1:${sitePort}/heat`));
  // El canvas tiene color donde hubo clics.
  const painted = await page.getByTestId('an-heat-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(100);
  await page.locator('[data-testid="an-heat-frame"]').evaluate((el) => el.scrollIntoView());
  await page.waitForTimeout(1500);
  await shot(page, 'heatmap');
  // La página dentro del iframe sandbox no se cuenta como una visita más.
  await page.waitForTimeout(2500);
  expect(await pageviews()).toBe(beforeViews);

  // Otros tamaños: sin datos, sin clics pero con explicación.
  await page.getByTestId('an-heat-viewport').selectOption('mobile');
  await expect(page.getByText('No clicks on this page and screen size in this period.')).toBeVisible();

  // 390 px y modo oscuro.
  await page.getByTestId('an-heat-viewport').selectOption('desktop');
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(elements).toContainText('Buy now');
  await noHorizontalScroll(page);
  await shot(page, 'heatmap-390');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Sitio que no se deja enmarcar: fondo liso y lo dice.
  await page.getByTestId('an-heat-path').selectOption('/locked');
  await expect(page.getByTestId('an-heat-refused')).toBeVisible();
  await expect(page.getByTestId('an-heat-frame')).toHaveCount(0);
  await expect(page.getByTestId('an-heat-canvas')).toBeVisible();
  await shot(page, 'heatmap-refused');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('claro y oscuro; borrar actualiza la lista sin recargar; borrar la persona se lleva sus grabaciones', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.context().addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, 'recordings-dark');
  await page.goto(`/en/app/analytics/replay/${recordingId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.replayer-wrapper iframe')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(page, 'player-dark');
  await page.goto('/en/app/analytics/heatmaps', { waitUntil: 'networkidle' });
  await shot(page, 'heatmap-dark');
  await page.context().addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);

  // Una grabación más, para borrar desde la lista.
  const t0 = Date.now() - 2000;
  const session = `delete-${uid()}-session`;
  const snap = { type: 0, id: 1, childNodes: [{ type: 2, tagName: 'html', attributes: {}, id: 2, childNodes: [] }] };
  const created = await request.post(`/api/ingest/replay?k=${publicKey}`, {
    data: JSON.stringify(
      chunkBody(
        [
          { type: 4, timestamp: t0, data: { href: 'http://delete.test/x', width: 800, height: 600 } },
          { type: 2, timestamp: t0 + 1, data: { node: snap, initialOffset: { top: 0, left: 0 } } },
        ],
        { session_id: session, distinct_id: 'delete-me' },
      ),
    ),
    headers: { 'content-type': 'text/plain', origin: 'http://shop.test' },
  });
  expect(created.status()).toBe(200);

  await page.goto('/en/app/analytics/replay', { waitUntil: 'networkidle' });
  const row = page.getByTestId('an-recording-row').filter({ hasText: 'delete-me' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /Delete recording/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  const gone = await sql('SELECT count(*) AS n FROM analytics_replay_chunks WHERE session_id = ?', [session]);
  expect(Number(gone[0].n)).toBe(0);

  // Teclado en el diálogo: Esc cierra.
  const remaining = page.getByTestId('an-recording-row').first();
  await remaining.getByRole('button', { name: /Delete recording/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Borrar a la persona borra sus grabaciones.
  const [p] = await sql(
    `SELECT m.person_id FROM analytics_replay_recordings r JOIN analytics_person_ids m ON m.project_id = r.project_id AND m.distinct_id = r.distinct_id WHERE r.id = ?`,
    [recordingId],
  );
  expect((await request.delete(`/api/analytics/persons/${p.person_id}`)).status()).toBe(200);
  expect((await request.get(`/api/analytics/replay/${recordingId}`)).status()).toBe(404);
  expect(Number((await sql('SELECT count(*) AS n FROM analytics_replay_chunks WHERE recording_id = ?', [recordingId]))[0].n)).toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
