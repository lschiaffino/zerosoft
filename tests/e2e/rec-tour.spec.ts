import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Tour guiado de Rec (lib/tours/rec.ts, components/tour/TourHost.tsx) con
 * personas nuevas (cookie zs_e2e_as, un dominio de mail propio cada una): se
 * abre solo en Mis videos la primera vez después del onboarding, va y vuelve,
 * Enter avanza (no lleva al grabador), señala grabar, subir y los ajustes, y
 * abrir un video cumple el paso y sigue ahí (compartir, analítica) sin abrir
 * el diálogo de compartir. Esc sale, "No mostrar más tours" lo apaga (y
 * Ajustes › Apariencia lo prende), el menú de la cuenta lo reabre desde un
 * video, en equipo suma el workspace, sin videos los pasos del video se
 * saltean, y en el teléfono va pegado abajo o arriba sin tapar ni scroll
 * lateral en los cinco aspectos.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
/** Cabecera de un WebM: alcanza para un video listo en la lista (como rec-trash.spec.ts). */
const tiny = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function ok(res: Promise<import('@playwright/test').APIResponse>) {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return r;
}

/** Un video listo subido por la API, como el grabador. */
async function makeVideo(request: APIRequestContext, title: string) {
  const { video } = (await (await ok(request.post('/api/rec/videos', { data: { title, mode: 'camera', contentType: 'video/webm' } }))).json()) as { video: { id: string } };
  const put = await request.put(`/api/rec/videos/${video.id}/parts?kind=video&n=1`, { data: tiny, headers: { 'content-type': 'application/octet-stream' } });
  expect(put.status()).toBe(204);
  await ok(request.post(`/api/rec/videos/${video.id}/complete`, { data: { kind: 'video', contentType: 'video/webm', parts: 1 } }));
  await ok(request.post(`/api/rec/videos/${video.id}/finalize`, { data: { durationSec: 2 } }));
  return video.id;
}

interface Person {
  ctx: BrowserContext;
  p: Page;
}

async function person(
  browser: Browser,
  opts: { mode?: 'personal' | 'team'; width?: number; scheme?: 'light' | 'dark'; videos?: number; look?: string } = {},
): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const width = opts.width ?? 1280;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: opts.scheme ?? 'light' });
  const email = `tour-${uid()}@${uid()}.rec-tour-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const onb = await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode ?? 'personal', name: 'Tour', locale: 'en', apps: ['rec'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  const videos: string[] = [];
  for (let i = 0; i < (opts.videos ?? 0); i++) videos.push(await makeVideo(ctx.request, `Tour video ${i + 1}`));
  // La página del video ya pedida una vez: con E2E_DEV (next dev) la primera compilación tarda más de lo que
  // el tour espera después del clic (AFTER_CLICK_MS) y saltearía los pasos del video.
  if (videos.length) expect((await ctx.request.get(`/en/app/rec/${videos[videos.length - 1]}`)).ok()).toBe(true);
  if (opts.look) {
    const [row] = await sql('SELECT id FROM users WHERE email = ?', [email]);
    await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, String(row.id)]);
    await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  }
  return { ctx, p: await ctx.newPage() };
}

const tour = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('tour-count') });
const stepIs = async (p: Page, id: string) => expect(p.getByTestId('tour')).toHaveAttribute('data-tour-step', id, { timeout: 15_000 });
const firstVideo = (p: Page) => p.locator('[data-tour="rec-video-item"]').first();
/** El video terminó de pintar: el botón Compartir de la cabecera. */
const videoReady = (p: Page) => expect(p.getByTestId('rec-share')).toBeVisible({ timeout: 15_000 });

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
  const apart = card!.x >= el!.x + el!.width || card!.x + card!.width <= el!.x || card!.y >= el!.y + el!.height || card!.y + card!.height <= el!.y;
  expect(apart, label).toBe(true);
}

test('se abre solo, va y vuelve, abrir un video sigue ahí, termina y se reabre desde el menú', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { videos: 2 });
  try {
    await p.goto('/en/app/rec', { waitUntil: 'networkidle' });
    await expect(firstVideo(p)).toBeVisible();
    await expect(tour(p)).toBeVisible({ timeout: 20_000 });
    await stepIs(p, 'intro');
    // Personal: no pregunta equipo o sola.
    await expect(p.getByTestId('tour-solo')).toHaveCount(0);
    await expect(p.getByTestId('tour-next')).toBeFocused();
    await expect(p.getByTestId('tour-back')).toHaveCount(0);
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'record');
    await cardBesideTarget(p, 'rec-record', 'record');
    await p.getByTestId('tour-back').click();
    await stepIs(p, 'intro');
    await expect(p.getByTestId('tour-next')).toBeFocused();
    // Enter aprieta Siguiente: no lleva al grabador.
    await p.keyboard.press('Enter');
    await stepIs(p, 'record');
    await expect(p).toHaveURL(/\/en\/app\/rec$/);
    for (const [id, target] of [
      ['upload', 'rec-upload'],
      // Persona sola: sin el paso del workspace.
      ['settings', 'rec-settings'],
    ] as const) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
      await cardBesideTarget(p, target, id);
    }
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'openVideo');
    // Un paso "usá esto": sin Siguiente, con Saltear paso; abrir un video lo cumple.
    await expect(p.getByTestId('tour-next')).toHaveCount(0);
    await expect(p.getByTestId('tour-skip')).toBeVisible();
    await cardBesideTarget(p, 'rec-video-item', 'openVideo');
    await firstVideo(p).click();
    await p.waitForURL(/\/en\/app\/rec\/[^/]+$/);
    await videoReady(p);
    await stepIs(p, 'share');
    await expect.poll(async () => (await tours(p)).seen?.rec).toMatchObject({ status: 'active', step: 'share' });
    await cardBesideTarget(p, 'rec-share', 'share');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'insights');
    await cardBesideTarget(p, 'rec-insights', 'insights');
    await p.getByTestId('tour-next').click();
    await stepIs(p, 'done');
    await p.getByTestId('tour-next').click();
    await expect(tour(p)).toHaveCount(0);
    await expect(p.getByTestId('tour-layer')).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.rec?.status).toBe('done');
    // Los clics del tour no abrieron el diálogo de compartir.
    await expect(p.getByRole('dialog')).toHaveCount(0);

    // Terminado: no vuelve a abrirse solo.
    await p.goto('/en/app/rec', { waitUntil: 'networkidle' });
    await expect(firstVideo(p)).toBeVisible();
    await expect(tour(p)).toHaveCount(0);

    // Desde un video, el menú de la cuenta lleva a Mis videos y lo abre ahí; Esc sale.
    await firstVideo(p).click();
    await p.waitForURL(/\/en\/app\/rec\/[^/]+$/);
    await videoReady(p);
    await p.getByTestId('workspace-switcher').click();
    await p.getByTestId('side-tour').click();
    await p.waitForURL(/\/en\/app\/rec$/);
    await stepIs(p, 'intro');
    await p.keyboard.press('Escape');
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).seen?.rec?.status).toBe('exited');
  } finally {
    await ctx.close();
  }
});

test('equipo: suma el workspace; "No mostrar más tours" y volver a prenderlos', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, p } = await person(browser, { mode: 'team', videos: 1, scheme: 'dark' });
  try {
    await p.goto('/en/app/rec', { waitUntil: 'networkidle' });
    await expect(firstVideo(p)).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['record', 'upload', 'workspace']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await cardBesideTarget(p, 'rec-workspace', 'workspace');
    for (const id of ['settings', 'openVideo']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await firstVideo(p).click();
    await videoReady(p);
    await stepIs(p, 'share');
    await cardBesideTarget(p, 'rec-share', 'team share');
    await p.getByTestId('tour-off').click();
    await expect(tour(p)).toHaveCount(0);
    await expect.poll(async () => (await tours(p)).off).toBe(true);

    await p.goto('/en/app/settings/appearance', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('appearance-tours-auto')).not.toBeChecked();
    await p.getByTestId('appearance-tours-reset').click();
    await expect(p.getByTestId('appearance-tours-auto')).toBeChecked();
    const after = await tours(p);
    expect(after.off).toBeFalsy();
    expect(after.seen?.rec).toBeUndefined();

    await p.goto('/en/app/rec', { waitUntil: 'networkidle' });
    await stepIs(p, 'intro');
  } finally {
    await ctx.close();
  }
});

test('sin videos: abrir uno y los pasos del video se saltean', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p } = await person(browser);
  try {
    await p.goto('/en/app/rec', { waitUntil: 'networkidle' });
    await expect(p.locator('[data-tour="rec-record"]')).toBeVisible();
    await stepIs(p, 'intro');
    for (const id of ['record', 'upload', 'settings', 'done']) {
      await p.getByTestId('tour-next').click();
      await stepIs(p, id);
    }
    await expect(p).toHaveURL(/\/en\/app\/rec$/);
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
    const { ctx, p } = await person(browser, { width: 390, scheme, look, videos: 1 });
    try {
      await p.goto('/en/app/rec', { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(firstVideo(p)).toBeVisible();
      await stepIs(p, 'intro');
      await noHorizontalScroll(p, `${look} intro`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'record');
      const card = await p.getByTestId('tour').boundingBox();
      expect(card, look).not.toBeNull();
      expect(card!.x, look).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width, look).toBeLessThanOrEqual(390);
      // Pegada abajo, o arriba si el elemento quedó en la mitad de abajo.
      expect(card!.y + card!.height >= 844 - 40 || card!.y <= 40, look).toBe(true);
      await cardBesideTarget(p, 'rec-record', `${look} record`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'upload');
      await cardBesideTarget(p, 'rec-upload', `${look} upload`);
      // En el teléfono el lateral es un cajón: ajustes se saltea.
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'openVideo');
      await cardBesideTarget(p, 'rec-video-item', `${look} openVideo`);
      await firstVideo(p).click();
      await videoReady(p);
      await stepIs(p, 'share');
      await cardBesideTarget(p, 'rec-share', `${look} share`);
      await noHorizontalScroll(p, `${look} share`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'insights');
      await cardBesideTarget(p, 'rec-insights', `${look} insights`);
      await noHorizontalScroll(p, `${look} insights`);
      await p.getByTestId('tour-next').click();
      await stepIs(p, 'done');
      await noHorizontalScroll(p, `${look} done`);
    } finally {
      await ctx.close();
    }
  }
});
