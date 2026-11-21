import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Docs (lib/tours/docs.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en /app/docs la primera vez después del onboarding, va y vuelve,
 * Enter en la tarjeta avanza (no crea una página con el atajo C), abrir una
 * página de la lista cumple el paso y sigue en la página con el título,
 * comentarios, compartir y el menú, Esc sale, "No mostrar más tours" lo apaga
 * (y Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre, y en el
 * teléfono va pegado abajo o arriba sin scroll lateral en los cinco aspectos
 * (sin el paso de búsqueda: vive en el cajón de páginas).
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

async function person(browser: Browser, opts: { width?: number; scheme?: 'light' | 'dark'; pages?: number; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.docs-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Tour', locale: 'en', apps: ['docs'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.pages ?? 0); i++) {
    const res = await ctx.request.post('/api/docs/pages', { data: { title: `Tour page ${i + 1}` } });
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
const firstPage = (p: Page) => p.locator('[data-tour="docs-item"]').first();

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function pageCount(p: Page) {
  return ((await (await p.request.get('/api/docs/pages')).json()) as { rows: unknown[] }).rows.length;
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

test('se abre solo, va y vuelve, abrir una página sigue en la página, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { pages: 2 });
  try {
    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(firstPage(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newPage');
    await cardBesideTarget(p, 'docs-new', 'newPage');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no llega al atajo de Docs.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newPage');
    for (const [id, target] of [
      ['templates', 'docs-templates'],
      ['pages', 'docs-pages'],
      ['search', 'docs-search'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openPage');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir una página lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await firstPage(p).click();
    await p.waitForURL(/\/en\/app\/docs\/[^/]+$/);
    await stepIs(p, 'write');
    await expect.poll(async () => (await tours(p)).seen?.docs).toMatchObject({ status: 'active', step: 'write' });
    await cardBesideTarget(p, 'docs-title', 'write');
    for (const [id, target] of [
      ['comments', 'docs-comments'],
      ['share', 'docs-share'],
      ['pageMenu', 'docs-page-menu'],
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
    await expect.poll(async () => (await tours(p)).seen?.docs?.status).toBe('done');
    // Ni Enter ni los clics del tour crearon páginas.
    expect(await pageCount(p)).toBe(2);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(firstPage(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // El menú de la cuenta lo reabre desde el principio; Esc sale.
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.docs?.status).toBe('exited');

    // Desde una página, el menú lleva al inicio de Docs y lo abre ahí.
    await firstPage(p).click();
    await p.waitForURL(/\/en\/app\/docs\/[^/]+$/);
    await expect(p.locator('[data-tour="docs-title"]')).toBeVisible();
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/docs$/);
    await stepIs(p, 'intro');
    await p.getByTestId('tour-exit').click();
    await expect(tour(p)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('saltear un paso, "No mostrar más tours" y volver a prenderlos en Ajustes › Apariencia', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { pages: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(firstPage(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newPage', 'templates', 'pages', 'search', 'openPage']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    // Saltear sin abrir una página: los pasos de la página no están y siguen los atajos.
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
    expect(after.seen?.docs).toBeUndefined();

    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin páginas: abrir una y los pasos de la página se saltean', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
    for (const id of ['newPage', 'templates', 'pages', 'search', 'shortcuts', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    expect(await pageCount(p)).toBe(0);
  } finally {
    await ctx.close();
  }
});

test('teléfono: tarjeta pegada abajo o arriba sin tapar, sin búsqueda y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look, pages: 1 });
    try {
      await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstPage(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newPage');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'docs-new', `${look} newPage`);
      for (const [id, target] of [
        ['templates', 'docs-templates'],
        ['pages', 'docs-pages'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        await cardBesideTarget(p, target, `${look} ${id}`);
      }
      // La búsqueda vive en el cajón de páginas, cerrado: el paso se saltea.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'openPage');
      await firstPage(p).click();
      await p.waitForURL(/\/en\/app\/docs\/[^/]+$/);
      await stepIs(p, 'write');
      await cardBesideTarget(p, 'docs-title', `${look} write`);
      await noHorizontalScroll(p, `${look} write`);
      for (const [id, target] of [
        ['comments', 'docs-comments'],
        ['share', 'docs-share'],
        ['pageMenu', 'docs-page-menu'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        await cardBesideTarget(p, target, `${look} ${id}`);
      }
      // En el teléfono el paso de atajos de teclado se saltea, y los textos no nombran atajos.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await expect(p.getByTestId('tour')).toHaveAttribute('data-tour-touch', 'true');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
