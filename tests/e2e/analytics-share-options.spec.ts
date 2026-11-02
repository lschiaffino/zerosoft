import { expect, test, type Browser } from '@playwright/test';

/** Opciones de un link público: tema, leyenda, crédito, contraseñas, token nuevo e historial. */
const uid = () => Math.random().toString(36).slice(2, 8);

test.describe.configure({ mode: 'serial' });

let projectId = '';
let insightId = '';
let shareId = '';
let token = '';

test.beforeAll(async ({ request }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Share ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  for (const event of ['a', 'b']) await request.post('/api/ingest/e', { headers: { origin: 'http://shop.test' }, data: { api_key: project.publicKey, event, distinct_id: 'u' } });
  const { insight } = await (await request.post('/api/analytics/insights', { data: { projectId, name: 'Shared', query: { kind: 'trends', series: [{ event: 'a' }, { event: 'b' }], dateRange: { from: '-1d' } } } })).json();
  insightId = insight.id;
});

const anon = (browser: Browser, baseURL: string) => browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });

test('crear, tema, leyenda y crédito, desde el cuadro de compartir', async ({ page, browser, baseURL, request }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto(`/en/app/analytics/insights/${insightId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Public link' });
  await dialog.getByRole('button', { name: 'Create link' }).or(dialog.locator('.ui-modal-foot .btn-primary')).first().click();
  await expect(dialog.getByTestId('an-share-row')).toHaveCount(1);
  const list = (await (await request.get(`/api/analytics/shares?project=${projectId}&insight=${insightId}`)).json()) as { shares: Array<{ id: string; token: string }> };
  shareId = list.shares[0].id;
  token = list.shares[0].token;

  await dialog.getByLabel('Theme').selectOption('dark');
  await expect(dialog.getByLabel('Theme')).toHaveValue('dark');
  await dialog.getByLabel('Show legend').uncheck();
  await expect(dialog.getByLabel('Show legend')).not.toBeChecked();
  await dialog.getByLabel('Show zerosoft credit').uncheck();
  await expect(dialog.getByLabel('Show zerosoft credit')).not.toBeChecked();

  const ctx = await anon(browser, baseURL!);
  const p = await ctx.newPage();
  await p.goto(`/en/stats/a/${token}?refresh=true`, { waitUntil: 'networkidle' });
  await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(p.locator('.an-legend')).toHaveCount(0);
  await expect(p.getByTestId('an-share-brand')).toHaveCount(0);
  await ctx.close();

  await dialog.getByLabel('Show legend').check();
  await expect(dialog.getByLabel('Show legend')).toBeChecked();
  await dialog.getByLabel('Show zerosoft credit').check();
  await expect(dialog.getByLabel('Show zerosoft credit')).toBeChecked();
  const again = await anon(browser, baseURL!);
  const q = await again.newPage();
  await q.goto(`/en/stats/a/${token}?refresh=true`, { waitUntil: 'networkidle' });
  await expect(q.locator('.an-legend')).toHaveCount(1);
  await expect(q.getByTestId('an-share-brand')).toBeVisible();
  await again.close();
});

test('contraseña: pide, equivocarse no abre, acertar sí, y al quitarla se corta el acceso guardado', async ({ page, browser, baseURL, request }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto(`/en/app/analytics/insights/${insightId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Public link' });
  await dialog.getByLabel('Note, such as who gets it').fill('For Ana');
  await dialog.getByRole('button', { name: 'Create password' }).click();
  const password = await dialog.getByTestId('an-share-password').innerText();
  expect(password.length).toBeGreaterThan(8);
  await expect(dialog).toContainText('For Ana');

  const ctx = await anon(browser, baseURL!);
  const p = await ctx.newPage();
  await p.goto(`/en/stats/a/${token}?refresh=true`, { waitUntil: 'networkidle' });
  await expect(p.getByTestId('an-share-locked')).toBeVisible();
  // Bloqueado no llega ningún dato al HTML.
  expect(await p.content()).not.toContain('Shared');
  await p.getByLabel('Password').fill('wrong');
  await p.getByRole('button', { name: 'Open' }).click();
  await expect(p.getByRole('alert')).toContainText('not right');
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Open' }).click();
  await expect(p.getByTestId('an-share-public')).toBeVisible({ timeout: 15_000 });
  await p.reload({ waitUntil: 'networkidle' });
  await expect(p.getByTestId('an-share-public')).toBeVisible();

  // El hash nunca sale por la API.
  const raw = await (await request.get(`/api/analytics/shares?project=${projectId}&insight=${insightId}`)).text();
  expect(raw).not.toContain(password);
  expect(raw).not.toContain('hash');

  // Quitarla: ese navegador ya no entra con su acceso, con otra contraseña activa.
  await dialog.getByRole('button', { name: 'Create password' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove' })).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Remove' }).first().click();
  await expect(dialog.getByRole('button', { name: 'Remove' })).toHaveCount(1);
  await p.reload({ waitUntil: 'networkidle' });
  await expect(p.getByTestId('an-share-locked')).toBeVisible();
  await ctx.close();
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('un link nuevo corta el anterior y todo queda en el historial', async ({ request, browser, baseURL }) => {
  const res = await request.patch(`/api/analytics/shares/${shareId}`, { data: { rotateToken: true } });
  const { share } = (await res.json()) as { share: { token: string } };
  expect(share.token).not.toBe(token);
  const ctx = await anon(browser, baseURL!);
  const p = await ctx.newPage();
  expect((await p.goto(`/en/stats/a/${token}`))?.status()).toBe(404);
  expect((await p.goto(`/en/stats/a/${share.token}`))?.status()).toBe(200);
  await ctx.close();
  const { log } = (await (await request.get(`/api/analytics/shares?project=${projectId}&insight=${insightId}`)).json()) as { log: Array<{ action: string }> };
  const actions = log.map((l) => l.action);
  for (const a of ['enabled', 'options', 'password_added', 'password_removed', 'token_rotated']) expect(actions).toContain(a);
});

test('el embed avisa su alto a la página que lo contiene', async ({ page, baseURL, request }) => {
  const { shares } = (await (await request.get(`/api/analytics/shares?project=${projectId}&insight=${insightId}`)).json()) as { shares: Array<{ token: string }> };
  await page.goto(`${baseURL}/en`, { waitUntil: 'domcontentloaded' });
  const height = await page.evaluate(
    (src) =>
      new Promise<number>((resolve) => {
        addEventListener('message', (e) => {
          if (e.data?.event === 'zs:dimensions' && e.data.name === 'zs-test') resolve(e.data.height);
        });
        const f = document.createElement('iframe');
        f.name = 'zs-test';
        f.src = src;
        document.body.appendChild(f);
      }),
    `/en/stats/a/${shares[0].token}?embed=1`,
  );
  expect(height).toBeGreaterThan(50);
});
