import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * IA del CRM de punta a punta contra el modelo falso (CRM_AI_FAKE=1 en
 * playwright.config.ts): resumen y score en la ficha, score en el board,
 * resumen de llamadas, asistente con confirmación, agentes de datos y de
 * prospección, paso de IA en workflows y el error claro sin IA
 * (cookie crm_ai_fake=off).
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function setup(request: APIRequestContext) {
  const tag = uid();
  const contact = await ok<{ id: string }>(
    request.post('/api/crm/contacts', { data: { firstName: 'Nora', lastName: `Quinn${tag}`, email: `nora.${tag}@quinnco.example.com` } }),
  );
  const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; name: string }> }> }>(request.get('/api/crm/pipelines'));
  const pipeline = pipelines.rows[0];
  const deal = await ok<{ id: string; name: string }>(
    request.post('/api/crm/deals', {
      data: { name: `Quinn expansion ${tag}`, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: 12000, contactIds: [contact.id] },
    }),
  );
  await ok(request.post('/api/crm/activities', { data: { type: 'note', subject: 'Intro', body: 'Wants a pilot for the sales team.', dealId: deal.id, contactId: contact.id } }));
  return { tag, contactId: contact.id, dealId: deal.id, dealName: `Quinn expansion ${tag}`, pipelineId: pipeline.id };
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test('deal: resumen, score, plan a tarea y score en el board', async ({ page, request }) => {
  const errors = watchErrors(page);
  const s = await setup(request);
  await page.goto(`/en/app/crm/deals/${s.dealId}`, { waitUntil: 'networkidle' });

  const summary = page.getByRole('region', { name: 'AI summary' });
  await expect(summary).toContainText('Get a short summary');
  await summary.getByRole('button', { name: 'Summarize' }).click();
  await expect(summary.getByTestId('ai-summary-text')).toContainText(s.dealName);
  await expect(summary.getByRole('button', { name: 'Regenerate' })).toBeVisible();

  const score = page.getByRole('region', { name: /Deal score/ });
  await score.getByRole('button', { name: 'Score deal' }).click();
  await expect(score.getByTestId('ai-deal-score')).toHaveText(/^\d{1,2}$/);
  await expect(score).toContainText('Deal plan');
  const first = score.getByRole('button', { name: /^Add task:/ }).first();
  const title = ((await first.getAttribute('aria-label')) ?? '').replace('Add task: ', '');
  await first.click();
  await expect(score.getByText('Task added').first()).toBeVisible();
  const tasks = await ok<{ rows: Array<{ subject: string; type: string }> }>(request.get(`/api/crm/activities?dealId=${s.dealId}&type=task`));
  expect(tasks.rows.map((r) => r.subject)).toContain(title);

  // El resumen guardado sigue al recargar, ahora marcado viejo (hay una tarea nueva).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(summary.getByTestId('ai-summary-text')).toContainText(s.dealName);
  await expect(summary).toContainText('New activity since this summary.');

  // Board: el score aparece en la tarjeta y el botón calcula el resto.
  await page.goto(`/en/app/crm/deals?view=board&pipeline=${s.pipelineId}`, { waitUntil: 'networkidle' });
  const card = page.locator('article').filter({ hasText: s.dealName });
  await expect(card.locator('.kb-card-score')).toHaveText(/^\d{1,2}$/);
  await page.getByRole('button', { name: 'Score deals with AI' }).click();
  await expect(page.locator('#ai-board-status')).toHaveText(/scored|current score/);
  expect(errors).toEqual([]);
});

test('sin IA: el error ai_disabled se explica en la ficha', async ({ page, request, context }) => {
  const s = await setup(request);
  await page.goto(`/en/app/crm/contacts/${s.contactId}`);
  await context.addCookies([{ name: 'crm_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
  await page.reload({ waitUntil: 'networkidle' });
  const summary = page.getByRole('region', { name: 'AI summary' });
  await expect(summary).toContainText('AI is not set up on this workspace');
  await summary.getByRole('button', { name: 'Summarize' }).click();
  await expect(summary.getByRole('alert')).toContainText('AI_GATEWAY_API_KEY');
  // Un solo aviso: el gris se va cuando aparece el error.
  await expect(summary.getByText('AI is not set up on this workspace')).toHaveCount(1);
});

test('llamada: resumen con IA y próximos pasos a tareas', async ({ page, request }) => {
  const s = await setup(request);
  await ok(
    request.post('/api/crm/activities', {
      data: {
        type: 'call',
        subject: 'Discovery call',
        body: 'Nora is interested in the pilot. They use spreadsheets today. We will send pricing on Friday.',
        contactId: s.contactId,
      },
    }),
  );
  await page.goto(`/en/app/crm/contacts/${s.contactId}`, { waitUntil: 'networkidle' });
  const item = page.locator('.tl-item').filter({ hasText: 'Discovery call' });
  await item.getByRole('button', { name: 'Summarize with AI' }).click();
  const block = page.getByTestId('ai-call-summary');
  await expect(block).toContainText('Nora is interested');
  await expect(page.getByText('Positive')).toBeVisible();
  await page.getByRole('button', { name: /^Add task: We will send pricing/ }).click();
  await expect(page.getByText('Task added').first()).toBeVisible();
  const tasks = await ok<{ rows: Array<{ subject: string }> }>(request.get(`/api/crm/activities?contactId=${s.contactId}&type=task`));
  expect(tasks.rows.some((r) => r.subject.startsWith('We will send pricing'))).toBe(true);
});

test('asistente: busca, propone y aplica solo al confirmar; Esc cierra', async ({ page, request }) => {
  test.slow();
  const s = await setup(request);
  await page.goto(`/en/app/crm/deals/${s.dealId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const panel = page.getByRole('dialog', { name: 'CRM assistant' });
  await expect(panel).toBeVisible();
  const input = panel.getByRole('textbox', { name: 'Ask about the CRM…' });
  await expect(input).toBeFocused();

  await input.fill(`find Quinn expansion ${s.tag}`);
  await input.press('Enter');
  await expect(panel.getByRole('link', { name: s.dealName })).toBeVisible();

  await input.fill('Create a task: call the CFO');
  await input.press('Enter');
  const proposal = panel.getByTestId('ai-proposal').last();
  await expect(proposal).toContainText('Create task "call the CFO"');
  let tasks = await ok<{ rows: Array<{ subject: string }> }>(request.get(`/api/crm/activities?dealId=${s.dealId}&type=task`));
  expect(tasks.rows.map((r) => r.subject)).not.toContain('call the CFO');
  await proposal.getByRole('button', { name: 'Confirm' }).click();
  await expect(proposal).toContainText('Done.');
  tasks = await ok<{ rows: Array<{ subject: string }> }>(request.get(`/api/crm/activities?dealId=${s.dealId}&type=task`));
  expect(tasks.rows.map((r) => r.subject)).toContain('call the CFO');

  // Mover de etapa: la propuesta usa la API de mover deals.
  const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; name: string; is_won: number; is_lost: number }> }> }>(request.get('/api/crm/pipelines'));
  const target = pipelines.rows[0].stages.find((st, i) => i > 0 && !st.is_won && !st.is_lost);
  if (target) {
    await input.fill(`move Quinn expansion ${s.tag} to ${target.name}`);
    await input.press('Enter');
    const move = panel.getByTestId('ai-proposal').last();
    await expect(move).toContainText(`to ${target.name}`);
    await move.getByRole('button', { name: 'Confirm' }).click();
    await expect(move).toContainText('Done.');
    const deal = await ok<{ deal: { stage_id: string } }>(request.get(`/api/crm/deals/${s.dealId}`));
    expect(deal.deal.stage_id).toBe(target.id);
  }

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('[data-crm-assistant-trigger]')).toBeFocused();

  // ⌘K tiene la acción y abre el panel.
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('input:focus')).toHaveCount(1);
  await page.keyboard.type('Ask the CRM');
  await page.getByText('Ask the CRM assistant').first().click();
  await expect(page.getByRole('dialog', { name: 'CRM assistant' })).toBeVisible();
});

test('agentes: prospección con borrador editable y envío, renombrar y borrar desde la UI', async ({ page, request }) => {
  const tag = uid();
  const a = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Ada', email: `ada.${tag}@prospect.example.com` } }));
  const b = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Bo', email: `bo.${tag}@prospect.example.com` } }));
  const list = await ok<{ id: string }>(request.post('/api/crm/lists', { data: { name: `Prospects ${tag}` } }));
  await ok(request.post(`/api/crm/lists/${list.id}/members`, { data: { contactIds: [a.id, b.id] } }));

  await page.goto('/en/app/crm/agents', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'AI agents', level: 1 })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: 'Prospecting agent' }).getByRole('button', { name: 'Run' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('List', { exact: true }).selectOption(list.id);
  await dialog.getByLabel('What should the email do?').fill('book a 15 minute demo');
  await dialog.getByRole('button', { name: 'Start' }).click();

  await expect(page).toHaveURL(/\/app\/crm\/agents\/[\w-]+$/);
  await expect(page.getByTestId('ai-run-progress')).toHaveText('2 of 2 processed', { timeout: 30_000 });
  const items = page.getByTestId('ai-run-item');
  await expect(items).toHaveCount(2);
  const firstItem = items.first();
  await expect(firstItem).toContainText('Ready');
  await firstItem.getByLabel('Subject').fill(`Edited subject ${tag}`);
  await firstItem.getByRole('button', { name: 'Send' }).click();
  await expect(firstItem).toContainText('Sent');
  await expect(firstItem).toContainText(`Edited subject ${tag}`);
  await items.nth(1).getByRole('button', { name: 'Skip' }).click();
  await expect(items.nth(1)).toContainText('Skipped');

  // Renombrar desde la ficha y verlo en la lista sin recargar.
  await page.getByRole('button', { name: 'Rename' }).click();
  const nameInput = page.getByRole('textbox', { name: 'Rename' });
  await nameInput.fill(`Demo outreach ${tag}`);
  await nameInput.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Demo outreach ${tag}`);
  await page.getByRole('link', { name: 'AI agents' }).first().click();
  const row = page.getByTestId('ai-run-row').filter({ hasText: `Demo outreach ${tag}` });
  await expect(row).toContainText('Done');
  await row.getByRole('button', { name: `Delete Demo outreach ${tag}` }).click();
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('ai-run-row').filter({ hasText: `Demo outreach ${tag}` })).toHaveCount(0);
});

test('agente de datos de contactos: propone y aplica campos vacíos', async ({ page, request }) => {
  const tag = uid().replace(/\d/g, 'q');
  const domain = `${tag}data.example.com`;
  await ok(request.post('/api/crm/companies', { data: { name: `Data Co ${tag}`, domain, city: 'Lima', country: 'Peru' } }));
  const c = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { email: `maria.lopez@${domain}` } }));
  const list = await ok<{ id: string }>(request.post('/api/crm/lists', { data: { name: `Data ${tag}` } }));
  await ok(request.post(`/api/crm/lists/${list.id}/members`, { data: { contactIds: [c.id] } }));
  const run = await ok<{ id: string }>(request.post('/api/crm/ai/runs', { data: { agent: 'enrich_contacts', listId: list.id } }));
  await page.goto(`/en/app/crm/agents/${run.id}`, { waitUntil: 'networkidle' });
  const item = page.getByTestId('ai-run-item').first();
  await expect(item).toContainText('Maria');
  await expect(item).toContainText('Lopez');
  await item.getByRole('button', { name: 'Apply' }).click();
  await expect(item).toContainText('Applied');
  const contact = await ok<{ contact: { first_name: string; last_name: string } }>(request.get(`/api/crm/contacts/${c.id}`));
  expect(contact.contact).toMatchObject({ first_name: 'Maria', last_name: 'Lopez' });
});

test('workflow: el paso de IA escribe una nota en el registro', async ({ page, request }) => {
  const tag = uid();
  const wf = await ok<{ id: string }>(
    request.post('/api/crm/workflows', {
      data: {
        name: `AI classify ${tag}`,
        enabled: true,
        triggers: [{ type: 'contact_created' }],
        actions: [{ type: 'ai_step', config: { mode: 'prompt', prompt: 'Classify this lead', output: 'note' } }],
      },
    }),
  );
  const c = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Wes', lastName: tag, email: `wes.${tag}@wf.example.com` } }));
  await expect
    .poll(async () => {
      const rows = (await ok<{ rows: Array<{ type: string; body: string }> }>(request.get(`/api/crm/activities?contactId=${c.id}&type=note`))).rows;
      return rows.map((r) => r.body).join('|');
    })
    .toContain('AI: Classify this lead');
  await page.goto(`/en/app/crm/workflows/${wf.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Prompt')).toHaveValue('Classify this lead');
  await expect(page.getByLabel('What the AI does')).toHaveValue('prompt');
  await request.delete(`/api/crm/workflows/${wf.id}`);
});

for (const theme of ['light', 'dark'] as const) {
  test(`agentes y asistente se ven bien en ${theme} y a 390px`, async ({ page, request }) => {
    const s = await setup(request);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app/crm/agents', { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
    await page.goto(`/en/app/crm/deals/${s.dealId}`, { waitUntil: 'networkidle' });
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const panel = page.getByRole('dialog', { name: 'CRM assistant' });
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(391);
    await noHorizontalScroll(page);
  });
}
