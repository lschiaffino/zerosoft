import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * El menú de filtros de Track es una sola superficie en todos los aspectos:
 * la lista de adentro (role="menu") no lleva fondo, borde ni sombra propios,
 * así no se ve un panel dentro de otro. El aspecto se cambia solo en esta
 * página (atributo data-look), sin tocar la cuenta demo compartida.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function team(request: APIRequestContext) {
  const r = await request.post('/api/track/projects', { data: { name: `Menú ${uid()}` } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as { id: string };
}

for (const look of ['lines', 'classic', 'liquid', 'retro'] as const) {
  test(`Track: el menú de filtros es una sola superficie (${look})`, async ({ page, request }) => {
    const p = await team(request);
    await page.goto(`/en/app/track/team/${p.id}`);
    await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);

    await page.getByTestId('track-filter-add').click();
    await expect(page.getByTestId('track-filter-quick')).toBeVisible();

    const outer = page.locator('.track-filter-menu');
    const inner = outer.locator('[role="menu"]').first();
    const outerShadow = await outer.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(outerShadow).not.toBe('none');

    const s = await inner.evaluate((el) => {
      const c = getComputedStyle(el);
      return { shadow: c.boxShadow, border: c.borderTopWidth, bg: c.backgroundColor, img: c.backgroundImage };
    });
    expect(s.shadow).toBe('none');
    expect(s.border).toBe('0px');
    expect(s.bg).toBe('rgba(0, 0, 0, 0)');
    expect(s.img).toBe('none');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('track-filter-quick')).toHaveCount(0);
  });
}
