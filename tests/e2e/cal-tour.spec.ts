import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Cal (lib/tours/cal.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en el resumen de Cal la primera vez después del onboarding, va y
 * vuelve, Enter avanza (no abre el alta de un tipo de evento), señala crear,
 * la fila del link, las próximas reservas y el lateral (reservas,
 * disponibilidad, ajustes). Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre desde otra
 * página de Cal, en equipo suma los formularios de ruteo, sin tipos de evento
 * el paso de la fila se saltea, y en el teléfono va pegado abajo o arriba sin
 * tapar ni scroll lateral en los cinco aspectos.
 *
 * No crea reservas: nada depende de la fecha ni de la hora.
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
  opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; eventTypes?: number; look?: string } = {},
): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.cal-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['cal'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.eventTypes ?? 0); i++) {
    const res = await ctx.request.post('/api/calendar/event-types', { data: { title: `Tour call ${i + 1}`, slug: `tour-${uid()}`, durationMin: 30 } });
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
/** El resumen terminó de pintar: la sección de próximas reservas y, si hay, la lista de tipos de evento. */
async function overviewReady(p: Page, withList: boolean) {
  await expect(p.getByTestId('cal-upcoming')).toBeVisible();
  if (withList) await expect(p.locator('[data-tour="cal-event-item"]')).toBeVisible();
}

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function eventTypeCount(p: Page) {
  return ((await (await p.request.get('/api/calendar/event-types')).json()) as { rows: unknown[] }).rows.length;
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

test('se abre solo, va y vuelve, recorre el resumen y el lateral, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { eventTypes: 2 });
  try {
    await p.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    await overviewReady(p, true);
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newEventType');
    await cardBesideTarget(p, 'cal-new', 'newEventType');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no abre el alta de un tipo de evento.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newEventType');
    for (const [id, target] of [
      ['eventType', 'cal-event-item'],
      ['upcoming', 'cal-upcoming'],
      ['bookings', 'cal-bookings'],
      ['availability', 'cal-availability'],
      ['settings', 'cal-settings'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.cal?.status).toBe('done');
    // Ni Enter ni los clics del tour crearon tipos de evento.
    expect(await eventTypeCount(p)).toBe(2);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    await overviewReady(p, true);
    await expect(tour(p)).toHaveCount(0);

    // Desde otra página de Cal, el menú de la cuenta lleva al resumen y lo abre ahí; Esc sale.
    await p.goto('/en/app/calendar/bookings', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/calendar$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.cal?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma los formularios de ruteo; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', eventTypes: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    await overviewReady(p, true);
    await stepIs(p, 'intro');
    for (const id of ['newEventType', 'eventType', 'upcoming', 'bookings', 'availability']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'routing');
    await cardBesideTarget(p, 'cal-routing', 'routing');
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
    expect(after.seen?.cal).toBeUndefined();

    await p.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin tipos de evento: el paso de la fila se saltea', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    await overviewReady(p, false);
    await stepIs(p, 'intro');
    for (const id of ['newEventType', 'upcoming', 'bookings', 'availability', 'settings', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    expect(await eventTypeCount(p)).toBe(0);
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
    const { ctx, p } = await person(browser, { width: 390, scheme, look, eventTypes: 1 });
    try {
      await p.goto('/en/app/calendar', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await overviewReady(p, true);
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newEventType');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'cal-new', `${look} newEventType`);
      // En el teléfono el lateral es un cajón: reservas señala "Ver todas" del resumen, y el resto del lateral se saltea.
      for (const [id, target] of [
        ['eventType', 'cal-event-item'],
        ['upcoming', 'cal-upcoming'],
        ['bookings', 'cal-all-bookings'],
      ] as const) {
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
