import { expect, test, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * El menú de filtros de Track es una sola superficie en todos los aspectos:
 * la lista de adentro (role="menu") no lleva fondo, borde ni sombra propios,
 * así no se ve un panel dentro de otro.
 *
 * El aspecto es de la cuenta (users.ui_look manda sobre la cookie y sobre el
 * atributo: LookProvider lo vuelve a poner al hidratar), así que se guarda con
 * la API en un workspace propio, sin tocar la cuenta demo compartida. Los
 * tests van en serie porque comparten ese usuario.
 */

ownWorkspace('track-filter-surface');
test.describe.configure({ mode: 'serial' });

const uid = () => Math.random().toString(36).slice(2, 8);

async function openTeam(page: Page) {
  const r = await page.request.post('/api/track/projects', { data: { name: `Menu ${uid()}` } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return ((await r.json()) as { id: string }).id;
}

for (const look of ['lines', 'classic', 'liquid', 'retro'] as const) {
  test(`Track: el menú de filtros es una sola superficie (${look})`, async ({ page }) => {
    const set = await page.request.put('/api/profile/look', { data: { look } });
    expect(set.ok(), await set.text()).toBeTruthy();
    const id = await openTeam(page);

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/en/app/track/team/${id}`);
      await expect(page.locator('html')).toHaveAttribute('data-look', look);

      const toggle = page.getByTestId('track-filter-add');
      await toggle.click();
      await expect(page.getByTestId('track-filter-quick')).toBeVisible();

      // La superficie de afuera: borde y fondo propios.
      const outer = page.getByRole('group', { name: await toggle.getAttribute('aria-label') ?? '' });
      const o = await outer.evaluate((el) => {
        const c = getComputedStyle(el);
        return { border: c.borderTopWidth, bg: c.backgroundColor };
      });
      expect(o.border).toBe('1px');
      expect(o.bg).not.toBe('rgba(0, 0, 0, 0)');

      // La lista de adentro: nada propio.
      const inner = outer.getByRole('menu').first();
      const s = await inner.evaluate((el) => {
        const c = getComputedStyle(el);
        return { shadow: c.boxShadow, border: c.borderTopWidth, bg: c.backgroundColor, img: c.backgroundImage };
      });
      expect(s).toEqual({ shadow: 'none', border: '0px', bg: 'rgba(0, 0, 0, 0)', img: 'none' });

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('track-filter-quick')).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
  });
}
