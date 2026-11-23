import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, settle } from './responsive-audit';

/**
 * Time in status y las Display properties que faltaban (Updated, Estimate,
 * Links, Milestone), como Linear: en la fila y la tarjeta, ordenar por tiempo
 * en el status, filtrar "más de N días", y en el issue el tiempo actual con
 * el total por status. A 390 sin scroll lateral; capturas en los cinco
 * aspectos (data-look en la página, sin tocar la cuenta demo).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const DAY = 86_400_000;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Status = { id: string; name: string; category: string };

/** Un team con dos issues en Todo: uno lleva 10 días ahí (con estimación, milestone y un PR) y otro recién llegado. */
async function seed(request: APIRequestContext) {
  const tag = uid();
  const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Tiempo ${tag}` } }));
  const statuses = ((await (await request.get(`/api/track/projects/${team.id}/statuses`)).json()) as { rows: Status[] }).rows;
  const todo = statuses.find((s) => s.category === 'todo')!;
  const doing = statuses.find((s) => s.category === 'in_progress')!;
  const milestone = await ok<{ id: string }>(request.post(`/api/track/projects/${team.id}/milestones`, { data: { name: `Beta ${tag}` } }));
  const old = await ok<{ id: string; identifier: string }>(
    request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Viejo ${tag}`, statusId: doing.id, estimate: 3, milestoneId: milestone.id } }),
  );
  const fresh = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Nuevo ${tag}`, statusId: todo.id } }));
  // Pasó por In Progress y entró a Todo hace 10 días.
  const r = await request.patch(`/api/track/issues/${old.id}`, { data: { statusId: todo.id } });
  expect(r.ok()).toBeTruthy();
  const db = e2eDb();
  try {
    const at = (d: number) => new Date(Date.now() - d * DAY).toISOString();
    await db.execute({ sql: 'UPDATE track_issue_status_log SET entered_at = ? WHERE issue_id = ? AND status_id = ?', args: [at(12), old.id, doing.id] });
    await db.execute({ sql: 'UPDATE track_issue_status_log SET entered_at = ? WHERE issue_id = ? AND status_id = ?', args: [at(10), old.id, todo.id] });
    await db.execute({ sql: 'UPDATE track_issues SET status_changed_at = ? WHERE id = ?', args: [at(10), old.id] });
    await db.execute({
      sql: "INSERT INTO track_issue_links (id, issue_id, kind, repo, ref, url, title) VALUES (?, ?, 'pr', 'acme/app', ?, 'https://github.com/acme/app/pull/1', 'Fix')",
      args: [crypto.randomUUID(), old.id, `1-${tag}`],
    });
  } finally {
    db.close();
  }
  return { team: team.id, old, fresh, todo, doing };
}

const rows = (page: Page) => page.locator('tr[data-issue-row]');
const order = (page: Page) => rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-issue-key') ?? ''));

async function showProps(page: Page) {
  await page.getByTestId('track-display').click();
  await page.getByTestId('track-group-by').click();
  await page.getByTestId('track-group-by-none').click();
  for (const p of ['milestone', 'estimate', 'links', 'status_time', 'updated']) {
    const chip = page.getByTestId(`track-prop-${p}`);
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  await page.getByTestId('track-sort-by').click();
  await page.getByTestId('track-sort-by-status_time').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-display-panel')).toHaveCount(0);
}

test.beforeEach(() => {
  test.slow();
});

test('fila: propiedades compactas, orden por time in status y filtro "más de N días"', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/team/${s.team}`, { waitUntil: 'networkidle' });
  await expect(rows(page)).toHaveCount(2);
  await showProps(page);

  // Los que llevan más tiempo en su status primero.
  await expect.poll(() => order(page)).toEqual([s.old.id, s.fresh.id]);
  const oldRow = rows(page).filter({ hasText: s.old.identifier });
  await expect(oldRow.getByTestId('track-row-prop-status_time').locator('.track-row-prop-text')).toHaveText('10d');
  await expect(oldRow.getByTestId('track-row-prop-status_time')).toHaveAttribute('title', `In ${s.todo.name} for 10d`);
  await expect(oldRow.getByTestId('track-row-prop-estimate').locator('.track-row-prop-text')).toHaveText('3');
  await expect(oldRow.getByTestId('track-row-prop-links').locator('.track-row-prop-text')).toHaveText('1');
  await expect(oldRow.getByTestId('track-row-prop-milestone')).toContainText('Beta');
  await expect(oldRow.getByTestId('track-row-prop-updated')).toBeVisible();
  // Sin estimación, milestone ni links: no ocupan lugar.
  const freshRow = rows(page).filter({ hasText: s.fresh.identifier });
  await expect(freshRow.getByTestId('track-row-prop-estimate')).toHaveCount(0);
  await expect(freshRow.getByTestId('track-row-prop-links')).toHaveCount(0);
  await expect(freshRow.getByTestId('track-row-prop-status_time').locator('.track-row-prop-text')).toHaveText(/^\d+m$/);
  await shot(page, 'track-status-time-list-1280');

  // Filter › Time in status › More than 7 days.
  await page.getByTestId('track-filter-add').click();
  await page.getByTestId('track-filter-field-status_age').click();
  await page.getByTestId('track-filter-value-status_age-7').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(s.old.identifier);
  await expect(page.getByTestId('track-filter-op')).toHaveText('more than');
  // El operador pasa a "less than": queda el nuevo.
  await page.getByTestId('track-filter-op').click();
  await page.locator('[role^="menuitem"]', { hasText: 'less than' }).first().click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(s.fresh.identifier);

  // El tablero muestra lo mismo en la tarjeta.
  await page.locator('.track-filter-chip-remove').click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByTestId('track-display').click();
  await page.getByTestId('track-view-board').click();
  await page.keyboard.press('Escape');
  const card = page.locator('.track-board-card', { hasText: s.old.identifier });
  await expect(card.getByTestId('track-row-prop-status_time')).toHaveText(/10d/);
  await expect(card.getByTestId('track-row-prop-estimate')).toBeVisible();
  await shot(page, 'track-status-time-board-1280');
  await page.getByTestId('track-display').click();
  await page.getByTestId('track-view-list').click();
  await page.keyboard.press('Escape');
});

test('issue: tiempo en el status actual y total por status; Esc cierra', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/issues/${s.old.id}`, { waitUntil: 'networkidle' });
  const btn = page.getByTestId('track-issue-status-time');
  await expect(btn).toHaveText(new RegExp(`In ${s.todo.name} for 10d`));
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const list = page.getByTestId('track-issue-status-time-row');
  await expect(list).toHaveCount(2);
  await expect(list.filter({ hasText: s.doing.name })).toContainText('2d');
  await expect(list.filter({ hasText: s.todo.name })).toContainText('10d');
  await shot(page, 'track-status-time-issue-1280');
  await btn.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('390 y los cinco aspectos: sin scroll lateral en la lista y en el issue', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  // Un teléfono de verdad (puntero táctil): así se auditan los objetivos de 40px.
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/en/app/track/team/${s.team}`, { waitUntil: 'networkidle' });
  await expect(rows(page)).toHaveCount(2);
  await showProps(page);
  await expect.poll(() => order(page)).toEqual([s.old.id, s.fresh.id]);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-status-time-list-390-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  await check(page, 'track list status time 390', { tap: true });

  await page.goto(`/en/app/track/issues/${s.old.id}`, { waitUntil: 'networkidle' });
  const btn = page.getByTestId('track-issue-status-time');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.getByTestId('track-issue-status-time-row')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'track-status-time-issue-390');
  await ctx.close();
});

test('1280: cinco aspectos, claro y oscuro (capturas)', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/team/${s.team}`, { waitUntil: 'networkidle' });
  await showProps(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-status-time-1280-${look}-${scheme}`);
    }
  }
});
