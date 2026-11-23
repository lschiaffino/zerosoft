import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM C5: IA tras una llamada contra el modelo falso (CRM_AI_FAKE=1). Las
 * tarjetas aparecen sin aplicar nada; cada una se aplica, se edita o se
 * descarta. Un member con un campo oculto: el campo no llega a la respuesta
 * ni a la pantalla (390, oscuro, otro aspecto, sin scroll horizontal).
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

/** Pipeline propio de tres etapas, un contacto, un deal con un campo propio y una llamada con notas. */
async function setup(request: APIRequestContext, body: string, admin: APIRequestContext = request) {
  const tag = uid();
  const p = await ok<{ id: string }>(admin.post('/api/crm/pipelines', { data: { name: `Fu ${tag}` } }));
  const first = await ok<{ id: string }>(admin.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: 'Discovery' } }));
  const second = await ok<{ id: string }>(admin.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: 'Proposal' } }));
  const field = await ok<{ id: string; name: string }>(
    admin.post('/api/crm/custom-fields', { data: { entity: 'deals', name: `comp_${tag}`, label: 'Competitor', type: 'text' } }),
  );
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Nora', lastName: `Fu${tag}`, email: `nora.${tag}@fu.example.com` } }));
  const deal = await ok<{ id: string }>(
    request.post('/api/crm/deals', { data: { name: `Fu deal ${tag}`, pipelineId: p.id, stageId: first.id, amount: 12000, contactIds: [contact.id] } }),
  );
  const call = await ok<{ id: string }>(
    request.post('/api/crm/activities', { data: { type: 'call', subject: `Pricing call ${tag}`, body, contactId: contact.id, dealId: deal.id } }),
  );
  return { tag, dealId: deal.id, contactId: contact.id, callId: call.id, field, second };
}

function callItem(page: Page, callId: string) {
  return page.getByTestId('crm-timeline-item').filter({ has: page.locator(`[data-followup-activity="${callId}"]`) });
}

test('sugerencias tras una llamada: nada cambia hasta aplicar; aplicar, editar, mover y descartar', async ({ page, request }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = await setup(request, 'Amount: 15000. Competitor: Rival Co. They liked the demo. We will send the contract on Monday.');
  await page.goto(`/en/app/crm/deals/${s.dealId}?tab=activity`, { waitUntil: 'networkidle' });

  const item = callItem(page, s.callId);
  page.on('response', async (r) => {
    if (r.url().includes('/api/crm/ai/followups')) console.log('DEBUG', r.request().method(), r.status(), (await r.text().catch(() => '')).slice(0, 300));
  });
  await item.getByTestId('ai-followup-open').click();
  const block = item.getByTestId('ai-followup');
  const cards = block.getByTestId('ai-followup-card');
  await expect(cards.first()).toBeVisible();
  await expect(block.locator('[data-kind="field"]')).toHaveCount(2);
  await expect(block.locator('[data-kind="stage"]')).toHaveCount(1);
  await expect(block.locator('[data-kind="email"]')).toHaveCount(1);
  expect(await block.locator('[data-kind="task"]').count()).toBeGreaterThan(0);

  // Nada se aplicó todavía.
  let deal = await ok<{ deal: { amount: number; stage_id: string; custom: string } }>(request.get(`/api/crm/deals/${s.dealId}`));
  expect(deal.deal.amount).toBe(12000);

  // Propiedad tal cual.
  const amount = block.getByRole('button', { name: /^Apply: Amount/ });
  await amount.click();
  await expect(block.locator('[data-kind="field"][data-status="applied"]')).toHaveCount(1);
  deal = await ok(request.get(`/api/crm/deals/${s.dealId}`));
  expect(deal.deal.amount).toBe(15000);

  // Propiedad editada: Esc cancela la edición, Enter guarda.
  await block.getByRole('button', { name: /^Edit: Competitor/ }).click();
  const input = block.getByRole('textbox', { name: 'Competitor' });
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await block.getByRole('button', { name: /^Edit: Competitor/ }).click();
  await block.getByRole('textbox', { name: 'Competitor' }).fill('Rival Inc');
  await block.getByRole('textbox', { name: 'Competitor' }).press('Enter');
  await expect(block.locator('[data-kind="field"][data-status="applied"]')).toHaveCount(2);
  deal = await ok(request.get(`/api/crm/deals/${s.dealId}`));
  expect(JSON.parse(deal.deal.custom)[s.field.name]).toBe('Rival Inc');

  // Etapa.
  await block.locator('[data-kind="stage"]').getByTestId('ai-followup-apply').click();
  await expect(block.locator('[data-kind="stage"][data-status="applied"]')).toBeVisible();
  deal = await ok(request.get(`/api/crm/deals/${s.dealId}`));
  expect(deal.deal.stage_id).toBe(s.second.id);

  // Tarea.
  const task = block.locator('[data-kind="task"]').first();
  await task.getByTestId('ai-followup-apply').click();
  await expect(task).toHaveAttribute('data-status', 'applied');
  const tasks = await ok<{ rows: Array<{ subject: string }> }>(request.get(`/api/crm/activities?dealId=${s.dealId}&type=task`));
  expect(tasks.rows.length).toBeGreaterThan(0);

  // Email: descartado, desaparece.
  await block.locator('[data-kind="email"]').getByTestId('ai-followup-discard').click();
  await expect(block.locator('[data-kind="email"]')).toHaveCount(0);

  // Al recargar quedan las aplicadas y no la descartada.
  await page.reload({ waitUntil: 'networkidle' });
  await callItem(page, s.callId).getByTestId('ai-followup-open').click();
  const again = callItem(page, s.callId).getByTestId('ai-followup');
  await expect(again.locator('[data-kind="field"][data-status="applied"]')).toHaveCount(2);
  await expect(again.locator('[data-kind="email"]')).toHaveCount(0);
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

async function personContext(browser: Browser, email: string, opts: { width: number; scheme: 'light' | 'dark'; look?: string }) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width, height: opts.width < 500 ? 844 : 900 }, colorScheme: opts.scheme });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  if (opts.look) await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  return ctx;
}

test('member con un campo oculto: no aparece ni en la respuesta ni en las tarjetas (390, oscuro)', async ({ browser }) => {
  test.setTimeout(300_000);
  const view = { width: 390, scheme: 'dark' as const, look: 'retro' };
  const ownerEmail = `fu-owner-${uid()}@crm-fu-e2e.test`;
  const memberEmail = `fu-member-${uid()}@crm-fu-e2e.test`;
  const owner = await personContext(browser, ownerEmail, view);
  const onb = await owner.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'Fu', locale: 'en', apps: ['crm'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  const hidden = await ok<{ id: string; name: string }>(
    owner.request.post('/api/crm/custom-fields', { data: { entity: 'deals', name: `secret_${uid()}`, label: 'Budget code', type: 'text' } }),
  );
  await ok(owner.request.put(`/api/crm/field-permissions/${hidden.id}`, { data: { rules: [{ subject: 'role:member', access: 'hidden' }] } }));
  await ok(owner.request.post('/api/teams/invites', { data: { emails: [memberEmail], role: 'member' } }));
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [memberEmail]))[0]?.token);
  const member = await personContext(browser, memberEmail, view);
  try {
    await ok(member.request.post('/api/teams/accept', { data: { token } }));
    await sql("UPDATE users SET onboarded_at = datetime('now'), ui_look = ? WHERE email = ?", [view.look, memberEmail]);
    await member.request.post('/api/tours', { data: { kind: 'off', off: true } });
    const s = await setup(member.request, 'Budget code: BX-4400. Amount: 9000. We will send the proposal on Friday.', owner.request);

    const page = await member.newPage();
    await page.goto(`/en/app/crm/deals/${s.dealId}?tab=activity`);
    const item = callItem(page, s.callId);
    const generated = page.waitForResponse((r) => r.url().includes('/api/crm/ai/followups') && r.request().method() === 'POST');
    await item.getByTestId('ai-followup-open').click();
    const body = await (await generated).text();
    expect(body).not.toContain(hidden.name);
    expect(body).not.toContain('Budget code');
    expect(body).not.toContain('BX-4400');
    const block = item.getByTestId('ai-followup');
    await expect(block.getByRole('button', { name: /^Apply: Amount/ })).toBeVisible();
    await expect(block.getByTestId('ai-followup-card').filter({ hasText: 'BX-4400' })).toHaveCount(0);
    await noHorizontalScroll(page);
  } finally {
    await member.close();
    await owner.close();
  }
});
