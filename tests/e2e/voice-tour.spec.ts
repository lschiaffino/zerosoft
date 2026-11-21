import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Voice (lib/tours/voice.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en Reuniones la primera vez después del onboarding, va y vuelve,
 * Enter avanza (no crea una reunión ni prende el micrófono), señala nueva
 * reunión, importar, próximas, preguntas, carpetas, la lista con su búsqueda y
 * el lateral (dictado, ajustes). Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre desde
 * Dictado, sin reuniones señala el botón de la lista vacía, y en el teléfono
 * (sin lateral) va pegado abajo o arriba sin tapar ni scroll lateral en los
 * cinco aspectos.
 *
 * No graba nada: las reuniones se crean por la API.
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

async function person(browser: Browser, opts: { width?: number; scheme?: 'light' | 'dark'; meetings?: number; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.voice-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Tour', locale: 'en', apps: ['voice'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.meetings ?? 0); i++) {
    const res = await ctx.request.post('/api/voice/sessions', { data: { title: `Tour call ${i + 1}`, locale: 'en' } });
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

/** Reuniones terminó de pintar: las secciones y, si hay reuniones, una fila de la lista. */
async function voiceReady(p: Page, withRows: boolean) {
  await expect(p.locator('[data-tour="voice-meetings"]')).toBeVisible();
  if (withRows) await expect(p.getByTestId('voice-meeting-row').first()).toBeVisible();
}

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function meetingCount(p: Page) {
  return ((await (await p.request.get('/api/voice/sessions?kind=meeting')).json()) as { sessions: unknown[] }).sessions.length;
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
  // Un elemento más alto que la ventana (la lista en el teléfono) se recorta: la tarjeta va encima de lo visible.
  const top = Math.max(el!.y, 0);
  const bottom = Math.min(el!.y + el!.height, vp.height);
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= bottom || card!.y + card!.height <= top;
  expect(apart, label).toBe(true);
}

test('se abre solo, va y vuelve, recorre Reuniones y el lateral, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { meetings: 2 });
  try {
    await p.goto('/en/app/voice', { waitUntil: 'networkidle' });
    await voiceReady(p, true);
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Voice no pregunta equipo o sola: los mismos pasos para todos.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newMeeting');
    await cardBesideTarget(p, 'voice-new', 'newMeeting');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no crea una reunión.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newMeeting');
    for (const [id, target] of [
      ['import', 'voice-import'],
      ['upcoming', 'voice-upcoming'],
      ['ask', 'voice-ask'],
      ['folders', 'voice-folders'],
      ['meetings', 'voice-meetings'],
      ['dictation', 'voice-dictation'],
      ['settings', 'voice-settings'],
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
    await expect.poll(async () => (await tours(p)).seen?.voice?.status, { timeout: 20_000 }).toBe('done');
    // Ni Enter ni los clics del tour crearon reuniones, y seguimos en Reuniones.
    expect(await meetingCount(p)).toBe(2);
    expect(new URL(p.url()).pathname).toBe('/en/app/voice');

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/voice', { waitUntil: 'networkidle' });
    await voiceReady(p, true);
    await expect(tour(p)).toHaveCount(0);

    // Desde Dictado, el menú de la cuenta lleva a Reuniones y lo abre ahí; Esc sale.
    await p.goto('/en/app/voice/dictation', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/voice$/);
    await voiceReady(p, true);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.voice?.status, { timeout: 20_000 }).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('sin reuniones señala el botón de la lista vacía; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { scheme: 'dark' });
  try {
    await p.goto('/en/app/voice', { waitUntil: 'networkidle' });
    await voiceReady(p, false);
    await stepIs(p, 'intro');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newMeeting');
    // Sin reuniones, Nueva reunión vive en la lista vacía (no en la cabecera).
    await expect(p.locator('[data-tour="voice-meetings"] [data-tour="voice-new"]')).toBeVisible();
    await cardBesideTarget(p, 'voice-new', 'newMeeting');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'import');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off, { timeout: 20_000 }).toBe(true);
    expect(await meetingCount(p)).toBe(0);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.voice).toBeUndefined();

    await p.goto('/en/app/voice', { waitUntil: 'networkidle' });
    await voiceReady(p, false);
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('teléfono: sin lateral, tarjeta pegada abajo o arriba sin tapar y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look, meetings: 1 });
    try {
      await p.goto('/en/app/voice', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await voiceReady(p, true);
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      // En el teléfono el lateral es un cajón: dictado y ajustes se saltean.
      for (const [id, target] of [
        ['newMeeting', 'voice-new'],
        ['import', 'voice-import'],
        ['upcoming', 'voice-upcoming'],
        ['ask', 'voice-ask'],
        ['folders', 'voice-folders'],
        ['meetings', 'voice-meetings'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        const card = await p.getByTestId('tour').boundingBox();
        expect(card, look).not.toBeNull();
        // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
        expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, `${look} ${id}`).toBe(true);
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
