import { expect, test, type Page } from '@playwright/test';

/**
 * Editor de Robots: pestañas con teclado y en la URL, menú "⋯" de cada paso,
 * presets de horario con un solo Guardar y nombres de entradas derivados.
 */
async function createRobot(page: Page, template = 'priceCheck'): Promise<string> {
  await page.goto('/es/app/robots', { waitUntil: 'networkidle' });
  const res = await page.request.post('/api/robots', { data: { name: `E2E ${template}`, template } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  return id;
}

test('robots: la lista carga con su cabecera y las plantillas', async ({ page }) => {
  await page.goto('/es/app/robots', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Robots' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear robot' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plantillas' })).toBeVisible();
});

test('robots: pestañas con flechas y ?tab= en la URL', async ({ page }) => {
  const id = await createRobot(page);
  await page.goto(`/es/app/robots/${id}`, { waitUntil: 'networkidle' });
  const steps = page.getByRole('tab', { name: /Pasos/ });
  await expect(steps).toHaveAttribute('aria-selected', 'true');
  await steps.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Entradas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Entradas/ })).toBeFocused();
  await expect(page).toHaveURL(/tab=inputs/);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Avanzado' })).toHaveAttribute('aria-selected', 'true');

  await page.goto(`/es/app/robots/${id}?tab=schedule`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('tab', { name: 'Programación' })).toHaveAttribute('aria-selected', 'true');
});

test('robots: reintentos detrás del menú ⋯ del paso, que cierra con Esc', async ({ page }) => {
  const id = await createRobot(page);
  await page.goto(`/es/app/robots/${id}`, { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Reintentos')).toHaveCount(0);
  const menuButton = page.getByRole('button', { name: 'Opciones del paso 1' });
  await menuButton.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Agregar reintentos' }).click();
  await expect(page.getByLabel('Reintentos')).toBeFocused();
  await page.getByLabel('Reintentos').fill('2');
  await expect(page.getByText('2 reintentos')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
});

test('robots: preset "Días hábiles" se guarda con un solo Guardar', async ({ page }) => {
  const id = await createRobot(page);
  await page.goto(`/es/app/robots/${id}?tab=schedule`, { waitUntil: 'networkidle' });
  const save = page.getByRole('button', { name: 'Guardar cambios' });
  await expect(save).toBeDisabled();
  await page.getByRole('radio', { name: /Días hábiles/ }).check();
  await page.getByLabel('Hora', { exact: true }).fill('07:30');
  await save.click();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  const res = await page.request.get(`/api/robots/${id}`);
  const { robot } = (await res.json()) as { robot: { schedule: { mode: string; cron: string } } };
  expect(robot.schedule.mode).toBe('cron');
  expect(robot.schedule.cron).toBe('30 7 * * 1-5');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('radio', { name: /Días hábiles/ })).toBeChecked();
});

test('robots: el nombre de una entrada sale de la etiqueta', async ({ page }) => {
  const id = await createRobot(page);
  await page.goto(`/es/app/robots/${id}?tab=inputs`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Agregar entrada' }).click();
  const rows = page.locator('.robots-input-table tbody tr');
  const last = rows.last();
  await expect(last.getByLabel(/^Etiqueta/)).toBeFocused();
  await last.getByLabel(/^Etiqueta/).fill('Email del cliente');
  await expect(last.getByLabel(/^Nombre en los pasos/)).toHaveValue('email_del_cliente');
});
