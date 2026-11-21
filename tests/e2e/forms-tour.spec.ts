import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Forms (lib/tours/forms.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en la lista la primera vez después del onboarding, va y vuelve,
 * Enter avanza (no abre Nuevo formulario), abrir un formulario cumple el paso
 * y sigue en el editor (preguntas, publicar, compartir, respuestas) sin
 * publicar nada. Esc sale, "No mostrar más tours" lo apaga (y Ajustes ›
 * Apariencia lo prende), el menú de la cuenta lo reabre, en equipo suma quién
 * ve el formulario, sin formularios los pasos del editor se saltean, y en el
 * teléfono va pegado abajo o arriba sin tapar ni scroll lateral en los cinco
 * aspectos.
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

async function person(
  browser: Browser,
  opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; forms?: number; look?: string } = {},
): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.forms-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['forms'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.forms ?? 0); i++) {
    const res = await ctx.request.post('/api/forms', { data: { name: `Tour form ${i + 1}`, template: 'contact' } });
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
const firstForm = (p: Page) => p.locator('[data-tour="forms-item"]').first();

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function formStatuses(p: Page) {
  return ((await (await p.request.get('/api/forms')).json()) as { forms: Array<{ status: string }> }).forms.map((f) => f.status);
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

/** Los pasos del editor, en orden, con el anclaje que resaltan. */
const EDITOR_STEPS = [
  ['publish', 'forms-publish'],
  ['share', 'forms-share'],
  ['responses', 'forms-responses'],
] as const;

test('se abre solo, va y vuelve, abrir un formulario sigue en el editor sin publicar, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { forms: 2 });
  try {
    await p.goto('/en/app/forms', { waitUntil: 'networkidle' });
    await expect(firstForm(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newForm');
    await cardBesideTarget(p, 'forms-new', 'newForm');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no lleva a Nuevo formulario.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newForm');
    await expect(p).toHaveURL(/\/en\/app\/forms$/);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'filters');
    await cardBesideTarget(p, 'forms-filters', 'filters');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openForm');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir un formulario lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await cardBesideTarget(p, 'forms-item', 'openForm');
    await firstForm(p).click();
    await p.waitForURL(/\/en\/app\/forms\/[^/]+$/);
    await stepIs(p, 'questions');
    await expect.poll(async () => (await tours(p)).seen?.forms).toMatchObject({ status: 'active', step: 'questions' });
    await cardBesideTarget(p, 'forms-questions', 'questions');
    for (const [id, target] of EDITOR_STEPS) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    // Persona sola: sin el paso de quién lo ve.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.forms?.status).toBe('done');
    // Los clics del tour no publicaron nada.
    expect(await formStatuses(p)).toEqual(['draft', 'draft']);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/forms', { waitUntil: 'networkidle' });
    await expect(firstForm(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde un formulario, el menú de la cuenta lleva a la lista y lo abre ahí; Esc sale.
    await firstForm(p).click();
    await p.waitForURL(/\/en\/app\/forms\/[^/]+$/);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/forms$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.forms?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma quién ve el formulario; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', forms: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/forms', { waitUntil: 'networkidle' });
    await expect(firstForm(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newForm', 'filters', 'openForm']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await firstForm(p).click();
    await stepIs(p, 'questions');
    await cardBesideTarget(p, 'forms-questions', 'team questions');
    for (const [id, target] of EDITOR_STEPS) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, `team ${id}`);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'access');
    await cardBesideTarget(p, 'forms-access', 'access');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.forms).toBeUndefined();

    await p.goto('/en/app/forms', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin formularios: abrir uno y los pasos del editor se saltean', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/forms', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-tour="forms-new"]')).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newForm', 'filters', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    expect(await formStatuses(p)).toEqual([]);
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
    const { ctx, p } = await person(browser, { width: 390, scheme, look, forms: 1 });
    try {
      await p.goto('/en/app/forms', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstForm(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newForm');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'forms-new', `${look} newForm`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'filters');
      await cardBesideTarget(p, 'forms-filters', `${look} filters`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'openForm');
      await cardBesideTarget(p, 'forms-item', `${look} openForm`);
      await firstForm(p).click();
      await stepIs(p, 'questions');
      await cardBesideTarget(p, 'forms-questions', `${look} questions`);
      await noHorizontalScroll(p, `${look} questions`);
      for (const [id, target] of EDITOR_STEPS) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
      }
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
