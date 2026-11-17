import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Cal con el kit (el formato de Lines): los números de lo
 * sembrado, el cambio de período, el filtro por tipo de evento, el vacío y
 * 390 px sin scroll horizontal. Workspace propio; reservas sembradas directo
 * en la base con fechas relativas a ahora.
 */

ownWorkspace('cal-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const sqlTs = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
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

async function seed(page: Page) {
  if (seeded) return;
  const res = await page.request.post('/api/calendar/event-types', { data: { slug: `an-${rid().slice(0, 8)}`, title: 'Intro e2e', durationMin: 30, active: true } });
  expect(res.status()).toBe(201);
  const et = (await res.json()) as { id: string };
  const other = (await (await page.request.post('/api/calendar/event-types', { data: { slug: `an-${rid().slice(0, 8)}`, title: 'Demo e2e', durationMin: 30, active: true } })).json()) as { id: string };
  const booking = (eventTypeId: string, createdAgo: number, status: string) =>
    sql(
      `INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at, status, created_at, updated_at)
       VALUES (?, ?, 'guest@example.com', 'Guest', ?, ?, ?, ?, ?)`,
      [rid(), eventTypeId, iso(2 * DAY), iso(2 * DAY + 1_800_000), status, sqlTs(createdAgo), sqlTs(createdAgo)],
    );
  // Últimos días: dos confirmadas, una cancelada y un no-show; hace 20 días, una confirmada del otro tipo.
  await booking(et.id, DAY, 'confirmed');
  await booking(et.id, 2 * DAY, 'confirmed');
  await booking(et.id, 2 * DAY, 'cancelled');
  await booking(et.id, 3 * DAY, 'no_show');
  await booking(other.id, 20 * DAY, 'confirmed');
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

test('Cal: analítica con el kit, período, filtro por tipo de evento y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed(page);
  await page.goto('/en/app/calendar/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/calendar\/analytics$/);
  expect(await kpi(page, 'Created')).toBe(5);
  expect(await kpi(page, 'Cancelled')).toBe(1);
  expect(await kpi(page, 'No-shows')).toBe(1);
  expect(await kpi(page, 'Cancellation rate')).toBeCloseTo(0.2, 5);
  await expect(page.getByRole('img', { name: /^Bookings created per day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'By event type' })).toContainText('Intro e2e');
  await expect(page.getByRole('region', { name: 'Popular times' }).getByRole('img')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', /\/api\/calendar\/analytics\/export\?from=/);

  // 7 días: la de hace 20 días queda afuera.
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/\/app\/calendar\/analytics\?days=7/);
  expect(await kpi(page, 'Created')).toBe(4);

  // Filtro por tipo de evento: solo "Demo e2e" (30 días).
  await page.goto('/en/app/calendar/analytics', { waitUntil: 'networkidle' });
  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Event type').selectOption({ label: 'Demo e2e' });
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/et=/);
  expect(await kpi(page, 'Created')).toBe(1);

  // Un rango sin nada: el vacío, sin tarjetas.
  await page.goto('/en/app/calendar/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/calendar/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
