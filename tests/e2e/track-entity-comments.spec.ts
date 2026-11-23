import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, settle } from './responsive-audit';

/**
 * Hilos de comentarios en projects e iniciativas (como Linear), con el mismo
 * componente que los issues: comentar, responder, editar y borrar lo propio,
 * resolver y reaccionar; el menú "…" del comentario cierra con Esc y con un
 * clic afuera. 1280 y 390, cinco aspectos.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

const thread = (page: Page) => page.getByTestId('track-entity-comments');

async function comment(page: Page, text: string) {
  const input = thread(page).getByTestId('track-comment-input');
  await input.click();
  await page.keyboard.type(text);
  await thread(page).locator('.track-activity-composer button[type="submit"]').click();
  await expect(thread(page).getByTestId('track-comment').filter({ hasText: text })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
});

for (const kind of ['plan', 'initiative'] as const) {
  test(`1280: hilo de ${kind === 'plan' ? 'un project' : 'una iniciativa'}: comentar, responder, editar, resolver y borrar`, async ({ page, request }) => {
    const tag = uid();
    const path = kind === 'plan' ? '/api/track/plans' : '/api/track/initiatives';
    const { id } = await ok<{ id: string }>(request.post(path, { data: { name: `Thread ${tag}` } }));
    await page.goto(kind === 'plan' ? `/en/app/track/projects/${id}` : `/en/app/track/initiatives/${id}`, { waitUntil: 'networkidle' });
    await expect(thread(page)).toBeVisible({ timeout: 120_000 });
    await thread(page).scrollIntoViewIfNeeded();
    await expect(thread(page).locator('.ui-help')).toBeVisible();

    await comment(page, `Kickoff notes ${tag}`);
    const root = thread(page).getByTestId('track-comment').filter({ hasText: `Kickoff notes ${tag}` });

    // Responder.
    await root.hover();
    await root.getByTestId('track-comment-reply').click();
    await thread(page).getByTestId('track-reply-input').click();
    await page.keyboard.type('Agreed');
    await thread(page).getByTestId('track-reply-submit').click();
    await expect(thread(page).getByTestId('track-comment').filter({ hasText: 'Agreed' })).toBeVisible();

    // El menú "…" cierra con Esc y con un clic afuera; editar lo propio.
    await root.hover();
    const more = root.getByRole('button', { name: 'Comment actions' });
    await more.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await more.click();
    await page.mouse.click(5, 790);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await root.hover();
    await more.click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' v2');
    await root.getByRole('button', { name: 'Save' }).click();
    await expect(root).toContainText(`Kickoff notes ${tag} v2`);
    await shot(page, `track-${kind}-comments-1280`);

    // Resolver pliega el hilo.
    await root.hover();
    await more.click();
    await page.getByTestId('track-thread-resolve').click();
    await expect(thread(page).getByTestId('track-thread-resolved')).toBeVisible();

    // Se guarda.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(thread(page).getByTestId('track-thread-resolved')).toBeVisible({ timeout: 60_000 });
    await thread(page).getByTestId('track-thread-resolved').click();

    // Borrar la raíz se lleva la respuesta.
    page.once('dialog', (d) => void d.accept());
    const again = thread(page).getByTestId('track-comment').filter({ hasText: 'v2' });
    await again.hover();
    await again.getByRole('button', { name: 'Comment actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(thread(page).getByTestId('track-comment')).toHaveCount(0);
  });
}

test('390: hilo de un project sin scroll lateral; cinco aspectos, claro y oscuro', async ({ browser, request, baseURL }) => {
  const tag = uid();
  const { id } = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Phone ${tag}` } }));
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/en/app/track/projects/${id}`, { waitUntil: 'networkidle' });
  await expect(thread(page)).toBeVisible({ timeout: 120_000 });
  await comment(page, `From the phone ${tag}`);
  await thread(page).scrollIntoViewIfNeeded();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-plan-comments-390-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  await check(page, 'track plan comments 390', { tap: true });
  await ctx.close();
});

test('1280: hilo de un project en los cinco aspectos, claro y oscuro', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const tag = uid();
  const { id } = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Looks ${tag}` } }));
  await page.goto(`/en/app/track/projects/${id}`, { waitUntil: 'networkidle' });
  await expect(thread(page)).toBeVisible({ timeout: 120_000 });
  await comment(page, `Looks check ${tag}`);
  await thread(page).scrollIntoViewIfNeeded();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-plan-comments-1280-${look}-${scheme}`);
    }
  }
});
