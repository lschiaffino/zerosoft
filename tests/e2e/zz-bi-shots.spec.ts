import { expect, test } from '@playwright/test';

// Temporal (no se commitea): capturas de Analytics para la pasada visual.
const DIR = process.env.BI_SHOTS_DIR!;

test('capturas de Analytics en claro y oscuro, 1280 y 390', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const setup = await browser.newPage();
  await setup.goto('/en/app/analytics', { waitUntil: 'networkidle' });
  const q = await setup.locator('[data-testid="bi-items"] a[href*="/questions/biq_"]').first().getAttribute('href');
  const d = await setup.locator('[data-testid="bi-items"] a[href*="/dashboards/bidb_"]').first().getAttribute('href');
  expect(q && d).toBeTruthy();
  await setup.goto(d!, { waitUntil: 'networkidle' });
  await setup.getByRole('button', { name: 'Share' }).click();
  const share = setup.getByRole('dialog', { name: 'Public link' });
  const create = share.getByRole('button', { name: 'Create link' });
  if (await create.isVisible()) await create.click();
  const pub = await share.getByTestId('bi-share-url').getByRole('textbox').first().inputValue();
  await setup.close();

  const pages: Array<[string, string]> = [
    ['home', '/en/app/analytics'],
    ['question', q!],
    ['sql', '/en/app/analytics/questions/new?mode=sql'],
    ['builder', '/en/app/analytics/questions/new'],
    ['dashboard', d!],
    ['public', pub.replace(/^https?:\/\/[^/]+/, '')],
    ['settings', '/en/app/analytics/settings'],
    ['data', '/en/app/analytics/data'],
  ];
  for (const theme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ baseURL });
    await ctx.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    const page = await ctx.newPage();
    for (const [w, h] of [
      [1280, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const [name, path] of pages) {
        await page.goto(path, { waitUntil: 'networkidle' });
        if (name === 'question') {
          const run = page.getByTestId('bi-run');
          if (await run.isVisible()) await run.click();
          await page.waitForTimeout(1500);
        }
        await page.screenshot({ path: `${DIR}/${name}-${w}-${theme}.png`, fullPage: true });
      }
    }
    await ctx.close();
  }
});
