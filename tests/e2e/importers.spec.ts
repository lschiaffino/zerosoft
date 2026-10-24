import http from 'http';
import { expect, test } from '@playwright/test';
import { buildZip } from '../../lib/zip-reader';

/**
 * Importadores de punta a punta en la UI: Track (CSV de Linear y GitHub),
 * Cal (Calendly) y Docs (export de Notion). Las APIs de terceros son un mock
 * local en PORT + 1 (playwright.config.ts apunta IMPORT_*_API_URL ahí): nada
 * sale a internet.
 */

const PORT = Number(process.env.E2E_PORT) || 3210;
const uid = () => Math.random().toString(36).slice(2, 8);

// Recorren varias páginas que en `next dev` compilan la primera vez.
test.describe.configure({ timeout: 180_000 });

let server: http.Server | null = null;
const seen: string[] = [];

function mockRoutes(path: string, auth: string | undefined): unknown {
  seen.push(`${path} ${auth ?? ''}`);
  const routes: Record<string, unknown> = {
    '/github/repos/acme/e2e': { full_name: 'acme/e2e' },
    '/github/repos/acme/e2e/issues': [
      { number: 1, title: 'GH crash on save', body: 'Steps', state: 'open', created_at: '2024-01-01T00:00:00Z', labels: [{ name: 'bug', color: 'd73a4a' }] },
      { number: 2, title: 'GH a PR', state: 'open', created_at: '2024-01-02T00:00:00Z', pull_request: {} },
    ],
    '/github/repos/acme/e2e/issues/comments': [
      { id: 7, body: 'Seen it too', created_at: '2024-01-03T00:00:00Z', issue_url: 'https://api.github.com/repos/acme/e2e/issues/1', user: { login: 'octo' } },
    ],
    '/calendly/users/me': { resource: { uri: 'https://api.calendly.com/users/U1' } },
    '/calendly/user_availability_schedules': {
      collection: [{ uri: 'S1', name: 'Working hours', default: true, timezone: 'UTC', rules: [{ type: 'wday', wday: 'monday', intervals: [{ from: '09:00', to: '17:00' }] }] }],
    },
    '/calendly/event_types': {
      collection: [
        {
          uri: `https://api.calendly.com/event_types/E2E-${uid()}`,
          name: 'Calendly discovery',
          slug: `discovery-${uid()}`,
          duration: 45,
          description_plain: 'Imported',
          active: true,
          type: 'StandardEventType',
          locations: [{ kind: 'google_conference' }],
          custom_questions: [{ name: 'Company', type: 'string', enabled: true, required: true, position: 0 }],
        },
      ],
      pagination: {},
    },
  };
  return routes[path];
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = mockRoutes(url.pathname, req.headers.authorization);
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? { message: 'Not Found' }));
  });
  await new Promise<void>((resolve) => server!.listen(PORT + 1, '127.0.0.1', () => resolve()));
});

// Un import abierto (de una corrida que falló) se retoma al entrar: se cancela antes.
test.beforeEach(async ({ request }) => {
  for (const app of ['track', 'cal', 'docs']) {
    const res = await request.get(`/api/import/jobs?app=${app}`);
    if (!res.ok()) continue;
    const { jobs } = (await res.json()) as { jobs: Array<{ id: string; status: string }> };
    for (const j of jobs.filter((x) => ['uploading', 'fetching', 'preview', 'importing'].includes(x.status))) {
      await request.delete(`/api/import/jobs/${j.id}`);
    }
  }
});

test.afterAll(() => {
  server?.close();
});

test('Track: CSV de Linear con vista previa, import y export', async ({ page, request }) => {
  const title = `Linear CSV ${uid()}`;
  const team = `Imported team ${uid()}`;
  const csv = [
    'ID,Team,Title,Description,Status,Estimate,Priority,Assignee,Labels,Created',
    `IMP-1,${team},${title},From Linear,In Review,3,High,demo@zerosoft.ai,"Infra, DX",2024-04-28T10:00:00.000Z`,
    `IMP-2,${team},Second ${title},,Todo,,Low,nobody@else.test,,2024-04-29T10:00:00.000Z`,
  ].join('\n');

  await page.goto('/en/app/track/settings?tab=import');
  const panel = page.getByTestId('track-import');
  await expect(panel).toBeVisible();
  await page.getByLabel('Import from').selectOption('linear_csv');
  await page.getByLabel('CSV file').setInputFiles({ name: 'linear.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByLabel('Title *')).toHaveValue('Title');
  await page.getByRole('button', { name: 'Preview' }).click();

  const preview = page.getByTestId('track-import-preview');
  await expect(preview).toBeVisible({ timeout: 45_000 });
  await expect(preview.getByRole('cell', { name: 'In Review' })).toBeVisible();
  await expect(preview.getByText('nobody@else.test')).toBeVisible();
  await preview.getByRole('button', { name: 'Import 2 issues' }).click();

  const done = page.getByTestId('track-import-done');
  await expect(done).toBeVisible({ timeout: 45_000 });
  await expect(done).toContainText('2 issues');
  await done.getByRole('link', { name: `Open ${team}` }).click();
  await expect(page).toHaveURL(/\/app\/track\/projects\//, { timeout: 45_000 });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 45_000 });

  const exported = await request.get('/api/track/export');
  expect(exported.ok()).toBe(true);
  expect(await exported.text()).toContain(title);
});

test('Track: GitHub Issues con token (API mockeada)', async ({ page }) => {
  await page.goto('/en/app/track/settings?tab=import');
  await page.getByLabel('Import from').selectOption('github');
  await page.getByLabel('Repository').fill('acme/e2e');
  await page.getByLabel('GitHub token').fill('ghp_e2e_token_123');
  await expect(page.getByText('Used only for this import')).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('track-import-preview');
  await expect(preview).toBeVisible({ timeout: 45_000 });
  await preview.getByRole('button', { name: /^Import \d+ issues$/ }).click();
  await expect(page.getByTestId('track-import-done')).toBeVisible({ timeout: 45_000 });
  expect(seen.some((s) => s.startsWith('/github/repos/acme/e2e ') && s.endsWith('Bearer ghp_e2e_token_123'))).toBe(true);
  // El token no vuelve a la página.
  expect(await page.content()).not.toContain('ghp_e2e_token_123');
});

test('Cal: import desde Calendly (API mockeada)', async ({ page }) => {
  await page.goto('/en/app/calendar/settings?tab=import');
  await page.getByLabel('Calendly personal access token').fill('cly_e2e_token_123');
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('cal-import-preview');
  await expect(preview).toBeVisible({ timeout: 45_000 });
  await expect(preview.getByText('Calendly discovery')).toBeVisible();
  await preview.getByRole('button', { name: 'Import', exact: true }).click();
  const done = page.getByTestId('cal-import-done');
  await expect(done).toBeVisible({ timeout: 45_000 });
  await done.getByRole('link', { name: 'Go to event types' }).click();
  await expect(page).toHaveURL(/\/app\/calendar\/event-types$/, { timeout: 45_000 });
  await expect(page.getByText('Calendly discovery').first()).toBeVisible({ timeout: 45_000 });
});

test('Docs: export de Notion con árbol, links, imagen y base con filas', async ({ page, request }) => {
  const root = `Notion root ${uid()}`;
  const hex = (c: string) => c.repeat(32);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const home = `${root} ${hex('a')}`;
  const child = `Child ${hex('b')}`;
  const dbName = `Tareas ${uid()}`;
  const dbFile = `${dbName} ${hex('c')}`;
  const zip = buildZip([
    { name: `Export/${home}/${dbFile}.csv`, data: 'Nombre,Estado\nEscribir spec,Listo\nRevisar,En curso\n' },
    { name: `Export/${home}/${dbFile}/Escribir spec ${hex('d')}.md`, data: '# Escribir spec\n\nEstado: Listo\n\nCuerpo de la fila' },
    { name: `Export/${home}.md`, data: `# ${root}\n\nGo to [Child](${encodeURIComponent(home)}/${encodeURIComponent(child)}.md)\n\n![pic](${encodeURIComponent(home)}/pic.png)\n`, deflate: true },
    { name: `Export/${home}/${child}.md`, data: '# Child\n\nNested page' },
    { name: `Export/${home}/pic.png`, data: png },
  ]);

  await page.goto('/en/app/docs');
  await page.getByTestId('docs-import-link').click();
  await expect(page).toHaveURL(/\/app\/docs\/import$/, { timeout: 45_000 });
  await page.getByLabel('Export file (.zip)').setInputFiles({ name: 'notion.zip', mimeType: 'application/zip', buffer: zip });
  await page.getByRole('button', { name: 'Upload and preview' }).click();
  const preview = page.getByTestId('notion-import-preview');
  await expect(preview).toBeVisible({ timeout: 45_000 });
  await expect(preview.getByText(root)).toBeVisible();
  await expect(preview.getByText(dbName)).toBeVisible();
  // La fila no aparece como página: va como cuerpo de la fila.
  await expect(preview.getByText('Escribir spec')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Import 3 pages' }).click();
  const done = page.getByTestId('notion-import-done');
  await expect(done).toBeVisible({ timeout: 45_000 });
  await done.getByRole('link', { name: `Open ${root}` }).click();
  await expect(page).toHaveURL(/\/app\/docs\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await expect(page.locator('a[data-page]', { hasText: 'Child' }).first()).toBeVisible();
  const img = page.locator('.docs-blocks img').first();
  await expect(img).toBeVisible();
  // Que la imagen cargue de verdad (en `next start` lo subido a public/uploads daba 404).
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)), { timeout: 15_000 }).toBeGreaterThan(0);

  // La base: nombre del CSV, Estado como status y la fila con su página como cuerpo.
  const found = (await (await request.get(`/api/docs/search?q=${encodeURIComponent(dbName)}`)).json()) as { rows: Array<{ id: string; title: string }> };
  const dbPage = found.rows.find((r) => r.title === dbName)!;
  expect(dbPage).toBeTruthy();
  const { content } = (await (await request.get(`/api/docs/pages/${dbPage.id}`)).json()) as {
    content: Array<{ type: string; db?: { title?: string; properties: Array<{ id: string; type: string }>; rows: Array<{ values: Record<string, unknown>; body?: Array<{ content: string }> }> } }>;
  };
  const db = content[0].db!;
  expect(db.title).toBe(dbName);
  expect(db.properties.map((p) => p.type)).toEqual(['title', 'status']);
  const row = db.rows.find((r) => r.values[db.properties[0].id] === 'Escribir spec')!;
  expect(row.body?.map((b) => b.content)).toEqual(['Cuerpo de la fila']);
  await page.goto(`/en/app/docs/${dbPage.id}`);
  await expect(page.getByPlaceholder('Untitled database').first()).toHaveValue(dbName, { timeout: 45_000 });
});
