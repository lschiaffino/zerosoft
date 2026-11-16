import { expect, test } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Time de punta a punta con la persona demo (la app está en vista previa: solo
 * el staff la abre). Arranca sin horas en el workspace demo, así no depende
 * de lo que dejaron otras corridas. Crear un proyecto con un
 * cliente nuevo, cargar horas a mano, arrancar y parar el cronómetro, editar y
 * borrar una entrada, el reporte con su monto y el CSV, y el proyecto en Cmd+K.
 * Sin textos visibles en los selectores: roles, nombres de campo y testids.
 */
test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const db = e2eDb();
  try {
    // Solo las horas: los proyectos de otros archivos (app-smoke) quedan como están.
    // En una base recién creada la tabla todavía no existe (las migraciones corren con el primer pedido a la app).
    await db.execute({ sql: `DELETE FROM time_entries WHERE workspace_id = 'demo'`, args: [] }).catch((err: unknown) => {
      if (!/no such table/i.test(String(err))) throw err;
    });
  } finally {
    db.close();
  }
});

test('proyecto, horas, cronómetro, reporte y CSV', async ({ page }) => {
  const name = `Web ${Math.random().toString(36).slice(2, 7)}`;

  await page.goto('/en/app/time/projects?new=1', { waitUntil: 'networkidle' });
  const pd = page.getByTestId('time-project-dialog');
  await pd.locator('input[name=name]').fill(name);
  await pd.locator('select[name=client]').selectOption('__new__');
  await pd.locator('input[name=clientName]').fill(`Client ${name}`);
  await pd.locator('input[name=rate]').fill('100');
  await pd.locator('input[name=budget]').fill('10');
  await pd.getByTestId('time-project-submit').click();
  await page.waitForURL(/\/app\/time\/projects\/tpr_/);
  await expect(page.getByTestId('time-project-title')).toContainText(name);

  // Horas a mano: 1:30.
  await page.goto('/en/app/time', { waitUntil: 'networkidle' });
  await page.getByTestId('time-track').click();
  const ed = page.getByTestId('time-entry-dialog');
  await expect(ed).toBeVisible();
  await ed.locator('select[name=project]').selectOption({ label: name });
  await ed.locator('input[name=duration]').fill('1:30');
  await ed.getByTestId('time-entry-submit').click();
  await expect(ed).toBeHidden();
  await expect(page.getByTestId('time-entry')).toHaveCount(1);
  await expect(page.getByTestId('time-day-total')).toHaveText('1:30');

  // Una duración que no se entiende muestra el error y no guarda.
  await page.getByTestId('time-track').click();
  await ed.locator('input[name=duration]').fill('abc');
  await ed.getByTestId('time-entry-submit').click();
  await expect(ed.getByRole('alert')).toBeVisible();
  // Vacía arranca un cronómetro.
  await ed.locator('select[name=project]').selectOption({ label: name });
  await ed.locator('input[name=duration]').fill('');
  await ed.getByTestId('time-entry-submit').click();
  await expect(page.locator('[data-testid=time-entry][data-running=true]')).toHaveCount(1);
  await page.locator('[data-testid=time-entry][data-running=true]').getByTestId('time-entry-toggle').click();
  await expect(page.locator('[data-testid=time-entry][data-running=true]')).toHaveCount(0);
  await expect(page.getByTestId('time-entry')).toHaveCount(2);

  // Editar la primera a 2h: el total del día y de la semana se actualizan sin recargar.
  await page.getByTestId('time-entry').first().locator('.tm-entry-main').click();
  await ed.locator('input[name=duration]').fill('2h');
  await ed.getByTestId('time-entry-submit').click();
  await expect(ed).toBeHidden();
  await expect(page.getByTestId('time-day-total')).toHaveText('2:00');

  // Borrar la del cronómetro (0:00) desde el diálogo, con confirmación.
  await page.getByTestId('time-entry').last().locator('.tm-entry-main').click();
  await ed.getByTestId('time-entry-delete').click();
  await page.getByRole('alertdialog').getByRole('button').last().click();
  await expect(page.getByTestId('time-entry')).toHaveCount(1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('time-entry')).toHaveCount(1);

  // Reporte de la semana del proyecto: 2 h a 100 = 200 (la tarea por defecto es facturable).
  await page.goto('/en/app/time/reports', { waitUntil: 'networkidle' });
  await page.getByTestId('time-report-range').selectOption('thisWeek');
  await page.getByTestId('time-report-project').selectOption({ label: name });
  await expect(page.getByTestId('time-report-row')).toHaveCount(1);
  await expect(page.getByTestId('time-report-hours')).toHaveText('2:00');
  await expect(page.getByTestId('time-report-amount')).toContainText('200');
  const href = await page.getByTestId('time-report-export').getAttribute('href');
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(name);

  // El proyecto aparece en Cmd+K.
  const search = await page.request.get(`/api/search?q=${encodeURIComponent(name)}`);
  const items = ((await search.json()) as { items: Array<{ group: string; href: string }> }).items;
  expect(items.some((i) => i.group === 'timeProjects' && i.href.startsWith('/app/time/projects/'))).toBe(true);
});

test('en el teléfono la hoja no se corre de costado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/en/app/time', '/en/app/time/projects', '/en/app/time/reports', '/en/app/time/settings']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
});
