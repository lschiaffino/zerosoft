import { expect, test, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

/** Crea un flow desde la plantilla Lead → CRM + Slack y abre el editor. */
async function openTemplateFlow(page: Page) {
  const res = await page.request.post('/api/flow/flows', { data: { name: `E2E ${uid()}`, template: 'leadToCrmSlack' } });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/es/app/flow/${id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  return id;
}

async function selectNode(page: Page, text: RegExp) {
  await expect(async () => {
    await page.locator('.react-flow__node').filter({ hasText: text }).first().click();
    await expect(page.locator('.flow-config-title')).toHaveText(text, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test('Flow: reintentos y si falla quedan en Avanzado', async ({ page }) => {
  await openTemplateFlow(page);
  await selectNode(page, /Slack/);
  const side = page.locator('.flow-side');
  await expect(side.getByLabel('Canal')).toBeVisible();
  const toggle = side.getByRole('button', { name: /Avanzado/ });
  // La plantilla deja reintentos en 1 (el default): Avanzado no marca cambios.
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await expect(side.getByLabel('Reintentos si falla')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(side.getByLabel('Reintentos si falla')).toBeVisible();
  await expect(side.getByLabel('Si este paso falla')).toBeVisible();
});

test('Flow: crear una credencial sin salir del editor', async ({ page }) => {
  const id = await openTemplateFlow(page);
  await selectNode(page, /Slack/);
  await page.getByRole('button', { name: 'Crear credencial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva credencial' });
  await expect(dialog).toBeVisible();
  // El tipo viene del nodo y el nombre técnico se deriva solo.
  await expect(dialog.getByLabel('Tipo')).toHaveValue('slack');
  await dialog.getByLabel(/Webhook/i).first().fill('https://hooks.slack.com/services/T000/B000/XXXX');
  await dialog.getByRole('button', { name: 'Crear credencial' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/app/flow/${id}$`));
  const select = page.locator('.flow-side').getByLabel('Credencial');
  await expect(select).not.toHaveValue('');
  await expect(select.locator('option:checked')).toContainText(/slack/);
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
});

test('Flow: tabs con flechas y modal de prueba con Esc', async ({ page }) => {
  await openTemplateFlow(page);
  const editorTab = page.getByRole('tab', { name: 'Editor' });
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');
  await editorTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Ejecuciones' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Ejecuciones' })).toBeFocused();
  await expect(page.getByText('Todavía no hay ejecuciones')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Probar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Probar' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Datos de prueba')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
