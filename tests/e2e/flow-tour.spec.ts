import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Flow (lib/tours/flow.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en la lista la primera vez después del onboarding, va y vuelve,
 * Enter avanza sin crear un flow. Sin flows, abrir uno y el editor se
 * saltean; con uno, el clic en la fila lo abre y el tour sigue en el editor
 * (disparador, pasos, probar). Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre desde otra
 * sección, y en el teléfono va pegado abajo o arriba sin tapar ni scroll
 * lateral en los cinco aspectos (el historial señala el link de la lista).
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

async function person(browser: Browser, opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; look?: string; flows?: number } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.flow-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['flow'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.flows ?? 0); i++) {
    const res = await ctx.request.post('/api/flow/flows', { data: { name: `Tour flow ${i + 1}`, template: 'leadToCrmSlack' } });
    expect(res.ok(), await res.text()).toBe(true);
    // Con E2E_DEV el editor se compila la primera vez que se pide: que no tarde más que la espera del tour tras el clic.
    const { id } = (await res.json()) as { id: string };
    await ctx.request.get(`/en/app/flow/${id}`);
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
const newFlow = (p: Page) => p.locator('[data-tour="flow-new"]').filter({ visible: true }).first();
const firstFlow = (p: Page) => p.locator('[data-tour="flow-item"]').first();

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
  const top = Math.max(el!.y, 0);
  const bottom = Math.min(el!.y + el!.height, vp.height);
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= bottom || card!.y + card!.height <= top;
  expect(apart, label).toBe(true);
}

test('se abre solo, va y vuelve, sin flows saltea el editor, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/flow', { waitUntil: 'networkidle' });
    await expect(newFlow(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Flow no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newFlow');
    await cardBesideTarget(p, 'flow-new', 'newFlow');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no crea un flow.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newFlow');
    await expect(p).toHaveURL(/\/en\/app\/flow$/);
    for (const [id, target] of [
      ['templates', 'flow-template'],
      ['runs', 'flow-runs'],
      ['credentials', 'flow-credentials'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await expect.poll(async () => (await tours(p)).seen?.flow).toMatchObject({ status: 'active', step: 'credentials' });
    // Sin flows no hay fila que abrir: abrir un flow y el editor se saltean.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.flow?.status).toBe('done');
    await expect(p).toHaveURL(/\/en\/app\/flow$/);
    expect(((await (await p.request.get('/api/flow/flows')).json()) as { flows?: unknown[] }).flows ?? []).toHaveLength(0);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/flow', { waitUntil: 'networkidle' });
    await expect(newFlow(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde el historial, el menú de la cuenta lleva a la lista y lo abre ahí; Esc sale.
    await p.goto('/en/app/flow/runs', { waitUntil: 'networkidle' });
    await expect(tour(p)).toHaveCount(0);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/flow$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.flow?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo con un flow: lo abre con un clic y sigue en el editor; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', scheme: 'dark', flows: 1 });
  try {
    await p.goto('/en/app/flow', { waitUntil: 'networkidle' });
    await expect(firstFlow(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const [id, target] of [
      ['newFlow', 'flow-new'],
      ['templates', 'flow-template'],
      ['runs', 'flow-runs'],
      ['credentials', 'flow-credentials'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openFlow');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir un flow lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await cardBesideTarget(p, 'flow-item', 'openFlow');
    await firstFlow(p).click();
    await p.waitForURL(/\/en\/app\/flow\/[^/]+$/);
    await stepIs(p, 'trigger');
    await expect.poll(async () => (await tours(p)).seen?.flow).toMatchObject({ status: 'active', step: 'trigger' });
    await cardBesideTarget(p, 'flow-trigger', 'trigger');
    for (const [id, target] of [
      ['addStep', 'flow-add-step'],
      ['test', 'flow-test'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
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
    expect(after.seen?.flow).toBeUndefined();

    await p.goto('/en/app/flow', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
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
    const { ctx, p } = await person(browser, { width: 390, scheme, look, flows: 1 });
    try {
      await p.goto('/en/app/flow', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstFlow(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      const check = async (id: string, target: string) => {
        await stepIs(p, id);
        const card = await p.getByTestId('tour').boundingBox();
        expect(card, look).not.toBeNull();
        expect(card!.x, look).toBeGreaterThanOrEqual(0);
        expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
        // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
        expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, `${look} ${id}`).toBe(true);
        await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
      };
      // En el teléfono el lateral es un cajón: el historial señala el link de la lista y las credenciales se saltean.
      for (const [id, target] of [
        ['newFlow', 'flow-new'],
        ['templates', 'flow-template'],
        ['runs', 'flow-history'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await check(id, target);
      }
      await p.getByTestId('tour-next').click();
      await check('openFlow', 'flow-item');
      await firstFlow(p).click();
      await p.waitForURL(/\/en\/app\/flow\/[^/]+$/);
      await check('trigger', 'flow-trigger');
      for (const [id, target] of [
        ['addStep', 'flow-add-step'],
        ['test', 'flow-test'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await check(id, target);
      }
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
