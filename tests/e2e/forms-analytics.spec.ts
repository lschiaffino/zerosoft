import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Forms con el kit (el formato de Lines): visitas, respuestas y
 * a medias sembradas, el cambio de período, el filtro por formulario, el
 * vacío, el vacío sin formularios y 390 px sin scroll horizontal. Workspace
 * propio; los formularios por la API, visitas y respuestas directo en la base.
 */

ownWorkspace('forms-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

test('Forms: sin formularios, el vacío invita a crear uno', async ({ page }) => {
  // Otro período que el del test siguiente: la caché corta del kit no le devuelve este vacío.
  await page.goto('/en/app/forms/analytics?days=90', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);
  await expect(page.getByRole('main').locator('a[href$="/app/forms/new"]').last()).toBeVisible();
});

test('Forms: analítica con el kit, período, filtro por formulario y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const create = async (name: string) => {
    const res = await page.request.post('/api/forms', { data: { name, template: 'contact' } });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { form: { id: string; workspace_id?: string } }).form.id;
  };
  const a = await create('Contact e2e');
  const b = await create('Survey e2e');
  const [{ workspace_id: ws }] = (await sql('SELECT workspace_id FROM forms_forms WHERE id = ?', [a])) as Array<{ workspace_id: string }>;
  const visit = (form: string, at: string, completed: number) => sql('INSERT INTO forms_visits (id, form_id, created_at, completed) VALUES (?, ?, ?, ?)', [rid(), form, at, completed]);
  const response = (form: string, at: string, status: 'completed' | 'partial') =>
    sql(`INSERT INTO forms_responses (id, form_id, workspace_id, status, created_at, updated_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      `fmr_${rid()}`,
      form,
      ws,
      status,
      at,
      at,
      status === 'completed' ? at : null,
    ]);
  // Últimos días: A con 4 visitas (2 terminadas) y 2 respuestas; B con 2 visitas y una a medias. Hace 20 días: A, una visita y una respuesta.
  for (const [i, done] of [1, 1, 0, 0].entries()) await visit(a, ago((i + 1) * DAY), done);
  await response(a, ago(DAY), 'completed');
  await response(a, ago(2 * DAY), 'completed');
  await visit(b, ago(DAY), 0);
  await visit(b, ago(2 * DAY), 0);
  await response(b, ago(2 * DAY), 'partial');
  await visit(a, ago(20 * DAY), 1);
  await response(a, ago(20 * DAY), 'completed');

  await page.goto('/en/app/forms/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/forms\/analytics$/);
  expect(await kpi(page, 'Views')).toBe(7);
  expect(await kpi(page, 'Responses')).toBe(3);
  expect(await kpi(page, 'Partial responses')).toBe(1);
  expect(await kpi(page, 'Completion rate')).toBeCloseTo(3 / 7, 5);
  await expect(page.getByRole('img', { name: /^Views and responses per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'By form' })).toContainText('Contact e2e');
  await expect(page.getByRole('region', { name: 'Forms' }).getByRole('link', { name: 'Survey e2e' })).toHaveAttribute('href', new RegExp(`/app/forms/${b}/summary$`));

  // 7 días: lo de hace 20 días queda afuera.
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/\/app\/forms\/analytics\?days=7/);
  expect(await kpi(page, 'Responses')).toBe(2);

  // Filtro por formulario: solo B (30 días).
  await page.goto('/en/app/forms/analytics', { waitUntil: 'networkidle' });
  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Form').selectOption({ label: 'Survey e2e' });
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/form=/);
  expect(await kpi(page, 'Views')).toBe(2);
  expect(await kpi(page, 'Responses')).toBe(0);

  // Un rango sin nada: el vacío, sin tarjetas.
  await page.goto('/en/app/forms/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/forms/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
