import { expect, test, type Page } from '@playwright/test';

/**
 * Hub de importación (/app/settings/import) de punta a punta contra los
 * fakes (NOTION_IMPORT_FAKE y CRM_IMPORT_FAKE en playwright.config.ts): las
 * fuentes por app, los pasos para sacar el token con sus permisos, Notion por
 * API (validación, vista previa, qué traer, informe, reimport sin duplicar),
 * HubSpot dentro del hub (listas e invitar owners), el atajo del sidebar,
 * Cmd+K y 390 px.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const HUB = '/en/app/settings/import';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('lista las fuentes por app con su tipo de conexión', async ({ page }) => {
  await page.goto(HUB, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('import-hub')).toBeVisible();
  for (const app of ['crm', 'docs', 'track', 'cal', 'link', 'notes']) await expect(page.getByTestId(`import-hub-app-${app}`)).toBeVisible();
  const hubspot = page.getByTestId('import-source-crm:hubspot');
  await expect(hubspot).toContainText('HubSpot');
  await expect(hubspot).toContainText('API token');
  await expect(page.getByTestId('import-source-docs:notion')).toContainText('Export file');
  await expect(page.getByTestId('import-source-docs:notion_api')).toContainText('API token');
});

test('Notion por API: token rechazado, vista previa, import y reimport', async ({ page }) => {
  await page.goto(HUB, { waitUntil: 'networkidle' });
  await page.getByTestId('import-source-docs:notion_api').getByRole('link', { name: /Import from Notion into Docs/ }).click();
  await expect(page.getByTestId('import-hub-source')).toHaveAttribute('data-source', 'docs:notion_api');
  // Pasos y capacidades exactas de la integración.
  const howto = page.getByTestId('import-hub-howto');
  await expect(howto.getByRole('heading', { name: 'How to get the Notion token' })).toBeVisible();
  await expect(howto.locator('ol li')).toHaveCount(5);
  await expect(page.getByTestId('import-hub-scopes')).toContainText('Read user information including email addresses');

  // Token inválido: se prueba antes de importar y vuelve al formulario.
  const token = page.getByLabel('Internal Integration Secret');
  await expect(token).toBeVisible({ timeout: 20_000 });
  await token.fill('secret_not_valid_123');
  await page.getByRole('button', { name: 'Connect and preview' }).click();
  await expect(page.getByTestId('import-read-failed')).toContainText("We couldn't read Notion", { timeout: 30_000 });

  await page.getByLabel('Internal Integration Secret').fill('fake-notion');
  await page.getByRole('button', { name: 'Connect and preview' }).click();
  const preview = page.getByTestId('notion-api-preview');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByText('Connected to Acme (fake).')).toBeVisible();
  await expect(preview.locator('.ximp-stat').filter({ hasText: 'Pages' }).locator('.ximp-stat-value')).toHaveText('2');
  await expect(preview.locator('.ximp-stat').filter({ hasText: 'Database rows' }).locator('.ximp-stat-value')).toHaveText('2');
  await expect(preview.getByText('Handbook')).toBeVisible();
  await expect(preview.getByLabel(/Databases \(1\) with their rows \(2\)/)).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await preview.getByRole('button', { name: 'Import', exact: true }).click();
  const done = page.getByTestId('notion-api-done');
  await expect(done).toBeVisible({ timeout: 90_000 });
  const report = page.getByTestId('notion-api-report');
  await expect(report.locator('.ximp-stat').filter({ hasText: 'Created' }).locator('.ximp-stat-value')).toHaveText('3');
  await expect(report.locator('.ximp-stat').filter({ hasText: 'Files' }).locator('.ximp-stat-value')).toHaveText('2');

  // La página importada se abre en Docs con su contenido y sus links internos.
  await done.getByRole('link', { name: 'Handbook' }).click();
  await expect(page).toHaveURL(/\/app\/docs\//);
  await expect(page.getByText('Welcome to Acme')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Onboarding' }).first()).toBeVisible();

  // Aparece en los imports recientes del hub.
  await page.goto(HUB, { waitUntil: 'networkidle' });
  const recent = page.getByTestId('import-hub-recent');
  await expect(recent.locator('li').filter({ hasText: 'Notion' }).first()).toContainText('Done');

  // Reimport: avisa lo ya importado y actualiza sin duplicar.
  await page.goto(`${HUB}?source=docs:notion_api`, { waitUntil: 'networkidle' });
  await page.getByLabel('Internal Integration Secret').fill('fake-notion');
  await page.getByRole('button', { name: 'Connect and preview' }).click();
  await expect(page.getByTestId('notion-api-preview').getByText(/3 items were imported before/)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('notion-api-preview').getByRole('button', { name: 'Import', exact: true }).click();
  const report2 = page.getByTestId('notion-api-report');
  await expect(report2).toBeVisible({ timeout: 90_000 });
  await expect(report2.locator('.ximp-stat').filter({ hasText: 'Created' }).locator('.ximp-stat-value')).toHaveText('0');
  await expect(report2.locator('.ximp-stat').filter({ hasText: 'Updated' }).locator('.ximp-stat-value')).toHaveText('3');
  const res = await page.request.get('/api/docs/pages');
  const body = JSON.stringify(await res.json());
  expect(body.split('"Handbook"').length - 1).toBe(1);
});

test('HubSpot dentro del hub: permisos, listas e invitar owners que faltan', async ({ page }) => {
  await page.goto(`${HUB}?source=crm:hubspot`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('import-hub-scopes')).toContainText('crm.lists.read');
  await expect(page.getByTestId('import-hub-howto').locator('ol li')).toHaveCount(5);
  await expect(page.getByRole('heading', { name: 'Connect HubSpot' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Access token').fill('fake');
  await page.getByRole('button', { name: 'Connect and preview' }).click();
  await expect(page.getByTestId('migrate-preview')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('migrate-count-lists')).toHaveText('2');

  const invite = page.getByTestId('migrate-invite');
  await invite.getByRole('button', { name: /Invite 1 person to the workspace/ }).click();
  await expect(invite.getByText('sam@fake-crm.test')).toBeVisible();
  await expect(invite.getByLabel('Invitation link for sam@fake-crm.test')).toHaveValue(/\/en\/invite\//);

  await page.getByRole('button', { name: 'Start import' }).click();
  const progress = page.getByTestId('migrate-progress');
  await expect(progress).toHaveAttribute('data-status', 'done', { timeout: 90_000 });
  await expect(progress.locator('tr[data-group="lists"] [data-col="created"], tr[data-group="lists"] [data-col="updated"]').first()).toBeVisible();
  const tags = JSON.stringify(await (await page.request.get('/api/crm/tags')).json());
  expect(tags).toContain('Newsletter');
});

test('atajo Importar del sidebar y Cmd+K llevan al hub', async ({ page }) => {
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await page.getByTestId('side-import').click();
  await expect(page).toHaveURL(/settings\/import\?app=docs/);
  // La app de origen va primero.
  const first = page.locator('[data-testid^="import-hub-app-"]').first();
  await expect(first).toHaveAttribute('data-testid', 'import-hub-app-docs');

  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('Import from Calendly');
  await dialog.getByRole('option', { name: /Import from Calendly to Cal/ }).first().click();
  await expect(page).toHaveURL(/source=cal(%3A|:)calendly/);
  await expect(page.getByTestId('import-hub-howto').getByRole('heading', { name: 'How to get the Calendly token' })).toBeVisible();
});

test('390 px y modo oscuro sin scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(HUB, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('import-hub')).toBeVisible();
  await noHorizontalScroll(page);
  await page.goto(`${HUB}?source=crm:hubspot`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('import-hub-howto')).toBeVisible();
  await noHorizontalScroll(page);
});
