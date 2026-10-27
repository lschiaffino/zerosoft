import { createServer, type Server } from 'node:http';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Agents, tanda de paridad: versiones, archivos, pares, sitemaps, MCP,
 * simulaciones, repetición, puntaje, revisión, bloqueo, reglas, export.
 * El modelo es el falso de lib/agents-ai.ts (cookie agents_ai_fake=on). El
 * servidor MCP y el sitemap son un mock local (ALLOW_PRIVATE_WEBHOOKS=true).
 */

const BASE = Number(process.env.E2E_PORT) || 3210;
const MOCK_PORT = BASE + 9;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const uid = () => Math.random().toString(36).slice(2, 8);
let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0"?><urlset><url><loc>${MOCK}/help/returns</loc></url><url><loc>${MOCK}/help/shipping</loc></url><url><loc>${MOCK}/blog/x</loc></url></urlset>`);
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/help/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><head><title>Help ${req.url}</title></head><body><p>Help page ${req.url} with useful text.</p></body></html>`);
      return;
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const msg = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: { id?: string } } };
        if (msg.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        let result: unknown = {};
        if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'store', version: '1' } };
        if (msg.method === 'tools/list') {
          result = {
            tools: [
              { name: 'lookup_order', description: 'Find an order by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
              { name: 'cancel_order', description: 'Cancel an order', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
            ],
          };
        }
        if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: `Order ${msg.params?.arguments?.id}: shipped` }] };
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'e2e' });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(MOCK_PORT, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function fakeAi(context: BrowserContext) {
  await context.addCookies([{ name: 'agents_ai_fake', value: 'on', url: `http://localhost:${BASE}` }]);
}

async function createAgent(page: Page, name: string, patch: Record<string, unknown> = {}): Promise<string> {
  const res = await page.request.post('/api/agents', { data: { name } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { id?: string; agent?: { id: string } };
  const id = body.id ?? body.agent!.id;
  if (Object.keys(patch).length) expect((await page.request.patch(`/api/agents/${id}`, { data: patch })).ok()).toBeTruthy();
  return id;
}

async function ask(page: Page, text: string) {
  const box = page.getByPlaceholder('Write a message…');
  await box.fill(text);
  await box.press('Enter');
  await expect(page.locator('.ag-msg.is-assistant').last()).not.toContainText('Thinking', { timeout: 15_000 });
}

test('versiones: publicar, guardar como borrador, publicar de nuevo y volver atrás', async ({ page }) => {
  const id = await createAgent(page, `Versions ${uid()}`);
  await page.goto(`/en/app/agents/${id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Changes go live on save')).toBeVisible();
  await page.getByRole('button', { name: 'Publish v1' }).click();
  await expect(page.getByText('Version 1 is live.')).toBeVisible();
  await expect(page.getByText('Live: v1', { exact: true })).toBeVisible();

  await page.getByLabel('Welcome message').fill('Hi from the draft');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saved as a draft. Publish to put it live.')).toBeVisible();
  await expect(page.getByText('Live: v1 · Unpublished changes')).toBeVisible();
  const live = (await (await page.request.get(`/api/agents/${id}/versions`)).json()) as { versioning: { hasDraft: boolean; draftChanges: string[] } };
  expect(live.versioning).toMatchObject({ hasDraft: true, draftChanges: ['welcomeMessage'] });

  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.locator('.ag-version').filter({ hasText: 'v1' }).getByText('Live')).toBeVisible();
  await expect(page.getByText('Changed welcome message in the draft')).toBeVisible();

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Version 2 is live.')).toBeVisible();
  await expect(page.locator('.ag-version').filter({ hasText: 'v2' }).getByText('Live')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.locator('.ag-version').filter({ hasText: 'v1' }).getByRole('button', { name: 'Go back to this version' }).click();
  await expect(page.getByText('Version 1 is live again.')).toBeVisible();
  await expect(page.locator('.ag-version').filter({ hasText: 'v3' }).getByText('Live')).toBeVisible();
  await expect(page.getByText('Put version 1 back live as version 3')).toBeVisible();
});

test('conocimiento: archivo, pares con CSV, sitemap y cita en la respuesta', async ({ page, context }) => {
  await fakeAi(context);
  const id = await createAgent(page, `Knowledge ${uid()}`);
  await page.goto(`/en/app/agents/${id}?tab=knowledge`, { waitUntil: 'networkidle' });

  await page.locator('#ag-file-input').setInputFiles({ name: 'refund-policy.txt', mimeType: 'text/plain', buffer: Buffer.from('Refunds are accepted within 30 days of purchase with the receipt.') });
  await expect(page.getByText('refund-policy.txt')).toBeVisible();
  await page.locator('#ag-file-input').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByText(/That file type is not supported/)).toBeVisible();

  await page.getByRole('button', { name: 'Add pair' }).click();
  await page.getByLabel('Question', { exact: true }).fill('Do you ship to Brazil?');
  await page.getByLabel('Other ways to ask it').fill('Shipping to Brazil');
  await page.getByLabel('Answer', { exact: true }).fill('Yes, in 5 business days.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.ag-qa').filter({ hasText: 'Do you ship to Brazil?' })).toBeVisible();
  await page.locator('#ag-qa-csv').setInputFiles({ name: 'faq.csv', mimeType: 'text/csv', buffer: Buffer.from('question,answer\nDo you ship to Brazil?,dup\nOpening hours?,9 to 18') });
  await expect(page.getByText('1 pair added, 1 skipped.')).toBeVisible();

  await page.getByLabel('Sitemap URL').fill(`${MOCK}/sitemap.xml`);
  await page.getByLabel('Only pages under').fill('/help');
  await page.getByRole('button', { name: 'Add sitemap' }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText(/of 2 pages read/)).toBeVisible();

  await page.getByRole('tab', { name: 'Playground' }).click();
  await ask(page, 'refunds within 30 days receipt');
  const reply = page.locator('.ag-msg.is-assistant').last();
  await expect(reply).toContainText('[1]');
  await expect(reply).toContainText('Sources:');
  await expect(reply).toContainText('refund-policy.txt');
});

test('MCP: conectar, elegir herramientas, leer en el playground y aprobación para escribir en vivo', async ({ page, context }) => {
  await fakeAi(context);
  const handle = `mcp-${uid()}`;
  const id = await createAgent(page, `MCP ${uid()}`, { publicHandle: handle });
  await page.goto(`/en/app/agents/${id}?tab=tools`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByRole('switch', { name: 'MCP servers' }).check();
  await page.getByLabel('Name', { exact: true }).fill('Store');
  await page.getByLabel('Server URL (streamable HTTP)').fill(`${MOCK}/mcp`);
  await page.getByLabel('Header value').fill('Bearer e2e-secret');
  await page.getByRole('button', { name: 'Connect server' }).click();
  const srv = page.locator('.ag-mcp-server').filter({ hasText: 'Store' });
  await expect(srv.getByText('2 tools')).toBeVisible();
  await expect(srv.getByText('Sends Authorization')).toBeVisible();
  await expect(srv.locator('.ag-mcp-tool').filter({ hasText: 'cancel_order' }).getByText('Changes data')).toBeVisible();
  await expect(page.getByText('e2e-secret')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();

  await page.getByRole('tab', { name: 'Playground' }).click();
  await ask(page, '/tool mcp_store_lookup_order {"id":"42"}');
  await expect(page.locator('.ag-msg.is-assistant').last()).toContainText('Order 42: shipped');
  await ask(page, '/tool mcp_store_cancel_order {"id":"42"}');
  await expect(page.locator('.ag-msg.is-assistant').last().getByText('Simulated', { exact: true })).toBeVisible();

  // En vivo (página pública), lo que cambia datos espera a un admin.
  const res = await page.request.post(`/api/agents/public/${handle}`, { data: { visitorKey: 'v'.repeat(24), message: '/tool mcp_store_cancel_order {"id":"7"}' } });
  expect(res.ok()).toBeTruthy();
  await res.text();
  const pending = (await (await page.request.get(`/api/agents/${id}/approvals?status=pending`)).json()) as { actions: Array<{ tool: string; input: { tool: string } }> };
  expect(pending.actions.map((a) => [a.tool, a.input.tool])).toEqual([['mcp_call', 'cancel_order']]);
});

test('tests: una conversación simulada pasa con el juez', async ({ page, context }) => {
  await fakeAi(context);
  const id = await createAgent(page, `Sim ${uid()}`);
  await page.goto(`/en/app/agents/${id}?tab=playground`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add test' }).click();
  await page.getByLabel('Simulated conversation').check();
  await page.getByLabel('Customer persona and goal').fill('Ana wants to know about shipping and says thanks.');
  await page.getByLabel('First customer message').fill('Hi, do you ship?');
  await page.getByLabel('Success criteria').fill('The agent answers about shipping.');
  await page.getByRole('button', { name: 'Save test' }).click();
  const row = page.locator('.ag-test').filter({ hasText: 'Hi, do you ship?' });
  await expect(row.getByText('Simulated conversation')).toBeVisible();
  await row.getByRole('button', { name: /^Run/ }).click();
  await expect(row.getByText('Passed')).toBeVisible({ timeout: 20_000 });
  await row.getByText('Conversation', { exact: true }).click();
  await expect(row.locator('.ag-sim-turn')).toHaveCount(2);
});

test('calidad: repetir, puntuar, revisar, memoria, bloquear y exportar', async ({ page, context }) => {
  await fakeAi(context);
  const handle = `q-${uid()}`;
  const id = await createAgent(page, `Quality ${uid()}`, { publicHandle: handle });
  // Memoria activa (por el mismo navegador en la página pública).
  const draft = (await (await page.request.get(`/api/agents/${id}`)).json()) as { agent: { settings: Record<string, unknown> } };
  await page.request.patch(`/api/agents/${id}`, { data: { settings: { ...draft.agent.settings, memory: true } } });
  const key = 'm'.repeat(24);
  const sent = await page.request.post(`/api/agents/public/${handle}`, { data: { visitorKey: key, message: 'Hello, I need help with my order' } });
  await sent.text();

  await page.goto(`/en/app/agents/${id}?tab=playground`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Replay last 10' }).click();
  await expect(page.locator('.ag-replay-item').getByText('Same')).toBeVisible({ timeout: 20_000 });
  await page.locator('.ag-replay-row').first().click();
  await expect(page.locator('.ag-replay-compare').first()).toContainText('Before');

  await page.getByRole('tab', { name: 'Analytics' }).click();
  await page.getByRole('button', { name: 'Score now' }).click();
  await expect(page.getByText('1 conversation scored.')).toBeVisible();
  await expect(page.locator('.ag-kpi').filter({ hasText: 'Satisfaction' }).first()).toContainText('4');
  await expect(page.getByRole('heading', { name: 'By channel' })).toBeVisible();

  const csv = await page.request.get(`/api/agents/${id}/export?days=30`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Hello, I need help with my order');

  await page.getByRole('tab', { name: 'Conversations' }).click();
  await page.locator('.ag-conv-item').first().click();
  await expect(page.locator('.ag-score').getByText('CSAT 4/5')).toBeVisible();
  await expect(page.getByText(/Talked about:/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.locator('.ag-conv-item').first().getByText('Reviewed')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Block visitor' }).click();
  await expect(page.getByText(/Visitor blocked/)).toBeVisible();
  const again = await page.request.post(`/api/agents/public/${handle}`, { data: { visitorKey: key, message: 'hi again' } });
  expect(await again.text()).toContain('blocked');
});

test('reglas que chocan y error claro sin AI', async ({ page }) => {
  const id = await createAgent(page, `Rules ${uid()}`, {
    instructions: 'Always explain pricing to every visitor.',
    guardrails: { avoidTopics: ['pricing'], maxReplyChars: 800 },
  });
  await page.goto(`/en/app/agents/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Advanced/ }).first().click();
  await page.getByRole('button', { name: 'Check rules' }).click();
  await expect(page.getByText('“pricing” is a topic to avoid, but the instructions talk about it.')).toBeVisible();
  await expect(page.getByText(/The AI review did not run: AI is not configured/)).toBeVisible();

  await page.getByRole('tab', { name: 'Analytics' }).click();
  // Sin conversaciones la pestaña muestra el vacío; el error sin AI se ve al puntuar desde la API.
  const res = await page.request.post(`/api/agents/${id}/quality`, { data: { action: 'score' } });
  expect(res.status()).toBe(503);
  expect(((await res.json()) as { error: string }).error).toBe('ai_disabled');
});

test('390 px y modo oscuro: Versiones y Conocimiento sin scroll horizontal', async ({ page }) => {
  const id = await createAgent(page, `Mobile ${uid()}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const tab of ['knowledge', 'versions', 'instructions']) {
    await page.goto(`/en/app/agents/${id}?tab=${tab}`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, tab).toBeLessThanOrEqual(1);
  }
});
