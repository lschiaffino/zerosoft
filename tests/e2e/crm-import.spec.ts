import { expect, test } from '@playwright/test';

/**
 * Import de CRM por API contra el proveedor falso (CRM_IMPORT_FAKE=1 en
 * playwright.config.ts, token "fake"): tarjetas, token, vista previa con
 * owners y campos, progreso hasta terminar, reimport sin duplicar, cancelar
 * con recarga en el medio, Cmd+K y presets de CSV.
 */

test.describe.configure({ mode: 'serial' });

const SETTINGS = '/en/app/crm/settings?tab=import';

async function connect(page: import('@playwright/test').Page, provider: 'HubSpot' | 'Pipedrive', token: string) {
  const card = page.getByTestId(`migrate-card-${provider.toLowerCase()}`);
  await expect(async () => {
    await card.getByRole('button', { name: `Connect ${provider}` }).click();
    await expect(page.getByRole('heading', { name: `Connect ${provider}` })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByLabel(provider === 'HubSpot' ? 'Access token' : 'API token').fill(token);
  await page.getByRole('button', { name: 'Connect and preview' }).click();
  await expect(page.getByTestId('migrate-preview')).toBeVisible({ timeout: 30_000 });
}

test('HubSpot: token, vista previa, import completo y reimport que actualiza', async ({ page, request }) => {
  await page.goto(SETTINGS, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Import from another CRM' })).toBeVisible();
  await expect(page.getByTestId('migrate-card-hubspot')).toBeVisible();
  await expect(page.getByTestId('migrate-card-pipedrive')).toBeVisible();

  // Token inválido: mensaje claro, no avanza.
  const card = page.getByTestId('migrate-card-hubspot');
  await expect(async () => {
    await card.getByRole('button', { name: 'Connect HubSpot' }).click();
    await expect(page.getByRole('heading', { name: 'Connect HubSpot' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText('crm.objects.owners.read')).toBeVisible();
  await page.getByLabel('Access token').fill('wrong-token');
  await page.getByRole('button', { name: 'Connect and preview' }).click();
  await expect(page.locator('p.form-error[role="alert"]')).toContainText("That token didn't work");
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await connect(page, 'HubSpot', 'fake');
  await expect(page.getByTestId('migrate-count-contacts')).toHaveText('24');
  await expect(page.getByTestId('migrate-count-companies')).toHaveText('6');
  // Owners: uno coincide por email con la persona demo, el otro va al owner por defecto.
  const owners = page.getByTestId('migrate-owners');
  await expect(owners.locator('tbody tr')).toHaveCount(2);
  await expect(owners.getByText('matched by email')).toHaveCount(1);
  await expect(page.getByText('1 owner has no teammate with the same email')).toBeVisible();
  await expect(page.getByTestId('migrate-fields').locator('tbody tr')).toHaveCount(3);
  await expect(page.getByText('Sales Pipeline')).toBeVisible();

  await page.getByRole('button', { name: 'Start import' }).click();
  const progress = page.getByTestId('migrate-progress');
  await expect(progress).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Import from HubSpot finished' })).toBeVisible();
  await expect(progress.locator('tr[data-group="contacts"] [data-col="created"]')).toHaveText('24');

  // Los registros están en el CRM.
  const contacts = await (await request.get('/api/crm/contacts?q=person1%40company1.example')).json();
  expect(JSON.stringify(contacts)).toContain('person1@company1.example');

  // El historial sobrevive a la recarga.
  await page.goto(SETTINGS, { waitUntil: 'networkidle' });
  await expect(page.getByText('Previous imports')).toBeVisible();

  // Reimport: avisa que ya vinieron registros y actualiza en vez de duplicar.
  await connect(page, 'HubSpot', 'fake');
  await expect(page.getByText(/records came from this account before/)).toBeVisible();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByTestId('migrate-progress')).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  const row = page.getByTestId('migrate-progress').locator('tr[data-group="contacts"]');
  await expect(row.locator('[data-col="created"]')).toHaveText('0');
  await expect(row.locator('[data-col="updated"]')).toHaveText('24');
});

test('Pipedrive: el progreso sobrevive a la recarga y se puede cancelar', async ({ page }) => {
  await page.goto(SETTINGS, { waitUntil: 'networkidle' });
  await connect(page, 'Pipedrive', 'fake-200000');
  // Pipedrive no da totales: se muestra "All".
  await expect(page.getByTestId('migrate-count-contacts')).toHaveText('All');
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByTestId('migrate-progress')).toHaveAttribute('data-status', /queued|running/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const progress = page.getByTestId('migrate-progress');
  await expect(progress).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Importing from Pipedrive' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel import' }).click();
  await expect(page.getByText("Stop the import? What's already imported stays.")).toBeVisible();
  await page.getByRole('button', { name: 'Cancel import' }).click();
  await expect(progress).toHaveAttribute('data-status', 'cancelled', { timeout: 30_000 });
  await expect(page.getByText('The token was deleted.', { exact: false })).toBeVisible();
});

test('Cmd+K abre el import de HubSpot', async ({ page }) => {
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('Import from HubSpot');
  await dialog.getByRole('option', { name: /Import from HubSpot/ }).first().click();
  await expect(page).toHaveURL(/tab=import&from=hubspot/);
  await expect(page.getByRole('heading', { name: 'Connect HubSpot' })).toBeVisible({ timeout: 20_000 });
});

test('CSV: preset de export de Salesforce', async ({ page }) => {
  await page.goto(SETTINGS, { waitUntil: 'networkidle' });
  const csv = 'First Name,Last Name,Email,Title,Account Name,Contact Owner\nAda,Lovelace,ada@sf-preset.test,CEO,Analytical,Demo User';
  await page.locator('textarea.imp-textarea').fill(csv);
  await page.getByRole('button', { name: 'Parse' }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByLabel('Mapping preset').selectOption('salesforce');
  const selects = page.locator('.imp-map-row select');
  await expect(selects.nth(3)).toHaveValue('jobTitle');
  await expect(selects.nth(4)).toHaveValue('companyName');
  await expect(selects.nth(5)).toHaveValue('ownerEmail');
});
