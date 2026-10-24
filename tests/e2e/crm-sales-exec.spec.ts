import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * CRM ejecución de ventas: cola de trabajo, playbooks, etapas con teclado en
 * el board, varios lead scores y aprobaciones de etapa con splits de deals.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function db() {
  return createClient({ url: `file:${process.env.E2E_DB_FILE}` });
}

async function demoId(): Promise<string> {
  const c = db();
  const r = await c.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: ['demo@zerosoft.ai'] });
  c.close();
  return String(r.rows[0].id);
}

async function firstPipeline(request: APIRequestContext) {
  const res = await request.get('/api/crm/pipelines');
  const body = (await res.json()) as { rows: Array<{ id: string; stages: Array<{ id: string; name: string; is_won: number; is_lost: number }> }> };
  const p = body.rows[0];
  return { id: p.id, open: p.stages.filter((s) => !s.is_won && !s.is_lost) };
}

test('cola de trabajo: recorre vencidas y de hoy, completa con D, pospone con Z y termina', async ({ page, request }) => {
  const me = await demoId();
  const name = `Queue ${uid()}`;
  const contact = (await (await request.post('/api/crm/contacts', { data: { firstName: name, email: `${uid()}@queue.test`, phone: '+1 555 0100' } })).json()) as { id: string };
  const a = await request.post('/api/crm/activities', {
    data: { type: 'task', subject: `${name} overdue`, dueAt: sqlTime(Date.now() - 3 * 86_400_000), contactId: contact.id, ownerId: me },
  });
  expect(a.status()).toBe(201);
  const b = await request.post('/api/crm/activities', { data: { type: 'task', subject: `${name} today`, dueAt: sqlTime(Date.now()), contactId: contact.id, ownerId: me } });
  const today = (await b.json()) as { id: string };

  await page.goto('/en/app/crm/tasks', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('start-queue')).toContainText(/Start queue \(\d+\)/);
  await page.keyboard.press('q');
  await expect(page).toHaveURL(/\/app\/crm\/tasks\/queue/);
  const card = page.getByTestId('queue-card');
  // La cola puede traer tareas de otros tests (y del seed): busca la nuestra con las flechas.
  async function goTo(subject: string) {
    const heading = card.getByRole('heading', { name: subject });
    for (let i = 0; i < 40 && !(await heading.isVisible()); i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 80 && !(await heading.isVisible()); i++) await page.keyboard.press('ArrowRight');
    await expect(heading).toBeVisible();
  }
  await expect(page.getByTestId('queue-counter')).toContainText(/Task 1 of \d+/);
  await goTo(`${name} overdue`);
  await expect(card).toContainText(name);
  await expect(card.getByText('Overdue', { exact: true })).toBeVisible();
  await card.getByRole('textbox', { name: 'Note for the record' }).fill('Left a voicemail');
  await card.getByRole('heading').click();
  await page.keyboard.press('d');
  await expect(card.getByRole('heading', { name: `${name} overdue` })).toBeHidden();
  await goTo(`${name} today`);
  await page.keyboard.press('z');
  await page.getByRole('menuitem', { name: 'Tomorrow at 9:00' }).click();
  await expect(card.getByRole('heading', { name: `${name} today` })).toBeHidden();

  const { rows } = (await (await request.get(`/api/crm/activities?contactId=${contact.id}`)).json()) as {
    rows: Array<{ type: string; body: string; done: number; subject: string; due_at: string }>;
  };
  expect(rows.find((r) => r.subject === `${name} overdue`)?.done).toBe(1);
  expect(rows.some((r) => r.type === 'note' && r.body === 'Left a voicemail')).toBe(true);
  const snoozed = rows.find((r) => r.subject === `${name} today`)!;
  expect(snoozed.done).toBe(0);
  expect(new Date(`${snoozed.due_at.replace(' ', 'T')}Z`).getTime()).toBeGreaterThan(Date.now());
  expect(today.id).toBeTruthy();

  // Esc vuelve a Tareas.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\/crm\/tasks$/);
});

test('playbooks: se crea con C, se edita, se usa desde un contacto y queda en el timeline', async ({ page, request }) => {
  const pbName = `Discovery ${uid()}`;
  await page.goto('/en/app/crm/playbooks', { waitUntil: 'networkidle' });
  await page.keyboard.press('c');
  await page.getByRole('textbox', { name: 'Name' }).fill(pbName);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/crm\/playbooks\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: pbName })).toBeVisible();
  await page.getByTestId('playbook-body').fill('## Opening\nAsk about **budget** first.');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.pb-preview strong')).toHaveText('budget');
  await page.getByTestId('playbook-add-question').click();
  const q = page.getByTestId('playbook-question').first();
  await q.getByRole('textbox', { name: 'Question 1' }).fill('What is your role?');
  await q.getByRole('combobox', { name: 'Save the answer in' }).selectOption('contact:jobTitle');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: 'Playbook saved' })).toBeVisible();

  // ⌘K lo encuentra.
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('combobox').fill(pbName);
  await expect(search.getByRole('option', { name: new RegExp(pbName) }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  const contact = (await (await request.post('/api/crm/contacts', { data: { firstName: 'Pb', lastName: uid(), email: `${uid()}@pb.test` } })).json()) as { id: string };
  await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('playbook-launcher').click();
  await page.getByRole('menuitem', { name: pbName }).click();
  const runner = page.getByTestId('playbook-runner');
  await expect(runner.getByText('Ask about')).toBeVisible();
  await runner.getByLabel('What is your role?').fill('VP Sales');
  await runner.getByTestId('playbook-save').click();
  await expect(runner).toBeHidden();
  await expect(page.getByText(`Playbook: ${pbName}`)).toBeVisible();
  await expect(page.locator('.record-meta')).toContainText('VP Sales');

  // Lista: muestra el uso; borrar desde el editor la saca sin recargar.
  await page.goto('/en/app/crm/playbooks', { waitUntil: 'networkidle' });
  const row = page.getByTestId('playbook-row').filter({ hasText: pbName });
  await expect(row).toContainText('1');
  await row.getByRole('link', { name: pbName }).click();
  await page.getByTestId('playbook-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete playbook' }).click();
  await expect(page).toHaveURL(/\/app\/crm\/playbooks$/);
  await expect(page.getByTestId('playbook-row').filter({ hasText: pbName })).toHaveCount(0);
});

test('board: Shift + flecha pasa el deal a la etapa de al lado con aviso y foco', async ({ page, request }) => {
  const p = await firstPipeline(request);
  const name = `Kbd ${uid()}`;
  await request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 100 } });
  await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
  const card = page.locator('.kb-card', { hasText: name });
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press('Shift+ArrowRight');
  const moved = page.locator(`.kb-cards[data-stage-id="${p.open[1].id}"] .kb-card`, { hasText: name });
  await expect(moved).toBeVisible();
  await expect(moved).toBeFocused();
  await expect(page.getByTestId('board-announce')).toContainText(`${name} moved to ${p.open[1].name}`);
  // Persistió.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator(`.kb-cards[data-stage-id="${p.open[1].id}"] .kb-card`, { hasText: name })).toBeVisible();
});

test('lead scoring: un score nuevo con tramos y decaimiento desde Ajustes', async ({ page }) => {
  const scoreName = `Engagement ${uid()}`;
  await page.goto('/en/app/crm/settings?tab=automation', { waitUntil: 'networkidle' });
  await page.getByTestId('score-new').click();
  await page.getByRole('textbox', { name: 'New score' }).fill(scoreName);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: scoreName })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('score-add-tier').click();
  await page.getByTestId('score-tier-row').last().getByRole('textbox', { name: 'Tier name' }).fill('Hot');
  await page.getByTestId('score-tier-row').last().getByRole('spinbutton').fill('50');
  await page.getByTestId('score-decay-on').check();
  await page.getByTestId('score-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Score saved' })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: scoreName }).click();
  await expect(page.getByTestId('score-tier-row').first().getByRole('textbox')).toHaveValue('Hot');
  // Se borra (el principal no se puede).
  await page.getByTestId('score-delete').click();
  await page.getByTestId('score-delete-confirm').click();
  await expect(page.getByRole('tab', { name: scoreName })).toHaveCount(0);
});

test('aprobaciones y splits: pedir aprobación, aprobar desde el deal y repartir el monto', async ({ page, request }) => {
  const me = await demoId();
  const c = db();
  const approverId = `approver-${uid()}`;
  const teamId = `team-${uid()}`;
  await c.execute({ sql: "INSERT INTO users (id, email, name) VALUES (?, ?, 'Alex Approver')", args: [approverId, `${approverId}@e2e.test`] });
  await c.execute({ sql: "INSERT INTO teams (id, name, owner_id) VALUES (?, 'E2E sales', ?)", args: [teamId, me] });
  await c.execute({ sql: "INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner'), (?, ?, 'member')", args: [teamId, me, teamId, approverId] });
  await c.execute({ sql: 'UPDATE users SET active_team_id = ? WHERE id = ?', args: [teamId, me] });
  let ruleId = '';
  try {
    const p = await firstPipeline(request);
    const target = p.open[1];
    const rule = await request.post('/api/crm/approval-rules', { data: { pipelineId: p.id, stageId: target.id, approverIds: [approverId] } });
    expect(rule.status(), await rule.text()).toBe(201);
    ruleId = ((await rule.json()) as { id: string }).id;
    const name = `Approve ${uid()}`;
    const deal = (await (await request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 1000 } })).json()) as { id: string };

    await page.goto(`/en/app/crm/deals/${deal.id}`, { waitUntil: 'networkidle' });
    await page.locator('.stage-step-btn', { hasText: target.name }).click();
    const dialog = page.getByTestId('approval-dialog');
    await expect(dialog).toContainText('Alex Approver');
    await dialog.getByRole('textbox').fill('Strategic logo');
    await dialog.getByTestId('approval-request').click();
    await expect(dialog.getByRole('status')).toContainText('Request sent');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('approval-banner')).toContainText(`Waiting for approval to move to ${target.name}`);
    await expect(page.locator('.stage-step-btn[aria-current="step"]')).toHaveText(p.open[0].name);

    await page.goto('/en/app/crm/approvals?view=requested', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('approval-row').filter({ hasText: name })).toContainText('Pending');

    // Sumar al demo como aprobador del pedido: aprueba desde el deal y el deal pasa solo.
    await c.execute({ sql: "UPDATE crm_deal_approvals SET approver_ids = json_insert(approver_ids, '$[#]', ?) WHERE deal_id = ?", args: [me, deal.id] });
    await page.goto(`/en/app/crm/deals/${deal.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId('approval-approve').click();
    await expect(page.locator('.stage-step-btn[aria-current="step"]')).toHaveText(target.name);

    // Splits: 60/40 con el aprobador; la suma tiene que dar 100.
    await page.getByTestId('deal-splits-edit').click();
    const splits = page.getByTestId('deal-splits');
    await splits.getByRole('combobox', { name: 'Owner 2' }).selectOption(approverId);
    await splits.getByRole('spinbutton', { name: 'Percentage 1' }).fill('60');
    await splits.getByRole('spinbutton', { name: 'Percentage 2' }).fill('30');
    await splits.getByTestId('deal-splits-save').click();
    await expect(splits.getByText('The percentages have to add up to 100%.')).toBeVisible();
    await splits.getByRole('spinbutton', { name: 'Percentage 2' }).fill('40');
    await splits.getByTestId('deal-splits-save').click();
    await expect(splits.getByTestId('deal-split-row')).toHaveCount(2);
    await expect(splits).toContainText('Alex Approver');
    await expect(splits).toContainText('40%');
    const saved = (await (await request.get(`/api/crm/deals/${deal.id}/splits`)).json()) as { splits: Array<{ ownerId: string; percent: number }> };
    expect(saved.splits).toEqual(expect.arrayContaining([{ ownerId: approverId, percent: 40 }]));
  } finally {
    if (ruleId) await request.delete(`/api/crm/approval-rules/${ruleId}`);
    await c.execute({ sql: 'UPDATE users SET active_team_id = NULL WHERE id = ?', args: [me] });
    await c.execute({ sql: 'DELETE FROM teams WHERE id = ?', args: [teamId] });
    c.close();
  }
});

test('390px y tema oscuro: cola, playbooks y aprobaciones sin scroll horizontal', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/en/app/crm/tasks/queue', '/en/app/crm/playbooks', '/en/app/crm/approvals']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
