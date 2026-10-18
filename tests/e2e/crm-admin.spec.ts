import { expect, test } from '@playwright/test';

/**
 * CRM admin: ajustes en pestañas, builder de formularios
 * con un solo Guardar, asistente de workflows con plantillas, horario de
 * secuencias resumido y remitente/destinatario colapsados en cotizaciones.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

test('ajustes: seis pestañas, cada una con lo suyo; la moneda ya no trae la regla de cotizaciones', async ({ page }) => {
  await page.goto('/en/app/crm/settings', { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Settings' });
  await expect(nav.getByRole('link')).toHaveCount(6);
  await expect(nav.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Sales' }).click();
  await expect(page).toHaveURL(/tab=sales/);
  await expect(page.getByRole('heading', { name: 'Pipelines' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quotes' })).toBeVisible();
  await expect(page.getByTestId('quote-moves-deal')).toBeVisible();

  await nav.getByRole('link', { name: 'Automation' }).click();
  await expect(page).toHaveURL(/tab=automation/);
  // Fuentes e historial del round-robin quedan en Avanzado, cerrado.
  const advanced = page.getByRole('button', { name: /Advanced/ }).first();
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
});

test('ajustes: un link viejo con ancla abre la pestaña nueva', async ({ page }) => {
  await page.goto('/en/app/crm/settings#quotas', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/tab=sales/);
});

test('formularios: pestañas sin perder cambios, URL propia en Avanzado y un solo Guardar', async ({ page, request }) => {
  const res = await request.post('/api/crm/forms', { data: { name: `Form ${uid()}` } });
  const form = await res.json();
  await page.goto(`/en/app/crm/forms/${form.id}`, { waitUntil: 'networkidle' });

  const tabs = page.getByRole('tablist', { name: 'Form sections' });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await page.getByTestId('form-add-field').click();
  await page.getByTestId('form-field-row').last().getByRole('textbox', { name: 'Label' }).fill('Company size');

  // Teclado: flecha a la derecha pasa a Diseño.
  await tabs.getByRole('tab', { name: 'Fields' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Design' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Custom URL')).toBeHidden();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await expect(page.getByLabel('Custom URL')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Save form' })).toHaveCount(1);
  await page.getByTestId('form-save').click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
  const saved = await (await request.get(`/api/crm/forms/${form.id}`)).json();
  const fields = (saved.form ?? saved).fields as Array<{ id: string; label: string }>;
  expect(fields.some((f) => f.id === 'company_size' && f.label === 'Company size')).toBe(true);
});

test('workflows: una plantilla completa disparador y acción, y el nombre se deriva', async ({ page }) => {
  await page.goto('/en/app/crm/workflows/new', { waitUntil: 'networkidle' });
  // Reintenta hasta que la página hidrate (el click antes de hidratar no hace nada).
  await expect(async () => {
    await page.getByTestId('workflow-template-wonTask').click();
    await expect(page.getByTestId('workflow-action')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('workflow-action').getByLabel('Task title')).toHaveValue('Schedule the onboarding');
  // Webhook, Flow y si/si no viven en el grupo Avanzado del select.
  await expect(page.getByTestId('workflow-action').locator('optgroup[label="Advanced"] option')).toHaveCount(3);
  await page.getByTestId('workflow-wizard-next').click();
  await expect(page.getByLabel('Workflow name')).toHaveValue('Task when a deal is won');
  await page.getByTestId('workflow-create').click();
  await expect(page).toHaveURL(/\/app\/crm\/workflows\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Task when a deal is won', level: 1 })).toBeVisible();
});

test('workflows: Siguiente en Acciones no guarda y pide los campos vacíos', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/crm/workflows') posts.push(r.url());
  });
  await page.goto('/en/app/crm/workflows/new', { waitUntil: 'networkidle' });
  await expect(async () => {
    await page.getByTestId('workflow-wizard-next').click();
    await expect(page.getByTestId('workflow-action')).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  // Acción por defecto: tarea sin título. Siguiente no avanza ni guarda.
  await page.getByTestId('workflow-wizard-next').click();
  await expect(page.getByText('Fill in the marked fields in the actions.')).toBeVisible();
  await expect(page.getByTestId('workflow-action').getByLabel('Task title')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('workflow-action').getByLabel('Task title').fill('Call them');
  await page.getByTestId('workflow-wizard-next').click();
  await expect(page.getByLabel('Workflow name')).toBeVisible();
  await expect(page.getByTestId('workflow-create')).toBeVisible();
  expect(posts).toHaveLength(0);
});

test('secuencias: el horario se ve como resumen y se abre para editarlo', async ({ page, request }) => {
  const res = await request.post('/api/crm/sequences', {
    data: { name: `Seq ${uid()}`, timezone: 'UTC', steps: [{ type: 'email', subject: 'Hi', body: 'Hello' }] },
  });
  const { sequence } = await res.json();
  await page.goto(`/en/app/crm/sequences/${sequence.id}`, { waitUntil: 'networkidle' });
  const toggle = page.getByRole('button', { name: /Schedule/ });
  await expect(toggle).toContainText(/UTC/);
  await expect(page.getByLabel('Time zone')).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel('Time zone')).toBeVisible();
});
