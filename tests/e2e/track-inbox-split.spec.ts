import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, settle } from './responsive-audit';

/**
 * Bandeja como Linear: abrir un aviso muestra el issue al lado de la lista
 * (la lista queda, J/K siguen y el panel sigue a la fila; Esc y la cruz lo
 * cierran) y a 390 el issue ocupa la página. Darse de baja del issue desde la
 * fila y desde el issue abierto, sincronizados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

interface Seeded {
  actor: string;
  a: { id: string; identifier: string };
  b: { id: string; identifier: string };
  first: string;
  second: string;
}

/** Dos issues con un aviso de asignación cada uno (Priority), el primero más nuevo. */
async function seed(request: APIRequestContext): Promise<Seeded> {
  const tag = uid();
  const team = await ok<{ id: string; name: string }>(request.post('/api/track/projects', { data: { name: `Split ${tag}` } }));
  const a = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Panel primero ${tag}` } }));
  const b = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Panel segundo ${tag}` } }));
  const actor = `split-actor-${tag}`;
  const ids = { first: crypto.randomUUID(), second: crypto.randomUUID() };
  const db = e2eDb();
  try {
    const insert = 'INSERT INTO notifications (id, user_id, type, title, body, href, read_at, source_type, source_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const meta = (identifier: string) => JSON.stringify({ issueIdentifier: identifier, projectName: team.name, actorId: actor, actorName: 'Ana Pérez' });
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await db.execute({ sql: insert, args: [ids.first, 'demo', 'assigned', 'assigned', null, `/app/track/issues/${a.id}`, null, 'track_issue', a.id, meta(a.identifier), ago(1)] });
    await db.execute({ sql: insert, args: [ids.second, 'demo', 'assigned', 'assigned', null, `/app/track/issues/${b.id}`, null, 'track_issue', b.id, meta(b.identifier), ago(2)] });
  } finally {
    db.close();
  }
  return { actor, a, b, ...ids };
}

const row = (page: Page, id: string) => page.locator(`[data-testid="track-inbox-item"][data-id="${id}"]`);
const pane = (page: Page) => page.getByTestId('track-inbox-pane');

async function openInbox(page: Page, s: Seeded) {
  await page.goto(`/en/app/track/inbox?from=${s.actor}`, { waitUntil: 'networkidle' });
  await expect(row(page, s.first)).toBeVisible();
}

async function subscribed(request: APIRequestContext, issueId: string): Promise<boolean> {
  const r = await request.get(`/api/track/issues/${issueId}/subscription`);
  return ((await r.json()) as { subscribed: boolean }).subscribed;
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => window.localStorage.removeItem('zs:track-inbox-view'));
});

test('1280: el issue se abre al lado, la lista queda y J/K mueven el panel; Esc y la cruz lo cierran', async ({ page, request }) => {
  const s = await seed(request);
  await openInbox(page, s);
  // Sin aviso abierto, el panel invita a elegir uno.
  await expect(pane(page)).toBeVisible();
  await shot(page, 'track-inbox-split-empty-1280');

  await row(page, s.first).locator('.track-inbox-link').click();
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/${s.a.id}\\?.*n=${s.first}`), { timeout: 120_000 });
  const issue = pane(page).getByTestId('track-inbox-issue');
  await expect(issue).toBeVisible({ timeout: 120_000 });
  await expect(issue.locator('.track-detail-title')).toContainText('Panel primero');
  // La lista sigue ahí, con el aviso abierto marcado y ya leído.
  await expect(row(page, s.first)).toBeVisible();
  await expect(row(page, s.first)).toHaveClass(/is-open/);
  await expect(row(page, s.first)).toHaveAttribute('data-read', 'true');
  const listBox = await page.getByTestId('track-inbox-panel').boundingBox();
  const paneBox = await pane(page).boundingBox();
  expect(listBox && paneBox && paneBox.x >= listBox.x + listBox.width - 1).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'track-inbox-split-open-1280');

  // J: el panel pasa al siguiente aviso (sin sumar historial); K vuelve.
  await row(page, s.first).locator('.track-inbox-link').focus();
  await page.keyboard.press('j');
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/${s.b.id}\\?.*n=${s.second}`), { timeout: 60_000 });
  await expect(issue.locator('.track-detail-title')).toContainText('Panel segundo', { timeout: 60_000 });
  await expect(row(page, s.second)).toHaveClass(/is-open/);
  await expect(row(page, s.first)).not.toHaveClass(/is-open/);
  // Con el foco dentro del issue, J/K siguen siendo de la bandeja.
  await page.getByTestId('track-issue-favorite').focus();
  await page.keyboard.press('k');
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/${s.a.id}`), { timeout: 60_000 });

  // Esc cierra el panel; la bandeja queda con su filtro.
  await page.getByTestId('track-issue-favorite').focus();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\/track\/inbox\?from=/);
  await expect(pane(page).getByTestId('track-inbox-issue')).toHaveCount(0);
  await expect(row(page, s.first)).toBeVisible();

  // La cruz también.
  await row(page, s.second).locator('.track-inbox-link').click();
  await expect(issue).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('track-inbox-panel-close').click();
  await expect(page).toHaveURL(/\/app\/track\/inbox\?from=/);
  await expect(row(page, s.second)).toBeVisible();
});

test('dejar de seguir el issue desde la fila y desde el issue abierto', async ({ page, request }) => {
  const s = await seed(request);
  await openInbox(page, s);
  expect(await subscribed(request, s.a.id)).toBe(true);

  const toggle = row(page, s.first).getByTestId('track-inbox-unsubscribe');
  await row(page, s.first).hover();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => subscribed(request, s.a.id)).toBe(false);
  await shot(page, 'track-inbox-unsubscribed-1280');

  // El issue abierto al lado muestra la baja; volver a seguirlo desde ahí actualiza la fila.
  await row(page, s.first).locator('.track-inbox-link').click();
  const bell = pane(page).getByTestId('track-issue-subscribe');
  await expect(bell).toBeVisible({ timeout: 120_000 });
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  await bell.click();
  await expect(bell).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => subscribed(request, s.a.id)).toBe(true);
  await row(page, s.first).hover();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Y de nuevo desde la fila, con el issue abierto: el issue lo refleja.
  await toggle.click();
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => subscribed(request, s.a.id)).toBe(false);
});

test('390: el issue ocupa la página, la cruz vuelve a la lista; el menú "…" deja de seguir y cierra con Esc y clic afuera', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await openInbox(page, s);
  await expect(pane(page)).toBeHidden();

  // Menú "…": Esc y clic afuera cierran; "Dejar de seguir" funciona.
  const more = row(page, s.second).locator('.track-inbox-more button');
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await more.click();
  await page.mouse.click(200, 820);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await more.click();
  await page.getByTestId('track-inbox-unsubscribe-menu').click();
  await expect.poll(() => subscribed(request, s.b.id)).toBe(false);

  await row(page, s.first).locator('.track-inbox-link').click();
  const issue = pane(page).getByTestId('track-inbox-issue');
  await expect(issue).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('track-inbox-panel')).toBeHidden();
  const close = page.getByTestId('track-inbox-panel-close');
  const box = await close.boundingBox();
  expect(box && box.width >= 40 && box.height >= 40).toBeTruthy();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-inbox-issue-390-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  // El título del issue (textarea de una línea) es de la página del issue, no del panel.
  await check(page, 'track inbox issue 390', { tap: true, ignore: /track-detail-title-input/ });

  await close.click();
  await expect(page).toHaveURL(/\/app\/track\/inbox\?from=/);
  await expect(row(page, s.first)).toBeVisible();
  await ctx.close();
});

test('1280: cinco aspectos con el issue abierto, claro y oscuro', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const s = await seed(request);
  await openInbox(page, s);
  await row(page, s.first).locator('.track-inbox-link').click();
  await expect(pane(page).getByTestId('track-inbox-issue')).toBeVisible({ timeout: 120_000 });
  await row(page, s.second).hover();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-inbox-split-1280-${look}-${scheme}`);
    }
  }
});
