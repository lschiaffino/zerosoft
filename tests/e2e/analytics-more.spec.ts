import http from 'http';
import { createClient } from '@libsql/client';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Encuestas, errores, LLM y extras de web de punta a punta, con el snippet en
 * una página de otro origen (como el sitio de un cliente). ANALYTICS_SHOTS_DIR
 * guarda capturas para mirarlas.
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

/** Capturas en claro, oscuro, 390 y 1280, para mirar. */
async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  const url = page.url();
  const ctx = page.context();
  const host = new URL(url).origin;
  for (const theme of ['light', 'dark'] as const) {
    await ctx.addCookies([{ name: 'zs_theme', value: theme, url: host }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${width}.png`, fullPage: true });
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll, `${name} ${theme} ${width}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
    }
  }
  await ctx.addCookies([{ name: 'zs_theme', value: 'light', url: host }]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle' });
}

async function noHorizontalScroll(page: Page, label: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(page.url(), { waitUntil: 'networkidle' });
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${label}: scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  await page.setViewportSize({ width: 1280, height: 720 });
}

function siteHtml(base: string, key: string, extra = ''): string {
  return `<!doctype html><html><head><title>Shop</title>
<script src="${base}/zs.js" defer></script>
<script>window.zs = window.zs || []; zs.push(['init', '${key}', { api_host: '${base}', autocapture: false }]);</script>
</head><body><h1>Shop</h1><p>Hello visitors, this is the page content for measuring paint.</p>${extra}
<button id="boom" onclick="setTimeout(function(){ throw new TypeError('Cannot read user 42'); })">Boom</button>
<button id="reject" onclick="Promise.reject(new RangeError('Rejected 7'))">Reject</button>
<input id="field">
</body></html>`;
}

type W = { zs: { capture: (e: string, p?: Record<string, unknown>) => void; captureException: (e: unknown, p?: Record<string, unknown>) => void; flush: () => void; getSurveys: (cb: (s: Array<{ id: string; type: string }>) => void) => void } };

test.describe.configure({ mode: 'serial' });

let projectId = '';
let publicKey = '';
let server: http.Server;
let siteUrl = '';

async function ensureProject(request: APIRequestContext, baseURL: string, page: Page) {
  if (projectId) {
    await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
    return;
  }
  const res = await request.post('/api/analytics/projects', { data: { name: `More ${uid()}` } });
  expect(res.status()).toBe(201);
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  publicKey = project.publicKey;
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL }]);
}

test.beforeAll(async ({ baseURL }) => {
  const port = (Number(process.env.E2E_PORT) || 3210) + 11;
  siteUrl = `http://127.0.0.1:${port}`;
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(siteHtml(baseURL!, publicKey));
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function decideConfig(request: APIRequestContext) {
  const r = await request.post('/api/ingest/decide', { data: JSON.stringify({ api_key: publicKey, distinct_id: 'probe' }), headers: { 'content-type': 'text/plain' } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { config: Record<string, unknown> }).config;
}

/** La caché de encuestas y de proyecto dura 15-30 s, pero un cambio en la misma instancia la vacía. */
test('sin encuesta al aire el sitio no hace pedidos extra; todo apagado por defecto', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  await ensureProject(request, baseURL!, page);
  expect(await decideConfig(request)).toMatchObject({ surveys: false, captureExceptions: false, webVitals: false });
  const site = await page.context().newPage();
  const surveyCalls: string[] = [];
  site.on('request', (r) => {
    if (r.url().includes('/api/ingest/surveys')) surveyCalls.push(r.url());
  });
  const decide = site.waitForResponse((r) => r.url().includes('/api/ingest/decide') && r.status() === 200);
  await site.goto(`${siteUrl}/landing`);
  await decide;
  await site.waitForTimeout(800);
  expect(surveyCalls).toEqual([]);
  // Con la captura apagada, un error de la página no manda nada.
  await site.click('#boom');
  await site.waitForTimeout(2000);
  expect((await sql(`SELECT COUNT(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$exception'`, [projectId]))[0].n).toBe(0);
  await site.close();
});

test('encuestas: crear desde la UI, editar, vista previa y estado', async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  await ensureProject(request, baseURL!, page);
  const errors = watchErrors(page);
  await page.goto('/en/app/analytics/surveys', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'No surveys yet' })).toBeVisible();
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/analytics\/surveys$/);
  await page.getByRole('button', { name: 'New survey' }).first().click();
  await page.getByLabel('Name').fill('Launch NPS');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/app\/analytics\/surveys\/asv_/);
  const surveyId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: 'Launch NPS' })).toBeVisible();
  await expect(page.getByTestId('an-sv-preview')).toContainText('How likely are you to recommend us');
  await expect(page.getByTestId('an-sv-preview').locator('.an-sv-rate span')).toHaveCount(10);

  // Segunda pregunta de opciones y tercera de texto.
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.getByTestId('an-sv-type-1').selectOption('multiple');
  await page.getByTestId('an-sv-choices-1').fill('Price\nSpeed\nSupport');
  await page.getByRole('button', { name: '+ Add question' }).click();
  await page.locator('fieldset', { hasText: 'Question 3' }).getByLabel('Question', { exact: true }).fill('<img src=x onerror=window.__pwned=1> Anything else?');
  await page.locator('fieldset', { hasText: 'Question 3' }).getByLabel('Can be left empty').check();
  await page.getByLabel('Thank-you message').fill('Thanks a lot');
  await page.getByLabel('Page URL contains').fill('/pricing');
  await page.getByTestId('an-sv-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // Un color inválido por la API no pasa.
  const bad = await request.patch(`/api/analytics/surveys/${surveyId}`, { data: { appearance: { background: 'url(https://evil)' } } });
  expect(bad.status()).toBe(400);
  // Seis preguntas tampoco.
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, type: 'open', text: 'x' }));
  expect((await request.patch(`/api/analytics/surveys/${surveyId}`, { data: { questions: six } })).status()).toBe(400);

  // Borrador: el sitio sigue sin pedir nada.
  expect((await decideConfig(request)).surveys).toBe(false);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('.ui-page-desc .badge')).toHaveText('Running');
  expect((await decideConfig(request)).surveys).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);

  // ⌘K la encuentra.
  await page.keyboard.press('ControlOrMeta+k');
  const searchDialog = page.getByRole('dialog', { name: 'Search' });
  await expect(searchDialog).toBeVisible();
  await searchDialog.getByRole('combobox').click();
  await searchDialog.getByRole('combobox').pressSequentially('Launch NPS');
  await expect(searchDialog.getByRole('option', { name: /Launch NPS/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await shots(page, 'survey-editor');
});

test('encuestas: el popover en el sitio, teclado, Esc, eventos y resultados', async ({ page, request, baseURL }) => {
  test.setTimeout(240_000);
  await ensureProject(request, baseURL!, page);
  const { surveys } = (await (await request.get(`/api/analytics/surveys?project=${projectId}`)).json()) as { surveys: Array<{ id: string; questions: Array<{ id: string }> }> };
  const survey = surveys[0];
  const [q1, q2, q3] = survey.questions.map((q) => q.id);

  // En una página que no le toca no aparece.
  const site = await page.context().newPage();
  const errors = watchErrors(site);
  const surveyCall = site.waitForResponse((r) => r.url().includes('/api/ingest/surveys') && r.status() === 200);
  await site.goto(`${siteUrl}/about`);
  const body = (await (await surveyCall).json()) as { surveys: Array<Record<string, unknown>> };
  // Lo público no lleva nombre interno ni condiciones.
  expect(body.surveys[0]).not.toHaveProperty('name');
  expect(body.surveys[0]).not.toHaveProperty('targeting');
  await site.waitForTimeout(500);
  await expect(site.locator('[data-zs-survey]')).toHaveCount(0);

  // Esc cierra y manda survey dismissed; queda recordada.
  await site.goto(`${siteUrl}/pricing?a=1`);
  const box = site.locator('[data-zs-survey] .box');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('role', 'dialog');
  expect(await site.locator('[data-zs-survey]').evaluate((el) => !!el.shadowRoot)).toBe(true);
  if (SHOTS) await site.screenshot({ path: `${SHOTS}/survey-popover.png` });
  await site.keyboard.press('Escape');
  await expect(site.locator('[data-zs-survey]')).toHaveCount(0);
  await site.reload();
  await site.waitForTimeout(1000);
  await expect(site.locator('[data-zs-survey]')).toHaveCount(0);

  // Otra persona (storage limpio): responde todo con el teclado.
  await site.evaluate(() => localStorage.clear());
  await site.goto(`${siteUrl}/pricing?b=2`);
  await expect(box).toBeVisible();
  await expect(site.locator('[data-zs-survey] .go')).toBeDisabled();
  await site.locator('[data-zs-survey] .rate button', { hasText: '10' }).focus();
  await site.keyboard.press('Enter');
  await expect(site.locator('[data-zs-survey] .go')).toBeEnabled();
  await site.locator('[data-zs-survey] .go').focus();
  await site.keyboard.press('Enter');
  await expect(box).toContainText('What could we do better?');
  await site.locator('[data-zs-survey] label', { hasText: 'Price' }).click();
  await site.locator('[data-zs-survey] label', { hasText: 'Support' }).click();
  await site.locator('[data-zs-survey] .go').click();
  // El texto de la pregunta se muestra como texto, nunca como HTML.
  await expect(box).toContainText('<img src=x onerror=window.__pwned=1> Anything else?');
  expect(await site.locator('[data-zs-survey]').evaluate((el) => el.shadowRoot!.querySelectorAll('img').length)).toBe(0);
  await site.locator('[data-zs-survey] textarea').fill('<script>window.__pwned=1</script> love it');
  const sent = site.waitForResponse((r) => r.url().includes('/api/ingest/e') && r.status() === 200);
  await site.locator('[data-zs-survey] .go').click();
  await sent;
  await expect(box).toContainText('Thanks a lot');
  expect(await site.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(errors, errors.join('\n')).toEqual([]);
  await site.close();

  // Respuestas con valores de un cliente hostil: no cuentan.
  const hostile = await request.post('/api/ingest/e', {
    headers: { 'content-type': 'text/plain', origin: siteUrl },
    data: JSON.stringify({
      api_key: publicKey,
      batch: [
        { event: 'survey sent', distinct_id: 'evil', properties: { $survey_id: survey.id, [`$survey_response_${q1}`]: 999, [`$survey_response_${q2}`]: ['Not a choice'], [`$survey_response_${q3}`]: { a: 1 } } },
        { event: 'survey sent', distinct_id: 'p6', properties: { $survey_id: survey.id, [`$survey_response_${q1}`]: 3, [`$survey_response_${q2}`]: ['Speed'] } },
      ],
    }),
  });
  expect(hostile.status()).toBe(200);

  await page.goto(`/en/app/analytics/surveys/${survey.id}/results`, { waitUntil: 'networkidle' });
  const stats = page.getByTestId('an-sv-stats');
  await expect(stats).toContainText('3'); // respuestas
  await expect(page.getByTestId('an-sv-nps')).toContainText('0');
  await expect(page.getByText(/ignored because/).first()).toBeVisible();
  // El texto del visitante se ve como texto.
  await expect(page.getByText('<script>window.__pwned=1</script> love it')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

  // CSV con los valores validados.
  const csv = await request.get(`/api/analytics/surveys/${survey.id}/export?from=-30d`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text).toContain('love it');
  expect(text).toContain('Price; Support');
  expect(text).not.toContain('999');
  expect(text).not.toContain('Not a choice');
  await shots(page, 'survey-results');

  // Lista con estado y cuenta.
  await page.goto('/en/app/analytics/surveys', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-list-surveys')).toContainText('3 responses');
  await expect(page.getByTestId('an-list-surveys')).toContainText('Running');
  await shots(page, 'survey-list');

  // API: getSurveys devuelve una encuesta de tipo API y el popover no la muestra.
  const apiSurvey = (await (await request.post('/api/analytics/surveys', { data: { projectId, name: 'API one' } })).json()) as { survey: { id: string } };
  await request.patch(`/api/analytics/surveys/${apiSurvey.survey.id}`, { data: { presentation: 'api', status: 'running' } });
  const s2 = await page.context().newPage();
  await s2.goto(`${siteUrl}/other`);
  await s2.evaluate(() => localStorage.clear());
  await s2.goto(`${siteUrl}/other`);
  const got = await s2.evaluate(() => new Promise<Array<{ id: string; type: string }>>((resolve) => (window as unknown as W).zs.getSurveys(resolve)));
  expect(got.map((x) => x.id)).toContain(apiSurvey.survey.id);
  await s2.waitForTimeout(500);
  await expect(s2.locator('[data-zs-survey]')).toHaveCount(0);
  await s2.close();
  // Terminada: deja de ofrecerse.
  await request.patch(`/api/analytics/surveys/${survey.id}`, { data: { status: 'ended' } });
  await request.patch(`/api/analytics/surveys/${apiSurvey.survey.id}`, { data: { status: 'ended' } });
  expect((await decideConfig(request)).surveys).toBe(false);
});

test('errores: capturar, agrupar, huella del servidor, estado, responsable y regresión', async ({ page, request, baseURL }) => {
  test.setTimeout(240_000);
  await ensureProject(request, baseURL!, page);
  const errors = watchErrors(page);

  await page.goto('/en/app/analytics/errors', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-errors-off')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No errors in this period' })).toBeVisible();

  // Prender desde Ajustes.
  await page.goto('/en/app/analytics/settings', { waitUntil: 'networkidle' });
  await page.getByTestId('an-capture-exceptions').check();
  await page.getByTestId('an-web-vitals').check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();
  expect(await decideConfig(request)).toMatchObject({ captureExceptions: true, webVitals: true });

  const site = await page.context().newPage();
  await site.goto(`${siteUrl}/app`);
  await site.waitForResponse((r) => r.url().includes('/api/ingest/e') && r.status() === 200);
  await site.click('#boom');
  await site.click('#reject');
  await site.waitForTimeout(300);
  await site.evaluate(() => {
    const zs = (window as unknown as W).zs;
    zs.captureException(new Error('Manual failure 1'), { plan: 'pro', $exception_fingerprint: 'cliente-miente' });
    zs.flush();
  });
  await expect.poll(async () => (await sql(`SELECT COUNT(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$exception'`, [projectId]))[0].n, { timeout: 15_000 }).toBe(3);
  const rows = await sql(`SELECT properties FROM analytics_events WHERE project_id = ? AND event = '$exception'`, [projectId]);
  for (const r of rows) {
    const p = JSON.parse(String(r.properties)) as Record<string, unknown>;
    expect(p.$exception_fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(Array.isArray(p.$exception_stack)).toBe(true);
  }

  // Un loop no inunda: como mucho 10 por minuto en cada carga (ya mandó 3).
  await site.evaluate(() => {
    const zs = (window as unknown as W).zs;
    for (let i = 0; i < 200; i++) zs.captureException(new Error(`Loop ${i}`));
    zs.flush();
  });
  await expect.poll(async () => (await sql(`SELECT COUNT(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$exception'`, [projectId]))[0].n, { timeout: 15_000 }).toBe(10);
  await site.waitForTimeout(500);
  expect((await sql(`SELECT COUNT(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$exception'`, [projectId]))[0].n).toBe(10);
  await site.close();

  // Mismo error dos veces por la API (ids distintos en el mensaje): un solo grupo con dos personas.
  for (const [who, n] of [['ana', 42], ['beto', 77]] as const) {
    const r = await request.post('/api/ingest/e', {
      headers: { 'content-type': 'text/plain', origin: siteUrl },
      data: JSON.stringify({
        api_key: publicKey,
        event: '$exception',
        distinct_id: who,
        properties: {
          $exception_type: 'PaymentError',
          $exception_message: `Order ${n} failed <img src=x onerror=window.__pwned=1>`,
          $exception_stack: [{ file: 'https://shop.test/assets/pay.abc12345.js', function: 'charge', line: n, column: 1 }],
          $exception_fingerprint: `fake-${n}`,
          $current_url: 'https://shop.test/checkout',
        },
      }),
    });
    expect(r.status()).toBe(200);
  }

  await page.goto('/en/app/analytics/errors', { waitUntil: 'networkidle' });
  const list = page.getByTestId('an-list-errors');
  const row = list.locator('tr', { hasText: 'PaymentError' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('td').nth(2)).toHaveText('2');
  await expect(row.locator('td').nth(3)).toHaveText('2');
  await expect(row).toContainText('<img src=x');
  await expect(list.locator('tr', { hasText: 'TypeError' })).toHaveCount(1);
  await page.getByLabel('Search type or message').fill('PaymentError');
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Search type or message').fill('');
  await shots(page, 'errors-list');

  await page.getByRole('link', { name: 'PaymentError' }).click();
  await expect(page).toHaveURL(/\/app\/analytics\/errors\/.+~[0-9a-f]{32}/);
  const issuePath = new URL(page.url()).pathname;
  const ref = decodeURIComponent(issuePath.split('/').pop()!);
  await expect(page.getByTestId('an-issue-occurrences')).toHaveText('2');
  await expect(page.getByTestId('an-issue-frames')).toContainText('charge');
  await expect(page.getByTestId('an-issue-frames')).toContainText('pay.abc12345.js');
  await expect(page.getByText('Source maps are not supported', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /.+/ }).filter({ hasText: /^[a-zA-Z0-9_-]{6,}$/ }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

  // Responsable: una persona del workspace sí, otra no.
  const members = page.getByTestId('an-issue-assignee').locator('option');
  expect(await members.count()).toBeGreaterThan(1);
  const assignee = await members.nth(1).getAttribute('value');
  await page.getByTestId('an-issue-assignee').selectOption(assignee!);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const invalid = await request.patch(`/api/analytics/errors/${encodeURIComponent(ref)}`, { data: { assigneeId: 'not-a-member' } });
  expect(invalid.status()).toBe(400);

  // Resolver: sale de la lista por defecto.
  await page.getByTestId('an-issue-status').selectOption('resolved');
  await expect(page.locator('.an-issue-controls .badge')).toHaveText('Resolved');
  await page.goto('/en/app/analytics/errors', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-list-errors').locator('tr', { hasText: 'PaymentError' })).toHaveCount(0);

  // Vuelve a pasar: es una regresión, también antes de que pase el cron.
  await page.waitForTimeout(50);
  const again = await request.post('/api/ingest/e', {
    headers: { 'content-type': 'text/plain', origin: siteUrl },
    data: JSON.stringify({
      api_key: publicKey,
      event: '$exception',
      distinct_id: 'carla',
      properties: {
        $exception_type: 'PaymentError',
        $exception_message: 'Order 99 failed <img src=x onerror=window.__pwned=1>',
        $exception_stack: [{ file: 'https://shop.test/assets/pay.ffff0000.js', function: 'charge', line: 1, column: 1 }],
      },
    }),
  });
  expect(again.status()).toBe(200);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-list-errors').locator('tr', { hasText: 'PaymentError' })).toContainText('Regression');

  // De otro workspace / inventado: 404.
  expect((await request.get(`/api/analytics/errors/${encodeURIComponent(`ap_nope~${'a'.repeat(32)}`)}`)).status()).toBe(404);
  expect((await page.goto(`/en/app/analytics/errors/${encodeURIComponent(`${projectId}~${'b'.repeat(32)}`)}`))?.status()).toBe(404);
  await page.goto(issuePath, { waitUntil: 'networkidle' });
  await expect(page.locator('.an-issue-controls .badge')).toHaveText('Regression');
  await shots(page, 'error-detail');
  expect(errors.filter((e) => !/404/.test(e)), errors.join('\n')).toEqual([]);
});

test('Cmd+K encuentra un error por su mensaje', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/analytics/errors', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').click();
  await dialog.getByRole('combobox').pressSequentially('Order 99 failed');
  await expect(dialog.getByRole('option', { name: /Order 99 failed/ }).first()).toBeVisible();
});

test('LLM: ejemplo vacío, valores limpios, por modelo, trazas y detalle', async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  await ensureProject(request, baseURL!, page);
  const errors = watchErrors(page);
  await page.goto('/en/app/analytics/llm', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-llm-example')).toContainText('$ai_generation');
  await shots(page, 'llm-empty');

  const gen = (props: Record<string, unknown>, who = 'dev') => ({ event: '$ai_generation', distinct_id: who, properties: props });
  const r = await request.post('/api/ingest/e', {
    headers: { 'content-type': 'text/plain', origin: siteUrl },
    data: JSON.stringify({
      api_key: publicKey,
      batch: [
        gen({ $ai_model: 'gpt-x', $ai_provider: 'openai', $ai_input_tokens: 100, $ai_output_tokens: 50, $ai_total_cost_usd: 0.5, $ai_latency: 1, $ai_trace_id: 't-1', $ai_input: '<script>window.__pwned=1</script> hi' }),
        gen({ $ai_model: 'gpt-x', $ai_provider: 'openai', $ai_input_tokens: 100, $ai_output_tokens: 50, $ai_total_cost_usd: 0.5, $ai_latency: 3, $ai_trace_id: 't-1', $ai_is_error: true, $ai_input: '<script>window.__pwned=1</script> hi' }),
        gen({ $ai_model: 'claude-y', $ai_provider: 'anthropic', $ai_input_tokens: -500, $ai_output_tokens: 'abc', $ai_total_cost_usd: 1e30, $ai_latency: 'slow' }),
      ],
    }),
  });
  expect(r.status()).toBe(200);
  await page.reload({ waitUntil: 'networkidle' });
  const stats = page.getByTestId('an-llm-stats');
  await expect(stats).toContainText('3');
  await expect(stats).toContainText('$1,001.00');
  const models = page.getByTestId('an-llm-models-table');
  await expect(models.locator('tr', { hasText: 'gpt-x' })).toContainText('1.00 s');
  await expect(models.locator('tr', { hasText: 'gpt-x' })).toContainText('3.00 s');
  await expect(models.locator('tr', { hasText: 'gpt-x' })).toContainText('50%');
  await shots(page, 'llm-overview');

  // Trazas: la fila lleva a sus generaciones.
  await page.getByRole('tab', { name: 'Traces' }).click();
  await page.getByTestId('an-llm-traces').getByRole('button', { name: 't-1' }).click();
  await expect(page.getByTestId('an-llm-generations').locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: /Remove trace filter/ }).click();
  await expect(page.getByTestId('an-llm-generations').locator('tbody tr')).toHaveCount(3);

  await page.getByLabel('Errors only').check();
  await expect(page.getByTestId('an-llm-generations').locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Errors only').uncheck();

  await page.getByTestId('an-llm-generations').getByRole('link', { name: 'gpt-x' }).last().click();
  await expect(page).toHaveURL(/\/app\/analytics\/llm\/\d+/);
  await expect(page.getByTestId('an-llm-detail')).toContainText('openai');
  await expect(page.getByText('<script>window.__pwned=1</script> hi')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await shots(page, 'llm-detail');
  expect((await page.goto('/en/app/analytics/llm/999999999'))?.status()).toBe(404);
  expect(errors.filter((e) => !/404/.test(e)), errors.join('\n')).toEqual([]);
});

test('web: filtros con chips y URL, canales, en vivo y web vitals', async ({ page, request, baseURL }) => {
  test.setTimeout(240_000);
  await ensureProject(request, baseURL!, page);
  const errors = watchErrors(page);
  const pv = (who: string, props: Record<string, unknown>) => ({ event: '$pageview', distinct_id: who, properties: { $session_id: `s-${who}`, ...props } });
  const r = await request.post('/api/ingest/e', {
    headers: { 'content-type': 'text/plain', origin: siteUrl },
    data: JSON.stringify({
      api_key: publicKey,
      batch: [
        pv('w1', { $current_url: 'https://shop.test/pricing', $host: 'shop.test', $pathname: '/pricing', $referrer: 'https://www.google.com/', $referring_domain: 'google.com' }),
        pv('w2', { $current_url: 'https://shop.test/pricing?utm_source=google&utm_medium=cpc', $host: 'shop.test', $pathname: '/pricing', utm_source: 'google', utm_medium: 'cpc', $referrer: '$direct', $referring_domain: '$direct' }),
        pv('w3', { $current_url: 'https://blog.test/post', $host: 'blog.test', $pathname: '/post', $referrer: 'https://l.facebook.com/', $referring_domain: 'l.facebook.com' }),
        pv('w4', { $current_url: 'https://blog.test/post?utm_medium=email', $host: 'blog.test', $pathname: '/post', utm_medium: 'email', $referrer: '$direct', $referring_domain: '$direct' }),
      ],
    }),
  });
  expect(r.status()).toBe(200);

  // Vitals reales desde el sitio: se mandan al salir de la página.
  const site = await page.context().newPage();
  await site.goto(`${siteUrl}/vitals-page`);
  await site.waitForTimeout(1500);
  await site.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect.poll(async () => (await sql(`SELECT COUNT(*) AS n FROM analytics_events WHERE project_id = ? AND event = '$web_vitals' AND pathname = '/vitals-page'`, [projectId]))[0].n, { timeout: 15_000 }).toBe(1);
  await site.close();
  // Una medición inventada e imposible no cuenta.
  await request.post('/api/ingest/e', {
    headers: { 'content-type': 'text/plain', origin: siteUrl },
    data: JSON.stringify({ api_key: publicKey, event: '$web_vitals', distinct_id: 'x', properties: { $pathname: '/vitals-page', $web_vitals_LCP_value: 1e12, $web_vitals_CLS_value: -3 } }),
  });

  await page.goto('/en/app/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-live-visitors')).toContainText(/visitor/);
  const channels = page.getByTestId('an-top-channels');
  await expect(channels).toContainText('Organic search');
  await expect(channels).toContainText('Paid search');
  await expect(channels).toContainText('Organic social');
  await expect(channels).toContainText('Email');
  const vitals = page.getByTestId('an-vitals');
  await expect(vitals.getByTestId('an-vitals-off')).toHaveCount(0);
  await expect(vitals.getByTestId('an-vital-FCP')).not.toContainText('No data');
  await expect(vitals.getByTestId('an-vitals-pages')).toContainText('/vitals-page');
  await shots(page, 'web-overview');

  // Clic en una fila: chip, URL y toda la página filtrada.
  await page.getByTestId('an-top-pages').getByRole('button', { name: '/post', exact: true }).click();
  await expect(page).toHaveURL(/[?&]path=%2Fpost/);
  const chips = page.getByTestId('an-web-chips');
  await expect(chips).toContainText('Path: /post');
  await expect(page.getByTestId('an-top-pages').locator('tbody tr')).toHaveCount(1);
  await expect(channels).not.toContainText('Paid search');
  await expect(channels).toContainText('Email');

  // Y el segundo filtro, después se recarga y sigue igual.
  await page.getByTestId('an-top-channels').getByRole('button', { name: 'Email' }).click();
  await expect(page).toHaveURL(/channel=email/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(chips).toContainText('Channel: Email');
  await expect(chips).toContainText('Path: /post');
  await expect(page.locator('.an-stats').first()).toContainText('1');
  await shots(page, 'web-filtered');

  // Filtros sin resultados: se explica, no se pide instalar el snippet.
  await page.goto('/en/app/analytics?country=ZZ', { waitUntil: 'networkidle' });
  await expect(page.getByText('No pageviews with these filters')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Install the snippet' })).toHaveCount(0);

  // Quitar el chip.
  await page.getByRole('button', { name: /Remove filter Country/ }).click();
  await expect(page).not.toHaveURL(/country=/);
  await expect(page.getByTestId('an-top-pages').locator('tbody tr').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('una persona sin la app queda afuera de todo; textos en es y pt', async ({ page, request, baseURL, browser }) => {
  test.setTimeout(180_000);
  await ensureProject(request, baseURL!, page);
  for (const locale of ['es', 'pt']) {
    for (const path of ['surveys', 'errors', 'llm']) {
      const errors = watchErrors(page);
      await page.goto(`/${locale}/app/analytics/${path}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.ui-page-title')).not.toBeEmpty();
      await noHorizontalScroll(page, `${locale} ${path}`);
      expect(errors, errors.join('\n')).toEqual([]);
    }
  }
  // Otra sesión, sin membresía en este workspace.
  const ctx = await browser.newContext({ baseURL: baseURL! });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: `outsider-${uid()}@example.com`, url: baseURL! }]);
  const outsider = ctx.request;
  const { surveys } = (await (await request.get(`/api/analytics/surveys?project=${projectId}`)).json()) as { surveys: Array<{ id: string }> };
  for (const url of [
    `/api/analytics/surveys?project=${projectId}`,
    `/api/analytics/surveys/${surveys[0].id}`,
    `/api/analytics/surveys/${surveys[0].id}/results`,
    `/api/analytics/surveys/${surveys[0].id}/export`,
    `/api/analytics/errors?project=${projectId}`,
    `/api/analytics/llm?project=${projectId}`,
    `/api/analytics/llm/generations?project=${projectId}`,
    `/api/analytics/web-live?project=${projectId}`,
    `/api/analytics/web-vitals?project=${projectId}`,
  ]) {
    const res = await outsider.get(url);
    expect([401, 403, 404], `${url} → ${res.status()}`).toContain(res.status());
  }
  const del = await outsider.delete(`/api/analytics/surveys/${surveys[0].id}`);
  expect([401, 403, 404]).toContain(del.status());
  await ctx.close();
});
