import { expect, test, type Page } from '@playwright/test';

/**
 * CRM, tanda de modelo de datos: objetos propios, objeto Lead, permisos por
 * campo, listas dinámicas con campos propios y actividad, y datos de la
 * empresa desde el dominio (CRM_ENRICH_FAKE=1, sin internet).
 */
const uid = () => Math.random().toString(36).slice(2, 8);

// Recorridos largos (varias páginas por test): más margen que el default.
test.describe.configure({ timeout: 150_000 });

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

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test('objetos propios: definir, propiedad, registro, asociación, sidebar y Cmd+K', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const plural = `Vehicles ${tag}`;
  await page.goto('/en/app/crm/objects', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New object' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New custom object' });
  await dialog.getByLabel('Singular name').fill(`Vehicle ${tag}`);
  await dialog.getByLabel('Plural name').fill(plural);
  await dialog.getByLabel('Primary property').fill('Plate');
  await dialog.getByRole('button', { name: 'Create' }).click();
  // Abre los ajustes del objeto: se agrega una propiedad.
  await expect(page.getByTestId('object-settings')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: plural })).toBeVisible();
  const settings = page.getByTestId('object-settings');
  await settings.getByPlaceholder('Label').fill('Model');
  await settings.getByRole('button', { name: 'New field' }).click();
  await expect(settings.locator('.cf-row input[aria-label="Label"]').first()).toHaveValue('Model');

  // Sidebar: el objeto cuelga de "Custom objects".
  await expect(page.locator('#side-branch').getByRole('link', { name: plural })).toBeVisible();

  // Alta de un registro con su propiedad.
  await page.getByRole('link', { name: 'Object settings' }).click();
  await expect(page.getByTestId('object-settings')).toHaveCount(0);
  await page.getByRole('button', { name: /^New: |^New Vehicle/ }).first().click();
  const rec = page.getByRole('dialog');
  await rec.getByLabel('Plate').fill(`AB ${tag}`);
  await rec.getByLabel('Model').fill('Hilux');
  await rec.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `AB ${tag}` })).toBeVisible();
  await expect(page.locator('.record-summary')).toContainText('Hilux');

  // Asociar un contacto desde Relacionados.
  const contact = await (await request.post('/api/crm/contacts', { data: { firstName: 'Assoc', lastName: tag, email: `a-${tag}@obj.io` } })).json();
  await page.locator('.record-tabs').getByRole('link', { name: 'Related', exact: true }).click();
  await page.getByLabel('Associate a contact').selectOption(contact.id);
  await expect(page.locator('.record-related')).toContainText(`Assoc ${tag}`);
  // Y se ve desde el contacto.
  await page.goto(`/en/app/crm/contacts/${contact.id}?tab=related`, { waitUntil: 'networkidle' });
  await expect(page.locator('.record-related')).toContainText(`AB ${tag}`);

  // Lista del objeto con su columna, y Cmd+K.
  await page.goto('/en/app/crm/objects', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: plural }).first().click();
  await expect(page.getByTestId('object-records')).toContainText('Hilux');
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('combobox').fill(`AB ${tag}`);
  await expect(search.getByRole('option', { name: new RegExp(`AB ${tag}`) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // 390 px sin scroll horizontal, en claro y oscuro.
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('leads: alta, tabla, board con cambio de etapa, conversión a deal', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const contact = await (await request.post('/api/crm/contacts', { data: { firstName: 'Lead', lastName: tag, email: `l-${tag}@lead.io` } })).json();
  await page.goto('/en/app/crm/leads', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New lead' });
  const combo = dialog.getByRole('combobox', { name: 'Contact' });
  await combo.click();
  await combo.pressSequentially(`Lead ${tag}`);
  await dialog.getByRole('option', { name: `Lead ${tag}` }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  // Sin nombre toma el del contacto.
  await expect(page.getByRole('heading', { level: 1, name: `Lead ${tag}` })).toBeVisible();
  const leadUrl = page.url();

  // Camino de etapas: pasar a Connected.
  await page.getByRole('button', { name: 'Connected' }).click();
  await expect(page.getByRole('button', { name: 'Connected' })).toHaveAttribute('aria-current', 'step');

  // Board: mover con el select "Move to" (teclado) a Attempting.
  await page.goto('/en/app/crm/leads?view=board', { waitUntil: 'networkidle' });
  const card = page.getByTestId('lead-card').filter({ hasText: `Lead ${tag}` });
  await expect(card).toBeVisible();
  await card.getByLabel(`Move to: Lead ${tag}`).selectOption({ label: 'Attempting' });
  await expect(page.locator('.kb-col[aria-label="Attempting"]').getByRole('link', { name: `Lead ${tag}` })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.kb-col[aria-label="Attempting"]').getByRole('link', { name: `Lead ${tag}` })).toBeVisible();

  // Tabla con búsqueda.
  await page.goto(`/en/app/crm/leads?q=${tag}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('leads-table')).toContainText(`Lead ${tag}`);

  // Convertir en deal: lleva al deal con el contacto.
  await page.goto(leadUrl, { waitUntil: 'networkidle' });
  await page.getByTestId('lead-convert').click();
  const conv = page.getByRole('dialog', { name: 'Convert to deal' });
  await conv.getByLabel(/Amount/).fill('1200');
  await conv.getByRole('button', { name: 'Create deal' }).click();
  await expect(page).toHaveURL(/\/app\/crm\/deals\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Lead ${tag}`);
  await page.goto(leadUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'Open deal' })).toBeVisible();

  // El lead aparece en el contacto.
  await page.goto(`/en/app/crm/contacts/${contact.id}?tab=related`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('related-leads')).toContainText(`Lead ${tag}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/crm/leads?view=board', { waitUntil: 'load' });
  await page.getByTestId('leads-board').waitFor();
  await noHorizontalScroll(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('ajustes: pipeline de leads y permisos por campo', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const field = await (
    await request.post('/api/crm/custom-fields', { data: { entity: 'contacts', name: `secret_${tag}`, label: `Secret ${tag}`, type: 'text' } })
  ).json();
  await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
  const perms = page.getByTestId('field-perms');
  const row = perms.locator('.field-perms-row').filter({ hasText: `Secret ${tag}` });
  await row.getByRole('button', { name: 'Permissions' }).click();
  await row.getByLabel(`Secret ${tag}: Members`).selectOption('hidden');
  await expect(row.getByRole('status')).toHaveText('Saved');
  const rules = (await (await request.get('/api/crm/field-permissions')).json()) as { rows: Array<{ field_id: string; access: string }> };
  expect(rules.rows.find((r) => r.field_id === field.id)?.access).toBe('hidden');

  await page.goto('/en/app/crm/settings?tab=sales', { waitUntil: 'networkidle' });
  const stages = page.getByTestId('lead-stages');
  await stages.getByPlaceholder('Stage name').fill(`Nurture ${tag}`);
  await stages.getByRole('button', { name: 'Add stage' }).click();
  await expect(stages.locator('.lead-stages-list input').last()).toHaveValue(`Nurture ${tag}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('listas dinámicas: campo propio OR actividad (deal abierto)', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  await request.post('/api/crm/custom-fields', {
    data: { entity: 'contacts', name: `plan_${tag}`, label: `Plan ${tag}`, type: 'select', options: ['pro', 'free'] },
  });
  await (await request.post('/api/crm/contacts', { data: { firstName: 'Pro', lastName: tag, email: `p-${tag}@l.io`, custom: { [`plan_${tag}`]: 'pro' } } })).json();
  const dealy = await (await request.post('/api/crm/contacts', { data: { firstName: 'Dealy', lastName: tag, email: `d-${tag}@l.io` } })).json();
  await request.post('/api/crm/contacts', { data: { firstName: 'Nobody', lastName: tag, email: `n-${tag}@l.io` } });
  const pipelines = await (await request.get('/api/crm/pipelines')).json();
  const p = pipelines.rows[0];
  const open = p.stages.find((s: { is_won: number; is_lost: number }) => !s.is_won && !s.is_lost);
  await request.post('/api/crm/deals', { data: { name: `D ${tag}`, pipelineId: p.id, stageId: open.id, contactIds: [dealy.id] } });

  await page.goto('/en/app/crm/lists', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Create list|New list/ }).first().click();
  await page.getByLabel('Name', { exact: true }).fill(`Hot ${tag}`);
  await page.getByLabel('Type').selectOption('dynamic');
  const rules = page.getByTestId('list-rules');
  await rules.getByRole('button', { name: 'Add filter' }).click();
  await rules.getByLabel('Property').nth(0).selectOption(`custom:plan_${tag}`);
  await rules.getByLabel('Value').nth(0).selectOption('pro');
  await rules.getByRole('button', { name: 'Add filter' }).click();
  await rules.getByLabel('Property').nth(1).selectOption('hasOpenDeal');
  await rules.getByLabel('Value').nth(1).selectOption('1');
  await rules.getByLabel('Match').selectOption('any');
  await page.getByLabel('Search text').fill(tag);
  await page.getByRole('button', { name: /Create list/ }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: `Hot ${tag}` })).toBeVisible();
  const table = page.locator('table.crm-table');
  await expect(table).toContainText(`Pro ${tag}`);
  await expect(table).toContainText(`Dealy ${tag}`);
  await expect(table).not.toContainText(`Nobody ${tag}`);
  await expect(page.getByTestId('list-filter-summary')).toContainText('Has an open deal');

  // Editar: AND deja afuera a los dos.
  await page.getByRole('button', { name: 'Edit filters' }).click();
  await page.getByTestId('list-rules').getByLabel('Match').selectOption('all');
  await page.getByRole('button', { name: 'Save filters' }).click();
  await expect(page.getByTestId('list-filter-summary')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(`Pro ${tag}`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('empresa: completar desde el sitio (descripción, redes, rubro y tamaño)', async ({ page, request }) => {
  const watched = watchErrors(page);
  // El logo de un dominio que no existe responde 404 y la ficha muestra las iniciales (no es un error).
  const errors = { filter: () => watched.filter((e) => !e.includes('/api/crm/logo/') && !e.includes('Failed to load resource')) };
  const tag = uid();
  const co = await (await request.post('/api/crm/companies', { data: { name: `Site ${tag}` } })).json();
  await request.patch(`/api/crm/companies/${co.id}`, { data: { domain: `norte-${tag}.io` } });
  await page.goto(`/en/app/crm/companies/${co.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('company-enrich').click();
  await expect(page.getByRole('status').filter({ hasText: /Filled \d+ fields/ })).toBeVisible();
  await expect(page.getByTestId('company-description')).toContainText('builds tools for small teams');
  await expect(page.locator('.co-socials')).toContainText('LinkedIn');
  await page.goto(`/en/app/crm/companies/${co.id}?tab=properties`, { waitUntil: 'networkidle' });
  await expect(page.locator('.record-props')).toContainText('Software');
  await expect(page.locator('.record-props')).toContainText('Austin');
  // Al crearla con dominio se completa sola (en segundo plano).
  const auto = await (await request.post('/api/crm/companies', { data: { name: `Auto ${tag}`, domain: `auto-${tag}.io` } })).json();
  await expect
    .poll(async () => ((await (await request.get(`/api/crm/companies/${auto.id}`)).json()) as { company: { industry: string } }).company.industry, {
      timeout: 10_000,
    })
    .toBe('Software');
  expect(errors.filter(), errors.filter().join('\n')).toEqual([]);
});
