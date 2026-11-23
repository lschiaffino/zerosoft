import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, settle } from './responsive-audit';

/**
 * Reordenar grupos y columnas, como Linear: arrastrar el asa del encabezado
 * (mouse a 1280, dedo a 390), flechas con el asa enfocada, "Mover arriba /
 * al principio" en el menú del grupo (Esc y clic afuera lo cierran), ⌘Z, y el
 * orden queda recordado en la vista al recargar. Capturas en los cinco aspectos.
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

/** Un team con un issue urgente, uno alto y uno bajo. */
async function seed(request: APIRequestContext) {
  const tag = uid();
  const team = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Orden ${tag}` } }));
  for (const [title, priority] of [
    ['Urgent one', 'urgent'],
    ['High one', 'high'],
    ['Low one', 'low'],
  ] as const) {
    await ok(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `${title} ${tag}`, priority } }));
  }
  return { team: team.id };
}

const groups = (page: Page) => page.locator('[data-testid="track-group"]');
const order = (page: Page) => groups(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-group-key') ?? ''));
const columns = (page: Page) => page.locator('[data-testid="track-board-column"]');
const columnOrder = (page: Page) => columns(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-group-key') ?? ''));
const group = (page: Page, key: string) => page.locator(`[data-testid="track-group"][data-group-key="${key}"]`);

/** Arrastra con el mouse el asa de `from` hasta el borde de arriba (o izquierdo) de `to`. */
async function mouseDrag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>, axis: 'x' | 'y') {
  await from.hover();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const tx = axis === 'x' ? b.x + 4 : a.x + a.width / 2;
  const ty = axis === 'y' ? b.y + 4 : a.y + a.height / 2;
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(() => {
  test.slow();
});

test('lista: arrastrar el asa, ⌘Z, flechas, menú del grupo y el orden recordado al recargar', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/team/${s.team}?group=priority`, { waitUntil: 'networkidle' });
  await expect.poll(() => order(page)).toEqual(['urgent', 'high', 'low']);

  // Esc a mitad del arrastre: no cambia nada (y se ve la línea de destino mientras tanto).
  const highGrip = group(page, 'high').getByTestId('track-group-grip');
  await highGrip.hover();
  const hb = (await highGrip.boundingBox())!;
  const ub = (await group(page, 'urgent').boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, ub.y + 4, { steps: 8 });
  await expect(page.locator('.is-group-drop-before')).toHaveCount(1);
  await shot(page, 'track-group-reorder-dragging-1280');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.is-group-drop-before, .is-group-dragging')).toHaveCount(0);
  expect(await order(page)).toEqual(['urgent', 'high', 'low']);

  // Arrastrar Low arriba de Urgent.
  await mouseDrag(page, group(page, 'low').getByTestId('track-group-grip'), group(page, 'urgent'), 'y');
  await expect.poll(() => order(page)).toEqual(['low', 'urgent', 'high']);
  // Soltar no contrae ni abre ningún grupo.
  await expect(page.getByTestId('track-group-toggle').and(page.locator('[aria-expanded="false"]'))).toHaveCount(0);
  await shot(page, 'track-group-reorder-list-1280');

  // ⌘Z vuelve al orden de antes.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => order(page)).toEqual(['urgent', 'high', 'low']);

  // Flechas con el asa enfocada: el foco sigue al grupo.
  await group(page, 'urgent').getByTestId('track-group-grip').focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['high', 'urgent', 'low']);
  await expect(group(page, 'urgent').getByTestId('track-group-grip')).toBeFocused();

  // Menú "…" del grupo: Esc y clic afuera lo cierran; "Move to top" lo sube.
  const menuBtn = group(page, 'low').locator('.track-group-menu');
  await group(page, 'low').hover();
  await menuBtn.click();
  await expect(page.locator('.track-menu[role="menu"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.track-menu[role="menu"]')).toHaveCount(0);
  await menuBtn.click();
  await expect(page.locator('.track-menu[role="menu"]')).toBeVisible();
  // Clic afuera (en el fondo de la página, sin tocar nada que navegue).
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await expect(page.locator('.track-menu[role="menu"]')).toHaveCount(0);
  await menuBtn.click();
  await expect(page.getByTestId('track-group-move-forward')).toBeDisabled();
  await page.getByTestId('track-group-move-first').click();
  await expect.poll(() => order(page)).toEqual(['low', 'high', 'urgent']);

  // Recargar: el orden quedó en la vista.
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => order(page)).toEqual(['low', 'high', 'urgent']);

  // Restablecer orden.
  await group(page, 'high').hover();
  await group(page, 'high').locator('.track-group-menu').click();
  await page.getByTestId('track-group-order-reset').click();
  await expect.poll(() => order(page)).toEqual(['urgent', 'high', 'low']);
});

test('tablero: arrastrar una columna y moverla desde su menú', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/team/${s.team}?group=priority&view=board`, { waitUntil: 'networkidle' });
  await expect(columns(page).first()).toBeVisible();
  const before = await columnOrder(page);
  expect(before.length).toBeGreaterThan(2);
  const col = (key: string) => page.locator(`[data-testid="track-board-column"][data-group-key="${key}"]`);
  // La primera columna pasa detrás de la segunda (las dos a la vista).
  await mouseDrag(page, col(before[0]).getByTestId('track-group-grip'), col(before[2]), 'x');
  await expect.poll(() => columnOrder(page)).toEqual([before[1], before[0], ...before.slice(2)]);
  await shot(page, 'track-group-reorder-board-1280');
  // Menú de la columna: "Move right".
  await col(before[0]).hover();
  await col(before[0]).locator('.track-group-menu').click();
  await page.getByTestId('track-group-move-forward').click();
  await expect.poll(() => columnOrder(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
});

test('390 con el dedo: arrastrar el asa, menú con objetivos de 40px, sin scroll lateral', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/en/app/track/team/${s.team}?group=priority`, { waitUntil: 'networkidle' });
  await expect.poll(() => order(page)).toEqual(['urgent', 'high', 'low']);
  const grip = group(page, 'low').getByTestId('track-group-grip');
  await expect(grip).toBeVisible();
  const box = (await grip.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(40);
  expect(box.width).toBeGreaterThanOrEqual(40);
  const menuBox = (await group(page, 'low').locator('.track-group-menu').boundingBox())!;
  expect(menuBox.height).toBeGreaterThanOrEqual(40);

  // Un dedo de verdad (eventos táctiles de Chromium): arrastrar Low arriba de Urgent.
  const target = (await group(page, 'urgent').boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((target.y + 4 - y0) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => order(page)).toEqual(['low', 'urgent', 'high']);

  // El menú también se usa con el dedo.
  await group(page, 'high').locator('.track-group-menu').tap();
  await expect(page.locator('.track-menu[role="menu"]')).toBeVisible();
  await page.getByTestId('track-group-move-back').tap();
  await expect.poll(() => order(page)).toEqual(['low', 'high', 'urgent']);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `track-group-reorder-390-${look}-${scheme}`);
    }
  }
  await ctx.close();
});

test('1280: cinco aspectos, claro y oscuro (capturas)', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/team/${s.team}?group=priority`, { waitUntil: 'networkidle' });
  await expect(groups(page).first()).toBeVisible();
  await groups(page).first().locator('.track-group-title').hover();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-group-reorder-1280-${look}-${scheme}`);
    }
  }
  await page.goto(`/en/app/track/team/${s.team}?group=priority&view=board`, { waitUntil: 'networkidle' });
  await columns(page).first().locator('.track-board-header').hover();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const look of LOOKS) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
      await settle(page);
      await shot(page, `track-group-reorder-board-1280-${look}-${scheme}`);
    }
  }
});
