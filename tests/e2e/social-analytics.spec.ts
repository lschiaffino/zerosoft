import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Social con el kit (el formato de Lines): publicaciones y
 * métricas sembradas, por red, el cambio de período, el filtro por cuenta, el
 * vacío y 390 px sin scroll horizontal. Workspace propio; cuentas y
 * publicaciones directo en la base.
 */

const email = ownWorkspace('social-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const rid = () => crypto.randomUUID();

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let seeded = false;

async function seed() {
  if (seeded) return;
  const [u] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  const ws = String(u.id);
  const now = ago(0);
  const account = async (network: string, name: string) => {
    const id = rid();
    await sql(`INSERT INTO social_accounts (id, workspace_id, network, external_id, name, followers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 250, ?, ?)`, [id, ws, network, rid(), name, now, now]);
    return id;
  };
  const li = await account('linkedin', 'Marca LinkedIn');
  const fb = await account('facebook', 'Marca Facebook');
  const post = async (acc: string, at: string, text: string, impressions: number, engagement: number) => {
    const pid = rid();
    await sql(`INSERT INTO social_posts (id, workspace_id, created_by, text, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'published', ?, ?, ?)`, [pid, ws, ws, text, at, at, at]);
    await sql(
      `INSERT INTO social_post_targets (id, post_id, account_id, workspace_id, status, published_at, impressions, reach, engagement, clicks, metrics_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, 3, ?, ?, ?)`,
      [rid(), pid, acc, ws, at, impressions, impressions - 10, engagement, now, at, at],
    );
  };
  await post(li, ago(DAY), 'Lanzamiento e2e', 500, 40);
  await post(fb, ago(2 * DAY), 'Promo e2e', 300, 20);
  await post(li, ago(20 * DAY), 'Viejo e2e', 100, 5);
  seeded = true;
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test('Social: analítica con el kit, por red, período, cuenta y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed();
  await page.goto('/en/app/social/analytics', { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Posts')).toBe(3);
  expect(await kpi(page, 'Impressions')).toBe(900);
  expect(await kpi(page, 'Engagement')).toBe(65);
  await expect(page.getByRole('img', { name: /^Engagement per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'By network' })).toContainText('LinkedIn');
  await expect(page.getByRole('region', { name: 'By post' })).toContainText('Lanzamiento e2e');
  await expect(page.getByRole('region', { name: 'By account' }).getByRole('row')).toHaveCount(3);

  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/\/app\/social\/analytics\?days=7/);
  expect(await kpi(page, 'Posts')).toBe(2);
  expect(await kpi(page, 'Engagement')).toBe(60);

  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Account').selectOption({ label: 'Marca Facebook' });
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/account=/);
  expect(await kpi(page, 'Posts')).toBe(1);

  await page.goto('/en/app/social/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/social/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
