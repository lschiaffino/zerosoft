import { expect, test, type Page } from '@playwright/test';

/**
 * Capas del shell: nunca dos menús abiertos a la vez. El dueño vio el switcher
 * de apps (banda) y el menú de la cuenta (pie del sidebar) abiertos juntos,
 * uno encima del otro. Abrir un menú cierra el otro, sea con el mouse, con el
 * teclado o con un atajo (⌘K, ⌘J); Esc cierra y devuelve el foco al botón.
 */

/** Menús y paneles flotantes visibles ahora (los de nivel superior: un submenú dentro de otro no cuenta). */
async function openLayers(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const sel = '[role="menu"], .side-bell-panel, .cmdk';
    const all = [...document.querySelectorAll(sel)].filter(visible);
    const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
    return top.map((el) => (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase()));
  });
}

async function expectAtMostOne(page: Page, step: string) {
  // Un frame para que React cierre lo que tenga que cerrar.
  await page.waitForTimeout(60);
  const layers = await openLayers(page);
  expect(layers.length, `${step}: ${layers.join(' + ')}`).toBeLessThanOrEqual(1);
  return layers;
}

const switcher = (page: Page) => page.locator('.band-product');
const account = (page: Page) => page.getByTestId('workspace-switcher');
const bell = (page: Page) => page.locator('.band-right .side-bell');

async function setup(page: Page, width = 1280, scheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
  await page.goto('/en/app/track', { waitUntil: 'load' });
  // En next dev, el indicador de Next tapa el pie del sidebar.
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  await expect(switcher(page)).toBeVisible();
}

test.describe('un solo menú abierto', () => {
  test('switcher y luego la cuenta, con el mouse (y al revés)', async ({ page }) => {
    await setup(page);
    await switcher(page).click();
    await expect(page.locator('.band-switcher-panel')).toBeVisible();
    await account(page).click();
    await expect(page.locator('.ws-switcher-menu')).toBeVisible();
    expect(await expectAtMostOne(page, 'switcher → cuenta')).toEqual(['side-menu']);

    await switcher(page).click();
    await expect(page.locator('.band-switcher-panel')).toBeVisible();
    await expect(page.locator('.ws-switcher-menu')).toHaveCount(0);
    await expectAtMostOne(page, 'cuenta → switcher');
  });

  test('con el teclado: el menú de la cuenta se cierra al salir con Tab y al abrir el switcher', async ({ page }) => {
    await setup(page);
    // Abierto con el teclado: Enter en el botón (sin mousedown, que es lo que cerraba los otros).
    await account(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ws-switcher-menu')).toBeVisible();
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.band-switcher-panel')).toBeVisible();
    await expectAtMostOne(page, 'cuenta (Enter) → switcher (Enter)');
    await expect(page.locator('.ws-switcher-menu')).toHaveCount(0);

    // Y al revés.
    await account(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ws-switcher-menu')).toBeVisible();
    await expectAtMostOne(page, 'switcher (Enter) → cuenta (Enter)');
    await expect(page.locator('.band-switcher-panel')).toHaveCount(0);

    // Tab saca el foco del menú: se cierra (como el switcher).
    await page.keyboard.press('Tab');
    await expect(page.locator('.ws-switcher-menu')).toHaveCount(0);
  });

  test('Esc cierra y devuelve el foco al botón que lo abrió', async ({ page }) => {
    await setup(page);
    for (const [trigger, panel] of [
      [switcher(page), '.band-switcher-panel'],
      [account(page), '.ws-switcher-menu'],
      [page.locator('.side-new-btn'), '.side-new .side-menu'],
    ] as const) {
      await trigger.click();
      await expect(page.locator(panel)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(panel)).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  });

  test('⌘K y ⌘J cierran el menú abierto', async ({ page }) => {
    await setup(page);
    await account(page).click();
    await expect(page.locator('.ws-switcher-menu')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    await expect(page.locator('.ws-switcher-menu')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);

    await switcher(page).click();
    await expect(page.locator('.band-switcher-panel')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(page.locator('.band-switcher-panel')).toHaveCount(0);
  });

  test('el aviso de notificaciones y los menús se excluyen', async ({ page }) => {
    await setup(page);
    await account(page).click();
    await bell(page).click();
    await expect(page.locator('.side-bell-panel')).toBeVisible();
    await expectAtMostOne(page, 'cuenta → campana');
    await page.locator('.side-new-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.side-new .side-menu')).toBeVisible();
    await expectAtMostOne(page, 'campana → nuevo (Enter)');
  });

  for (const [width, scheme] of [
    [1280, 'light'],
    [1280, 'dark'],
    [390, 'light'],
    [390, 'dark'],
  ] as const) {
    test(`secuencia al azar de aperturas (${width}px, ${scheme})`, async ({ page }) => {
      await setup(page, width, scheme);
      // Semilla fija por caso: si falla, se repite igual.
      let seed = width * 7 + (scheme === 'dark' ? 3 : 1);
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const phone = width < 600;
      test.setTimeout(150_000);
      const ensureDrawer = async () => {
        if (!phone) return;
        if (!(await page.locator('.side.open').count())) await page.locator('.band-menu').click();
        await expect(page.locator('.side.open')).toBeVisible();
        // El drawer entra deslizándose: se espera a que termine antes de medir lo que abre.
        await expect.poll(async () => (await page.locator('.side').boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
      };
      // Como una persona: si un menú abierto tapa el botón, primero lo cierra con Esc (no puede clickear a través).
      const userClick = async (target: () => import('@playwright/test').Locator, prep?: () => Promise<void>) => {
        for (let i = 0; i < 3; i++) {
          await prep?.();
          const loc = target();
          const covered = await loc.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !hit || !el.contains(hit);
          });
          if (!covered) return loc.click();
          await page.keyboard.press('Escape');
          await page.waitForTimeout(60);
        }
        throw new Error('el botón sigue tapado después de Esc');
      };
      const actions: Array<[string, () => Promise<void>]> = [
        ['switcher (clic)', () => userClick(() => switcher(page))],
        ['switcher (Enter)', async () => { await switcher(page).focus(); await page.keyboard.press('Enter'); }],
        ['cuenta (clic)', () => userClick(() => account(page), ensureDrawer)],
        ['cuenta (Enter)', async () => { await ensureDrawer(); await account(page).focus(); await page.keyboard.press('Enter'); }],
        ['nuevo (clic)', () => userClick(() => page.locator('.side-new-btn'), ensureDrawer)],
        ['nuevo (Enter)', async () => { await ensureDrawer(); await page.locator('.side-new-btn').focus(); await page.keyboard.press('Enter'); }],
        ['campana', () => userClick(() => bell(page))],
        ['⌘K', () => page.keyboard.press('ControlOrMeta+k')],
        ['Esc', () => page.keyboard.press('Escape')],
      ];
      const log: string[] = [];
      for (let i = 0; i < 40; i++) {
        const [name, run] = actions[Math.floor(rand() * actions.length)];
        log.push(name);
        // ⌘K es modal: lo que está debajo no se puede clickear; se cierra antes de seguir.
        if (await page.locator('.cmdk').count()) {
          await page.keyboard.press('Escape');
          await expect(page.locator('.cmdk')).toHaveCount(0);
        }
        await run().catch((e: Error) => {
          throw new Error(`${log.join(' → ')}: ${e.message}`);
        });
        const layers = await expectAtMostOne(page, log.join(' → '));
        // En el teléfono, el switcher de la banda no abre debajo del drawer: abrirlo lo cierra.
        if (phone && layers.includes('band-menu-panel')) expect(await page.locator('.side.open').count(), log.join(' → ')).toBe(0);
        // Ningún menú se sale de la pantalla ni tapa su propio botón.
        const box = await page.evaluate(() => {
          const el = document.querySelector('[role="menu"], .side-bell-panel');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight };
        });
        if (box && layers.length) {
          expect(box.x, log.join(' → ')).toBeGreaterThanOrEqual(0);
          expect(box.r, log.join(' → ')).toBeLessThanOrEqual(box.w + 1);
          expect(box.y, log.join(' → ')).toBeGreaterThanOrEqual(0);
          expect(box.b, log.join(' → ')).toBeLessThanOrEqual(box.h + 1);
        }
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), log.join(' → ')).toBeLessThanOrEqual(width + 1);
      }
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/menus-${width}-${scheme}.png` });
    });
  }
});
