import { expect, test } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Time: la hoja semanal en grilla (vista Week de Harvest) con la persona demo.
 * Agregar una fila, escribir horas en las celdas (Enter y Tab), ver los totales,
 * vaciar una celda, recargar, copiar las filas de la semana anterior, una celda
 * con cronómetro que abre el día, quitar la fila con confirmación, y la grilla a
 * 390 px sin scroll de costado. Las fechas salen de la semana que muestra la
 * página (atributos data-day), nunca de la hora del runner. Sin textos visibles
 * en los selectores.
 */
test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

let projectName = '';

test.beforeAll(async () => {
  const db = e2eDb();
  try {
    await db.execute({ sql: `DELETE FROM time_entries WHERE workspace_id = 'demo'`, args: [] }).catch((err: unknown) => {
      if (!/no such table/i.test(String(err))) throw err;
    });
  } finally {
    db.close();
  }
});

test('grilla semanal: filas, celdas, totales, copiar y quitar', async ({ page }) => {
  projectName = `Grid ${Math.random().toString(36).slice(2, 7)}`;
  const created = await page.request.post('/api/time/projects', { data: { name: projectName } });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  await page.goto('/en/app/time?view=week', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('time-view-week')).toHaveAttribute('aria-selected', 'true');
  const grid = page.getByTestId('time-week-grid');
  await expect(grid).toBeVisible();

  // Semana vacía: agregar una fila con el proyecto nuevo.
  await grid.getByTestId('time-week-add-row').click();
  const dialog = page.getByTestId('time-week-row-dialog');
  await dialog.locator('select[name=project]').selectOption(project.id);
  const taskId = await dialog.locator('select[name=task]').inputValue();
  await dialog.getByTestId('time-week-row-submit').click();
  await expect(dialog).toBeHidden();
  const row = grid.locator(`[data-testid=time-week-row][data-row="${project.id}|${taskId}"]`);
  await expect(row).toHaveCount(1);

  const cells = row.getByTestId('time-week-cell');
  await expect(cells).toHaveCount(7);
  const monday = (await cells.nth(0).getAttribute('data-day'))!;
  const tuesday = (await cells.nth(1).getAttribute('data-day'))!;

  // Lunes 1:30 con Enter, martes 2 con Tab: se guardan y los totales cambian sin recargar.
  let saved = page.waitForResponse((r) => r.url().endsWith('/api/time/entries') && r.request().method() === 'POST');
  await cells.nth(0).fill('1:30');
  await cells.nth(0).press('Enter');
  await saved;
  await expect(cells.nth(0)).toHaveValue('1:30');
  saved = page.waitForResponse((r) => r.url().endsWith('/api/time/entries') && r.request().method() === 'POST');
  await cells.nth(1).fill('2');
  await cells.nth(1).press('Tab');
  await saved;
  await expect(cells.nth(1)).toHaveValue('2:00');
  await expect(row.getByTestId('time-week-row-total')).toHaveText('3:30');
  await expect(grid.getByTestId(`time-week-day-total-${monday}`)).toHaveText('1:30');
  await expect(grid.getByTestId('time-week-grid-total')).toHaveText('3:30');
  await expect(page.getByTestId('time-week-total')).toContainText('3:30');

  // Una duración que no se entiende no guarda y vuelve al valor anterior.
  await cells.nth(0).fill('abc');
  await cells.nth(0).press('Enter');
  await expect(cells.nth(0)).toHaveValue('1:30');

  // Esc descarta lo escrito.
  await cells.nth(1).fill('9');
  await cells.nth(1).press('Escape');
  await expect(cells.nth(1)).toHaveValue('2:00');

  // Vaciar el martes borra esa entrada; la fila queda.
  const removed = page.waitForResponse((r) => r.url().includes('/api/time/entries/') && r.request().method() === 'DELETE');
  await cells.nth(1).fill('');
  await cells.nth(1).press('Enter');
  await removed;
  await expect(grid.getByTestId('time-week-grid-total')).toHaveText('1:30');
  await expect(row).toHaveCount(1);

  // Recargar: lo guardado sigue ahí.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(row.getByTestId('time-week-cell').nth(0)).toHaveValue('1:30');
  await expect(grid.getByTestId('time-week-grid-total')).toHaveText('1:30');

  // La semana siguiente arranca vacía y copia las filas de esta.
  await page.getByTestId('time-next-week').click();
  await expect(grid.getByTestId('time-week-copy-rows')).toBeVisible();
  await grid.getByTestId('time-week-copy-rows').click();
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('time-week-row-total')).toHaveText('0:00');
  await page.goto(`/en/app/time?view=week&date=${monday}`, { waitUntil: 'networkidle' });

  // Un cronómetro en el martes: la celda queda bloqueada y abre el día.
  const timer = await page.request.post('/api/time/entries', { data: { date: tuesday, projectId: project.id, taskId, start: true } });
  expect(timer.status()).toBe(201);
  await page.reload({ waitUntil: 'networkidle' });
  const locked = row.getByTestId('time-week-cell-locked');
  await expect(locked).toHaveCount(1);
  await expect(locked).toHaveAttribute('data-day', tuesday);
  await locked.click();
  await expect(page.getByTestId('time-view-day')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`time-day-${tuesday}`)).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-testid=time-entry][data-running=true]').getByTestId('time-entry-toggle').click();
  await expect(page.locator('[data-testid=time-entry][data-running=true]')).toHaveCount(0);

  // Quitar la fila borra sus horas de la semana, con confirmación.
  await page.getByTestId('time-view-week').click();
  await row.getByTestId('time-week-remove-row').click();
  await page.getByRole('alertdialog').getByRole('button').last().click();
  await expect(row).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(row).toHaveCount(0);
  const left = (await (await page.request.get(`/api/time/entries?from=${monday}&to=${tuesday}`)).json()) as { entries: Array<{ projectId: string }> };
  expect(left.entries.filter((e) => e.projectId === project.id)).toHaveLength(0);
});

test('la grilla a 390 px no corre la página de costado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/time?view=week', { waitUntil: 'networkidle' });
  await page.getByTestId('time-week-grid').getByTestId('time-week-add-row').click();
  await page.getByTestId('time-week-row-dialog').getByTestId('time-week-row-submit').click();
  await expect(page.getByTestId('time-week-row').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
