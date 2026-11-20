import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Track (lib/tours/track.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en el resumen la primera vez después del onboarding, va y vuelve,
 * Enter en la tarjeta avanza (los atajos de Track no lo toman), abrir Issues
 * desde el lateral cumple el paso y el tour sigue ahí con filtros,
 * visualización y vistas, Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre, sin teams
 * apunta a crear uno, y en el teléfono va pegado abajo sin scroll lateral en
 * los cinco aspectos. Track no pregunta si es equipo: los pasos son los mismos.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

interface Person {
  ctx: BrowserContext;
  p: Page;
}

async function person(browser: Browser, opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; team?: boolean; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.track-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['track'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  if (opts.team) {
    const res = await ctx.request.post('/api/track/projects', { data: { name: `Tour ${uid()}` } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  if (opts.look) {
    const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage() };
}

const tour = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('tour-count') });
const stepIs = async (p: Page, id: string) => expect(p.getByTestId('tour')).toHaveAttribute('data-tour-step', id, { timeout: 15_000 });
const overview = (p: Page) => p.locator('[data-tour="track-overview"]');

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function noHorizontalScroll(p: Page, label: string) {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

/** La tarjeta no tapa el elemento resaltado y entra en la ventana. */
async function cardBesideTarget(p: Page, target: string, label: string) {
  const card = await p.getByTestId('tour').boundingBox();
  const el = await p.locator(`[data-tour="${target}"]`).first().boundingBox();
  const vp = p.viewportSize()!;
  expect(card, label).not.toBeNull();
  expect(el, label).not.toBeNull();
  expect(card!.x, label).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width, label).toBeLessThanOrEqual(vp.width);
  expect(card!.y, label).toBeGreaterThanOrEqual(0);
  expect(card!.y + card!.height, label).toBeLessThanOrEqual(vp.height);
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= el!.y + el!.height || card!.y + card!.height <= el!.y;
  expect(apart, label).toBe(true);
}

test('se abre solo en el resumen, va y vuelve, abrir Issues sigue con filtros y vistas, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { team: true });
  try {
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(overview(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    // Con un team no hay paso de crear uno: sigue el resumen.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'overview');
    await cardBesideTarget(p, 'track-overview', 'overview');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: los atajos de Track no se lo llevan.
    await p.keyboard.press('Enter');
    await stepIs(p, 'overview');
    for (const [id, target] of [
      ['newIssue', 'app-new'],
      ['inbox', 'track-inbox'],
      ['myIssues', 'track-my-issues'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'issues');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir Issues lo cumple y el tour sigue en esa página.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await p.locator('[data-tour="track-issues"]').click();
    await p.waitForURL(/\/en\/app\/track\/issues/);
    await stepIs(p, 'filters');
    await expect.poll(async () => (await tours(p)).seen?.track).toMatchObject({ status: 'active', step: 'filters' });
    await cardBesideTarget(p, 'track-filters', 'filters');
    for (const [id, target] of [
      ['display', 'track-display'],
      ['views', 'track-views'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'shortcuts');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.track?.status).toBe('done');

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(overview(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // El menú de la cuenta lo reabre desde el principio; Esc sale.
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.track?.status).toBe('exited');

    // Desde otra página de Track, el menú lleva al resumen y lo abre ahí.
    await p.goto('/en/app/track/issues', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/track$/);
    await stepIs(p, 'intro');
    // Salir con la cruz.
    await p.getByTestId('tour-exit').click();
    await expect(tour(p)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('saltear un paso, "No mostrar más tours" y volver a prenderlos en Ajustes › Apariencia', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { team: true, scheme: 'dark' });
  try {
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(overview(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['overview', 'newIssue', 'inbox', 'myIssues', 'issues']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    // Saltear sin abrir Issues: filtros, visualización y vistas no están en el resumen y siguen los atajos.
    await p.getByTestId('tour-skip').click();
    await stepIs(p, 'shortcuts');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.track).toBeUndefined();

    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('equipo: los mismos pasos, sin preguntar', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser, { mode: 'team', team: true });
  try {
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(overview(p)).toBeVisible();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-team')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'overview');
  } finally {
    await ctx.close();
  }
});

test('teléfono: sin teams apunta a crear uno, tarjeta pegada abajo y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look });
    try {
      await p.goto('/en/app/track', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newTeam');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'track-new-team', look);
      await noHorizontalScroll(p, look);
      // En el teléfono el lateral es un cajón: sus pasos no tienen dónde mostrarse.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'shortcuts');
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});

test('teléfono con un team: el resumen se señala sin taparlo', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser, { width: 390, team: true, scheme: 'dark' });
  try {
    await p.goto('/en/app/track', { waitUntil: 'networkidle' });
    await expect(overview(p)).toBeVisible();
    await stepIs(p, 'intro');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'overview');
    await cardBesideTarget(p, 'track-overview', 'overview 390');
    await noHorizontalScroll(p, 'overview 390');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'shortcuts');
  } finally {
    await ctx.close();
  }
});
