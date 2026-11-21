import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Board (lib/tours/board.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en la lista la primera vez después del onboarding, va y vuelve,
 * Enter en la tarjeta avanza (no crea una pizarra), abrir una pizarra cumple
 * el paso y sigue en el lienzo (formas, herramientas, zoom, compartir), la
 * capa del tour no le quita los clics al lienzo, ni mientras se muestra ni al
 * salir, y sigue al elemento con zoom. Esc sale, "No mostrar más tours" lo
 * apaga (y Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre,
 * en equipo suma el taller y compartir con el workspace, sin pizarras los
 * pasos del lienzo se saltean, y en el teléfono va pegado abajo o arriba sin
 * tapar ni scroll lateral en los cinco aspectos.
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
  opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; boards?: number; look?: string } = {},
): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.board-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['board'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.boards ?? 0); i++) {
    const res = await ctx.request.post('/api/boards', { data: { name: `Tour board ${i + 1}` } });
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
const firstBoard = (p: Page) => p.locator('[data-tour="board-item"]').first();
/** El link de la tarjeta (el nombre): abre la pizarra. */
const openFirstBoard = (p: Page) => firstBoard(p).getByRole('link').first().click();

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function boardCount(p: Page) {
  return ((await (await p.request.get('/api/boards')).json()) as { boards: unknown[] }).boards.length;
}

async function noHorizontalScroll(p: Page, label: string) {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

/** La tarjeta no tapa el elemento resaltado y entra en la ventana. */
async function cardBesideTarget(p: Page, target: string, label: string) {
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

/** Lo que hay bajo un punto libre del lienzo es el lienzo de Excalidraw (la capa del tour no toma clics). */
async function canvasTakesClicks(p: Page, label: string) {
  const box = await p.locator('.board-canvas').boundingBox();
  expect(box, label).not.toBeNull();
  const hit = await p.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el instanceof HTMLCanvasElement && !!el.closest('.excalidraw');
    },
    [box!.x + box!.width * 0.6, box!.y + box!.height * 0.45],
  );
  expect(hit, label).toBe(true);
}

test('se abre solo, va y vuelve, abrir una pizarra sigue en el lienzo sin bloquear el dibujo, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { boards: 2 });
  try {
    await p.goto('/en/app/board', { waitUntil: 'networkidle' });
    await expect(firstBoard(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newBoard');
    await cardBesideTarget(p, 'board-new', 'newBoard');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no crea una pizarra.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newBoard');
    for (const [id, target] of [
      ['templates', 'board-templates'],
      ['organize', 'board-organize'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openBoard');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir una pizarra lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await openFirstBoard(p);
    await p.waitForURL(/\/en\/app\/board\/[^/]+$/);
    await stepIs(p, 'toolbar');
    await expect.poll(async () => (await tours(p)).seen?.board).toMatchObject({ status: 'active', step: 'toolbar' });
    await cardBesideTarget(p, 'board-toolbar', 'toolbar');
    // Con el tour a la vista, el lienzo sigue tomando los clics.
    await canvasTakesClicks(p, 'toolbar');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'canvasTools');
    await cardBesideTarget(p, 'board-canvas-tools', 'canvasTools');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'zoom');
    await cardBesideTarget(p, 'board-zoom', 'zoom');
    // Zoom del lienzo con el tour abierto: la tarjeta sigue al lado del elemento.
    const canvas = (await p.locator('.board-canvas').boundingBox())!;
    await p.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await p.keyboard.down('Control');
    await p.mouse.wheel(0, -400);
    await p.keyboard.up('Control');
    await stepIs(p, 'zoom');
    await cardBesideTarget(p, 'board-zoom', 'zoom after wheel');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'share');
    await cardBesideTarget(p, 'board-share', 'share');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'shortcuts');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.board?.status).toBe('done');
    // Al salir el lienzo queda libre para dibujar.
    await canvasTakesClicks(p, 'after');
    // Ni Enter ni los clics del tour crearon pizarras.
    expect(await boardCount(p)).toBe(2);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/board', { waitUntil: 'networkidle' });
    await expect(firstBoard(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde una pizarra, el menú de la cuenta lleva a la lista y lo abre ahí; Esc sale.
    await openFirstBoard(p);
    await p.waitForURL(/\/en\/app\/board\/[^/]+$/);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/board$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.board?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma el taller y compartir con el workspace; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', boards: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/board', { waitUntil: 'networkidle' });
    await expect(firstBoard(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newBoard', 'templates', 'organize', 'openBoard']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await openFirstBoard(p);
    await stepIs(p, 'toolbar');
    for (const id of ['canvasTools', 'zoom']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'workshop');
    await cardBesideTarget(p, 'board-workshop', 'workshop');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'shareTeam');
    await cardBesideTarget(p, 'board-share', 'shareTeam');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.board).toBeUndefined();

    await p.goto('/en/app/board', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin pizarras: abrir una y los pasos del lienzo se saltean', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/board', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-tour="board-templates"]')).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newBoard', 'templates', 'organize', 'shortcuts', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    expect(await boardCount(p)).toBe(0);
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
    const { ctx, p } = await person(browser, { width: 390, scheme, look, boards: 1 });
    try {
      await p.goto('/en/app/board', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstBoard(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newBoard');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'board-new', `${look} newBoard`);
      for (const [id, target] of [
        ['templates', 'board-templates'],
        ['organize', 'board-organize'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        // Las plantillas ocupan más que media pantalla: alcanza con que la tarjeta entre y no haya scroll lateral.
        if (id === 'organize') await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
      }
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'openBoard');
      await openFirstBoard(p);
      await stepIs(p, 'toolbar');
      await cardBesideTarget(p, 'board-toolbar', `${look} toolbar`);
      await noHorizontalScroll(p, `${look} toolbar`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'canvasTools');
      await cardBesideTarget(p, 'board-canvas-tools', `${look} canvasTools`);
      // En el teléfono Excalidraw no muestra la barra de zoom: sigue compartir.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'share');
      await cardBesideTarget(p, 'board-share', `${look} share`);
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
