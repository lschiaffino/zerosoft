import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Send con el kit (el formato de Lines): visitas, personas,
 * tiempo y lectura sembrados, el cambio de período, el filtro por documento,
 * el vacío, el vacío sin documentos y 390 px sin scroll horizontal. Workspace
 * propio; documentos, links y visitas directo en la base.
 */

const email = ownWorkspace('send-analytics');
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

test('Send: sin documentos, el vacío invita a subir uno', async ({ page }) => {
  // Otro período que el del test siguiente: la caché corta del kit no le devuelve este vacío.
  await page.goto('/en/app/send/analytics?days=90', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);
  await expect(page.getByRole('main').locator('a[href$="/app/send/new"]').last()).toBeVisible();
});

test('Send: analítica con el kit, período, filtro por documento y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // El workspace existe después de la primera página.
  const [u] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  const ws = String(u.id);
  const now = ago(0);
  const doc = async (title: string) => {
    const id = `sd_${rid()}`;
    await sql(`INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, ?, 'workspace', ?, ?)`, [id, ws, ws, title, now, now]);
    const link = `sl_${rid()}`;
    await sql(`INSERT INTO send_links (id, workspace_id, document_id, created_by, name, token_hash, token_sealed, created_at, updated_at) VALUES (?, ?, ?, ?, 'e2e', ?, 'x', ?, ?)`, [link, ws, id, ws, rid(), now, now]);
    return { id, link };
  };
  const visit = (d: { id: string; link: string }, at: string, who: string, seconds: number, seen: number, country: string, device: string) =>
    sql(
      `INSERT INTO send_visits (id, workspace_id, link_id, session_id, visitor_id, document_id, version_id, started_at, last_ping_at, seconds, pages_seen, page_total, device, country)
       VALUES (?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?, ?, 4, ?, ?)`,
      [rid(), ws, d.link, rid(), who, d.id, at, at, seconds, seen, device, country],
    );
  const a = await doc('Proposal e2e');
  const b = await doc('Deck e2e');
  // Últimos días: A con 3 visitas de 2 personas, B con 1; hace 20 días, una visita a A.
  await visit(a, ago(DAY), 'p1', 120, 4, 'AR', 'desktop');
  await visit(a, ago(2 * DAY), 'p1', 60, 2, 'AR', 'mobile');
  await visit(a, ago(2 * DAY), 'p2', 60, 2, 'US', 'desktop');
  await visit(b, ago(3 * DAY), 'p3', 0, 0, 'US', 'desktop');
  await visit(a, ago(20 * DAY), 'p4', 30, 1, 'BR', 'desktop');

  await page.goto('/en/app/send/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/send\/analytics$/);
  expect(await kpi(page, 'Visits')).toBe(5);
  expect(await kpi(page, 'People')).toBe(4);
  await expect(page.getByRole('img', { name: /^Visits per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'By document' })).toContainText('Proposal e2e');
  await expect(page.getByRole('region', { name: 'Countries' })).toContainText('Argentina');
  await expect(page.getByRole('region', { name: 'Documents' }).getByRole('link', { name: 'Deck e2e' })).toHaveAttribute('href', new RegExp(`/app/send/documents/${b.id}\\?tab=activity$`));

  // 7 días: lo de hace 20 días queda afuera.
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/\/app\/send\/analytics\?days=7/);
  expect(await kpi(page, 'Visits')).toBe(4);
  expect(await kpi(page, 'Read')).toBeCloseTo((1 + 0.5 + 0.5 + 0) / 4, 5);

  // Filtro por documento: solo B (30 días).
  await page.goto('/en/app/send/analytics', { waitUntil: 'networkidle' });
  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Document').selectOption({ label: 'Deck e2e' });
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/doc=/);
  expect(await kpi(page, 'Visits')).toBe(1);

  // Un rango sin nada: el vacío, sin tarjetas.
  await page.goto('/en/app/send/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/send/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
