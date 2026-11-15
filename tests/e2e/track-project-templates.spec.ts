import { expect, test } from '@playwright/test';

/**
 * Track: templates de projects (como Linear). Desde el menú … de un project se
 * guarda como template; al crear otro project se elige el template y nace con
 * sus milestones (fechas desde el inicio), sus issues y su prioridad. En
 * Ajustes › Project templates se renombra y se borra.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

test('guardar un project como template, crear otro desde el template y administrarlo', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const team = (await (await request.post('/api/track/projects', { data: { name: `Tpl ${uid()}` } })).json()) as { id: string };
  const plan = (await (
    await request.post('/api/track/plans', { data: { name: `Onboarding ${uid()}`, priority: 'high', teamIds: [team.id], startDate: '2026-11-02' } })
  ).json()) as { id: string };
  const ms = (await (await request.post(`/api/track/plans/${plan.id}/milestones`, { data: { name: 'Kickoff', targetDate: '2026-11-09' } })).json()) as { id: string };
  const issue = await request.post(`/api/track/projects/${team.id}/issues`, { data: { title: 'Send the welcome email', planId: plan.id, planMilestoneId: ms.id } });
  expect(issue.ok(), await issue.text()).toBe(true);

  // 1. Guardar como template desde el menú del project (⌘↵ guarda).
  await page.goto(`/en/app/track/projects/${plan.id}`);
  await page.getByTestId('tp-plan-more').click();
  await page.getByRole('option', { name: 'Save as template' }).click();
  const dialog = page.getByTestId('tp-save-template');
  const tplName = `Customer onboarding ${uid()}`;
  await dialog.getByLabel('Template name').fill(tplName);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Template “${tplName}” saved`)).toBeVisible();

  // 2. Nuevo project desde el template, con fecha de inicio.
  await page.goto('/en/app/track/projects');
  await page.getByTestId('tp-new-plan').first().click();
  const modal = page.getByTestId('tp-new-plan-modal');
  const newName = `Acme onboarding ${uid()}`;
  await modal.locator('#tp-plan-name').fill(newName);
  await modal.getByTestId('tp-new-template').click();
  await page.keyboard.type(tplName.slice(0, 18));
  await page.keyboard.press('Enter');
  await expect(modal.getByTestId('tp-new-template-note')).toContainText('Creates 1 milestone and 1 issue');
  // Sin fecha de inicio, el aviso dice que las fechas de los milestones se cuentan desde ahí.
  await expect(modal.getByTestId('tp-new-template-note')).toContainText('count from the start date');
  await modal.locator('#tp-plan-name').focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/app\/track\/projects\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: newName }).or(page.getByTestId('tp-plan-name'))).toBeVisible();
  const newId = page.url().split('/projects/')[1].split(/[?#]/)[0];
  const created = (await (await request.get(`/api/track/plans/${newId}`)).json()) as { plan: { priority: string }; milestones: Array<{ name: string; target_date: string | null }> };
  expect(created.plan.priority).toBe('high');
  expect(created.milestones.map((m) => [m.name, m.target_date])).toEqual([['Kickoff', null]]);
  const issues = (await (await request.get(`/api/track/issues?planId=${newId}&pageSize=50`)).json()) as { rows: Array<{ title: string }> };
  expect(issues.rows.map((r) => r.title)).toEqual(['Send the welcome email']);
  await expect(page.getByText('Kickoff').first()).toBeVisible();

  // 3. Ajustes › Project templates: renombrar y borrar.
  await page.goto('/en/app/track/settings?tab=templates');
  const row = page.getByTestId('tp-template-row').filter({ hasText: tplName });
  await expect(row).toContainText('1 milestone · 1 issue');
  await row.getByRole('button', { name: `Rename template ${tplName}` }).click();
  const renamed = `${tplName} v2`;
  await page.getByTestId('tp-templates-settings').getByRole('textbox', { name: 'Template name', exact: true }).fill(renamed);
  await page.keyboard.press('Enter');
  const row2 = page.getByTestId('tp-template-row').filter({ hasText: renamed });
  await expect(row2).toBeVisible();
  await row2.getByRole('button', { name: `Delete template ${renamed}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('tp-template-row').filter({ hasText: renamed })).toHaveCount(0);
});

test('project templates a 390px: Ajustes sin scroll horizontal', async ({ page, request }) => {
  const plan = (await (await request.post('/api/track/plans', { data: { name: `Phone tpl ${uid()}` } })).json()) as { id: string };
  expect((await request.post('/api/track/plan-templates', { data: { planId: plan.id, name: `A very long template name for a phone ${uid()}` } })).status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/track/settings?tab=templates');
  await expect(page.getByTestId('tp-template-row').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
