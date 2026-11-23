import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, settle } from './responsive-audit';

/**
 * Comentarios en línea sobre la descripción (como Linear): elegir texto,
 * "Comentar" en la barra de la selección, escribir y publicar. El texto queda
 * resaltado, el hilo muestra la cita, un clic en el resaltado lleva al hilo y
 * resolverlo saca el resaltado. El composer cierra con Esc y con un clic
 * afuera. 1280 y 390, cinco aspectos.
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

const QUOTE = 'the login button stays disabled';

async function seed(request: APIRequestContext) {
  const tag = uid();
  const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Inline ${tag}` } }));
  const issue = await ok<{ id: string; identifier: string }>(
    request.post(`/api/track/projects/${team.id}/issues`, {
      data: { title: `Inline ${tag}`, description: [{ type: 'text', text: `When the session expires ${QUOTE} until you reload the page.` }] },
    }),
  );
  return issue;
}

const editor = (page: Page) => page.locator('.track-description-editor .track-rte-content');

/** Elige `text` dentro de la descripción (como arrastrar el mouse). */
async function select(page: Page, text: string) {
  await editor(page).evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i < 0) continue;
      (root as HTMLElement).focus();
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + t.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    throw new Error('text not found');
  }, text);
}

const highlighted = (page: Page) => editor(page).evaluate((el) => Number((el as HTMLElement).dataset.inlineComments ?? '0'));

async function openIssue(page: Page, id: string) {
  await page.goto(`/en/app/track/issues/${id}`, { waitUntil: 'networkidle' });
  await expect(editor(page)).toContainText(QUOTE, { timeout: 120_000 });
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('1280: comentar una parte de la descripción, resaltado, ir al hilo y resolver', async ({ page, request }) => {
  const issue = await seed(request);
  await openIssue(page, issue.id);
  expect(await highlighted(page)).toBe(0);

  // Esc y clic afuera cierran el composer sin publicar.
  await select(page, QUOTE);
  await page.getByTestId('track-rte-comment').click();
  const composer = page.getByTestId('track-inline-composer');
  await expect(composer).toBeVisible();
  await expect(page.getByTestId('track-inline-quote')).toHaveText(QUOTE);
  await page.keyboard.press('Escape');
  await expect(composer).toHaveCount(0);
  // Esc cierra solo el composer: el foco vuelve a la descripción y otro Esc no saca del issue.
  await expect(editor(page)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/app/track/(issues/${issue.id}|issue/${issue.identifier})`));
  await select(page, QUOTE);
  await page.getByTestId('track-rte-comment').click();
  await expect(composer).toBeVisible();
  await page.mouse.click(1200, 780);
  await expect(composer).toHaveCount(0);
  // Con algo escrito, un clic afuera no tira el borrador.
  await select(page, QUOTE);
  await page.getByTestId('track-rte-comment').click();
  await page.keyboard.type('draft');
  await page.mouse.click(1200, 780);
  await expect(composer).toBeVisible();
  await composer.getByRole('button', { name: 'Cancel' }).click();
  await expect(composer).toHaveCount(0);

  // Publicar: ⌘↵ o el botón.
  await select(page, QUOTE);
  await page.getByTestId('track-rte-comment').click();
  await page.getByTestId('track-inline-editor').locator('.track-rte-content').click();
  await page.keyboard.type('Repro on Safari too');
  await shot(page, 'track-inline-composer-1280');
  await page.getByTestId('track-inline-submit').click();
  await expect(composer).toHaveCount(0);
  const thread = page.getByTestId('track-thread').filter({ has: page.getByTestId('track-comment-quote') });
  await expect(thread).toHaveCount(1);
  await expect(thread.getByTestId('track-comment-quote')).toHaveText(QUOTE);
  await expect(thread).toContainText('Repro on Safari too');
  // El hilo nuevo se muestra y se marca un momento.
  await expect(thread.getByTestId('track-comment').first()).toHaveClass(/is-flash/);
  await expect.poll(() => highlighted(page)).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'track-inline-highlight-1280');

  // Un clic en el texto resaltado lleva al hilo.
  const box = await editor(page).evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + 4);
      r.setEnd(n, i + 6);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return null;
  }, QUOTE);
  expect(box).not.toBeNull();
  // Escribiendo en la descripción, un clic en el resaltado solo pone el cursor.
  await editor(page).focus();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.click(box!.x, box!.y);
  await expect(thread.getByTestId('track-comment').first()).not.toHaveClass(/is-flash/);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // Sin estar escribiendo, lleva al hilo.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.click(box!.x, box!.y);
  await expect(thread.getByTestId('track-comment').first()).toHaveClass(/is-flash/);

  // Resolver saca el resaltado y deja el hilo plegado.
  await thread.getByTestId('track-inline-resolve').click();
  await expect.poll(() => highlighted(page)).toBe(0);
  await expect(page.getByTestId('track-thread-resolved')).toBeVisible();

  // Se guarda: al volver a abrir el issue, sigue sin resaltado y con la cita en el hilo.
  await openIssue(page, issue.id);
  expect(await highlighted(page)).toBe(0);
});

test('390: comentar desde el teléfono; sin scroll lateral; cinco aspectos', async ({ browser, request, baseURL }) => {
  const issue = await seed(request);
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await openIssue(page, issue.id);
  await select(page, QUOTE);
  await page.getByTestId('track-rte-comment').click();
  const composer = page.getByTestId('track-inline-composer');
  await expect(composer).toBeVisible();
  const c = await composer.boundingBox();
  expect(c && c.x >= 0 && c.x + c.width <= PHONE.width).toBeTruthy();
  const submit = page.getByTestId('track-inline-submit');
  const s = await submit.boundingBox();
  expect(s && s.height >= 40).toBeTruthy();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-inline-composer-390-${look}-${scheme}`);
    }
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.emulateMedia({ colorScheme: 'light' });
  await check(page, 'track inline composer 390', { tap: true, ignore: /track-detail-title-input/ });
  await page.getByTestId('track-inline-editor').locator('.track-rte-content').click();
  await page.keyboard.type('Phone note');
  await submit.click();
  await expect(composer).toHaveCount(0);
  await expect.poll(() => highlighted(page)).toBe(1);
  await check(page, 'track inline comments 390', { tap: true, ignore: /track-detail-title-input/ });
  await ctx.close();
});

test('1280: resaltado y composer en los cinco aspectos, claro y oscuro', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const issue = await seed(request);
  await openIssue(page, issue.id);
  await select(page, QUOTE);
  await page.getByTestId('track-rte-comment').click();
  await page.getByTestId('track-inline-editor').locator('.track-rte-content').click();
  await page.keyboard.type('Looks check');
  await page.getByTestId('track-inline-submit').click();
  await expect.poll(() => highlighted(page)).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-inline-1280-${look}-${scheme}`);
    }
  }
});
