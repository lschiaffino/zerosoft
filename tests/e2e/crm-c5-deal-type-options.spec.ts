import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * CRM C5: las opciones de Deal type se editan en Ajustes › Datos (como
 * Lifecycle stage y Lead status) y la ficha del deal las ofrece; una archivada
 * sigue en el deal que la tiene, marcada. Un workspace propio (la base es
 * compartida). A 1280 y a 390, sin scroll lateral. Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function ownWorkspace(browser: Browser) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: `c5-dt-${uid()}@crm-c5-e2e.test`, url: baseURL }]);
  await ok(ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'C5', locale: 'en', apps: ['crm'] } }));
  await ctx.request.post('/api/tours', { data: { kind: 'off', off: true } });
  return ctx;
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'sin scroll lateral').toBeLessThanOrEqual(0);
}

test('deal type: opción propia en Ajustes, elegida en la ficha y archivada', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await ownWorkspace(browser);
  try {
    const page = await ctx.newPage();
    await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
    const section = page.getByTestId('property-options-dealType');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('option-dealType-newbusiness').locator('input')).toHaveValue('New business');
    await page.getByTestId('property-options-input-dealType').fill('Renewal');
    await page.getByTestId('property-options-input-dealType').press('Enter');
    await expect(section.locator('li', { has: page.locator('input[value="Renewal"]') })).toHaveCount(1);

    const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> }>(ctx.request.get('/api/crm/pipelines'));
    const pipe = pipelines.rows[0];
    const stage = pipe.stages.find((s) => !s.is_won && !s.is_lost)!;

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
      await expect(page.getByTestId('property-options-dealType')).toBeVisible();
      await noSideScroll(page);

      const deal = await ok<{ id: string }>(ctx.request.post('/api/crm/deals', { data: { name: `Type ${uid()}`, pipelineId: pipe.id, stageId: stage.id, amount: 10 } }));
      await page.goto(`/en/app/crm/deals/${deal.id}?tab=properties`, { waitUntil: 'networkidle' });
      const row = page.locator('[data-prop="dealType"]');
      await row.getByRole('button', { name: 'Edit' }).click();
      const select = row.locator('select');
      expect(await select.locator('option').allTextContents()).toEqual(expect.arrayContaining(['New business', 'Existing business', 'Renewal']));
      const saved = page.waitForResponse((r) => r.url().endsWith(`/api/crm/deals/${deal.id}`) && r.request().method() === 'PATCH');
      await select.selectOption({ label: 'Renewal' });
      expect((await saved).status()).toBe(200);
      await expect(row.locator('.prop-btn')).toHaveText('Renewal');
      await noSideScroll(page);
    }

    // Archivada: el deal la sigue mostrando, marcada, y no se ofrece en otro.
    const sets = await ok<{ dealType: Array<{ value: string; label: string | null }> }>(ctx.request.get('/api/crm/property-options'));
    const renewal = sets.dealType.find((o) => o.label === 'Renewal')!;
    await ok(ctx.request.post('/api/crm/property-options', { data: { action: 'update', property: 'dealType', value: renewal.value, archived: true } }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-prop="dealType"] .prop-btn')).toHaveText('Renewal (archived)');
    const other = await ok<{ id: string }>(ctx.request.post('/api/crm/deals', { data: { name: `Other ${uid()}`, pipelineId: pipe.id, stageId: stage.id } }));
    const res = await ctx.request.patch(`/api/crm/deals/${other.id}`, { data: { dealType: renewal.value } });
    expect(res.status()).toBe(400);
  } finally {
    await ctx.close();
  }
});
