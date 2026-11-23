import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, settle } from './responsive-audit';

/**
 * Estado Duplicado (como Linear): marcar desde el menú "…" del issue, desde
 * ⌘K en la lista y con M M; banner en el duplicado con link al original y
 * "Quitar duplicado"; ⌘Z lo deshace; el original muestra el resumen. A 390 sin
 * scroll lateral y con objetivos de 40px; capturas en los cinco aspectos.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR ?? (process.env.CI ? 'e2e-results/shots' : '');
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Issue = { id: string; identifier: string; title: string; status_name?: string; status_category?: string };

async function seed(request: APIRequestContext) {
  const tag = uid();
  const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Dup ${tag}` } }));
  const original = await ok<Issue>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `Login fails on Safari ${tag}` } }));
  const dup = await ok<Issue>(
    request.post(`/api/track/projects/${team.id}/issues`, {
      data: { title: `Safari login broken ${tag}`, description: [{ type: 'text', text: 'Open Safari and try to log in with the demo account.' }] },
    }),
  );
  return { tag, team: team.id, original, dup };
}

async function issueOf(request: APIRequestContext, id: string): Promise<Issue> {
  return (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;
}

/** Elige el original en la página "Mark as duplicate of…" de la paleta. */
async function pickOriginal(page: Page, original: Issue) {
  const palette = page.locator('.cmdk');
  await expect(palette).toBeVisible();
  await page.locator('.cmdk-input').fill(original.title);
  const hit = palette.getByRole('option', { name: new RegExp(original.identifier) });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(palette).toBeHidden();
}

test.beforeEach(() => {
  test.slow();
});

test('issue: menú "…", banner con el original, ⌘Z, M M y Quitar duplicado; el original muestra el resumen', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/issues/${s.dup.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-duplicate-banner')).toHaveCount(0);

  // Menú "…" › Mark as duplicate of… (el atajo M M se ve en el menú).
  await page.locator('.track-detail-more').click();
  const item = page.getByTestId('track-menu-duplicate');
  await expect(item).toContainText('M M');
  await item.click();
  await pickOriginal(page, s.original);
  const banner = page.getByTestId('track-duplicate-banner');
  await expect(banner).toBeVisible();
  await expect(page.getByTestId('track-duplicate-original')).toContainText(s.original.identifier);
  await expect.poll(async () => (await issueOf(request, s.dup.id)).status_name).toBe('Duplicate');
  await expect(page.locator('.track-detail-side')).toContainText('Duplicate');
  await shot(page, 'track-duplicate-banner-1280');

  // ⌘Z: vuelve el estado y se va el banner.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => (await issueOf(request, s.dup.id)).status_category).not.toBe('cancelled');

  // M M abre la misma página de la paleta; Esc la cierra sin marcar.
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await expect(page.locator('.cmdk')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk')).toBeHidden();
  await expect(banner).toHaveCount(0);
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await pickOriginal(page, s.original);
  await expect(banner).toBeVisible();

  // En el original: el resumen del duplicado en la actividad.
  await page.getByTestId('track-duplicate-original').click();
  await expect(page).toHaveURL(new RegExp(s.original.identifier));
  const summary = page.getByTestId('track-dup-summary');
  await expect(summary).toContainText(s.dup.title);
  await expect(summary).toContainText('Open Safari and try to log in');
  await expect(page.getByTestId('track-dup-merged-link')).toHaveText(s.dup.identifier);
  await shot(page, 'track-duplicate-original-1280');

  // De vuelta en el duplicado: Quitar duplicado.
  await page.getByTestId('track-dup-merged-link').click();
  await expect(banner).toBeVisible();
  await page.getByTestId('track-unmark-duplicate').click();
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => (await issueOf(request, s.dup.id)).status_category).not.toBe('cancelled');
});

test('lista: ⌘K › Mark as duplicate sobre la fila, y deshacer desde el aviso', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/team/${s.team}`, { waitUntil: 'networkidle' });
  const row = page.locator('[data-issue-row]', { hasText: s.dup.identifier }).first();
  await expect(row).toBeVisible();
  await row.hover();
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.cmdk-input').fill('duplicate');
  await page.locator('.cmdk').getByRole('option', { name: /Mark as duplicate/ }).click();
  await pickOriginal(page, s.original);
  await expect.poll(async () => (await issueOf(request, s.dup.id)).status_name).toBe('Duplicate');
  await expect(page.getByTestId('track-undo')).toBeVisible();
  await page.getByTestId('track-undo').click();
  await expect.poll(async () => (await issueOf(request, s.dup.id)).status_category).not.toBe('cancelled');
});

test('390 y los cinco aspectos: banner sin scroll lateral y con objetivos de 40px', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  const mark = await request.post(`/api/track/issues/${s.dup.id}/duplicate-of`, { data: { originalId: s.original.id } });
  expect(mark.ok()).toBeTruthy();
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/en/app/track/issues/${s.dup.id}`, { waitUntil: 'networkidle' });
  const banner = page.getByTestId('track-duplicate-banner');
  await expect(banner).toBeVisible();
  const box = await page.getByTestId('track-unmark-duplicate').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-duplicate-banner-390-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  // El banner entra entero en la pantalla.
  const bb = await banner.boundingBox();
  expect((bb?.x ?? 0) + (bb?.width ?? 0)).toBeLessThanOrEqual(PHONE.width);

  await page.goto(`/en/app/track/issues/${s.original.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-dup-summary').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('track-dup-summary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'track-duplicate-original-390');
  await ctx.close();
});

test('1280: cinco aspectos, claro y oscuro (capturas)', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const s = await seed(request);
  await request.post(`/api/track/issues/${s.dup.id}/duplicate-of`, { data: { originalId: s.original.id } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/issues/${s.dup.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-duplicate-banner')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-duplicate-1280-${look}-${scheme}`);
    }
  }
});
