import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Tour guiado de Inbox (lib/tours/inbox.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo la primera vez después del onboarding, va y vuelve, abrir un chat
 * avanza el paso "usá esto", Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre, sin
 * cuentas apunta a conectar una, y en el teléfono va pegado abajo sin scroll
 * lateral en los cinco aspectos. Inbox es de cada persona: no pregunta si es
 * equipo.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

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

async function person(browser: Browser, opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; chats?: number; look?: string } = {}): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.inbox-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['inbox'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  if (opts.chats) {
    // WhatsApp falso vinculado y chats que llegan por el webhook, como en inbox.spec.ts.
    await ctx.request.post('/api/inbox/whatsapp', waLinkIp());
    await expect
      .poll(async () => ((await (await ctx.request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 })
      .toBe('connected');
    const [acc] = await sql("SELECT id, webhook_secret FROM inbox_accounts WHERE owner_id = ? AND kind = 'whatsapp'", [String(row.id)]);
    for (let i = 0; i < opts.chats; i++) {
      const from = phone();
      const res = await ctx.request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, {
        data: {
          events: [
            {
              type: 'message',
              chatId: `${from}@s.whatsapp.net`,
              isGroup: false,
              fromMe: false,
              senderPhone: from,
              senderName: `Tour ${uid()}`,
              providerMessageId: `in-${uid()}`,
              body: 'Hola',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
  }
  if (opts.look) {
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage() };
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

/** La tarjeta no tapa el elemento resaltado y entra en la ventana. */
async function cardBesideTarget(p: Page, target: string, label: string) {
  const card = await p.getByTestId('tour').boundingBox();
  const el = await p.locator(`[data-tour="${target}"]`).first().boundingBox();
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

test('se abre solo, va y vuelve, abrir un chat avanza, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { chats: 2 });
  try {
    await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('inbox-row').first()).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Inbox es de cada persona: no pregunta si es equipo.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    // Con una cuenta conectada no hay paso de conectar: sigue la lista.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'chatList');
    await expect(p.getByTestId('tour-count')).toContainText('2');
    await cardBesideTarget(p, 'inbox-chat-list', 'chatList');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await p.keyboard.press('Enter');
    await stepIs(p, 'chatList');
    for (const [id, target] of [
      ['filters', 'inbox-filters'],
      ['search', 'inbox-search'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openChat');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir un chat lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await p.getByTestId('inbox-row').first().locator('[data-tour="inbox-chat-row"]').click();
    await stepIs(p, 'composer');
    await expect.poll(async () => (await tours(p)).seen?.inbox).toMatchObject({ status: 'active', step: 'composer' });
    await cardBesideTarget(p, 'inbox-composer', 'composer');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'triage');
    await cardBesideTarget(p, 'inbox-triage', 'triage');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'settings');
    await cardBesideTarget(p, 'inbox-settings', 'settings');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.inbox?.status).toBe('done');

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('inbox-row').first()).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // El menú de la cuenta lo reabre desde el principio; Esc sale.
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.inbox?.status).toBe('exited');

    // Desde otra página de Inbox, el menú lleva a la bandeja y lo abre ahí.
    await p.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/inbox$/);
    await stepIs(p, 'intro');
    // Salir con la cruz.
    await p.getByTestId('tour-exit').click();
    await expect(tour(p)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('saltear un paso, "No mostrar más tours" y volver a prenderlos en Ajustes › Apariencia', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { chats: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('inbox-row').first()).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['chatList', 'filters', 'search', 'openChat']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    // Saltear sin abrir un chat: responder y archivar no tienen dónde mostrarse y siguen los ajustes.
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
    expect(after.seen?.inbox).toBeUndefined();

    await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('equipo: los mismos pasos, sin preguntar', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser, { mode: 'team', chats: 1 });
  try {
    await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('inbox-row').first()).toBeVisible();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-team')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'chatList');
  } finally {
    await ctx.close();
  }
});

test('teléfono: sin cuentas apunta a conectar una, tarjeta pegada abajo y sin scroll lateral en los cinco aspectos', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const [look, scheme] of [
    ['current', 'light'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    const { ctx, p } = await person(browser, { width: 390, scheme, look });
    try {
      await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await stepIs(p, 'intro');
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'connect');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
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

test('teléfono con chats: abrir uno lleva a responder y archivar, y la tarjeta no tapa el elemento', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, p } = await person(browser, { width: 390, chats: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('inbox-row').first()).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['chatList', 'filters', 'search', 'openChat']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await p.getByTestId('inbox-row').first().locator('[data-tour="inbox-chat-row"]').click();
    await stepIs(p, 'composer');
    await cardBesideTarget(p, 'inbox-composer', 'composer 390');
    await noHorizontalScroll(p, 'composer 390');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'triage');
    await cardBesideTarget(p, 'inbox-triage', 'triage 390');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
  } finally {
    await ctx.close();
  }
});
