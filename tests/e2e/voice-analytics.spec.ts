import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Voice con el kit (el formato de Lines): reuniones y dictados
 * propios sembrados en la base, el filtro por tipo, el cambio de período, el
 * vacío y 390 px sin scroll horizontal.
 */

const email = ownWorkspace('voice-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let meeting = '';

async function seed() {
  if (meeting) return;
  const [user] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  const ws = String(user.id);
  const add = async (kind: 'meeting' | 'dictation', when: number, opts: { title?: string; ms: number; words: number; app?: string; status?: string }) => {
    const id = crypto.randomUUID();
    await sql(
      `INSERT INTO voice_sessions (id, workspace_id, person_id, kind, title, status, source_app, duration_ms, words, started_at, ended_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ws, ws, kind, opts.title ?? '', opts.status ?? 'done', opts.app ?? '', opts.ms, opts.words, ago(when), ago(when - opts.ms), ago(when), ago(when)],
    );
    return id;
  };
  meeting = await add('meeting', DAY, { title: 'Weekly sync', ms: 30 * 60_000, words: 2000 });
  await add('meeting', 20 * DAY, { title: 'Kickoff', ms: 45 * 60_000, words: 3000 });
  await add('meeting', 2 * DAY, { title: 'Failed', ms: 10 * 60_000, words: 0, status: 'error' });
  await add('dictation', DAY, { ms: 60_000, words: 100, app: '/en/app/docs' });
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

test('Voice: analítica con el kit, tipo, período y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed();

  await page.goto('/en/app/voice/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('a[href$="/app/voice/analytics"][aria-current="page"]').first()).toBeAttached();
  await expect(page.getByRole('img', { name: /^Meetings and dictations per day/ })).toBeVisible();
  expect(await kpi(page, 'Meetings')).toBe(2);
  expect(await kpi(page, 'Dictations')).toBe(1);
  expect(await kpi(page, 'Words dictated')).toBe(100);
  expect(await kpi(page, 'Words per minute')).toBe(100);
  await expect(page.getByRole('region', { name: 'Where you dictate' }).getByRole('listitem')).toHaveCount(1);
  const table = page.getByRole('region', { name: 'Meetings in the period' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.locator(`a[href$="/app/voice/meetings/${meeting}"]`)).toBeVisible();

  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Type').selectOption('dictation');
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/kind=dictation/);
  expect(await kpi(page, 'Meetings')).toBe(0);
  await expect(page.getByRole('region', { name: 'Meetings in the period' })).toHaveCount(0);

  await page.goto('/en/app/voice/analytics?days=7', { waitUntil: 'networkidle' });
  expect(await kpi(page, 'Meetings')).toBe(1);

  await page.goto('/en/app/voice/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/voice/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
