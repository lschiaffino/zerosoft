import { expect, test } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Time: equipo y tareas de un proyecto (como en Harvest) con la persona demo,
 * que administra. Dejar el proyecto solo para otra persona lo saca del
 * selector de la hoja y la API rechaza cargarle horas; volver a sumarse lo
 * devuelve. Elegir una sola tarea, no facturable en este proyecto: el diálogo
 * y la grilla semanal ofrecen solo esa y la entrada sale no facturable.
 * Sin textos visibles en los selectores: testids, nombres de campo y valores.
 */
test.setTimeout(120_000);

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

test('equipo y tareas por proyecto', async ({ page }) => {
  // El inicio crea la base y el workspace demo si esta suite corre sola.
  await page.goto('/en/app/time/projects', { waitUntil: 'networkidle' });
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const otherId = `ta-${uid()}`;
  await sql("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, 'Ana', datetime('now'))", [otherId, `${otherId}@darwin-e2e.io`]);
  await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, otherId]);

  // Otro proyecto abierto a todos: así la hoja tiene dónde cargar aunque la base esté vacía.
  expect((await page.request.post('/api/time/projects', { data: { name: `Open ${uid()}` } })).status()).toBe(201);
  const created = await page.request.post('/api/time/projects', { data: { name: `Assign ${uid()}` } });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const patchDone = () => page.waitForResponse((r) => r.url().endsWith(`/api/time/projects/${project.id}`) && r.request().method() === 'PATCH' && r.ok());

  // Equipo: solo la otra persona.
  await page.goto(`/en/app/time/projects/${project.id}`, { waitUntil: 'networkidle' });
  const teamCard = page.getByTestId('time-team-card');
  await expect(page.getByTestId('time-team-everyone')).toBeChecked();
  await expect(page.getByTestId('time-team-save')).toBeDisabled();
  await page.getByTestId('time-team-only').check();
  const me = teamCard.locator('[data-testid=time-team-person][data-person=demo]');
  await expect(me).toBeChecked();
  await me.uncheck();
  // Sin nadie no se guarda.
  await expect(page.getByTestId('time-team-save')).toBeDisabled();
  await teamCard.locator(`[data-testid=time-team-person][data-person="${otherId}"]`).check();
  await Promise.all([patchDone(), page.getByTestId('time-team-save').click()]);

  await page.goto('/en/app/time', { waitUntil: 'networkidle' });
  await page.getByTestId('time-track').click();
  const ed = page.getByTestId('time-entry-dialog');
  await expect(ed).toBeVisible();
  await expect(ed.locator(`select[name=project] option[value="${project.id}"]`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(ed).toBeHidden();
  const tasks = ((await (await page.request.get('/api/time/tasks')).json()) as { tasks: Array<{ id: string; archived: boolean }> }).tasks.filter((x) => !x.archived);
  const denied = await page.request.post('/api/time/entries', { data: { date: '2026-11-18', projectId: project.id, taskId: tasks[0].id, minutes: 10 } });
  expect(denied.status()).toBe(403);

  // Volver a sumarse y dejar una sola tarea, no facturable acá.
  await page.goto(`/en/app/time/projects/${project.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('time-team-only')).toBeChecked();
  await me.check();
  await Promise.all([patchDone(), page.getByTestId('time-team-save').click()]);
  await page.getByTestId('time-tasks-only').check();
  const taskBoxes = page.getByTestId('time-tasks-task');
  const count = await taskBoxes.count();
  expect(count).toBeGreaterThan(1);
  const kept = String(await taskBoxes.first().getAttribute('data-task'));
  for (let i = 1; i < count; i++) await taskBoxes.nth(i).uncheck();
  await page.locator(`[data-testid=time-tasks-billable][data-task="${kept}"]`).uncheck();
  await Promise.all([patchDone(), page.getByTestId('time-tasks-save').click()]);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('time-tasks-only')).toBeChecked();
  await expect(page.getByTestId('time-tasks-task')).toHaveCount(count);
  await expect(page.locator(`[data-testid=time-tasks-task][data-task="${kept}"]`)).toBeChecked();

  // La hoja ofrece solo esa tarea y la entrada sale no facturable.
  await page.goto('/en/app/time', { waitUntil: 'networkidle' });
  await page.getByTestId('time-track').click();
  await ed.locator('select[name=project]').selectOption(project.id);
  await expect(ed.locator('select[name=task] option')).toHaveCount(1);
  await expect(ed.locator('select[name=task]')).toHaveValue(kept);
  await ed.locator('input[name=duration]').fill('0:30');
  const [saved] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/time/entries') && r.request().method() === 'POST'), ed.getByTestId('time-entry-submit').click()]);
  expect(saved.status()).toBe(201);
  expect(((await saved.json()) as { entry: { billable: boolean } }).entry.billable).toBe(false);
  await expect(ed).toBeHidden();

  // La grilla semanal también.
  await page.goto('/en/app/time?view=week', { waitUntil: 'networkidle' });
  await page.getByTestId('time-week-add-row').click();
  const rd = page.getByTestId('time-week-row-dialog');
  await rd.locator('select[name=project]').selectOption(project.id);
  await expect(rd.locator('select[name=task] option')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Volver a todos.
  await page.goto(`/en/app/time/projects/${project.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('time-team-everyone').check();
  await Promise.all([patchDone(), page.getByTestId('time-team-save').click()]);
  await page.getByTestId('time-tasks-all').check();
  await Promise.all([patchDone(), page.getByTestId('time-tasks-save').click()]);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('time-team-everyone')).toBeChecked();
  await expect(page.getByTestId('time-tasks-all')).toBeChecked();
});

test('equipo y tareas a 390 px sin scroll de costado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await page.request.post('/api/time/projects', { data: { name: `Narrow ${uid()}` } });
  const { project } = (await created.json()) as { project: { id: string } };
  await page.goto(`/en/app/time/projects/${project.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('time-team-only').check();
  await page.getByTestId('time-tasks-only').check();
  await expect(page.getByTestId('time-tasks-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
