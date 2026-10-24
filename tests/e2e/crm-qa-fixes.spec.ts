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

// El refresh de la cookie tz en la primera visita no puede caer mientras el
// boundary de loading.tsx sigue sin revelarse: React lo renderiza de cero en el
// cliente y por un momento conviven dos formularios (el vivo y la copia oculta
// del servidor, <div hidden id="S:0">).
test('/new de altas en modal: la primera visita nunca muestra el formulario dos veces', async ({ browser }) => {
  const paths = [
    '/en/app/calendar/event-types/new',
    '/en/app/calendar/routing/new',
    '/en/app/crm/companies/new',
    '/en/app/crm/contacts/new',
    '/en/app/crm/deals/new',
  ];
  for (const path of paths) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __qmMax: number };
      w.__qmMax = 0;
      new MutationObserver(() => {
        w.__qmMax = Math.max(w.__qmMax, document.querySelectorAll('.qm').length);
      }).observe(document, { subtree: true, childList: true });
    });
    await page.goto(path);
    await expect(page.getByRole('dialog')).toBeVisible();
    // Espera a que se guarde la cookie y pase el refresh.
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === 'tz')).toBe(true);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => (window as unknown as { __qmMax: number }).__qmMax), path).toBe(1);
    await expect(page.locator('.qm')).toHaveCount(1);
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

test('nuevo lead: al filtrar el contacto, ↓ va al primer resultado y "No contact" queda al final', async ({ page, request }) => {
  const tag = uid();
  await request.post('/api/crm/contacts', { data: { firstName: 'Combo', lastName: tag, email: `combo-${tag}@qa.io` } });
  await page.goto('/en/app/crm/leads', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New lead' });
  const combo = dialog.getByRole('combobox', { name: 'Contact' });
  await combo.click();
  await combo.pressSequentially(`Combo ${tag}`);
  const options = dialog.getByRole('option');
  await expect(options.first()).toHaveText(`Combo ${tag}`);
  await expect(options.last()).toHaveText('No contact');
  await combo.press('ArrowDown');
  await combo.press('Enter');
  await expect(combo).toHaveValue(`Combo ${tag}`);
});

test('nuevo lead: el placeholder del nombre entra entero a 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/crm/leads', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New lead' });
  const name = dialog.getByPlaceholder("Optional: the contact's name");
  await expect(name).toBeVisible();
  const fits = await name.evaluate((el) => {
    const input = el as HTMLInputElement;
    const ctx = document.createElement('canvas').getContext('2d')!;
    const cs = getComputedStyle(input);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const inner = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return ctx.measureText(input.placeholder).width <= inner;
  });
  expect(fits).toBe(true);
});

test('⌘K: "Ask" pone primero "Ask the CRM assistant"', async ({ page }) => {
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('Ask');
  await expect(dialog.getByRole('option').first()).toHaveText('Ask the CRM assistant');
});

test('borrar contacto: el botón dice papelera (90 días) y el campo queda alineado con el texto', async ({ page, request }) => {
  const tag = uid();
  const email = `trash-${tag}@qa.io`;
  const c = await (await request.post('/api/crm/contacts', { data: { firstName: 'Trash', lastName: tag, email } })).json();
  await page.goto(`/en/app/crm/contacts/${c.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('record-more').click();
  await page.getByRole('menuitem', { name: 'Delete contact' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: 'Delete forever' })).toHaveCount(0);
  const button = modal.getByRole('button', { name: 'Move to recycle bin' });
  await expect(button).toBeDisabled();
  const input = modal.getByLabel(`Type ${email} to confirm`);
  const desc = modal.locator('.danger-desc');
  const [d, i, b] = await Promise.all([desc.boundingBox(), input.boundingBox(), button.boundingBox()]);
  expect(Math.abs(d!.x - i!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(d!.x - b!.x)).toBeLessThanOrEqual(1);
});

test('asistente: el resumen de la propuesta sale en el idioma de la persona', async ({ request }) => {
  const res = await request.post('/api/crm/ai/assistant', {
    data: { messages: [{ role: 'user', content: 'Crear tarea: llamar al CFO' }], locale: 'es' },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { proposals: Array<{ summary: string }> };
  expect(body.proposals[0]?.summary).toBe('Crear la tarea "llamar al CFO"');
});

test('logo de empresa sin sitio: no hay 404 ni error de consola, se ven las iniciales', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const co = await (await request.post('/api/crm/companies', { data: { name: `Nologo ${tag}`, domain: `nologo-${tag}.invalid` } })).json();
  const logo = await request.get(`/api/crm/logo/nologo-${tag}.invalid`);
  expect(logo.status()).toBe(200);
  expect(logo.headers()['x-logo']).toBe('none');
  await page.goto(`/en/app/crm/companies/${co.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.co-logo-initials').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
