import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Notes (lib/tours/notes.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en /app/notes la primera vez después del onboarding, va y vuelve,
 * Enter en la tarjeta avanza (no crea una nota ni llega a los atajos de
 * Notes), abrir una nota cumple el paso y sigue con la barra y las etiquetas,
 * Esc sale, "No mostrar más tours" lo apaga (y Ajustes › Apariencia lo
 * prende), el menú de la cuenta lo reabre, y en el teléfono va pegado abajo
 * sin scroll lateral en los cinco aspectos, sin el paso de libretas (el
 * lateral de Notes no se ve con la lista).
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

async function person(browser: Browser, opts: { width?: number; scheme?: 'light' | 'dark'; notes?: number; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.notes-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Tour', locale: 'en', apps: ['notes'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.notes ?? 0); i++) {
    const res = await ctx.request.post('/api/notes', { data: { title: `Tour note ${i + 1}`, content: [] } });
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
const firstNote = (p: Page) => p.locator('[data-tour="notes-item"]').first();

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function noteCount(p: Page) {
  return ((await (await p.request.get('/api/notes')).json()) as { notes: unknown[] }).notes.length;
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

test('se abre solo, va y vuelve, abrir una nota sigue con la barra y las etiquetas, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { notes: 2 });
  try {
    await p.goto('/en/app/notes', { waitUntil: 'networkidle' });
    await expect(firstNote(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newNote');
    await cardBesideTarget(p, 'notes-new', 'newNote');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no llega a los atajos de Notes.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newNote');
    for (const [id, target] of [
      ['notebooks', 'notes-notebooks'],
      ['search', 'notes-search'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openNote');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir una nota lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await firstNote(p).click();
    await stepIs(p, 'noteBar');
    await expect.poll(async () => (await tours(p)).seen?.notes).toMatchObject({ status: 'active', step: 'noteBar' });
    await cardBesideTarget(p, 'notes-note-bar', 'noteBar');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'tags');
    await cardBesideTarget(p, 'notes-tags', 'tags');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'shortcuts');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.notes?.status).toBe('done');
    // Ni Enter ni los clics del tour crearon notas.
    expect(await noteCount(p)).toBe(2);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/notes', { waitUntil: 'networkidle' });
    await expect(firstNote(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // El menú de la cuenta lo reabre desde el principio; Esc sale.
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.notes?.status).toBe('exited');

    // Desde otra página de Notes, el menú lleva a /app/notes y lo abre ahí.
    await p.goto('/en/app/notes/clip', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/notes$/);
    await stepIs(p, 'intro');
    await p.getByTestId('tour-exit').click();
    await expect(tour(p)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('saltear un paso, "No mostrar más tours" y volver a prenderlos en Ajustes › Apariencia', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { notes: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/notes', { waitUntil: 'networkidle' });
    await expect(firstNote(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newNote', 'notebooks', 'search', 'openNote']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    // Saltear sin abrir una nota: la barra y las etiquetas no están y siguen los atajos.
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
    expect(after.seen?.notes).toBeUndefined();

    await p.goto('/en/app/notes', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin notas: los pasos de la nota se saltean', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/notes', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
    for (const id of ['newNote', 'notebooks', 'search', 'shortcuts', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    expect(await noteCount(p)).toBe(0);
  } finally {
    await ctx.close();
  }
});

test('teléfono: tarjeta pegada abajo o arriba sin tapar, sin libretas y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look, notes: 1 });
    try {
      await p.goto('/en/app/notes', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstNote(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newNote');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'notes-new', `${look} newNote`);
      // Con la lista a la vista, el lateral de Notes no se ve: libretas se saltea.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'search');
      await cardBesideTarget(p, 'notes-search', `${look} search`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'openNote');
      await firstNote(p).click();
      await stepIs(p, 'noteBar');
      await cardBesideTarget(p, 'notes-note-bar', `${look} noteBar`);
      await noHorizontalScroll(p, `${look} noteBar`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'tags');
      await cardBesideTarget(p, 'notes-tags', `${look} tags`);
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
