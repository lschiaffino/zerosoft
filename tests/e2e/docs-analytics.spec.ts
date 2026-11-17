import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Docs con el kit (el formato de Lines): páginas creadas,
 * ediciones, vistas, lectores y comentarios de lo sembrado en un teamspace
 * propio, el cambio de período, el vacío, el sitio publicado (admins) y
 * 390 px sin scroll horizontal. Las páginas se crean por la API; las marcas
 * de edición, las vistas y los comentarios se siembran en la base.
 */

ownWorkspace('docs-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const DAY = 86_400_000;
const hour = (ago: number) => new Date(Date.now() - ago).toISOString().slice(0, 13);
const day = (ago: number) => new Date(Date.now() - ago).toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let space = '';

async function seed(page: Page) {
  if (space) return;
  const ts = await page.request.post('/api/docs/teamspaces', { data: { name: `Analítica ${uid()}` } });
  expect(ts.ok(), await ts.text()).toBe(true);
  const tsId = ((await ts.json()) as { id: string }).id;
  const create = async (title: string) => {
    const res = await page.request.post('/api/docs/pages', { data: { title, teamspace_id: tsId } });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { id: string }).id;
  };
  const a = await create(`Guía ${uid()}`);
  const b = await create(`Notas ${uid()}`);
  const [row] = await sql('SELECT user_id FROM docs_pages WHERE id = ?', [a]);
  const ws = String(row.user_id);
  // b se creó hace 20 días (queda afuera de 7).
  await sql('UPDATE docs_pages SET created_at = ? WHERE id = ?', [new Date(Date.now() - 20 * DAY).toISOString(), b]);
  // Ediciones: dos horas en a (hace 1 día), una en b hace 20 días.
  for (const [id, ago] of [
    [a, DAY],
    [a, DAY + 3_600_000],
    [b, 20 * DAY],
  ] as const) {
    await sql('INSERT INTO docs_edit_marks (workspace_id, page_id, person_id, hour, saves) VALUES (?, ?, ?, ?, 1)', [ws, id, ws, hour(ago)]);
  }
  await sql('INSERT INTO docs_page_views (page_id, viewer_id, day, views, last_at) VALUES (?, ?, ?, ?, ?)', [a, ws, day(DAY), 3, new Date().toISOString()]);
  await sql('INSERT INTO docs_comments (id, page_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), a, ws, 'x', new Date(Date.now() - DAY).toISOString()]);
  await sql('INSERT INTO docs_site_views (workspace_id, page_id, day, visitor, views) VALUES (?, ?, ?, ?, ?)', [ws, '', day(0), `v-${uid()}`, 2]);
  space = tsId;
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

test('Docs: analítica con el kit, teamspace, período, sitio y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed(page);

  // El sidebar lleva a la analítica.
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await expect(page.locator('a[href$="/app/docs/analytics"]').first()).toBeAttached();
  await page.goto('/en/app/docs/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByRole('img', { name: /^Edits and new pages per day/ })).toBeVisible();

  // Filtro por teamspace: solo lo sembrado.
  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Teamspace').selectOption(space);
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/space=/);
  expect(await kpi(page, 'Pages created')).toBe(2);
  expect(await kpi(page, 'Edits')).toBe(3);
  expect(await kpi(page, 'Pages edited')).toBe(2);
  expect(await kpi(page, 'Views')).toBe(3);
  expect(await kpi(page, 'Readers')).toBe(1);
  expect(await kpi(page, 'Comments')).toBe(1);
  await expect(page.getByRole('region', { name: 'When pages get edited' }).getByRole('img')).toBeVisible();
  await expect(page.getByRole('region', { name: 'By page' }).getByRole('row')).toHaveCount(3);

  // 7 días: la página y la edición de hace 20 días quedan afuera.
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/days=7/);
  expect(await kpi(page, 'Pages created')).toBe(1);
  expect(await kpi(page, 'Edits')).toBe(2);

  // Un rango viejo: el vacío, sin tarjetas.
  await page.goto(`/en/app/docs/analytics?from=2001-01-01&to=2001-01-31&space=${space}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  // Sitio publicado (quien mira es admin).
  await page.goto('/en/app/docs/analytics?tab=site', { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Visits')).toBeGreaterThanOrEqual(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/docs/analytics?space=${space}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
