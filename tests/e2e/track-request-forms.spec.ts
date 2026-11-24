import { expect, test, type APIResponse, type Page } from '@playwright/test';

/** Track: formularios de pedidos (form templates de Linear) que crean issues en triage. */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function noSideScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
}

test('armar un formulario en ajustes, mandarlo y que el issue llegue a triage', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Forms ${uid()}` } }));
  await ok(request.patch(`/api/track/projects/${project.id}`, { data: { triageEnabled: true } }));

  await page.goto(`/en/app/track/team/${project.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('track-project-settings').click();
  await page.getByTestId('track-settings-tab-templates').click();
  await page.getByTestId('track-new-template').first().click();
  const form = page.getByTestId('track-template-form');
  await form.getByLabel('Template name').fill('Bug report');

  // Esc en el editor cancela sin guardar.
  await form.getByTestId('track-form-add-field').click();
  await form.getByTestId('track-form-field-label').first().fill('Throwaway');
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);

  await page.getByTestId('track-new-template').first().click();
  await form.getByLabel('Template name').fill('Bug report');
  await form.getByTestId('track-form-add-field').click();
  const first = form.getByTestId('track-form-field').nth(0);
  await first.getByTestId('track-form-field-label').fill('Where');
  await first.getByTestId('track-form-field-type').selectOption('select');
  await first.getByTestId('track-form-field-options').fill('Web\nMobile');
  await first.getByTestId('track-form-field-required').check();
  await form.getByTestId('track-form-add-field').click();
  const second = form.getByTestId('track-form-field').nth(1);
  await second.getByTestId('track-form-field-label').fill('What happened');
  await second.getByTestId('track-form-field-type').selectOption('textarea');
  await second.getByTestId('track-form-field-required').check();
  // Un formulario no puede ser la plantilla predeterminada.
  await expect(form.getByTestId('track-template-default')).toHaveCount(0);
  await form.getByRole('button', { name: 'Create template' }).click();

  const row = page.getByTestId('track-template').filter({ has: page.getByTestId('track-template-is-form') });
  await expect(row).toHaveCount(1);
  await row.getByTestId('track-template-open-form').click();
  await expect(page).toHaveURL(/\/app\/track\/forms\//);

  // Enviar vacío marca los obligatorios y no crea nada.
  const req = page.getByTestId('track-request-form');
  await page.getByTestId('track-request-submit').click();
  await expect(page.getByTestId('track-request-title')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('track-request-title').fill(`Login fails ${uid()}`);
  await page.getByTestId('track-request-submit').click();
  await expect(req.locator('[data-field-id][aria-invalid="true"]')).toHaveCount(2);

  await req.getByLabel(/Where/).selectOption('Web');
  await req.getByLabel(/What happened/).fill('Blank page after login');
  await page.getByTestId('track-request-submit').click();
  await expect(page.getByTestId('track-request-sent')).toBeVisible();

  const triage = await ok<{ rows: Array<{ title: string; description: string; source: string }> }>(request.get(`/api/track/projects/${project.id}/triage`));
  const issue = triage.rows.find((r) => r.title.startsWith('Login fails'));
  expect(issue?.source).toBe('form');
  expect(issue?.description).toContain('Blank page after login');

  // Mandar otro deja el formulario vacío.
  await page.getByTestId('track-request-again').click();
  await expect(page.getByTestId('track-request-title')).toHaveValue('');
  await expect(page.getByTestId('track-request-title')).toBeFocused();

  // El índice lo lista.
  await page.goto('/en/app/track/forms', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-forms-index-item').filter({ hasText: 'Bug report' }).first()).toBeVisible();
});

test('formulario a 390 px en oscuro, sin scroll lateral', async ({ page, request }) => {
  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Forms m ${uid()}` } }));
  const tpl = await ok<{ id: string }>(
    request.post(`/api/track/projects/${project.id}/templates`, {
      data: {
        name: 'A request form with a fairly long name to check wrapping',
        description: 'Tell us what you need. **Be specific.**',
        fields: [
          { id: 'area', label: 'Which part of the product is this about?', type: 'select', required: true, options: ['Web', 'Desktop', 'Mobile'] },
          { id: 'why', label: 'Why', type: 'textarea', help: 'What would it let you do?' },
          { id: 'urgent', label: 'It blocks my work', type: 'checkbox' },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/track/forms/${tpl.id}`, { waitUntil: 'networkidle' });
  await page.context().addCookies([{ name: 'zs_theme', value: 'dark', url: page.url() }]);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-request-form')).toBeVisible();
  await expect(page.getByTestId('track-request-field')).toHaveCount(3);
  await noSideScroll(page);
  await page.screenshot({ path: process.env.FORMS_SHOT || 'test-results/track-request-form-390-dark.png', fullPage: true });
});
