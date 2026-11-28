import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Analytics: descargar resultados en CSV, Excel y JSON desde el editor (tabla
 * y gráfico), y la ruta que vuelve a correr la consulta para la descarga
 * (editor y pregunta guardada). En 1280 y 390, claro y oscuro.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const tag = uid();

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ request }) => {
  for (const n of ['Ana', 'Beto']) {
    const r = await request.post('/api/crm/contacts', { data: { firstName: `${n} ${tag}`, email: `${n.toLowerCase()}-${tag}@example.com` } });
    expect(r.ok(), await r.text()).toBe(true);
  }
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function runSql(page: Page, sql: string) {
  await page.goto('/en/app/analytics/questions/new?mode=sql', { waitUntil: 'networkidle' });
  const editor = page.getByTestId('bi-sql-input');
  await editor.click();
  await editor.fill(sql);
  await editor.press('Escape');
  const done = page.waitForResponse((r) => r.url().includes('/api/bi/query') && r.request().method() === 'POST');
  await page.getByTestId('bi-run').click();
  expect((await done).status()).toBe(200);
}

async function download(page: Page, format: 'csv' | 'xlsx' | 'json') {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`bi-download-${format}`).click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), bytes: readFileSync(path) };
}

const SQL = `SELECT first_name, email, created_at FROM contacts WHERE instr(first_name, '${tag}') > 0 ORDER BY first_name`;

test('tabla: descarga CSV, Excel y JSON con las filas del resultado', async ({ page }) => {
  const errors = watchErrors(page);
  await runSql(page, SQL);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByTestId('bi-table')).toBeVisible();
  const group = page.getByTestId('bi-download');
  await expect(group).toBeVisible();

  const csv = await download(page, 'csv');
  expect(csv.name).toBe('results.csv');
  const lines = csv.bytes.toString('utf8').replace(/^﻿/, '').split('\n');
  expect(lines[0]).toBe('first_name,email,created_at');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain(`ana-${tag}@example.com`);

  const xlsx = await download(page, 'xlsx');
  expect(xlsx.name).toBe('results.xlsx');
  expect(xlsx.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(xlsx.bytes.toString('latin1')).toContain(`beto-${tag}@example.com`);

  const json = await download(page, 'json');
  const rows = JSON.parse(json.bytes.toString('utf8')) as Array<Record<string, string>>;
  expect(rows.map((r) => r.email)).toEqual([`ana-${tag}@example.com`, `beto-${tag}@example.com`]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('gráfico: la descarga también está debajo del gráfico, con el nombre de la pregunta', async ({ page }) => {
  await runSql(page, `SELECT first_name, length(email) AS chars FROM contacts WHERE instr(first_name, '${tag}') > 0`);
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await expect(page.getByTestId('bi-chart')).toBeVisible();
  await page.getByLabel('Question name').fill(`Largo de emails ${tag}`);
  const csv = await download(page, 'csv');
  expect(csv.name).toBe(`Largo-de-emails-${tag}.csv`);
  expect(csv.bytes.toString('utf8')).toContain('first_name,chars');
});

test('la ruta de descarga vuelve a correr la consulta (editor y pregunta guardada)', async ({ request }) => {
  const adhoc = await request.post('/api/bi/query', { data: { source: 'zerosoft', query: { kind: 'sql', sql: SQL }, format: 'xlsx', name: 'Contactos' } });
  expect(adhoc.status(), await adhoc.text()).toBe(200);
  expect(adhoc.headers()['content-type']).toContain('spreadsheetml');
  expect(adhoc.headers()['content-disposition']).toContain('filename="Contactos.xlsx"');
  expect((await adhoc.body()).subarray(0, 2).toString('latin1')).toBe('PK');

  const saved = await (await request.post('/api/bi/questions', { data: { name: `Export ${tag}`, query: { kind: 'sql', sql: SQL } } })).json();
  const res = await request.post(`/api/bi/questions/${saved.question.id}/run`, { data: { format: 'json' } });
  expect(res.status(), await res.text()).toBe(200);
  expect(res.headers()['content-disposition']).toContain(`filename="Export-${tag}.json"`);
  const rows = (await res.json()) as Array<Record<string, string>>;
  expect(rows).toHaveLength(2);

  // Sin formato válido sigue siendo la respuesta JSON de siempre.
  const plain = await request.post(`/api/bi/questions/${saved.question.id}/run`, { data: { format: 'pdf' } });
  expect((await plain.json()).result.rows).toHaveLength(2);
});

test('tablero: cada tarjeta descarga su resultado; Esc cierra el menú', async ({ page, request }) => {
  const errors = watchErrors(page);
  const { question } = await (await request.post('/api/bi/questions', { data: { name: `Card ${tag}`, query: { kind: 'sql', sql: SQL } } })).json();
  const { dashboard } = await (await request.post('/api/bi/dashboards', { data: { name: `Downloads ${tag}` } })).json();
  const added = await request.post(`/api/bi/dashboards/${dashboard.id}/cards`, { data: { questionId: question.id } });
  expect(added.ok(), await added.text()).toBe(true);
  await page.goto(`/en/app/analytics/dashboards/${dashboard.id}`, { waitUntil: 'networkidle' });
  const card = page.getByTestId('bi-grid').locator('article').filter({ has: page.getByRole('link', { name: `Card ${tag}` }) });
  const toggle = card.getByTestId('bi-card-download');
  await toggle.click();
  const menu = card.getByTestId('bi-download');
  await expect(menu).toBeVisible();
  const csv = await download(page, 'csv');
  expect(csv.name).toBe(`Card-${tag}.csv`);
  expect(csv.bytes.toString('utf8').replace(/^\ufeff/, '').split('\n')).toHaveLength(3);
  await toggle.focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('390 px en oscuro: la descarga entra sin scroll lateral', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await runSql(page, SQL);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const group = page.getByTestId('bi-download');
  await group.scrollIntoViewIfNeeded();
  await expect(group.getByRole('button')).toHaveCount(3);
  const box = await group.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  await ctx.close();
});
