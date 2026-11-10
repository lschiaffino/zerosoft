import { expect, test, type Page } from '@playwright/test';

/**
 * Mudanza desde Linear de punta a punta en la UI, contra el workspace falso
 * de lib/track-linear-fake.ts (TRACK_LINEAR_FAKE=1 en playwright.config.ts):
 * key equivocada, vista previa, import, issue con todo lo que trae y una
 * segunda corrida un día después que actualiza sin duplicar.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });

// Un import abierto (de una corrida que falló) se retoma al entrar: se cancela antes.
test.beforeEach(async ({ request }) => {
  const res = await request.get('/api/import/jobs?app=track');
  if (!res.ok()) return;
  const { jobs } = (await res.json()) as { jobs: Array<{ id: string; status: string }> };
  for (const j of jobs.filter((x) => ['uploading', 'fetching', 'preview', 'importing'].includes(x.status))) {
    await request.delete(`/api/import/jobs/${j.id}`);
  }
});

async function openImporter(page: Page) {
  await page.goto('/en/app/track/settings?tab=import');
  await expect(page.getByTestId('track-import')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Import from').selectOption('linear');
}

test('Linear: una key equivocada avisa y no queda a la vista', async ({ page }) => {
  await openImporter(page);
  await page.getByLabel('Linear API key').fill('lin_api_fake_wrong_key');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('import-read-failed')).toBeVisible({ timeout: 60_000 });
  // La key queda solo en su campo (oculto, para corregirla), nunca como texto en la página.
  await expect(page.getByLabel('Linear API key')).toHaveAttribute('type', 'password');
  await expect(page.getByText('lin_api_fake_wrong_key')).toHaveCount(0);
});

test('Linear: workspace entero con vista previa, import y reimport que actualiza', async ({ page }) => {
  await openImporter(page);
  await page.getByLabel('Linear API key').fill('lin_api_fake');
  await page.getByRole('button', { name: 'Preview' }).click();

  const preview = page.getByTestId('track-import-preview');
  await expect(preview).toBeVisible({ timeout: 90_000 });
  await expect(preview.getByText('From the Linear workspace Acme.')).toBeVisible();
  await expect(preview.getByTestId('track-import-plans').getByText('Mobile app v2')).toBeVisible();
  // Quien no es miembro aparece con el botón para invitarlo.
  await expect(preview.getByText('bo@acme-linear.test')).toBeVisible();
  await expect(preview.getByTestId('track-import-invite')).toBeVisible();
  // La key no vuelve a la página.
  expect(await page.content()).not.toContain('lin_api_fake"');

  const confirm = preview.getByRole('button', { name: /^(Import \d+ issues?|Update \d+ issues?|Bring in new comments and links)$/ });
  await confirm.click();
  const done = page.getByTestId('track-import-done');
  await expect(done).toBeVisible({ timeout: 120_000 });
  await expect(done.getByRole('link', { name: 'Open project Mobile app v2' })).toBeVisible();

  // El issue en Track: proyecto, milestone, links, PR y comentarios en hilo.
  await done.getByRole('link', { name: 'Open Engineering' }).click();
  await expect(page).toHaveURL(/\/app\/track\/team\//, { timeout: 60_000 });
  await page.getByText(/^Offline sync for the mobile app/).first().click();
  await expect(page).toHaveURL(/\/app\/track\/issue\//, { timeout: 60_000 });
  await expect(page.getByText('Conflict handling').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Mobile app v2').first()).toBeVisible();
  await expect(page.getByText('Can we keep the queue under 5 MB?')).toBeVisible();
  await expect(page.getByTestId('track-issue-links').getByText(/Spec/)).toBeVisible();

  // Un día después en Linear: reimportar actualiza lo que cambió y suma lo nuevo.
  await openImporter(page);
  await page.getByLabel('Linear API key').fill('lin_api_fake_v2');
  await page.getByRole('button', { name: 'Preview' }).click();
  const again = page.getByTestId('track-import-preview');
  await expect(again).toBeVisible({ timeout: 90_000 });
  // En un reintento la v2 ya está importada: entonces no hay nada que actualizar.
  await expect(again.getByTestId('track-import-already')).toContainText(/imported before/);
  await again.getByRole('button', { name: /^(Import \d+ issues?|Update \d+ issues?|Bring in new comments and links)$/ }).click();
  const done2 = page.getByTestId('track-import-done');
  await expect(done2).toBeVisible({ timeout: 120_000 });

  // Sin duplicados: el issue renombrado está una sola vez y el nuevo de la v2 también.
  const found = async (q: string) =>
    ((await (await page.request.get(`/api/track/issues?q=${encodeURIComponent(q)}&pageSize=50`)).json()) as { rows: Array<{ title: string }> }).rows.filter(
      (r) => r.title === q,
    ).length;
  expect(await found('Offline sync for the mobile app (v2)')).toBe(1);
  expect(await found('Offline sync for the mobile app')).toBe(0);
  expect(await found('Retry failed uploads')).toBe(1);
});
