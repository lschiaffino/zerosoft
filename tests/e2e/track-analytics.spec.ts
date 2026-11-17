import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Track con el kit (el formato de Lines): creados, terminados y
 * abiertos de lo sembrado, el cambio de período, el filtro por equipo, el
 * vacío y 390 px sin scroll horizontal. Workspace propio; los issues se crean
 * por la API y las fechas y el cierre se ajustan en la base.
 */

ownWorkspace('track-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const DAY = 86_400_000;
const sqlTs = (ago: number) => new Date(Date.now() - ago).toISOString().slice(0, 19).replace('T', ' ');
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let seeded = false;

async function seed(page: Page) {
  if (seeded) return;
  const team = async (name: string) => {
    const res = await page.request.post('/api/track/projects', { data: { name } });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { id: string }).id;
  };
  const issue = async (projectId: string, title: string, createdAgo: number, doneAgo: number | null) => {
    const res = await page.request.post(`/api/track/projects/${projectId}/issues`, { data: { title } });
    expect(res.ok(), await res.text()).toBe(true);
    const [row] = await sql('SELECT id FROM track_issues WHERE project_id = ? AND title = ?', [projectId, title]);
    if (doneAgo == null) {
      await sql('UPDATE track_issues SET created_at = ? WHERE id = ?', [sqlTs(createdAgo), String(row.id)]);
      return;
    }
    const [done] = await sql("SELECT id FROM track_statuses WHERE project_id = ? AND category = 'done' LIMIT 1", [projectId]);
    await sql('UPDATE track_issues SET created_at = ?, updated_at = ?, status_id = ? WHERE id = ?', [sqlTs(createdAgo), sqlTs(doneAgo), String(done.id), String(row.id)]);
  };
  const eng = await team(`Eng ${uid()}`);
  const design = await team(`Design ${uid()}`);
  // Últimos días: tres creados en Eng (uno terminado) y uno en Design terminado; hace 20 días, uno creado y terminado.
  await issue(eng, `Open a ${uid()}`, DAY, null);
  await issue(eng, `Open b ${uid()}`, 2 * DAY, null);
  await issue(eng, `Done ${uid()}`, 3 * DAY, DAY);
  await issue(design, `Done ${uid()}`, 2 * DAY, DAY);
  await issue(eng, `Old ${uid()}`, 21 * DAY, 20 * DAY);
  seeded = true;
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

test('Track: analítica con el kit, período, filtro por equipo y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed(page);
  await page.goto('/en/app/track/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByRole('img', { name: /^Created and completed per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'When issues get done' }).getByRole('img')).toBeVisible();

  // Filtro por equipo (el workspace nuevo puede traer issues de ejemplo en otros equipos): solo Eng.
  const form = page.getByRole('form', { name: 'Report filters' });
  const select = form.getByLabel('Team');
  const engId = await select.locator('option', { hasText: /^Eng / }).getAttribute('value');
  const designId = await select.locator('option', { hasText: /^Design / }).getAttribute('value');
  await select.selectOption(engId!);
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/team=/);
  expect(await kpi(page, 'Created')).toBe(4);
  expect(await kpi(page, 'Completed')).toBe(2);
  expect(await kpi(page, 'Open')).toBe(2);

  // 7 días: lo terminado hace 20 días queda afuera.
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/days=7/);
  expect(await kpi(page, 'Created')).toBe(3);
  expect(await kpi(page, 'Completed')).toBe(1);

  await page.goto(`/en/app/track/analytics?team=${designId}`, { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Completed')).toBe(1);
  expect(await kpi(page, 'Open')).toBe(0);

  // Un rango viejo en un equipo sin abiertos: el vacío, sin tarjetas.
  await page.goto(`/en/app/track/analytics?from=2001-01-01&to=2001-01-31&team=${designId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/track/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
