import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Send (lib/tours/send.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en la lista de documentos la primera vez después del onboarding,
 * va y vuelve, Enter avanza (no lleva a Documento nuevo), señala el lateral
 * (espacios, analítica), y abrir un documento cumple el paso y sigue ahí
 * (links, actividad) sin crear links. Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre desde un
 * documento, en equipo suma quién ve el documento, sin documentos los pasos
 * del documento se saltean, y en el teléfono va pegado abajo o arriba sin
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

async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Tour page ${i}`, { x: 60, y: 690, size: 34, font, color: rgb(0.1, 0.1, 0.1) });
  }
  return Buffer.from(await doc.save());
}

/** Un documento listo (subido y procesado), como en send.spec.ts. */
async function makeDoc(request: APIRequestContext, title: string) {
  const bytes = await pdf(2);
  const created = await request.post('/api/send/documents', { data: { title, file: { name: 'deck.pdf', mime: 'application/pdf', size: bytes.length } } });
  expect(created.status(), await created.text()).toBe(201);
  const { version } = await created.json();
  expect((await request.put(`/api/send/versions/${version.id}/parts/0`, { data: bytes, headers: { 'content-type': 'application/octet-stream' } })).ok()).toBe(true);
  expect((await request.post(`/api/send/versions/${version.id}/complete`, { data: {} })).ok()).toBe(true);
  for (let i = 0; i < 30; i++) {
    const v = (await (await request.post(`/api/send/versions/${version.id}/process`)).json()).version;
    if (v.status === 'ready') return;
    expect(v.status).toBe('processing');
  }
  throw new Error('the document never got ready');
}

interface Person {
  ctx: BrowserContext;
  p: Page;
}

async function person(
  browser: Browser,
  opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; docs?: number; look?: string } = {},
): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.send-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['send'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  for (let i = 0; i < (opts.docs ?? 0); i++) await makeDoc(ctx.request, `Tour deck ${i + 1}`);
  if (opts.look) {
    const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage() };
}

const tour = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('tour-count') });
const stepIs = async (p: Page, id: string) => expect(p.getByTestId('tour')).toHaveAttribute('data-tour-step', id, { timeout: 15_000 });
const firstDoc = (p: Page) => p.locator('[data-tour="send-doc-item"]').first();
/** El documento terminó de pintar: el botón de link nuevo (solo con una versión lista). */
const docReady = (p: Page) => expect(p.getByTestId('send-link-new')).toBeVisible({ timeout: 15_000 });

async function tours(p: Page) {
  return ((await (await p.request.get('/api/tours')).json()) as { tours: { off?: boolean; seen?: Record<string, { status: string; step?: string }> } }).tours;
}

/** Links de todos los documentos de la persona. */
async function linkCount(p: Page) {
  const { documents } = (await (await p.request.get('/api/send/documents')).json()) as { documents: Array<{ links: number }> };
  return documents.reduce((n, d) => n + d.links, 0);
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

/** El lateral, en la compu, antes de abrir un documento. */
const SIDEBAR_STEPS = [
  ['spaces', 'send-spaces'],
  ['analytics', 'send-analytics'],
] as const;

test('se abre solo, va y vuelve, abrir un documento sigue ahí sin crear links, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { docs: 2 });
  try {
    await p.goto('/en/app/send', { waitUntil: 'networkidle' });
    await expect(firstDoc(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'newDocument');
    await cardBesideTarget(p, 'send-new', 'newDocument');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no lleva a Documento nuevo.
    await p.keyboard.press('Enter');
    await stepIs(p, 'newDocument');
    await expect(p).toHaveURL(/\/en\/app\/send$/);
    for (const [id, target] of SIDEBAR_STEPS) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openDocument');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir un documento lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await cardBesideTarget(p, 'send-doc-item', 'openDocument');
    await firstDoc(p).click();
    await p.waitForURL(/\/en\/app\/send\/documents\/[^/]+$/);
    await docReady(p);
    await stepIs(p, 'links');
    await expect.poll(async () => (await tours(p)).seen?.send).toMatchObject({ status: 'active', step: 'links' });
    await cardBesideTarget(p, 'send-link-new', 'links');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'activity');
    await cardBesideTarget(p, 'send-activity', 'activity');
    // Persona sola: sin el paso de quién lo ve.
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.send?.status).toBe('done');
    // Ni Enter ni los clics del tour crearon links.
    expect(await linkCount(p)).toBe(0);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/send', { waitUntil: 'networkidle' });
    await expect(firstDoc(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde un documento, el menú de la cuenta lleva a la lista y lo abre ahí; Esc sale.
    await firstDoc(p).click();
    await p.waitForURL(/\/en\/app\/send\/documents\/[^/]+$/);
    await docReady(p);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/send$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.send?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma quién ve el documento; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', docs: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/send', { waitUntil: 'networkidle' });
    await expect(firstDoc(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newDocument', 'spaces', 'analytics', 'openDocument']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await firstDoc(p).click();
    await docReady(p);
    await stepIs(p, 'links');
    await cardBesideTarget(p, 'send-link-new', 'team links');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'activity');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'sharing');
    await cardBesideTarget(p, 'send-sharing', 'sharing');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.send).toBeUndefined();

    await p.goto('/en/app/send', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin documentos: abrir uno y los pasos del documento se saltean', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/send', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-tour="send-new"]')).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['newDocument', 'spaces', 'analytics', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await expect(p).toHaveURL(/\/en\/app\/send$/);
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
    const { ctx, p } = await person(browser, { width: 390, scheme, look, docs: 1 });
    try {
      await p.goto('/en/app/send', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstDoc(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'newDocument');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'send-new', `${look} newDocument`);
      // En el teléfono el lateral es un cajón: espacios y analítica se saltean.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'openDocument');
      await cardBesideTarget(p, 'send-doc-item', `${look} openDocument`);
      await firstDoc(p).click();
      await docReady(p);
      await stepIs(p, 'links');
      await cardBesideTarget(p, 'send-link-new', `${look} links`);
      await noHorizontalScroll(p, `${look} links`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'activity');
      await cardBesideTarget(p, 'send-activity', `${look} activity`);
      await noHorizontalScroll(p, `${look} activity`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
