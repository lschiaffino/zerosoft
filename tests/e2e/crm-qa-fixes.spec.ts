import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Regresiones de la pasada de QA del CRM: filas de etapas en Ajustes, click
 * en Crear del alta rápida de empresa, un solo diálogo al ganar, /new sin el
 * error #310, aviso de dominio duplicado, resultados de WhatsApp y la
 * confirmación de fusión en un diálogo propio.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function pipelineWithStages(request: APIRequestContext, names: string[]) {
  const name = `QA ${uid()}`;
  const p = await (await request.post('/api/crm/pipelines', { data: { name } })).json();
  const stages: Array<{ id: string; name: string }> = [];
  for (const n of names) {
    stages.push(await (await request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: n } })).json());
  }
  return { id: p.id as string, name, stages };
}

/** Errores de consola y respuestas 4xx/5xx de la API mientras corre el test. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return errors;
}

test('ajustes: las filas de etapa no se salen de la tarjeta y el nombre siempre se ve (1280 y 390)', async ({ page, request }) => {
  const p = await pipelineWithStages(request, ['Discovery call scheduled', 'Proposal', 'Won']);
  const won = p.stages[2];
  await request.patch(`/api/crm/stages/${won.id}`, { data: { isWon: true, requiredFields: ['closeDate', 'contacts'] } });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/app/crm/settings?tab=sales', { waitUntil: 'networkidle' });
    const block = page.locator('.pl-block').filter({ has: page.locator(`input.pl-name[value="${p.name}"]`) });
    const rows = block.getByTestId('stage-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2).getByRole('button', { name: 'Required (2)' })).toBeVisible();
    const box = await block.locator('.pl-stages').boundingBox();
    for (let i = 0; i < 3; i++) {
      const row = rows.nth(i);
      const name = await row.getByRole('textbox', { name: 'Stage name' }).boundingBox();
      expect(name!.width).toBeGreaterThan(width === 1280 ? 200 : 250);
      const del = await row.getByRole('button', { name: /Delete stage/ }).boundingBox();
      expect(del!.x + del!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
      const down = await row.getByRole('button', { name: 'Move down' }).boundingBox();
      expect(down!.x + down!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    }
    if (width === 1280) {
      // Las columnas numéricas tienen cabecera.
      await expect(block.locator('.stage-head')).toContainText('Prob. %');
    } else {
      // A 390 cada número lleva su etiqueta y la página no se desplaza de costado.
      await expect(rows.first().locator('.stage-num-label').first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  }
});

test('alta rápida de empresa: el primer click en Crear crea aunque el dominio esté buscándose', async ({ page }) => {
  await page.goto('/en/app/crm/companies?new=1', { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog');
  const name = `Click Co ${uid()}`;
  await dialog.getByPlaceholder('Name').fill(name);
  await dialog.getByTestId('quick-company-domain').fill(`click-${uid()}.example`);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/crm/companies') && r.request().method() === 'POST');
  // Click directo desde el campo de dominio: el blur dispara la búsqueda del sitio.
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();
});

test('alta rápida de empresa: avisa si el dominio ya existe y pide confirmar con "Create anyway"', async ({ page, request }) => {
  const domain = `dup-${uid()}.example`;
  await request.post('/api/crm/companies', { data: { name: 'Original Co', domain } });
  await page.goto('/en/app/crm/companies?new=1', { waitUntil: 'networkidle' });
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Name').fill('Copy Co');
  await dialog.getByTestId('quick-company-domain').fill(domain);
  // El aviso aparece mientras se escribe, sin salir del campo.
  await expect(dialog.getByTestId('company-dup-warning')).toContainText('Original Co');
  const create = dialog.getByRole('button', { name: 'Create anyway' });
  await expect(create).toBeVisible();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/crm/companies') && r.request().method() === 'POST');
  await create.click();
  expect((await created).status()).toBe(201);
});

test('tablero: arrastrar a ganado abre un solo diálogo con la fecha de hoy y lo que falta, sin 422', async ({ page, request }) => {
  const p = await pipelineWithStages(request, ['Open', 'Won']);
  const [open, won] = p.stages;
  await request.patch(`/api/crm/stages/${won.id}`, { data: { isWon: true, requiredFields: ['closeDate', 'amount'] } });
  const deal = await (await request.post('/api/crm/deals', { data: { name: `Drag ${uid()}`, pipelineId: p.id, stageId: open.id } })).json();

  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
  const errors = watchErrors(page);
  const card = page.locator(`.kb-card[data-deal-id="${deal.id}"]`);
  const target = page.locator(`.kb-cards[data-stage-id="${won.id}"]`);
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 12 });
  await page.mouse.up();

  const dialog = page.getByRole('dialog', { name: 'Close as won' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await expect(dialog.getByLabel('Close date')).toHaveValue(today);
  await dialog.getByLabel('Amount').fill('4200');
  await dialog.getByRole('button', { name: 'Mark as won' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(target.locator(`.kb-card[data-deal-id="${deal.id}"]`)).toBeVisible();

  const saved = await (await request.get(`/api/crm/deals/${deal.id}`)).json();
  const row = saved.deal ?? saved;
  expect(row).toMatchObject({ stage_id: won.id, close_date: today, amount: 4200 });
  expect(errors).toEqual([]);
});

test('/new de altas en modal: la primera visita (sin cookie tz) abre el modal sin error #310', async ({ browser }) => {
  for (const path of ['/es/app/calendar/event-types/new', '/es/app/calendar/routing/new', '/es/app/crm/companies/new']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\?new=1|\/(companies|event-types|routing)$/);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(800);
    expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
    await context.close();
  }
});

test('ajustes: WhatsApp tiene su propia lista de resultados', async ({ page }) => {
  await page.goto('/en/app/crm/settings?tab=sales', { waitUntil: 'networkidle' });
  const calls = page.getByLabel('Calls, one per line');
  const wa = page.getByLabel('WhatsApp, one per line');
  await expect(calls).toHaveValue(/Left a voicemail/);
  await expect(wa).not.toHaveValue(/voicemail|Wrong number/i);
  await expect(wa).toHaveValue(/Replied/);
});

test('duplicadas: fusionar pide confirmación en un diálogo de la app, no en confirm()', async ({ page, request }) => {
  const domain = `merge-${uid()}.example`;
  await request.post('/api/crm/companies', { data: { name: 'Merge Keep', domain } });
  await request.post('/api/crm/companies', { data: { name: 'Merge Drop', domain } });
  let native = false;
  page.on('dialog', async (d) => {
    native = true;
    await d.dismiss();
  });
  await page.goto('/en/app/crm/companies/duplicates', { waitUntil: 'networkidle' });
  const group = page.locator('.dup-group').filter({ hasText: domain });
  await group.getByRole('button', { name: /Merge 1 company/ }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  // Esc cancela sin fusionar.
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await group.getByRole('button', { name: /Merge 1 company/ }).click();
  const merged = page.waitForResponse((r) => r.url().includes('/api/crm/companies/merge'));
  await page.getByTestId('confirm-dialog-confirm').click();
  expect((await merged).ok()).toBe(true);
  expect(native).toBe(false);
});
