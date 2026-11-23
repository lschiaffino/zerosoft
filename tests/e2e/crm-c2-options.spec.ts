import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * CRM C2: las opciones de Lifecycle stage y Lead status se editan en
 * Ajustes › Datos (agregar, renombrar, ordenar, archivar) y la ficha las usa;
 * el lifecycle avanza solo al crear y ganar un deal, queda en el timeline y un
 * admin lo apaga. Cada test corre en un workspace propio (la base es
 * compartida). Datos inventados.
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
  await ctx.addCookies([{ name: 'zs_e2e_as', value: `c2-owner-${uid()}@crm-c2-e2e.test`, url: baseURL }]);
  await ok(ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'C2', locale: 'en', apps: ['crm'] } }));
  await ctx.request.post('/api/tours', { data: { kind: 'off', off: true } });
  return ctx;
}

async function pipelineWithWon(request: import('@playwright/test').APIRequestContext) {
  const pipe = await ok<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: `C2 ${uid()}` } }));
  for (const stage of ['Intro', 'Won']) await ok(request.post(`/api/crm/pipelines/${pipe.id}/stages`, { data: { name: stage } }));
  const all = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; name: string }> }> }>(request.get('/api/crm/pipelines'));
  const p = all.rows.find((r) => r.id === pipe.id)!;
  const open = p.stages.find((s) => s.name === 'Intro')!;
  const won = p.stages.find((s) => s.name === 'Won')!;
  await ok(request.patch(`/api/crm/stages/${won.id}`, { data: { isWon: true } }));
  return { id: p.id, open: open.id, won: won.id };
}

async function lifecycleShown(page: Page) {
  return page.locator('[data-prop="lifecycleStage"] .prop-btn').first();
}

test('editar opciones en Ajustes y usarlas en la ficha', async ({ browser }) => {
  const ctx = await ownWorkspace(browser);
  try {
    const page = await ctx.newPage();
    await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
    const lifecycle = page.getByTestId('property-options-lifecycle');
    await expect(lifecycle).toBeVisible();

    // Agregar una opción propia.
    await page.getByTestId('property-options-input-lifecycle').fill('Partner');
    await page.getByTestId('property-options-input-lifecycle').press('Enter');
    const partnerRow = lifecycle.locator('li', { has: page.locator('input[value="Partner"]') });
    await expect(partnerRow).toHaveCount(1);

    // Renombrar una de fábrica: Esc vuelve, Enter guarda.
    const leadInput = lifecycle.getByTestId('option-lifecycle-lead').locator('input');
    await leadInput.fill('Nope');
    await leadInput.press('Escape');
    await expect(leadInput).toHaveValue('Lead');
    await leadInput.fill('Prospect');
    await leadInput.press('Enter');
    await expect(lifecycle.getByTestId('option-lifecycle-lead').locator('input')).toHaveValue('Prospect');

    // Subir Partner un lugar (queda anteúltima) y archivar Subscriber.
    await partnerRow.getByRole('button', { name: /Move up/i }).click();
    await expect(lifecycle.locator('ol > li').nth(-2).locator('input')).toHaveValue('Partner');
    await lifecycle.getByTestId('option-lifecycle-subscriber').getByRole('button', { name: /Archive/i }).click();
    await expect(lifecycle.getByRole('heading', { name: 'Archived' })).toBeVisible();
    await expect(lifecycle.getByTestId('option-lifecycle-subscriber').getByRole('button', { name: /Restore/i })).toBeVisible();

    // La ficha: el nombre nuevo, la opción propia para elegir y la archivada fuera.
    const contact = await ok<{ id: string }>(ctx.request.post('/api/crm/contacts', { data: { firstName: 'Opt', lastName: `Test ${uid()}` } }));
    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
    await expect(await lifecycleShown(page)).toHaveText('Prospect');
    await (await lifecycleShown(page)).click();
    const select = page.locator('[data-prop="lifecycleStage"] select');
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('Partner');
    expect(options).not.toContain('Subscriber');
    await select.selectOption({ label: 'Partner' });
    await expect(await lifecycleShown(page)).toHaveText('Partner');

    // Archivar Partner: el contacto la sigue mostrando.
    await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
    await page.getByTestId('property-options-lifecycle').locator('li', { has: page.locator('input[value="Partner"]') }).getByRole('button', { name: /Archive/i }).click();
    await expect(page.getByTestId('property-options-lifecycle').locator('ul input[value="Partner"]')).toHaveCount(1);
    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
    await expect(await lifecycleShown(page)).toHaveText('Partner');

    // La API no acepta una archivada en otro registro.
    const other = await ok<{ id: string }>(ctx.request.post('/api/crm/contacts', { data: { firstName: 'Other', lastName: uid() } }));
    const archived = (await ok<{ lifecycle: Array<{ value: string; label: string | null }> }>(ctx.request.get('/api/crm/property-options'))).lifecycle.find((o) => o.label === 'Partner')!;
    const res = await ctx.request.patch(`/api/crm/contacts/${other.id}`, { data: { lifecycleStage: archived.value } });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_option');
  } finally {
    await ctx.close();
  }
});

test('lifecycle automático con los deals, en el timeline, y apagado por un admin', async ({ browser }) => {
  const ctx = await ownWorkspace(browser);
  try {
    const p = await pipelineWithWon(ctx.request);
    const contact = await ok<{ id: string }>(ctx.request.post('/api/crm/contacts', { data: { firstName: 'Auto', lastName: uid() } }));
    const deal = await ok<{ id: string }>(ctx.request.post('/api/crm/deals', { data: { name: `Auto ${uid()}`, pipelineId: p.id, stageId: p.open, contactIds: [contact.id] } }));
    const page = await ctx.newPage();
    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
    await expect(await lifecycleShown(page)).toHaveText('Opportunity');
    await expect(page.getByTestId('crm-timeline-change').first()).toContainText('Opportunity');

    await ok(ctx.request.post(`/api/crm/deals/${deal.id}/move`, { data: { stageId: p.won } }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(await lifecycleShown(page)).toHaveText('Customer');
    await expect(page.getByTestId('crm-timeline-change')).toHaveCount(2);

    // Apagado desde Ajustes: un deal nuevo no cambia nada.
    await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
    const toggle = page.getByTestId('lifecycle-auto');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    const section = page.locator('[data-setting="crm-lifecycle-auto"]');
    await section.getByRole('button', { name: /Save/i }).click();
    await expect(section.getByText(/Saved/i)).toBeVisible();
    const second = await ok<{ id: string }>(ctx.request.post('/api/crm/contacts', { data: { firstName: 'Manual', lastName: uid() } }));
    await ok(ctx.request.post('/api/crm/deals', { data: { name: `Manual ${uid()}`, pipelineId: p.id, stageId: p.open, contactIds: [second.id] } }));
    await page.goto(`/en/app/crm/contacts/${second.id}`, { waitUntil: 'networkidle' });
    await expect(await lifecycleShown(page)).toHaveText('Lead');
    await expect(page.getByTestId('crm-timeline-change')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
