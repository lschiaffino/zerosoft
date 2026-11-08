import { expect, test, type Page } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * Analytics (tipo Metabase) de punta a punta: constructor, editor SQL con
 * autocompletado, preguntar con palabras (modelo falso), tablero con filtro,
 * link público, una base Postgres real en proceso y 390 px en claro y oscuro.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.BI_SHOTS_DIR;
const PG_PORT = Number(process.env.E2E_PORT || 3210) + 41;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test.describe.configure({ timeout: 120_000 });

const tag = uid();

test.beforeAll(async ({ request }) => {
  for (const n of ['Ana', 'Beto', 'Caro']) {
    const r = await request.post('/api/crm/contacts', { data: { firstName: `${n} ${tag}`, email: `${n.toLowerCase()}-${tag}@example.com` } });
    expect(r.ok(), await r.text()).toBe(true);
  }
});

test('constructor: cuenta contactos por mes, guarda y aparece en la lista y el sidebar', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/en/app/analytics/questions/new', { waitUntil: 'networkidle' });
  const builder = page.getByTestId('bi-builder');
  await expect(builder).toBeVisible();
  await builder.getByRole('combobox', { name: 'Table' }).selectOption('contacts');
  await builder.getByRole('button', { name: '+ Add metric' }).click();
  await builder.getByRole('button', { name: '+ Add grouping' }).click();
  const compiled = page.waitForResponse((r) => r.url().includes('/api/bi/compile') && r.request().postData()?.includes('created_at') === true, { timeout: 60_000 });
  await builder.getByRole('combobox', { name: 'Column' }).last().selectOption('created_at');
  const res = await compiled;
  expect(res.status(), await res.text()).toBe(200);
  // El SQL del constructor se ve siempre.
  await expect(page.getByTestId('bi-sql-shown')).toContainText('COUNT(*)');
  await page.getByTestId('bi-run').click();
  await expect(page.getByTestId('bi-chart').or(page.getByTestId('bi-table')).or(page.getByTestId('bi-number'))).toBeVisible();
  const name = `Contacts by month ${tag}`;
  await page.getByLabel('Question name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/analytics\/questions\/biq_/);
  await page.goto('/en/app/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('bi-items').getByRole('link', { name })).toBeVisible();
  await expect(page.getByTestId('bi-branch').getByRole('link', { name })).toBeVisible();
  await shot(page, 'home-1280');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('SQL: autocompletado con teclado, variables y error claro', async ({ page }) => {
  await page.goto('/en/app/analytics/questions/new?mode=sql', { waitUntil: 'networkidle' });
  const editor = page.getByTestId('bi-sql-input');
  await editor.click();
  await editor.pressSequentially('SELECT COUNT(*) AS n FROM cont');
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option', { name: /contacts/ })).toBeVisible();
  await editor.press('Tab');
  await expect(editor).toHaveValue('SELECT COUNT(*) AS n FROM contacts');
  await editor.pressSequentially(' WHERE 1=1 [[AND first_name = {{who}}]]');
  await expect(page.locator('.bi-param code')).toHaveText('{{who}}');
  await editor.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('bi-number')).toBeVisible();
  // Escribir no está permitido: el error lo dice.
  await editor.fill('DELETE FROM contacts');
  await page.getByTestId('bi-run').click();
  await expect(page.getByTestId('bi-run-error')).toContainText('SELECT');
  await shot(page, 'sql-1280');
});

test('preguntar con palabras: se ve el SQL y el resultado', async ({ page }) => {
  await page.goto('/en/app/analytics', { waitUntil: 'networkidle' });
  await page.getByLabel('Ask a question about your data').fill('how many contacts per month');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByTestId('bi-explanation')).toBeVisible();
  await expect(page.getByTestId('bi-sql-input')).toHaveValue(/FROM contacts/);
  await expect(page.getByTestId('bi-chart').or(page.getByTestId('bi-table'))).toBeVisible();
});

test('tablero: tarjeta, filtro conectado, link público sin la consulta', async ({ page, request }) => {
  const errors = watchErrors(page);
  const { question } = await (
    await request.post('/api/bi/questions', {
      data: { name: `People named ${tag}`, query: { kind: 'sql', sql: `SELECT COUNT(*) AS people FROM contacts WHERE instr(first_name, '${tag}') > 0 [[AND instr(first_name, {{who}}) > 0]]`, params: [{ name: 'who', type: 'text' }] } },
    })
  ).json();
  await page.goto('/en/app/analytics', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New dashboard' }).click();
  const dlg = page.getByRole('dialog', { name: 'New dashboard' });
  await dlg.getByLabel('Name').fill(`Board ${tag}`);
  await dlg.getByLabel('Name').press('Enter');
  await expect(page).toHaveURL(/\/dashboards\/bidb_.*edit=1/);
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByRole('dialog', { name: 'Add question' }).getByRole('button', { name: `People named ${tag}` }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
  const fd = page.getByRole('dialog', { name: 'Add filter' });
  await fd.getByLabel('Name').fill('Who');
  await fd.getByRole('button', { name: 'Create' }).click();
  await page.locator('.bi-mapping select').selectOption(`param:who`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Board ${tag}` })).toBeVisible();
  const grid = page.getByTestId('bi-grid');
  await expect(grid.locator('.bi-number-value')).toHaveText('3');
  const filter = page.getByRole('group', { name: 'Filters' }).getByRole('textbox');
  await filter.fill(`Ana ${tag}`);
  await filter.press('Enter');
  await expect(grid.locator('.bi-number-value')).toHaveText('1');
  await expect(page).toHaveURL(/f_who=/);
  await shot(page, 'dashboard-1280');

  // Link público: el demo es owner.
  await page.getByRole('button', { name: 'Share' }).click();
  const share = page.getByRole('dialog', { name: 'Public link' });
  await share.getByRole('button', { name: 'Create link' }).click();
  const url = await share.getByTestId('bi-share-url').getByRole('textbox').first().inputValue();
  expect(url).toMatch(/\/stats\/bi\/[A-Za-z0-9_-]{43}$/);
  await page.keyboard.press('Escape');
  await expect(share).toBeHidden();
  const pub = await page.context().newPage();
  await pub.goto(url);
  await expect(pub.getByTestId('bi-public')).toContainText(`Board ${tag}`);
  await expect(pub.locator('.bi-number-value')).toHaveText('3');
  expect(await pub.content()).not.toContain('instr(first_name');
  await pub.close();
  void question;
  expect(errors, errors.join('\n')).toEqual([]);
});

test.describe('base Postgres externa', () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  test.beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`CREATE TABLE orders (id serial PRIMARY KEY, customer text, total numeric(10,2));
      INSERT INTO orders (customer, total) VALUES ('Acme', 120.5), ('Globex', 80), ('Acme', 10);`);
    server = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1' });
    await server.start();
  });
  test.afterAll(async () => {
    await server?.stop();
    await db?.close();
  });

  test('conectar, ver tablas y preguntar con SQL', async ({ page }) => {
    await page.goto('/en/app/analytics/data', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Connect a database' }).click();
    const dlg = page.getByRole('dialog', { name: 'Connect a database' });
    await dlg.getByLabel('Name').fill(`Shop DB ${tag}`);
    await dlg.getByLabel('Host').fill('127.0.0.1');
    await dlg.getByLabel('Port').fill(String(PG_PORT));
    await dlg.getByLabel('Database').fill('postgres');
    await dlg.getByLabel('User').fill('postgres');
    await dlg.getByLabel('Password').fill('secret');
    await dlg.getByLabel('TLS').selectOption('disable');
    await dlg.getByRole('button', { name: 'Test and save' }).click();
    await expect(dlg).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId('bi-dbs')).toContainText(`Shop DB ${tag}`);
    await expect(page.getByTestId('bi-dbs')).not.toContainText('secret');

    await page.goto('/en/app/analytics/questions/new?mode=sql', { waitUntil: 'networkidle' });
    await page.getByRole('combobox', { name: 'Data' }).selectOption({ label: `Shop DB ${tag}` });
    await expect(page.getByRole('complementary', { name: 'Tables' })).toContainText('orders');
    await page.getByTestId('bi-sql-input').fill('SELECT customer, SUM(total) AS total FROM orders GROUP BY customer ORDER BY customer');
    await page.getByTestId('bi-run').click();
    await expect(page.getByTestId('bi-chart').or(page.getByTestId('bi-table'))).toBeVisible();
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(page.getByTestId('bi-table')).toContainText('Acme');
    // Escribir en la base externa falla (transacción de solo lectura).
    await page.getByTestId('bi-sql-input').fill("SELECT * FROM (SELECT 1) x; DELETE FROM orders");
    await page.getByTestId('bi-run').click();
    await expect(page.getByTestId('bi-run-error')).toBeVisible();
    expect((await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n).toBe(3);
  });

  test('un host privado se rechaza si no está permitido (API)', async ({ request }) => {
    const res = await request.post('/api/bi/databases', { data: { name: 'Meta', engine: 'postgres', host: '169.254.169.254', port: 5432, dbname: 'x', username: 'x', password: 'x', ssl: 'disable' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('private_host');
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`390px y 1280px en ${theme}: sin scroll horizontal`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const [w, h] of [
      [390, 844],
      [1280, 900],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const path of ['/en/app/analytics', '/en/app/analytics/questions/new', '/en/app/analytics/questions/new?mode=sql', '/en/app/analytics/data']) {
        await page.goto(path, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await noHorizontalScroll(page);
        await shot(page, `${path.split('/').pop()!.replace(/[?=&]/g, '-')}-${w}-${theme}`);
      }
    }
  });
}
