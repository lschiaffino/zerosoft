import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Bandeja de Track como la Inbox de Linear: filtrar por quién, estado
 * (leídas / sin leer), tipo y project dentro de Priority y Other; ordenar (más
 * viejas primero) y agrupar por tipo; el filtro queda en la URL y se recuerda
 * al volver sin ella; Esc y el clic afuera cierran los menús; a 390 px sin
 * scroll lateral.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

interface Seeded {
  actor: string;
  planId: string;
  /** Mención (sin leer, hace 3 h), comentario (leído, hace 2 h) y asignación sin project (sin leer, hace 1 h). */
  mention: string;
  comment: string;
  assigned: string;
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const tag = uid();
  const team = await ok<{ id: string; name: string }>(request.post('/api/track/projects', { data: { name: `Inbox ${tag}` } }));
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Inbox plan ${tag}` } }));
  const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Inbox ${tag}`, planId: plan.id } }));
  const actor = `inbox-actor-${tag}`;
  const meta = (extra: Record<string, unknown> = {}) => JSON.stringify({ issueIdentifier: issue.identifier, projectName: team.name, actorId: actor, actorName: `Ana ${tag}`, ...extra });
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const ids = { mention: crypto.randomUUID(), comment: crypto.randomUUID(), assigned: crypto.randomUUID() };
  const db = e2eDb();
  try {
    const insert = 'INSERT INTO notifications (id, user_id, type, title, body, href, read_at, source_type, source_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    await db.execute({ sql: insert, args: [ids.mention, 'demo', 'mention', `Ana mentioned you in ${issue.identifier}`, null, `/app/track/issues/${issue.id}`, null, 'track_issue', issue.id, meta(), ago(3)] });
    await db.execute({ sql: insert, args: [ids.comment, 'demo', 'comment', `Ana commented on ${issue.identifier}`, null, `/app/track/issues/${issue.id}`, ago(1.5), 'track_comment', crypto.randomUUID(), meta(), ago(2)] });
    await db.execute({ sql: insert, args: [ids.assigned, 'demo', 'assigned', 'Ana assigned you', null, '/app/track', null, 'track_issue', crypto.randomUUID(), JSON.stringify({ actorId: actor, actorName: `Ana ${tag}` }), ago(1)] });
  } finally {
    db.close();
  }
  return { actor, planId: plan.id, ...ids };
}

const items = (page: Page) => page.getByTestId('track-inbox-panel').getByTestId('track-inbox-item');

async function ids(page: Page): Promise<string[]> {
  return items(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''));
}

/** Filter › propiedad › valor (el menú queda abierto para tildar otro; Esc lo cierra). */
async function addFilter(page: Page, field: string, value: string) {
  await page.getByTestId('track-inbox-filter-add').click();
  await page.getByTestId(`track-inbox-filter-field-${field}`).click();
  await page.getByTestId(`track-inbox-filter-value-${field}-${value}`).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-inbox-filter-quick')).toHaveCount(0);
  await expect(page.getByTestId('track-inbox-filter-value-search')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('filtrar por quién, estado, tipo y project; ordenar y agrupar; se recuerda', async ({ page, request }) => {
  const s = await seed(request);
  await page.goto('/en/app/track/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.removeItem('zs:track-inbox-view'));
  await page.reload({ waitUntil: 'networkidle' });

  // Quién: los avisos de esta persona. Priority (asignación y mención) y Other (el comentario).
  await addFilter(page, 'from', s.actor);
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.mention]);
  await expect(page).toHaveURL(new RegExp(`from=${s.actor}`));
  await expect(page.getByTestId('track-inbox-count-priority')).toHaveText('2');
  await expect(page.getByTestId('track-inbox-count-other')).toHaveCount(0);
  await page.getByTestId('track-inbox-tab-other').click();
  await expect.poll(() => ids(page)).toEqual([s.comment]);
  await page.getByTestId('track-inbox-tab-priority').click();
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.mention]);

  // Estado: sin leer (en Other el comentario leído sale).
  await addFilter(page, 'read', 'unread');
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.mention]);
  await page.getByTestId('track-inbox-tab-other').click();
  await expect(items(page)).toHaveCount(0);
  await page.getByTestId('track-inbox-tab-priority').click();
  await expect(page.getByTestId('track-inbox-filter-chip')).toHaveCount(2);
  await page.getByTestId('track-inbox-chip-remove-read').click();
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.mention]);

  // Tipo: comentarios (en Priority no hay); se cambia desde el chip a menciones.
  await addFilter(page, 'kind', 'comment');
  await expect(items(page)).toHaveCount(0);
  await page.getByTestId('track-inbox-chip-values-kind').click();
  await page.getByTestId('track-inbox-filter-value-kind-mention').click();
  await page.getByTestId('track-inbox-filter-value-kind-comment').click();
  // Clic afuera, lejos del menú (con la lista vacía, el menú tapa el comienzo del panel).
  await page.mouse.click(900, 700);
  await expect(page.getByTestId('track-inbox-filter-value-kind-mention')).toHaveCount(0);
  await expect.poll(() => ids(page)).toEqual([s.mention]);
  await page.getByTestId('track-inbox-chip-remove-kind').click();

  // Project (el del issue que nombra el aviso).
  await addFilter(page, 'project', s.planId);
  await expect.poll(() => ids(page)).toEqual([s.mention]);
  await shot(page, 'track-inbox-filter-1280');
  await page.getByTestId('track-inbox-chip-remove-project').click();
  await expect.poll(() => ids(page)).toEqual([s.assigned, s.mention]);

  // Display: más viejas primero y agrupado por tipo.
  await page.getByTestId('track-inbox-display').click();
  await page.getByTestId('track-inbox-ordering').click();
  await page.getByTestId('track-inbox-ordering-oldest').click();
  await expect.poll(() => ids(page)).toEqual([s.mention, s.assigned]);
  await page.getByTestId('track-inbox-grouping').click();
  await page.getByTestId('track-inbox-grouping-kind').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-inbox-display-panel')).toHaveCount(0);
  await expect(page.getByTestId('track-inbox-display')).toBeFocused();
  const groups = page.getByTestId('track-inbox-panel').getByTestId('track-inbox-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-group', 'mention');
  await expect(groups.nth(1)).toHaveAttribute('data-group', 'assigned');
  await shot(page, 'track-inbox-grouped-1280');

  // Recargar: la URL lo trae.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(groups).toHaveCount(2);
  await expect.poll(() => ids(page)).toEqual([s.mention, s.assigned]);

  // Volver sin parámetros: se recuerda (y la URL lo vuelve a mostrar).
  await page.goto('/en/app/track/inbox', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/group=kind/);
  await expect.poll(() => ids(page)).toEqual([s.mention, s.assigned]);

  // El clic afuera cierra Display.
  await page.getByTestId('track-inbox-display').click();
  await expect(page.getByTestId('track-inbox-display-panel')).toBeVisible();
  await page.getByTestId('track-inbox-panel').click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId('track-inbox-display-panel')).toHaveCount(0);

  // Esc lo cierra aunque el foco ya no esté en el panel.
  await page.getByTestId('track-inbox-display').click();
  await expect(page.getByTestId('track-inbox-display-panel')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-inbox-display-panel')).toHaveCount(0);

  // Limpiar deja orden y agrupado.
  await page.getByTestId('track-inbox-filter-clear').click();
  await expect(page.getByTestId('track-inbox-filter-chip')).toHaveCount(0);
  await expect(page).not.toHaveURL(/from=/);
  await expect(page).toHaveURL(/group=kind/);
  await page.evaluate(() => window.localStorage.removeItem('zs:track-inbox-view'));
});

test('sin coincidencias: estado vacío con "Limpiar"; 390 px sin scroll lateral en claro y oscuro', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/en/app/track/inbox?from=${s.actor}&kind=reminder`, { waitUntil: 'networkidle' });
  await expect(items(page)).toHaveCount(0);
  await page.getByTestId('track-inbox-empty-clear').click();
  await expect(items(page).first()).toBeVisible();

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.getByTestId('track-inbox-filter-add').click();
    await page.getByTestId('track-inbox-filter-field-from').click();
    const value = page.getByTestId(`track-inbox-filter-value-from-${s.actor}`);
    await expect(value).toBeVisible();
    const box = await value.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `track-inbox-filter-390-${scheme}`);
    await page.keyboard.press('Escape');
    await expect(value).toHaveCount(0);
  }
  // Con el chip de la persona puesto, la fila tampoco desborda.
  await addFilter(page, 'from', s.actor);
  const chip = await page.getByTestId('track-inbox-filter-chip').boundingBox();
  expect(chip && chip.x >= 0 && chip.x + chip.width <= 390).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => window.localStorage.removeItem('zs:track-inbox-view'));
});
