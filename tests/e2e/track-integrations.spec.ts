import { createHmac } from 'crypto';
import http from 'http';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track T4: API v1 + webhooks con log, MCP, Slack (fake), Sentry (fake),
 * vínculos externos y Figma en el issue, GitHub App (fake) y reglas, acceso
 * (proyectos privados e invitados) y audit log, de punta a punta en la UI.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

function receiver() {
  const got: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  return new Promise<{ url: string; got: typeof got; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/hook`, got, close: () => server.close() });
    }),
  );
}

async function newProject(request: APIRequestContext, name: string) {
  return ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name } }));
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('API v1 de Track, webhook firmado con log de entregas y MCP', async ({ page, request }) => {
  const project = await newProject(request, `API ${uid()}`);
  const { key } = await ok<{ key: string }>(request.post('/api/keys', { data: { name: `track-${uid()}` } }));
  const auth = { authorization: `Bearer ${key}` };
  const rx = await receiver();
  try {
    const hook = await ok<{ id: string; secret: string }>(request.post('/api/webhooks', { data: { url: rx.url, events: ['issue.created', 'issue.status_changed'] } }));

    const created = await request.post('/api/v1/track/issues', {
      headers: auth,
      data: { projectId: project.slug.toUpperCase(), title: 'Created by CI', priority: 'high', labels: ['ci'] },
    });
    expect(created.status(), await created.text()).toBe(201);
    const issue = (await created.json()) as { id: string; identifier: string };

    // El webhook llega firmado (después de responder).
    await expect.poll(() => rx.got.filter((g) => g.headers['zerosoft-event'] === 'issue.created').length, { timeout: 15_000 }).toBeGreaterThan(0);
    const delivery = rx.got.find((g) => g.headers['zerosoft-event'] === 'issue.created')!;
    const [t, v1] = String(delivery.headers['zerosoft-signature']).split(',').map((p) => p.split('=')[1]);
    expect(createHmac('sha256', hook.secret).update(`${t}.${delivery.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(delivery.body).data.issue.identifier).toBe(issue.identifier);

    const patched = await request.patch(`/api/v1/track/issues/${issue.identifier}`, { headers: auth, data: { status: 'done' } });
    expect(patched.status(), await patched.text()).toBe(200);
    await expect.poll(() => rx.got.some((g) => g.headers['zerosoft-event'] === 'issue.status_changed'), { timeout: 15_000 }).toBe(true);

    // MCP: tools/list y una búsqueda.
    const list = await ok<{ result: { tools: Array<{ name: string }> } }>(
      request.post('/api/mcp/track', { headers: auth, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }),
    );
    expect(list.result.tools.map((x) => x.name)).toContain('create_issue');
    const search = await ok<{ result: { structuredContent: { total: number } } }>(
      request.post('/api/mcp/track', {
        headers: auth,
        data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_issues', arguments: { query: 'Created by CI' } } },
      }),
    );
    expect(search.result.structuredContent.total).toBeGreaterThan(0);
    expect((await request.post('/api/mcp/track', { data: { jsonrpc: '2.0', id: 3, method: 'tools/list' } })).status()).toBe(401);

    // Log de entregas en Ajustes del workspace.
    await page.goto('/en/app/settings/workspace#webhooks');
    const row = page.locator('tr', { hasText: rx.url });
    await row.getByTestId('webhook-deliveries-toggle').click();
    const log = page.getByTestId('webhook-deliveries');
    await expect(log).toContainText('issue.created');
    await expect(log).toContainText('Delivered');

    // La pestaña API y MCP de Track.
    await page.goto('/en/app/track/settings?tab=api');
    await expect(page.getByTestId('track-mcp-url')).toContainText('/api/mcp/track');
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
    await page.request.delete(`/api/webhooks/${hook.id}`);
  } finally {
    rx.close();
  }
});

test('Slack (fake): conectar, aviso a canal, /track firmado y vista en el log', async ({ page, request }) => {
  const project = await newProject(request, `Slack ${uid()}`);
  await page.goto('/en/app/track/settings?tab=integrations');
  await page.getByTestId('track-slack-connect').click();
  await expect(page.getByTestId('track-slack-settings')).toBeVisible();

  const form = page.getByRole('form', { name: 'Add channel' });
  await form.getByLabel('Team').selectOption(project.id);
  await form.getByLabel('Channel').selectOption('C_ENG');
  await page.getByTestId('track-slack-add-channel').click();
  await expect(page.getByTestId('track-slack-subs')).toContainText('#eng');

  // Slash command firmado como lo haría Slack.
  const body = new URLSearchParams({ team_id: 'T_FAKE', user_id: 'U1', text: `From Slack ${uid()}` }).toString();
  const ts = Math.floor(Date.now() / 1000);
  const sig = `v0=${createHmac('sha256', 'fake-signing-secret').update(`v0:${ts}:${body}`).digest('hex')}`;
  const res = await request.post('/api/track/slack/commands', {
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig },
    data: body,
  });
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { text: string }).text).toMatch(/Created/);
  const bad = await request.post('/api/track/slack/commands', {
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(ts), 'x-slack-signature': 'v0=00' },
    data: body,
  });
  expect(bad.status()).toBe(401);

  await page.reload();
  await expect(page.getByTestId('track-slack-settings')).toContainText('/track From Slack');

  // Claro y oscuro, y 390px.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('track-slack-settings')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
  await request.delete('/api/track/integrations/slack');
});

test('Sentry (fake) crea el issue y el issue muestra sus vínculos y el embed de Figma', async ({ page, request }) => {
  const project = await newProject(request, `Sentry ${uid()}`);
  await page.goto('/en/app/track/settings?tab=integrations');
  await page.getByTestId('track-sentry-start').click();
  const form = page.getByTestId('track-sentry-form');
  await form.getByLabel('Track team for new errors').selectOption(project.id);
  await form.getByLabel('Sentry organization slug').fill('acme');
  await form.getByLabel('Client secret (webhook signature)').fill('sentry-client-secret');
  await page.locator('form', { has: form }).getByRole('button', { name: 'Connect' }).click();
  const url = await page.getByTestId('track-sentry-url').textContent();
  expect(url).toMatch(/\/api\/track\/sentry\/webhook\//);

  const raw = JSON.stringify({ action: 'created', data: { issue: { id: String(Date.now()), title: 'TypeError in checkout', level: 'error', web_url: 'https://acme.sentry.io/issues/1/' } } });
  const res = await request.post(new URL(url!).pathname, {
    headers: { 'content-type': 'application/json', 'sentry-hook-resource': 'issue', 'sentry-hook-signature': createHmac('sha256', 'sentry-client-secret').update(raw).digest('hex') },
    data: raw,
  });
  expect(res.status(), await res.text()).toBe(201);
  const { issueId } = (await res.json()) as { issueId: string };

  await page.goto(`/en/app/track/issues/${issueId}`);
  const links = page.getByTestId('track-issue-links');
  await expect(links.getByTestId('track-issue-link')).toContainText('Sentry');
  // Vincular un diseño de Figma: aparece con su vista previa.
  await links.getByTestId('track-issue-link-add').click();
  await links.getByTestId('track-issue-link-url').fill('https://www.figma.com/design/AbC123/Checkout');
  await links.getByTestId('track-issue-link-url').press('Enter');
  const embed = links.getByTestId('track-figma-embed');
  await expect(embed).toBeVisible();
  await embed.getByRole('button', { name: 'Preview' }).click();
  await expect(embed.locator('iframe')).toHaveAttribute('src', /figma\.com\/embed/);
  // Un link que no es de ningún servicio: error claro.
  await links.getByTestId('track-issue-link-add').click();
  await links.getByTestId('track-issue-link-url').fill('https://example.com/x');
  await links.getByTestId('track-issue-link-url').press('Enter');
  await expect(links.getByRole('alert')).toBeVisible();
  await links.getByTestId('track-issue-link-url').press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
  await request.delete('/api/track/integrations/sentry');
});

test('GitHub App (fake) y reglas por proyecto', async ({ page, request }) => {
  await newProject(request, `GH ${uid()}`);
  await page.goto('/en/app/track/settings?tab=github');
  await page.getByTestId('track-github-app-install').click();
  await expect(page).toHaveURL(/github=installed/);
  await expect(page.getByTestId('track-github-app-status')).toContainText('Installed on acme');
  const rule = page.getByTestId('track-github-rule').first();
  await rule.getByLabel('Custom rules').check();
  await expect(rule.getByLabel('PR merged')).toBeVisible();
  await expect(rule.getByRole('status')).toContainText('Saved');
  // Deja el workspace demo como estaba (otras suites esperan GitHub sin conectar).
  await request.delete('/api/track/github');
});

test('Acceso: proyecto privado con candado, invitado y audit log con export', async ({ page, request }) => {
  const team = await ok<{ id: string }>(request.post('/api/teams', { data: { name: `T4 ${uid()}` } }));
  await ok(request.post('/api/teams/switch', { data: { teamId: team.id } }));
  try {
    const project = await newProject(request, `Private ${uid()}`);
    await page.goto('/en/app/track/settings?tab=access');
    const row = page.getByTestId('track-access-project').filter({ hasText: 'Private' }).first();
    await row.getByRole('combobox').selectOption('private');
    await expect(row).toContainText('1 member');

    await page.getByTestId('track-guest-email').fill(`guest-${uid()}@example.com`);
    await page.getByRole('group', { name: 'Teams the guest can see' }).getByRole('checkbox').first().check();
    await page.getByTestId('track-guest-save').click();
    await expect(page.getByTestId('track-guests')).toContainText('invitation pending');

    await page.goto('/en/app/track/teams');
    await expect(page.locator('.track-private-mark').first()).toBeVisible();

    await page.goto('/en/app/track/settings?tab=audit');
    await expect(page.getByTestId('track-audit-row').first()).toBeVisible();
    await expect(page.getByTestId('track-audit')).toContainText('changed who can see');
    await page.getByTestId('track-audit-action').selectOption('access.guest_set');
    await expect(page.getByTestId('track-audit-row')).toHaveCount(1);
    const href = await page.getByTestId('track-audit-export').getAttribute('href');
    const csv = await request.get(href!);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('access.guest_set');
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
    await request.delete(`/api/track/projects/${project.id}`);
  } finally {
    await request.post('/api/teams/switch', { data: { teamId: null } });
  }
});
