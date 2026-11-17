import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Link con el kit (el formato de Lines): clics y escaneos
 * sembrados, país y dispositivo, el cambio de período, el filtro, el vacío y
 * 390 px sin scroll horizontal. Workspace propio; los clics van directo a la
 * base con fechas relativas a ahora.
 */

ownWorkspace('link-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const ts = (ago: number) => new Date(Date.now() - ago).toISOString().slice(0, 19).replace('T', ' ');

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
  const res = await page.request.post('/api/links', { data: { url: 'https://example.com/a-very-long-destination/path/that/should/not/push/the/table/wider?utm_source=e2e', slug: `lka${Math.random().toString(36).slice(2, 8)}` } });
  expect(res.status(), await res.text()).toBe(201);
  const link = (await res.json()) as { id: string };
  const click = (ago: number, source: string, country: string, device: string) =>
    sql(`INSERT INTO clicks (link_id, ts, referrer, country, device, browser, source) VALUES (?, ?, 'example.org', ?, ?, 'Chrome', ?)`, [link.id, ts(ago), country, device, source]);
  // Últimos días: tres clics (dos de AR en móvil) y un escaneo; hace 20 días, un clic.
  await click(DAY, 'link', 'AR', 'mobile');
  await click(2 * DAY, 'link', 'AR', 'mobile');
  await click(2 * DAY, 'link', 'US', 'desktop');
  await click(3 * DAY, 'qr', 'US', 'mobile');
  await click(20 * DAY, 'link', 'BR', 'desktop');
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

test('Link: analítica con el kit, país, dispositivo, período, filtro y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed(page);
  await page.goto('/en/app/links/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/links\/analytics$/);
  expect(await kpi(page, 'Clicks')).toBe(4);
  expect(await kpi(page, 'QR scans')).toBe(1);
  await expect(page.getByRole('img', { name: /^Visits per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Countries' })).toContainText('Argentina');
  await expect(page.getByRole('region', { name: 'Devices' })).toContainText('Mobile');
  await expect(page.getByRole('region', { name: 'Top links' }).getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', /\/api\/links\/analytics\/export\.csv\?from=/);

  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/\/app\/links\/analytics\?days=7/);
  expect(await kpi(page, 'Clicks')).toBe(3);

  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Device').selectOption('mobile');
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/device=mobile/);
  await expect(page).toHaveURL(/days=7/);
  expect(await kpi(page, 'Clicks')).toBe(2);
  expect(await kpi(page, 'QR scans')).toBe(1);

  await page.goto('/en/app/links/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/links/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
