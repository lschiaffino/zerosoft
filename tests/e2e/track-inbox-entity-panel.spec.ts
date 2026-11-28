import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, settle } from './responsive-audit';

/**
 * Bandeja: los avisos de un project o una iniciativa (comentarios, updates)
 * se abren en el panel de al lado, como los de un issue (Esc y la cruz lo
 * cierran, J/K lo siguen). Entre 1024 y 1599 px el issue del panel muestra
 * sus propiedades debajo del título y no al final; "Limpiar" del filtro no se
 * parte en dos renglones en la lista angosta. A 390 sin scroll lateral.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR ?? (process.env.CI ? 'e2e-results/shots' : '');
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
  plan: { id: string; name: string };
  initiative: { id: string; name: string };
  issue: { id: string; identifier: string };
  notes: { plan: string; update: string; initiative: string; issue: string };
}

/** Un aviso de un issue, uno de un project y uno de una iniciativa, de la misma persona (filtro "De"). */
async function seed(request: APIRequestContext): Promise<Seeded> {
  const tag = uid();
  const team = await ok<{ id: string; name: string }>(request.post('/api/track/projects', { data: { name: `Panel ${tag}` } }));
  const issue = await ok<{ id: string; identifier: string }>(
    request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Issue del panel ${tag}`, description: [{ type: 'text', text: 'Descripción larga del issue.' }] } }),
  );
  const plan = await ok<{ plan?: { id: string; name: string }; id?: string; name?: string }>(request.post('/api/track/plans', { data: { name: `Launch ${tag}` } }));
  const planRow = { id: (plan.plan?.id ?? plan.id)!, name: (plan.plan?.name ?? plan.name)! };
  const initiative = await ok<{ id: string; name: string }>(request.post('/api/track/initiatives', { data: { name: `Growth ${tag}` } }));
  const actor = `panel-actor-${tag}`;
  const notes = { plan: crypto.randomUUID(), update: crypto.randomUUID(), initiative: crypto.randomUUID(), issue: crypto.randomUUID() };
  const db = e2eDb();
  try {
    const insert = 'INSERT INTO notifications (id, user_id, type, title, body, href, read_at, source_type, source_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const who = { actorId: actor, actorName: 'Ana Pérez', kind: 'comment' };
    // Menciones: van a Priority, junto con la asignación del issue.
    await db.execute({
      sql: insert,
      args: [
        notes.plan,
        'demo',
        'mention',
        `Ana mentioned you in ${planRow.name}`,
        'Qué buen avance',
        `/app/track/projects/${planRow.id}#comments`,
        null,
        'track_plan',
        planRow.id,
        JSON.stringify({ planId: planRow.id, planName: planRow.name, ...who }),
        ago(1),
      ],
    });
    // Un update del mismo project (abre la pestaña Updates).
    await db.execute({
      sql: insert,
      args: [
        notes.update,
        'demo',
        'mention',
        `Ana mentioned you in an update of ${planRow.name}`,
        null,
        `/app/track/projects/${planRow.id}?tab=updates`,
        null,
        'track_plan',
        planRow.id,
        JSON.stringify({ planId: planRow.id, planName: planRow.name, ...who, kind: 'update' }),
        ago(1.5),
      ],
    });
    await db.execute({
      sql: insert,
      args: [
        notes.initiative,
        'demo',
        'mention',
        `Ana mentioned you in ${initiative.name}`,
        'Sumemos esto',
        `/app/track/initiatives/${initiative.id}#comments`,
        null,
        'track_initiative',
        initiative.id,
        JSON.stringify({ initiativeId: initiative.id, initiativeName: initiative.name, ...who }),
        ago(2),
      ],
    });
    await db.execute({
      sql: insert,
      args: [
        notes.issue,
        'demo',
        'assigned',
        'assigned',
        null,
        `/app/track/issues/${issue.id}`,
        null,
        'track_issue',
        issue.id,
        JSON.stringify({ issueIdentifier: issue.identifier, projectName: team.name, actorId: actor, actorName: 'Ana Pérez' }),
        ago(3),
      ],
    });
  } finally {
    db.close();
  }
  return { actor, plan: planRow, initiative, issue, notes };
}

const row = (page: Page, id: string) => page.locator(`[data-testid="track-inbox-item"][data-id="${id}"]`);
const pane = (page: Page) => page.getByTestId('track-inbox-pane');

async function openInbox(page: Page, s: Seeded) {
  await page.goto(`/en/app/track/inbox?from=${s.actor}`, { waitUntil: 'networkidle' });
  await expect(row(page, s.notes.plan)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.addInitScript(() => window.localStorage.removeItem('zs:track-inbox-view'));
});

test('1280: el project y la iniciativa se abren al lado; Esc, la cruz y J/K', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openInbox(page, s);

  // Project: en el panel, la lista queda.
  await row(page, s.notes.plan).locator('.track-inbox-link').click();
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/project/${s.plan.id}`));
  const entity = pane(page).getByTestId('track-inbox-entity');
  await expect(entity).toHaveAttribute('data-kind', 'project');
  await expect(pane(page).getByTestId('tp-plan-name')).toHaveValue(s.plan.name);
  // El aviso era de un comentario: el panel baja hasta los comentarios y la página detrás no se mueve.
  await expect(pane(page).getByTestId('track-entity-comments')).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(row(page, s.notes.initiative)).toBeVisible();
  await expect(pane(page).getByTestId('track-inbox-entity-open')).toHaveAttribute('href', new RegExp(`/app/track/projects/${s.plan.id}`));
  await shot(page, 'track-inbox-entity-project-1280');

  await expect(pane(page).getByTestId('tp-tab-overview')).toHaveAttribute('aria-selected', 'true');

  // J: el panel sigue a la fila. El update del mismo project abre su pestaña Updates.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await row(page, s.notes.plan).locator('.track-inbox-link').focus();
  await page.keyboard.press('j');
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/project/${s.plan.id}\\?.*ptab=updates`));
  await expect(pane(page).getByTestId('tp-tab-updates')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('j');
  await expect(page).toHaveURL(new RegExp(`/app/track/inbox/initiative/${s.initiative.id}`));
  await expect(pane(page).getByTestId('track-inbox-entity')).toHaveAttribute('data-kind', 'initiative');
  await expect(pane(page).getByTestId('tp-initiative-page')).toBeVisible();
  await shot(page, 'track-inbox-entity-initiative-1280');

  // Esc cierra el panel (el foco fuera de un campo).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\/track\/inbox(\?|$)/);
  await expect(pane(page).getByTestId('track-inbox-entity')).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]n=/);

  // La cruz también. Con el menú "…" del project abierto, Esc cierra el menú y el panel queda.
  await row(page, s.notes.plan).locator('.track-inbox-link').click();
  await expect(pane(page).getByTestId('track-inbox-entity')).toBeVisible();
  await pane(page).getByTestId('tp-plan-more').click();
  const picker = page.locator('.track-keypicker-list');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(pane(page).getByTestId('track-inbox-entity')).toBeVisible();
  await pane(page).getByTestId('track-inbox-panel-close').click();
  await expect(pane(page).getByTestId('track-inbox-entity')).toHaveCount(0);
});

test('1366: el issue del panel muestra las propiedades arriba y "Clear" entra en un renglón', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1366, height: 820 });
  await openInbox(page, s);

  // El filtro "De" está puesto: "Clear" en un solo renglón.
  const clear = page.getByTestId('track-inbox-filter-clear');
  await expect(clear).toBeVisible();
  const lines = await clear.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top))).size;
  });
  expect(lines).toBe(1);

  await row(page, s.notes.issue).locator('.track-inbox-link').click();
  const side = pane(page).locator('.track-detail-side');
  const activity = pane(page).locator('.track-detail-activity');
  const title = pane(page).locator('.track-detail-title');
  await expect(side).toBeVisible();
  await expect(activity).toBeVisible();
  const [sb, ab, tb] = [(await side.boundingBox())!, (await activity.boundingBox())!, (await title.boundingBox())!];
  // Debajo del título y antes de la actividad (no al final del panel).
  expect(sb.y).toBeGreaterThan(tb.y);
  expect(sb.y + sb.height).toBeLessThanOrEqual(ab.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'track-inbox-issue-pane-1366');

  for (const scheme of SHOTS ? (['light', 'dark'] as const) : []) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-inbox-issue-pane-1366-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  // El project en el panel angosto: una sola columna, sin scroll lateral.
  await row(page, s.notes.plan).locator('.track-inbox-link').click();
  await expect(pane(page).getByTestId('tp-plan-page')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const scheme of SHOTS ? (['light', 'dark'] as const) : []) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-inbox-project-pane-1366-${look}-${scheme}`);
    }
  }
});

test('390: el project ocupa la página, la cruz de 40px vuelve a la lista, sin scroll lateral', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => window.localStorage.removeItem('zs:track-inbox-view'));
    await openInbox(page, s);
    const clear = page.getByTestId('track-inbox-filter-clear');
    const lines = await clear.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top))).size;
    });
    expect(lines).toBe(1);
    await row(page, s.notes.plan).locator('.track-inbox-link').click();
    await expect(pane(page).getByTestId('tp-plan-page')).toBeVisible();
    const close = pane(page).getByTestId('track-inbox-panel-close');
    const box = (await close.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.width).toBeGreaterThanOrEqual(40);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const look of LOOKS) {
        await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
        await settle(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(page, `track-inbox-project-390-${look}-${scheme}`);
      }
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
    await close.tap();
    await expect(row(page, s.notes.plan)).toBeVisible();
  } finally {
    await ctx.close();
  }
});
