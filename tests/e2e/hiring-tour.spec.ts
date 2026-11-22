import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Hiring (lib/tours/hiring.ts, components/tour/TourHost.tsx)
 * con personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una):
 * se abre solo en el inicio la primera vez después del onboarding, va y
 * vuelve, Enter avanza sin seguir el link de Nuevo puesto, señala Nuevo
 * puesto, los puestos abiertos, los candidatos recientes y el lateral
 * (candidatos, reportes, plantillas, ajustes). Esc sale, "No mostrar más
 * tours" lo apaga (y Ajustes › Apariencia lo prende), el menú de la cuenta lo
 * reabre desde otra sección, en equipo suma las scorecards, y en el teléfono
 * va pegado abajo o arriba sin tapar ni scroll lateral en los cinco aspectos.
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

async function person(browser: Browser, opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.hiring-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['hiring'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  if (opts.look) {
    const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage() };
}

const tour = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('tour-count') });
const stepIs = async (p: Page, id: string) => expect(p.getByTestId('tour')).toHaveAttribute('data-tour-step', id, { timeout: 15_000 });
const newJob = (p: Page) => p.locator('[data-tour="hiring-new-job"]');

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
  const el = await p.locator(`[data-tour="${target}"]`).filter({ visible: true }).first().boundingBox();
  const vp = p.viewportSize()!;
  expect(card, label).not.toBeNull();
  expect(el, label).not.toBeNull();
  expect(card!.x, label).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width, label).toBeLessThanOrEqual(vp.width);
  expect(card!.y, label).toBeGreaterThanOrEqual(0);
  expect(card!.y + card!.height, label).toBeLessThanOrEqual(vp.height);
  // Un panel alto puede pasar la altura de la ventana: ahí basta con que la tarjeta no tape lo que se ve de él.
  const top = Math.max(el!.y, 0);
  const bottom = Math.min(el!.y + el!.height, vp.height);
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= bottom || card!.y + card!.height <= top;
  expect(apart, label).toBe(true);
}

test('se abre solo, va y vuelve, recorre el inicio y el lateral, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/hiring', { waitUntil: 'networkidle' });
    await expect(newJob(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newJob');
    await cardBesideTarget(p, 'hiring-new-job', 'newJob');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no sigue el link de Nuevo puesto.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newJob');
    await expect(p).toHaveURL(/\/en\/app\/hiring$/);
    // Persona sola: sin scorecards; quien creó el workspace administra (ajustes).
    for (const [id, target] of [
      ['jobs', 'hiring-jobs'],
      ['recent', 'hiring-recent'],
      ['candidates', 'hiring-candidates'],
      ['reports', 'hiring-reports'],
      ['templates', 'hiring-templates'],
      ['settings', 'hiring-settings'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await expect.poll(async () => (await tours(p)).seen?.hiring).toMatchObject({ status: 'active', step: 'settings' });
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.hiring?.status).toBe('done');
    // Los clics del tour no se fueron del inicio.
    await expect(p).toHaveURL(/\/en\/app\/hiring$/);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/hiring', { waitUntil: 'networkidle' });
    await expect(newJob(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde Puestos, el menú de la cuenta lleva al inicio y lo abre ahí; Esc sale.
    await p.goto('/en/app/hiring/jobs', { waitUntil: 'networkidle' });
    await expect(tour(p)).toHaveCount(0);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/hiring$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.hiring?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma las scorecards; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', scheme: 'dark' });
  try {
    await p.goto('/en/app/hiring', { waitUntil: 'networkidle' });
    await expect(newJob(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newJob', 'jobs', 'pending']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await cardBesideTarget(p, 'hiring-pending', 'pending');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'recent');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.hiring).toBeUndefined();

    await p.goto('/en/app/hiring', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('teléfono: tarjeta pegada abajo o arriba sin tapar y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look });
    try {
      await p.goto('/en/app/hiring', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(newJob(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newJob');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'hiring-new-job', `${look} newJob`);
      for (const [id, target] of [
        ['jobs', 'hiring-jobs'],
        ['recent', 'hiring-recent'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
      }
      // En el teléfono el lateral es un cajón: candidatos, reportes, plantillas y ajustes se saltean.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
