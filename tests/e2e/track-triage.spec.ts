import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track T3 (como Linear): triage con teclado, reglas y responsable de turno,
 * SLAs, pedidos de clientes, IA (modelo falso de TRACK_AI_FAKE) y agentes que
 * trabajan issues. Cada test arma sus datos por API.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function setup(request: APIRequestContext) {
  const project = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name: `Triage ${uid()}` } }));
  await ok(request.patch(`/api/track/projects/${project.id}`, { data: { triageEnabled: true } }));
  const key = (await ok<{ key: string }>(request.post('/api/keys', { data: { name: `t3 ${uid()}` } }))).key;
  const intake = async (title: string, email: string, body = '') =>
    (
      await ok<{ data: { issue: { id: string; identifier: string } } }>(
        request.post('/api/v1/track/requests', {
          headers: { authorization: `Bearer ${key}` },
          data: { projectId: project.id, title, body: body || title, customer: { email, name: email.split('@')[0] }, source: 'email' },
        }),
      )
    ).data.issue;
  return { project, key, intake };
}

test.describe('Track T3: triage', () => {
  test('cola con teclado: sugerencias de IA, 1 acepta, H pospone; reglas y responsable de turno', async ({ page, request }) => {
    const { project, intake } = await setup(request);
    const me = (await ok<{ rows: Array<{ id: string }> }>(request.get(`/api/track/projects/${project.id}/members`))).rows[0];
    await ok(request.patch(`/api/track/projects/${project.id}/triage-settings`, { data: { ownerIds: [me.id], ownerAction: 'notify' } }));
    await ok(request.post(`/api/track/projects/${project.id}/triage-rules`, { data: { name: 'Crashes', conditions: [{ field: 'text', op: 'contains', values: ['crash'] }], actions: { priority: 'urgent' } } }));
    const crash = await intake('Checkout crash on save', 'ana@acme.io');
    await intake('Export invoices to CSV', 'bob@initech.com');
    expect((await ok<{ priority: string }>(request.get(`/api/track/issues/${crash.id}`))).priority).toBe('urgent');

    await page.goto(`/en/app/track/projects/${project.id}?tab=triage`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-triage-owner')).toContainText('Triage owner');
    const items = page.getByTestId('track-triage-item');
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId('track-ai-suggestions').first()).toBeVisible();
    await shot(page, 't3_triage_queue');

    // Foco en la primera fila (la más nueva) y 1 = aceptar.
    await items.first().focus();
    await page.keyboard.press('1');
    await expect(items).toHaveCount(1);
    // H = posponer: abre el menú y "hasta mañana" la saca de la cola.
    await items.first().focus();
    await page.keyboard.press('h');
    await page.getByTestId('track-triage-snooze-tomorrow').click();
    await expect(page.getByText('No issues waiting for triage.')).toBeVisible();
    await page.getByTestId('track-triage-show-snoozed').click();
    await expect(items).toHaveCount(1);
    await shot(page, 't3_triage_snoozed');
  });

  test('reglas desde los ajustes: crear, editar y borrar; ajustes de SLA e IA', async ({ page, request }) => {
    const { project } = await setup(request);
    await page.goto(`/en/app/track/projects/${project.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId('track-project-settings').click();
    await page.getByTestId('track-settings-tab-triage').click();
    await expect(page.getByTestId('track-triage-general')).toBeVisible();
    await page.getByTestId('track-sla-toggle').check();
    await expect(page.getByTestId('track-sla-hours-urgent')).toHaveValue('24');
    await page.getByTestId('track-rule-new').click();
    await page.getByTestId('track-rule-name').fill('Invoices');
    await page.getByTestId('track-rule-values').fill('invoice');
    await page.getByTestId('track-rule-priority').selectOption('high');
    await page.getByTestId('track-rule-save').click();
    const rule = page.getByTestId('track-rule');
    await expect(rule).toContainText('Invoices');
    await shot(page, 't3_rules');
    await rule.getByTestId('track-rule-edit').click();
    await page.getByTestId('track-rule-name').fill('Invoices and billing');
    await page.getByTestId('track-rule-save').click();
    await expect(rule).toContainText('Invoices and billing');
    await rule.getByTestId('track-rule-delete').click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId('track-rule')).toHaveCount(0);
    const settings = await ok<{ slaEnabled: boolean }>(request.get(`/api/track/projects/${project.id}/triage-settings`));
    expect(settings.slaEnabled).toBe(true);
  });

  test('crear un issue desde texto con IA', async ({ page, request }) => {
    const { project } = await setup(request);
    await page.goto(`/en/app/track/projects/${project.id}?tab=triage`, { waitUntil: 'networkidle' });
    await page.getByTestId('track-triage-from-text').click();
    await page.getByTestId('track-from-text-input').fill('The payment page is broken on Safari. Customers cannot pay.');
    await page.getByTestId('track-from-text-submit').click();
    await expect(page.getByTestId('track-from-text-title')).toHaveValue('The payment page is broken on Safari.');
    await page.getByTestId('track-from-text-submit').click();
    await expect(page).toHaveURL(/\/app\/track\/issues\//);
    const created = page.url().split('/issues/')[1];
    const row = await ok<{ title: string; priority: string; triage: number }>(request.get(`/api/track/issues/${created}`));
    expect(row).toMatchObject({ title: 'The payment page is broken on Safari.', priority: 'high', triage: 0 });
  });
});

test.describe('Track T3: issue', () => {
  test('SLA en el issue y la lista, pedido de cliente, resumen con IA y error sin IA', async ({ page, request, context }) => {
    const { project } = await setup(request);
    await ok(request.patch(`/api/track/projects/${project.id}/triage-settings`, { data: { slaEnabled: true } }));
    const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${project.id}/issues`, { data: { title: 'Site is down', priority: 'urgent' } }));
    await ok(request.post(`/api/track/issues/${issue.id}/comments`, { data: { body: 'Rolled back the last deploy.' } }));

    await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-issue-sla')).toContainText(/h left/);

    // Pedido de cliente con nombre libre, marcado importante.
    await page.getByTestId('track-request-add').click();
    await page.getByTestId('track-request-customer').fill('Globex');
    await page.getByTestId('track-request-body').fill('We lost sales during the outage');
    await page.getByTestId('track-request-important-input').check();
    await page.getByTestId('track-request-save').click();
    const req = page.getByTestId('track-request');
    await expect(req).toContainText('Globex');
    await expect(req.getByTestId('track-request-important')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('track-ai-summarize').click();
    await expect(page.getByTestId('track-ai-summary-text')).toContainText('Site is down');
    await shot(page, 't3_issue_light');

    // Lista: chip de SLA y cantidad de clientes; orden por clientes.
    await page.goto(`/en/app/track/projects/${project.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-sla-chip').first()).toBeVisible();
    await expect(page.getByTestId('track-customer-count').first()).toContainText('1');

    // Track › Clientes.
    await page.goto('/en/app/track/customers', { waitUntil: 'networkidle' });
    const customer = page.getByTestId('track-customer').filter({ hasText: 'Globex' });
    await expect(customer).toBeVisible();
    await customer.getByRole('button').first().click();
    await expect(customer.getByTestId('track-request')).toContainText(issue.identifier);

    // Sin IA: el error explica ai_disabled.
    await context.addCookies([{ name: 'track_ai_fake', value: 'off', domain: 'localhost', path: '/' }]);
    await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId('track-ai-summarize').click();
    await expect(page.getByText(/ai_disabled/)).toBeVisible();
    await context.clearCookies({ name: 'track_ai_fake' });

    // Borrar el pedido.
    await page.getByTestId('track-request-remove').click();
    await expect(page.getByTestId('track-request')).toHaveCount(0);
  });

  test('CRM: la empresa muestra sus pedidos y se enlaza a un issue por ID', async ({ page, request }) => {
    const { project } = await setup(request);
    const company = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Acme ${uid()}` } }));
    const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${project.id}/issues`, { data: { title: 'SSO login' } }));
    await page.goto(`/en/app/crm/companies/${company.id}?tab=related`, { waitUntil: 'networkidle' });
    const block = page.getByTestId('track-crm-requests');
    await expect(block).toContainText('has not asked');
    await block.getByTestId('track-crm-request-add').click();
    await block.getByTestId('track-crm-request-issue').fill(issue.identifier);
    await block.getByTestId('track-crm-request-save').click();
    await expect(block.getByTestId('track-request')).toContainText('SSO login');
    await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-request')).toContainText('Acme');
  });

  test('delegar a un agente de zerosoft y a uno externo que responde por la API', async ({ page, request }) => {
    const { project } = await setup(request);
    const agent = await ok<{ id: string }>(request.post('/api/agents', { data: { name: `Helper ${uid()}` } }));
    const issue = await ok<{ id: string }>(request.post(`/api/track/projects/${project.id}/issues`, { data: { title: 'Write the release notes' } }));
    await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId('track-agent-trigger').click();
    await page.getByTestId('track-agent-option').filter({ hasText: 'Helper' }).click();
    const sessionBox = page.getByTestId('track-agent-session');
    await expect(sessionBox.getByTestId('track-agent-state')).toHaveText('Done', { timeout: 20_000 });
    await expect(sessionBox.locator('[data-type="response"]')).toContainText('Picked up');
    await expect(sessionBox.locator('[data-type="action"]')).toContainText('In progress');
    // El issue se actualiza sin recargar: el agente lo pasó a In progress.
    await expect(page.locator('header').filter({ hasText: 'Write the release notes' }).getByText('In progress').first()).toBeVisible();
    await expect(page.getByText(/changed status from Todo to In progress/)).toBeVisible();
    await expect(page.getByTestId('track-agent-trigger')).toContainText('Helper');
    await shot(page, 't3_agent_session');
    void agent;

    // Agente externo: se conecta en Ajustes › Agentes, el token se muestra una vez.
    await page.goto('/en/app/track/settings?tab=agents', { waitUntil: 'networkidle' });
    await page.getByTestId('track-agent-app-name').fill('Coder bot');
    await page.getByTestId('track-agent-app-create').click();
    const token = await page.getByTestId('track-agent-token').inputValue();
    expect(token).toMatch(/^zsa_/);
    await expect(page.getByTestId('track-agent-app')).toContainText('Coder bot');

    await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId('track-agent-trigger').click();
    await page.getByTestId('track-agent-option').filter({ hasText: 'Coder bot' }).click();
    // Sin webhook configurado la sesión queda con error claro; el agente igual puede responder con su token.
    await expect(page.getByTestId('track-agent-state').first()).toHaveText(/Error|Waiting/, { timeout: 20_000 });
    const sessions = (await ok<{ sessions: Array<{ id: string; agentName: string }> }>(request.get(`/api/track/issues/${issue.id}/insights`))).sessions;
    const external = sessions.find((s) => s.agentName === 'Coder bot')!;
    const posted = await request.post(`/api/v1/track/agent-sessions/${external.id}/activities`, {
      headers: { authorization: `Bearer ${token}` },
      data: { type: 'response', body: 'Opened a pull request' },
    });
    expect(posted.status()).toBe(201);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-agent-session').first()).toContainText('Opened a pull request');
  });
});

test.describe('Track T3: temas y mobile', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`triage, issue y clientes a 390px en ${scheme}`, async ({ browser, request }) => {
      const { project, intake } = await setup(request);
      const issue = await intake('Mobile crash when paying', 'ana@acme.io', 'App closes at checkout');
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(`/en/app/track/projects/${project.id}?tab=triage`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('track-triage-item')).toHaveCount(1);
      await noHorizontalScroll(page);
      await shot(page, `t3_triage_390_${scheme}`);
      await page.goto(`/en/app/track/issues/${issue.id}`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('track-request')).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, `t3_issue_390_${scheme}`);
      await page.goto('/en/app/track/customers', { waitUntil: 'networkidle' });
      await expect(page.getByTestId('track-customer').first()).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, `t3_customers_390_${scheme}`);
      await ctx.close();
    });
  }
});
