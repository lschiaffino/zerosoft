import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, settle } from './responsive-audit';

/**
 * Priority inbox como Linear (sep. 2025): pestañas Priority y Other con su
 * cantidad de sin leer, avatar con el ícono de la acción, línea gris con el
 * por qué, y el teclado (J/K, U, H, Backspace, Enter). A 390: sin scroll
 * lateral, menú "…" de 40px que cierra con Esc y con un clic afuera. Capturas
 * en los cinco aspectos (data-look en la página, sin tocar la cuenta demo).
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
  issue: { id: string; identifier: string };
  assigned: string;
  status: string;
  comment: string;
}

/** Un issue real con tres avisos de la misma persona: asignación y cambio de status (Priority) y comentario (Other). */
async function seed(request: APIRequestContext): Promise<Seeded> {
  const tag = uid();
  const team = await ok<{ id: string; name: string }>(request.post('/api/track/projects', { data: { name: `Prio ${tag}` } }));
  const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Revisar el login ${tag}` } }));
  const actor = `prio-actor-${tag}`;
  const meta = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ issueIdentifier: issue.identifier, projectName: team.name, actorId: actor, actorName: `Didier Bruno`, ...extra });
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const ids = { assigned: crypto.randomUUID(), status: crypto.randomUUID(), comment: crypto.randomUUID() };
  const db = e2eDb();
  try {
    const insert = 'INSERT INTO notifications (id, user_id, type, title, body, href, read_at, source_type, source_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const href = `/app/track/issues/${issue.id}`;
    await db.execute({ sql: insert, args: [ids.assigned, 'demo', 'assigned', 'assigned', null, href, null, 'track_issue', issue.id, meta(), ago(1)] });
    await db.execute({ sql: insert, args: [ids.status, 'demo', 'status_change', 'status', null, href, null, 'track_issue', issue.id, meta({ newStatus: 'In Review' }), ago(2)] });
    await db.execute({ sql: insert, args: [ids.comment, 'demo', 'comment', 'comment', null, href, null, 'track_comment', crypto.randomUUID(), meta(), ago(3)] });
  } finally {
    db.close();
  }
  return { actor, issue, ...ids };
}

const items = (page: Page) => page.getByTestId('track-inbox-panel').getByTestId('track-inbox-item');
const row = (page: Page, id: string) => page.locator(`[data-testid="track-inbox-item"][data-id="${id}"]`);

async function ids(page: Page): Promise<string[]> {
  return items(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''));
}

async function open(page: Page, s: Seeded, tab = '') {
  await page.goto(`/en/app/track/inbox?from=${s.actor}${tab ? `&tab=${tab}` : ''}`, { waitUntil: 'networkidle' });
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => window.localStorage.removeItem('zs:track-inbox-view'));
});

test('Priority y Other: cantidades, avatar con la acción y la línea del por qué', async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s);
  await expect(page.getByTestId('track-inbox-tab-priority')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.status]);
  await expect(page.getByTestId('track-inbox-count-priority')).toHaveText('2');
  await expect(page.getByTestId('track-inbox-count-other')).toHaveText('1');

  const assigned = row(page, s.assigned);
  await expect(assigned).toHaveAttribute('data-reason', 'assigned');
  await expect(assigned).toContainText(s.issue.identifier);
  await expect(assigned).toContainText('Revisar el login');
  await expect(assigned.getByTestId('track-inbox-reason')).toHaveText('Didier Bruno assigned this to you');
  await expect(assigned.getByTestId('track-inbox-badge')).toBeVisible();
  await expect(assigned.locator('.track-inbox-avatar')).toHaveText('DB');
  await expect(row(page, s.status).getByTestId('track-inbox-reason')).toHaveText("Didier Bruno changed the status to In Review · you're subscribed");
  // La regla está en el tooltip de la pestaña (y para lectores de pantalla).
  await expect(page.getByTestId('track-inbox-tab-priority')).toHaveAttribute('title', /assigned to you/);
  await shot(page, 'track-inbox-priority-1280-light');

  // Other: el comentario; la pestaña queda en la URL.
  await page.getByTestId('track-inbox-tab-other').click();
  await expect.poll(() => ids(page)).toEqual([s.comment]);
  await expect(page).toHaveURL(/tab=other/);
  await expect(row(page, s.comment).getByTestId('track-inbox-reason')).toHaveText("Didier Bruno commented · you're subscribed");
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-inbox-tab-other')).toHaveAttribute('aria-selected', 'true');

  // Flechas entre pestañas.
  await page.getByTestId('track-inbox-tab-other').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('track-inbox-tab-priority')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.status]);
});

test('teclado como Linear: J/K, U, H (Esc y clic afuera cierran), Backspace y Enter', async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s);
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.status]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press('j');
  await expect(row(page, s.assigned)).toHaveClass(/is-kb-active/);
  await page.keyboard.press('j');
  await expect(row(page, s.status)).toHaveClass(/is-kb-active/);
  await expect(row(page, s.assigned)).not.toHaveClass(/is-kb-active/);
  await page.keyboard.press('k');
  await expect(row(page, s.assigned)).toHaveClass(/is-kb-active/);

  // U: leída y de vuelta sin leer; la cantidad de la pestaña sigue.
  await page.keyboard.press('u');
  await expect(row(page, s.assigned)).toHaveAttribute('data-read', 'true');
  await expect(page.getByTestId('track-inbox-count-priority')).toHaveText('1');
  await page.keyboard.press('u');
  await expect(row(page, s.assigned)).toHaveAttribute('data-read', 'false');
  await expect(page.getByTestId('track-inbox-count-priority')).toHaveText('2');

  // H abre Posponer; Esc lo cierra y el teclado sigue en la fila.
  await page.keyboard.press('h');
  await expect(page.getByRole('menu')).toBeVisible();
  await shot(page, 'track-inbox-snooze-1280');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Clic afuera también.
  await page.keyboard.press('h');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.click(5, 790);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // La fila del teclado sigue: otra H vuelve a abrir Posponer, con los textos enteros.
  await expect(row(page, s.assigned)).toHaveClass(/is-kb-active/);
  await page.keyboard.press('h');
  await expect(page.getByRole('menu')).toBeVisible();
  for (const item of await page.getByRole('menuitem').all()) {
    expect(await item.evaluate((el) => [...el.querySelectorAll('span')].every((x) => x.scrollWidth <= x.clientWidth + 1))).toBe(true);
  }
  await page.keyboard.press('Escape');

  // U dos veces seguidas con el servidor lento: queda como estaba (optimista y en fila).
  await page.route('**/api/notifications/*', async (route) => {
    if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  let saved = 0;
  page.on('response', (r) => {
    if (r.request().method() === 'PATCH' && r.url().includes(`/api/notifications/${s.assigned}`)) saved += 1;
  });
  await row(page, s.assigned).locator('.track-inbox-link').focus();
  await page.keyboard.press('u');
  await expect(row(page, s.assigned)).toHaveAttribute('data-read', 'true');
  await page.keyboard.press('u');
  await expect(row(page, s.assigned)).toHaveAttribute('data-read', 'false');
  await expect.poll(() => saved).toBe(2);
  await expect(row(page, s.assigned)).toHaveAttribute('data-read', 'false');
  await page.unroute('**/api/notifications/*');

  // Backspace borra y la siguiente queda activa.
  await row(page, s.assigned).locator('.track-inbox-link').focus();
  await page.keyboard.press('Backspace');
  await expect(row(page, s.assigned)).toHaveCount(0);
  await expect(row(page, s.status)).toHaveClass(/is-kb-active/);
  await expect(page.getByTestId('track-inbox-count-priority')).toHaveText('1');

  // H y un plazo: sale de la lista y aparece en Pospuestos.
  await page.keyboard.press('h');
  await page.getByRole('menuitem').first().click();
  await expect(row(page, s.status)).toHaveCount(0);
  await page.getByTestId('track-inbox-tab-snoozed').click();
  await expect(row(page, s.status)).toBeVisible();
  await row(page, s.status).getByRole('button').click();
  await expect(row(page, s.status)).toHaveCount(0);

  // Enter abre el issue al lado de la lista (y lo marca leído).
  await page.getByTestId('track-inbox-tab-priority').click();
  await expect(row(page, s.status)).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('j');
  await expect(row(page, s.status)).toHaveClass(/is-kb-active/);
  await page.keyboard.press('Enter');
  // Con next dev la página del issue se compila la primera vez: más margen.
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/${s.issue.id}\\?.*n=${s.status}`), { timeout: 120_000 });
  await expect(page.getByTestId('track-inbox-issue').getByTestId('track-side-status')).toBeVisible({ timeout: 120_000 });
  await expect(row(page, s.status)).toHaveAttribute('data-read', 'true');
  await expect(row(page, s.status)).toBeVisible();
});

test('390: sin scroll lateral, menú "…" de 40px que cierra con Esc y clic afuera; cinco aspectos, claro y oscuro', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  // Un teléfono de verdad (puntero táctil): así se auditan los objetivos de 40px.
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await open(page, s);
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.status]);
  const more = row(page, s.assigned).locator('.track-inbox-more button');
  await expect(more).toBeVisible();
  const box = await more.boundingBox();
  expect(box && box.width >= 40 && box.height >= 40).toBeTruthy();
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await more.click();
  await page.mouse.click(200, 820);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Marcar leída desde el menú.
  await more.click();
  await page.getByRole('menuitem', { name: 'Mark as read' }).click();
  await expect(row(page, s.assigned)).toHaveAttribute('data-read', 'true');

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-inbox-390-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  // Sin scroll lateral ni nada fuera de pantalla (los 40px del "…" se miden arriba).
  await check(page, 'track inbox 390', { tap: true });
  await ctx.close();
});

test('1280: cinco aspectos, claro y oscuro', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const s = await seed(request);
  await open(page, s);
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.status]);
  await row(page, s.assigned).hover();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-inbox-1280-${look}-${scheme}`);
    }
  }
});
