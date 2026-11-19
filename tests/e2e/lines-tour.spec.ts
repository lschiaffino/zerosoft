import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Lines (lib/tours/lines.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as): se abre solo la primera vez después del
 * onboarding, va y vuelve, un paso "usá esto" avanza al usarlo o se saltea,
 * Esc sale, "No mostrar más tours" lo apaga (y Ajustes › Apariencia lo
 * prende), el menú de la cuenta lo reabre, los pasos cambian si es equipo o
 * persona sola (y pregunta una vez si no se sabe), sin números apunta a
 * conectar una línea, y en el teléfono va pegado abajo sin scroll lateral en
 * los cinco aspectos.
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
  email: string;
}

async function person(
  browser: Browser,
  opts: { mode: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; sample?: boolean; unknownMode?: boolean; look?: string },
): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode, name: 'Tour', locale: 'en', apps: ['groups'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  if (opts.sample) {
    const res = await ctx.request.post('/api/groups/sample', { data: { locale: 'en' } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  // Un workspace de antes del modo: no dice si es equipo.
  if (opts.unknownMode) await sql('UPDATE teams SET use_mode = NULL WHERE owner_id = ?', [String(row.id)]);
  if (opts.look) {
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage(), email };
}

const tour = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('tour-count') });
const stepIs = async (p: Page, id: string) => expect(p.getByTestId('tour')).toHaveAttribute('data-tour-step', id, { timeout: 15_000 });

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; audience?: string; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

async function noHorizontalScroll(p: Page, label: string) {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test('persona sola: se abre solo, va y vuelve, abrir un chat avanza, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { mode: 'personal', sample: true });
  try {
    await p.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('chat-row').first()).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Persona sola deducida del workspace: no pregunta.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    // Con una sola línea no hay selector: el paso se saltea.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'chatList');
    await expect(p.getByTestId('tour-count')).toContainText('2');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await p.keyboard.press('Enter');
    await stepIs(p, 'chatList');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'filters');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'search');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openChat');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir un chat lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await p.getByTestId('chat-row').first().click();
    await stepIs(p, 'composer');
    await expect.poll(async () => (await tours(p)).seen?.lines).toMatchObject({ status: 'active', step: 'composer' });
    // Persona sola: ni asignar ni notas; los ajustes de Lines en el lateral.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'settings');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.lines?.status).toBe('done');

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('chat-row').first()).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // El menú de la cuenta lo reabre desde el principio; Esc sale.
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.lines?.status).toBe('exited');

    // Desde otra página de Lines, el menú lleva a la bandeja y lo abre ahí.
    await p.goto('/en/app/lines/templates', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/lines\/inbox$/);
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('equipo sin dato en el workspace: pregunta una vez y suma asignar, notas y acceso a líneas', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { mode: 'team', sample: true, unknownMode: true });
  try {
    await p.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('chat-row').first()).toBeVisible();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-solo')).toBeFocused();
    await p.getByTestId('tour-team').click();
    await stepIs(p, 'chatList');
    await expect.poll(async () => (await tours(p)).audience).toBe('team');
    for (const id of ['filters', 'search']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openChat');
    await p.getByTestId('chat-row').first().click();
    await stepIs(p, 'composer');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'assign');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'note');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'lineAccess');
    // Resalta los ajustes de Lines en el lateral.
    const link = await p.locator('[data-tour="lines-settings"]').boundingBox();
    await expect
      .poll(async () => {
        const spot = await p.locator('.zs-tour-spot').boundingBox();
        return !!spot && !!link && spot.x <= link.x && spot.y <= link.y && spot.x + spot.width >= link.x + link.width && spot.y + spot.height >= link.y + link.height;
      })
      .toBe(true);
    await p.getByTestId('tour-exit').click();
    await expect(tour(p)).toHaveCount(0);

    // Contestó una vez: la próxima no pregunta.
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('saltear un paso, "No mostrar más tours" y volver a prenderlos en Ajustes › Apariencia', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { mode: 'personal', sample: true });
  try {
    await p.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('chat-row').first()).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['chatList', 'filters', 'search', 'openChat']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    // Saltear sin abrir un chat: el paso de responder no tiene dónde mostrarse y sigue el de ajustes.
    await p.getByTestId('tour-skip').click();
    await stepIs(p, 'settings');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    await expect(p.getByTestId('appearance-tours-status')).not.toBeEmpty();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.lines).toBeUndefined();

    await p.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('teléfono: sin números apunta a conectar una línea, tarjeta pegada abajo y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { mode: 'personal', width: 390, scheme, look });
    try {
      await p.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await stepIs(p, 'intro');
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'connect');
      const card = await p.getByTestId('tour').boundingBox();
      const target = await p.locator('[data-tour="lines-connect"]').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo; nunca encima del elemento.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      expect(target && (card!.y >= target.y + target.height || card!.y + card!.height <= target.y), look).toBe(true);
      await noHorizontalScroll(p, look);
      // En el teléfono el lateral es un cajón: el paso de ajustes no tiene dónde mostrarse.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
