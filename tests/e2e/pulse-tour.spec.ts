import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Pulse (lib/tours/pulse.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en web analytics la primera vez después del onboarding, va y
 * vuelve, Enter avanza sin crear un proyecto. Sin proyecto señala crear uno y
 * saltea la instalación y los números; con proyecto, al revés. Esc sale, "No
 * mostrar más tours" lo apaga (y Ajustes › Apariencia lo prende), el menú de
 * la cuenta lo reabre desde otra sección, y en el teléfono va pegado abajo o
 * arriba sin tapar ni scroll lateral en los cinco aspectos (la actividad
 * señala el link de la página).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
/** Capturas para la revisión visual a mano (opcional): PULSE_TOUR_SHOTS=<carpeta>. */
const SHOTS = process.env.PULSE_TOUR_SHOTS;
const shot = async (p: Page, name: string) => {
  if (!SHOTS) return;
  // Que el resaltado y la tarjeta terminen de moverse.
  await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await p.screenshot({ path: `${SHOTS}/${name}.png` });
};

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

async function person(browser: Browser, opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; look?: string; project?: boolean } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.pulse-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['pulse'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  if (opts.project) {
    const res = await ctx.request.post('/api/analytics/projects', { data: { name: `Tour site ${uid()}` } });
    expect(res.status(), await res.text()).toBe(201);
    const { project } = (await res.json()) as { project: { id: string } };
    await ctx.addCookies([{ name: 'zs_analytics_project', value: project.id, url: baseURL }]);
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
const anchor = (p: Page, name: string) => p.locator(`[data-tour="${name}"]`).filter({ visible: true }).first();

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function noHorizontalScroll(p: Page, label: string) {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

/** La tarjeta no tapa el elemento resaltado y entra en la ventana (después de que la página termina de desplazarse). */
async function cardBesideTarget(p: Page, target: string, label: string) {
  await expect(async () => checkCardBeside(p, target, label)).toPass({ timeout: 5_000 });
}

async function checkCardBeside(p: Page, target: string, label: string) {
  const card = await p.getByTestId('tour').boundingBox();
  const el = await anchor(p, target).boundingBox();
  const vp = p.viewportSize()!;
  expect(card, label).not.toBeNull();
  expect(el, label).not.toBeNull();
  expect(card!.x, label).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width, label).toBeLessThanOrEqual(vp.width);
  expect(card!.y, label).toBeGreaterThanOrEqual(0);
  expect(card!.y + card!.height, label).toBeLessThanOrEqual(vp.height);
  const top = Math.max(el!.y, 0);
  const bottom = Math.min(el!.y + el!.height, vp.height);
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= bottom || card!.y + card!.height <= top;
  expect(apart, label).toBe(true);
}

test('sin proyecto: se abre solo, va y vuelve, saltea instalación y números, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/pulse', { waitUntil: 'networkidle' });
    await expect(anchor(p, 'pulse-new-project')).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newProject');
    await cardBesideTarget(p, 'pulse-new-project', 'newProject');
    await shot(p, 'desktop-empty-newProject');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no abre la creación del proyecto.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newProject');
    await expect(p).toHaveURL(/\/en\/app\/pulse$/);
    // Sin proyecto no hay instalación ni números: sigue con el lateral.
    for (const [id, target] of [
      ['events', 'pulse-events'],
      ['insights', 'pulse-insights'],
      ['dashboards', 'pulse-dashboards'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
      await shot(p, `desktop-empty-${id}`);
    }
    await expect.poll(async () => (await tours(p)).seen?.pulse).toMatchObject({ status: 'active', step: 'dashboards' });
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.pulse?.status).toBe('done');
    await expect(p).toHaveURL(/\/en\/app\/pulse$/);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/pulse', { waitUntil: 'networkidle' });
    await expect(anchor(p, 'pulse-new-project')).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde Actividad, el menú de la cuenta lleva al inicio y lo abre ahí; Esc sale.
    await p.goto('/en/app/pulse/events', { waitUntil: 'networkidle' });
    await expect(tour(p)).toHaveCount(0);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/pulse$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.pulse?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo con un proyecto: instalación, números y lateral; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', scheme: 'dark', project: true });
  try {
    await p.goto('/en/app/pulse', { waitUntil: 'networkidle' });
    await expect(anchor(p, 'pulse-setup')).toBeVisible();
    // Los números llegan después de la página (la consulta): esperarlos antes de Siguiente.
    await expect(anchor(p, 'pulse-stats')).toBeVisible({ timeout: 30_000 });
    await stepIs(p, 'intro');
    // Con proyecto no hay vacío: crear proyecto se saltea.
    for (const [id, target] of [
      ['setup', 'pulse-setup'],
      ['web', 'pulse-stats'],
      ['events', 'pulse-events'],
      ['insights', 'pulse-insights'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
      await shot(p, `desktop-project-${id}`);
    }
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.pulse).toBeUndefined();

    await p.goto('/en/app/pulse', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('escritorio en los cinco aspectos, claro y oscuro (capturas para la revisión a mano)', async ({ browser }) => {
  test.skip(!SHOTS, 'solo con PULSE_TOUR_SHOTS');
  test.setTimeout(600_000);
  for (const look of ['current', 'lines', 'classic', 'liquid', 'retro'] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      const { ctx, p } = await person(browser, { scheme, look, project: true });
      try {
        await p.goto('/en/app/pulse', { waitUntil: 'networkidle' });
        await expect(anchor(p, 'pulse-stats')).toBeVisible({ timeout: 30_000 });
        await stepIs(p, 'intro');
        await shot(p, `desk-${look}-${scheme}-intro`);
        for (const [id, target] of [
          ['setup', 'pulse-setup'],
          ['web', 'pulse-stats'],
          ['events', 'pulse-events'],
          ['insights', 'pulse-insights'],
          ['dashboards', 'pulse-dashboards'],
        ] as const) {
          await p.getByTestId('tour-next').click();
          await stepIs(p, id);
          await cardBesideTarget(p, target, `${look} ${scheme} ${id}`);
          await noHorizontalScroll(p, `${look} ${scheme} ${id}`);
          await shot(p, `desk-${look}-${scheme}-${id}`);
        }
      } finally {
        await ctx.close();
      }
    }
  }
});

test('teléfono: tarjeta pegada abajo o arriba sin tapar y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(420_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look, project: true });
    try {
      await p.goto('/en/app/pulse', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(anchor(p, 'pulse-setup')).toBeVisible();
      await expect(anchor(p, 'pulse-stats')).toBeVisible({ timeout: 30_000 });
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      // En el teléfono el lateral es un cajón: la actividad señala el link de la página; insights y tableros se saltean.
      for (const [id, target] of [
        ['setup', 'pulse-setup'],
        ['web', 'pulse-stats'],
        ['events', 'pulse-live'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        const card = await p.getByTestId('tour').boundingBox();
        expect(card, look).not.toBeNull();
        expect(card!.x, look).toBeGreaterThanOrEqual(0);
        expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
        // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
        expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, `${look} ${id}`).toBe(true);
        await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
        await shot(p, `phone-${look}-${id}`);
      }
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
