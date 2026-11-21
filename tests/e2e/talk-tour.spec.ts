import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Talk (lib/tours/talk.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo la primera vez después del onboarding aunque Talk pase enseguida
 * de /app/talk al canal, va y vuelve, Enter avanza (no manda un mensaje),
 * señala canales, mensajes directos, el redactor, hilos, la búsqueda, y la
 * analítica y los ajustes en el lateral de la app. Esc
 * sale, "No mostrar más tours" lo apaga (y Ajustes › Apariencia lo prende), el
 * menú de la cuenta lo reabre desde Ajustes de Talk, y en el teléfono (la
 * lista, sin la conversación) se saltea el redactor y el lateral, los textos
 * no nombran atajos de teclado, va pegado abajo o arriba sin tapar y sin
 * scroll lateral en los cinco aspectos.
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

async function person(browser: Browser, opts: { width?: number; scheme?: 'light' | 'dark'; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.talk-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'Tour', locale: 'en', apps: ['talk'] } });
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

/** Talk terminó de pintar: la fila del canal en el lateral (#general) y, en la compu, el redactor. */
async function talkReady(p: Page, withComposer: boolean) {
  await expect(p.locator('.talk-side [data-channel-id]').first()).toBeVisible();
  if (withComposer) await expect(p.locator('[data-tour="talk-composer"]')).toBeVisible();
}

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function messageCount(p: Page, channelId: string) {
  return ((await (await p.request.get(`/api/talk/channels/${channelId}/messages`)).json()) as { messages: unknown[] }).messages.length;
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

test('se abre solo en el canal, va y vuelve, recorre Talk, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/talk', { waitUntil: 'networkidle' });
    await talkReady(p, true);
    // Talk pasa solo al canal (#general): el tour se abre igual.
    await p.waitForURL(/\/en\/app\/talk\/[\w-]+$/);
    const channelId = new URL(p.url()).pathname.split('/').pop()!;
    const before = await messageCount(p, channelId);
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Talk no pregunta equipo o sola: los mismos pasos para todos.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'channels');
    await cardBesideTarget(p, 'talk-channels', 'channels');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no llega al redactor ni manda nada.
    await p.keyboard.press('Enter');
    await stepIs(p, 'channels');
    for (const [id, target] of [
      ['dms', 'talk-dms'],
      ['composer', 'talk-composer'],
      ['threads', 'talk-threads'],
      ['search', 'talk-search'],
      // El lateral de la app: analítica y ajustes de Talk.
      ['analytics', 'talk-analytics'],
      ['settings', 'talk-settings'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
      // En la compu los textos nombran los atajos (Cmd+G para buscar).
      await expect(p.getByTestId('tour')).not.toHaveAttribute('data-tour-touch', /.*/);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    // El progreso se guarda en fila (un POST por paso): el último llega después de los anteriores.
    await expect.poll(async () => (await tours(p)).seen?.talk?.status, { timeout: 20_000 }).toBe('done');
    // Ni Enter ni los clics del tour mandaron mensajes.
    expect(await messageCount(p, channelId)).toBe(before);

    // Terminado: no vuelve a abrirse solo.
    await p.goto(`/en/app/talk/${channelId}`, { waitUntil: 'networkidle' });
    await talkReady(p, true);
    await expect(tour(p)).toHaveCount(0);

    // Desde Ajustes de Talk, el menú de la cuenta lleva a Talk y lo abre ahí; Esc sale.
    await p.goto('/en/app/talk/settings', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/talk(\/[\w-]+)?$/);
    await talkReady(p, true);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.talk?.status, { timeout: 20_000 }).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('"No mostrar más tours" y volver a prenderlos; un paso salteado no rompe la cuenta', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { scheme: 'dark' });
  try {
    await p.goto('/en/app/talk', { waitUntil: 'networkidle' });
    await talkReady(p, true);
    await stepIs(p, 'intro');
    for (const id of ['channels', 'dms', 'composer']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off, { timeout: 20_000 }).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.talk).toBeUndefined();

    await p.goto('/en/app/talk', { waitUntil: 'networkidle' });
    await talkReady(p, true);
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('teléfono: la lista sin el redactor, tarjeta pegada sin tapar y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
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
      await p.goto('/en/app/talk', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await talkReady(p, false);
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      // En el teléfono se ve la lista (canales, mensajes directos, hilos, búsqueda): el redactor se saltea, y
      // el lateral de la app es un cajón: analítica y ajustes también. Los textos van sin atajos de teclado.
      for (const [id, target] of [
        ['channels', 'talk-channels'],
        ['dms', 'talk-dms'],
        ['threads', 'talk-threads'],
        ['search', 'talk-search'],
      ] as const) {
        await p.getByTestId('tour-next').click();
        await stepIs(p, id);
        const card = await p.getByTestId('tour').boundingBox();
        expect(card, look).not.toBeNull();
        // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
        expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, `${look} ${id}`).toBe(true);
        await cardBesideTarget(p, target, `${look} ${id}`);
        await noHorizontalScroll(p, `${look} ${id}`);
        await expect(p.getByTestId('tour')).toHaveAttribute('data-tour-touch', 'true');
      }
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
