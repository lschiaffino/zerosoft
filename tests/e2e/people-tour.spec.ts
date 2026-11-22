import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de People (lib/tours/people.ts, components/tour/TourHost.tsx)
 * con personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una):
 * se abre solo en el directorio la primera vez después del onboarding, va y
 * vuelve, Enter avanza, señala la ficha, los filtros, agregar persona y el
 * lateral (organigrama, ausencias, ajustes). Esc sale, "No mostrar más
 * tours" lo apaga (y Ajustes › Apariencia lo prende), el menú de la cuenta lo
 * reabre desde otra sección, en equipo suma evaluaciones, y en el teléfono va
 * pegado abajo o arriba sin tapar ni scroll lateral en los cinco aspectos.
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
  const email = `tour-${uid()}@${uid()}.people-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['people'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  // La ficha propia ya creada (lo que haría PeopleSync): la primera fila está desde el primer pintado.
  expect((await ctx.request.post('/api/people/me')).ok()).toBe(true);
  if (opts.look) {
    const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage() };
}

const tour = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('tour-count') });
const stepIs = async (p: Page, id: string) => expect(p.getByTestId('tour')).toHaveAttribute('data-tour-step', id, { timeout: 15_000 });
const firstRow = (p: Page) => p.getByTestId('people-row').first();

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
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= el!.y + el!.height || card!.y + card!.height <= el!.y;
  expect(apart, label).toBe(true);
}

test('se abre solo, va y vuelve, recorre el directorio y el lateral, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/people', { waitUntil: 'networkidle' });
    await expect(firstRow(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'person');
    await cardBesideTarget(p, 'people-person', 'person');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no abre la ficha.
    await p.keyboard.press('Enter');
    await stepIs(p, 'person');
    await expect(p).toHaveURL(/\/en\/app\/people$/);
    // Persona sola: sin evaluaciones; quien creó el workspace administra (agregar y ajustes).
    for (const [id, target] of [
      ['filters', 'people-filters'],
      ['add', 'people-add'],
      ['org', 'people-org'],
      ['timeOff', 'people-time-off'],
      ['settings', 'people-settings'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await expect.poll(async () => (await tours(p)).seen?.people).toMatchObject({ status: 'active', step: 'settings' });
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.people?.status).toBe('done');
    // Los clics del tour no abrieron el alta de persona.
    await expect(p.getByRole('dialog')).toHaveCount(0);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/people', { waitUntil: 'networkidle' });
    await expect(firstRow(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde el organigrama, el menú de la cuenta lleva al directorio y lo abre ahí; Esc sale.
    await p.goto('/en/app/people/org', { waitUntil: 'networkidle' });
    await expect(tour(p)).toHaveCount(0);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/people$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.people?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma evaluaciones; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', scheme: 'dark' });
  try {
    await p.goto('/en/app/people', { waitUntil: 'networkidle' });
    await expect(firstRow(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['person', 'filters', 'add', 'org', 'timeOff', 'reviews']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await cardBesideTarget(p, 'people-reviews', 'reviews');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'settings');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.people).toBeUndefined();

    await p.goto('/en/app/people', { waitUntil: 'networkidle' });
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
      await p.goto('/en/app/people', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstRow(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'person');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'people-person', `${look} person`);
      for (const [id, target] of [
        ['filters', 'people-filters'],
        ['add', 'people-add'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
      }
      // En el teléfono el lateral es un cajón: organigrama, ausencias y ajustes se saltean.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
