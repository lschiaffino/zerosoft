import { expect, test } from '@playwright/test';
// TEMPORAL (no se commitea): capturas de Dashboards para la pasada visual.
const OUT = '/private/tmp/claude-501/-Users-lautamacmini1-AI-zerosoftware-ai/47e4112c-84db-417f-88d9-7e30941974e8/scratchpad/p3/shots';
test.describe.configure({ timeout: 600_000 });

test('shots', async ({ page, request, context }) => {
  const p = await (await request.post('/api/crm/pipelines', { data: { name: 'Sales pipeline' } })).json();
  const mk = async (name: string, probability: number) => (await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name, probability } })).json()) as { id: string };
  const stages = [await mk('Discovery', 10), await mk('Demo', 30), await mk('Proposal', 60), await mk('Negotiation', 80)];
  const won = await mk('Closed won', 100);
  const lost = await mk('Closed lost', 0);
  await request.patch(`/api/crm/stages/${won.id}`, { data: { isWon: true } });
  await request.patch(`/api/crm/stages/${lost.id}`, { data: { isLost: true } });
  const names = ['Acme renewal', 'Globex expansion', 'Initech pilot', 'Umbrella rollout', 'Hooli platform', 'Stark annual', 'Wayne security', 'Wonka supply', 'Tyrell upgrade', 'Cyberdyne trial', 'Soylent pilot', 'Massive Dynamic'];
  const today = new Date();
  for (let i = 0; i < names.length; i++) {
    const st = stages[i % stages.length];
    const close = new Date(today.getTime() + ((i % 5) * 4 - 6) * 86400000).toISOString().slice(0, 10);
    const r = await (await request.post('/api/crm/deals', { data: { pipelineId: p.id, stageId: st.id, name: names[i], amount: 1500 + i * 1350, closeDate: close } })).json();
    if (i % 3 === 0) await request.post(`/api/crm/deals/${r.id}/move`, { data: { stageId: won.id } });
    else if (i % 5 === 1) await request.post(`/api/crm/deals/${r.id}/move`, { data: { stageId: lost.id, lostReason: 'Price' } });
    else if (i % 4 === 2) await request.post(`/api/crm/deals/${r.id}/move`, { data: { stageId: stages[(i + 1) % 4].id } });
  }
  const sources = ['ads', 'referral', 'organic', 'event', 'ads', 'email', 'ads', 'referral'];
  for (let i = 0; i < 14; i++) await request.post('/api/crm/contacts', { data: { firstName: `Person${i}`, lastName: 'Test', email: `p${i}-${Date.now()}@example.test`, source: sources[i % sources.length] } });
  for (let i = 0; i < 9; i++) await request.post('/api/crm/activities', { data: { type: ['call', 'email', 'meeting'][i % 3], subject: `Touchpoint ${i}` } });

  const d = await (await request.post('/api/crm/dashboards', { data: { name: 'Sales', template: 'sales', visibility: 'everyone' } })).json();
  await request.patch(`/api/crm/dashboards/${d.id}`, { data: { filters: { range: 'last_30', pipelineId: p.id } } });

  for (const [w, h] of [[1280, 900], [390, 844]] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/en/app/crm/dashboards?d=${d.id}`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('cdb-tile')).toHaveCount(12);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/dash-${w}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`/en/app/crm/dashboards?d=${d.id}`, { waitUntil: 'networkidle' });
  // Selector, biblioteca, drill y menú.
  await page.getByTestId('cdb-switcher').click();
  await page.screenshot({ path: `${OUT}/switcher.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('cdb-add-report').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/library.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('cdb-tile').filter({ hasText: 'Pipeline by stage' }).getByRole('button', { name: /Proposal/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/drill.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('cdb-tile').first().getByTestId('cdb-tile-menu').click();
  await page.screenshot({ path: `${OUT}/tile-menu.png` });
  await page.keyboard.press('Escape');
  for (const look of ['lines', 'classic', 'liquid', 'retro']) {
    await context.addCookies([{ name: 'zs_look', value: look, url: page.url() }]);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/en/app/crm/dashboards?d=${d.id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/look-${look}-${scheme}.png` });
    }
  }
  // Vacío.
  const e = await (await request.post('/api/crm/dashboards', { data: { name: 'Empty', template: 'blank' } })).json();
  await context.addCookies([{ name: 'zs_look', value: 'current', url: page.url() }]);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`/en/app/crm/dashboards?d=${e.id}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/empty.png` });
});
