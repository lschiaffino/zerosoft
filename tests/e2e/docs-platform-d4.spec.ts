import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Docs como plataforma (tanda D4): IA del editor y preguntas sobre el
 * workspace (modelo falso DOCS_AI_FAKE), notas de reunión (transcripción
 * pegada y grabación con el micrófono falso de Chromium), bases sincronizadas
 * (DOCS_SYNC_FAKE), API pública con scopes y servidor MCP, y herramientas de
 * Docs en Agents.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

type Block = { id: string; type: string; content: string; db?: { rows: Array<{ id: string }>; sync?: { provider: string } }; meeting_id?: string };

async function pageWith(request: APIRequestContext, title: string, content: Block[]) {
  const doc = (await (await request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
  const res = await request.patch(`/api/docs/pages/${doc.id}`, { data: { content } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return doc;
}

async function content(request: APIRequestContext, id: string): Promise<Block[]> {
  return ((await (await request.get(`/api/docs/pages/${id}`)).json()) as { content: Block[] }).content;
}

const editable = (p: Page, text: string) => p.locator('.docs-blocks .docs-editable', { hasText: text }).first();

test('D4: Ask AI sobre la selección traduce, se ve antes de aceptar y reemplaza', async ({ request, page }) => {
  const doc = await pageWith(request, `AI ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Hello team' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await editable(page, 'Hello team').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.getByTestId('docs-format-ai').click();
  const menu = page.getByTestId('docs-ai-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: /Translate/ }).click();
  await menu.getByRole('option', { name: 'Spanish' }).click();
  await expect(page.getByTestId('docs-ai-preview')).toContainText('[es] Hello team');
  // Todavía no tocó la página.
  expect((await content(request, doc.id))[0].content).toBe('Hello team');
  await page.getByTestId('docs-ai-replace').click();
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await content(request, doc.id))[0].content, { timeout: 10_000 }).toBe('[es] Hello team');
});

test('D4: Espacio en una línea vacía abre la IA; Esc cierra; sin IA se ve el error', async ({ request, page, context }) => {
  const doc = await pageWith(request, `Space ${uid()}`, [
    { id: 'a', type: 'paragraph', content: 'Plan the launch with marketing' },
    { id: 'b', type: 'paragraph', content: '' },
  ]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').nth(1).click();
  await page.keyboard.press(' ');
  const menu = page.getByTestId('docs-ai-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', { name: 'Continue writing' })).toBeVisible();
  // Teclado: flechas y Enter.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docs-ai-preview')).toContainText('Summary');
  await page.getByTestId('docs-ai-insert').click();
  await expect.poll(async () => (await content(request, doc.id)).map((b) => b.content).join(' '), { timeout: 10_000 }).toContain('Summary');

  // Pedido propio y Esc (en una línea vacía nueva debajo del primer párrafo).
  await editable(page, 'Plan the launch').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Sin IA (cookie que apaga el modelo falso): error claro.
  await context.addCookies([{ name: 'docs_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
  await page.keyboard.press(' ');
  await page.keyboard.type('write a haiku');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('docs-ai-error')).toContainText('AI is not set up');
  await context.clearCookies({ name: 'docs_ai_fake' });
});

test('D4: preguntas sobre todo el workspace con citas, desde ?ask=1', async ({ request, page }) => {
  const tag = uid();
  await pageWith(request, `Pricing ${tag}`, [{ id: 'a', type: 'paragraph', content: `We picked three plans for the ${tag} launch.` }]);
  await page.goto('/en/app/docs?ask=1', { waitUntil: 'networkidle' });
  const panel = page.getByTestId('docs-ask-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox').fill(`what plans for the ${tag} launch`);
  await panel.getByRole('textbox').press('Enter');
  await expect(panel.getByTestId('docs-ask-answer')).toBeVisible();
  await expect(panel.getByRole('link', { name: new RegExp(`Pricing ${tag}`) })).toBeVisible();
  await panel.getByRole('textbox').press('Escape');
  await expect(panel).toHaveCount(0);
  // ⌘K también lo abre.
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox').fill('Ask AI about');
  await page.getByRole('option', { name: 'Ask AI about your docs' }).click();
  await expect(page.getByTestId('docs-ask-panel')).toBeVisible();
});

test('D4: notas de reunión desde una transcripción pegada, con tareas al CRM', async ({ request, page }) => {
  const doc = await pageWith(request, `Meet ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('/meeting');
  await expect(page.locator('.docs-command-menu')).toBeVisible();
  await page.keyboard.press('Enter');
  const block = page.getByTestId('docs-meeting-block');
  await expect(block.getByTestId('docs-meeting-start')).toBeVisible();
  await expect.poll(async () => (await content(request, doc.id)).find((b) => b.type === 'meeting')?.meeting_id, { timeout: 10_000 }).toBeTruthy();
  await block.getByTestId('docs-meeting-paste-toggle').click();
  await block.getByTestId('docs-meeting-paste').fill('Ada: Thanks. We decided to ship the beta on Friday.\nGrace: I will send the release notes tomorrow.');
  await block.getByTestId('docs-meeting-paste-save').click();
  const notes = block.getByTestId('docs-meeting-notes');
  await expect(notes).toContainText('ship the beta on Friday');
  await expect(notes).toContainText('send the release notes');
  await block.getByTestId('docs-meeting-send-crm').click();
  await expect(notes.getByRole('link', { name: 'CRM task' })).toBeVisible();
  // El resumen queda en el contenido del bloque (búsqueda y exportar).
  await expect.poll(async () => (await content(request, doc.id)).find((b) => b.type === 'meeting')?.content ?? '', { timeout: 10_000 }).toContain('ship the beta');
  await block.getByRole('tab', { name: 'Transcript' }).click();
  await expect(block.getByTestId('docs-meeting-transcript')).toContainText('Grace:');
});

test('D4: base sincronizada con GitHub desde el menú /, de solo lectura y con sincronizar ahora', async ({ request, page }) => {
  const doc = await pageWith(request, `Sync ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.locator('.docs-blocks .docs-editable').first().click();
  await page.keyboard.type('/synced database');
  await expect(page.locator('.docs-command-menu')).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('docs-sync-dialog');
  await expect(dialog).toBeVisible();
  // Error claro con un repo que no existe.
  await dialog.getByLabel('Repository').fill('acme/missing');
  await dialog.getByRole('button', { name: 'Create synced database' }).click();
  await expect(dialog.getByTestId('docs-sync-error')).toContainText('does not exist');
  await dialog.getByLabel('Repository').fill('acme/web');
  await dialog.getByRole('button', { name: 'Create synced database' }).click();
  await expect(dialog).toHaveCount(0);
  const db = page.getByTestId('docs-database');
  await expect(db.getByTestId('docs-sync-banner')).toContainText('Synced from GitHub');
  await expect(db).toContainText('Login button is broken');
  await expect.poll(async () => (await content(request, doc.id)).find((b) => b.type === 'database')?.db?.sync?.provider, { timeout: 10_000 }).toBe('github');
  // Solo lectura: no hay "New" para agregar filas.
  await expect(db.getByRole('button', { name: /^New$/ })).toHaveCount(0);
  await db.getByTestId('docs-sync-now').click();
  await expect(db.getByTestId('docs-sync-now')).toHaveText('Sync now');
  // Abrir una fila: propiedades y cuerpo de solo lectura.
  await db.locator('.docs-db-title-text', { hasText: 'Login button is broken' }).click();
  await expect(page.getByTestId('docs-db-row-readonly')).toContainText('Steps to reproduce');
});

test('D4: API pública de Docs con scopes y servidor MCP', async ({ request }) => {
  const make = async (scopes: string[]) => ((await (await request.post('/api/keys', { data: { name: `d4 ${uid()}`, scopes } })).json()) as { key: string }).key;
  const rw = await make(['docs:write']);
  const ro = await make(['docs:read']);
  const auth = (k: string) => ({ authorization: `Bearer ${k}` });

  expect((await request.get('/api/v1/docs/pages')).status()).toBe(401);
  const created = await request.post('/api/v1/docs/pages', { headers: auth(rw), data: { title: `API ${uid()}`, markdown: '## Goals\n\n- [ ] Ship' } });
  expect(created.status(), await created.text()).toBe(201);
  const page = ((await created.json()) as { data: { id: string; markdown: string } }).data;
  expect(page.markdown).toContain('- [ ] Ship');
  expect((await request.post('/api/v1/docs/pages', { headers: auth(ro), data: { title: 'no' } })).status()).toBe(403);
  const append = await request.post(`/api/v1/docs/pages/${page.id}/blocks`, { headers: auth(rw), data: { markdown: 'Appended line' } });
  expect(append.status()).toBe(201);
  const got = (await (await request.get(`/api/v1/docs/pages/${page.id}`, { headers: auth(ro) })).json()) as { data: { markdown: string } };
  expect(got.data.markdown).toContain('Appended line');
  const comment = await request.post(`/api/v1/docs/pages/${page.id}/comments`, { headers: auth(rw), data: { text: 'From the API' } });
  expect(comment.status()).toBe(201);
  const search = (await (await request.get('/api/v1/docs/search?q=Appended', { headers: auth(ro) })).json()) as { data: Array<{ page: { id: string } }> };
  expect(search.data.some((h) => h.page.id === page.id)).toBe(true);

  const mcp = await request.post('/api/v1/docs/mcp', { headers: auth(ro), data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  const tools = ((await mcp.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(['search', 'fetch_page', 'create_page', 'update_page']));
  const denied = (await (await request.post('/api/v1/docs/mcp', { headers: auth(ro), data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_page', arguments: { title: 'x' } } } })).json()) as {
    result: { isError: boolean };
  };
  expect(denied.result.isError).toBe(true);

  // DELETE manda a la papelera y la key ya no la encuentra.
  expect((await request.delete(`/api/v1/docs/pages/${page.id}`, { headers: auth(rw) })).status()).toBe(204);
  expect((await request.get(`/api/v1/docs/pages/${page.id}`, { headers: auth(ro) })).status()).toBe(404);
});

test('D4: Agents muestra las herramientas de Docs con el selector de páginas', async ({ request, page }) => {
  const kb = await pageWith(request, `KB ${uid()}`, [{ id: 'a', type: 'paragraph', content: 'Answers' }]);
  const agent = (await (await request.post('/api/agents', { data: { name: `Docs bot ${uid()}` } })).json()) as { id?: string; agent?: { id: string } };
  const id = agent.id ?? agent.agent!.id;
  await page.goto(`/en/app/agents/${id}?tab=tools`, { waitUntil: 'networkidle' });
  await page.getByRole('switch', { name: 'Write Docs pages' }).check();
  const pages = page.getByTestId('ag-docs-pages');
  await expect(pages).toBeVisible();
  await expect(page.getByText('Pick at least one Docs page.').first()).toBeVisible();
  await pages.getByLabel(/^KB /).first().check();
  await expect(page.getByText('Pick at least one Docs page.')).toHaveCount(0);
  void kb;
});

test('D4: avisa al darle a un agente público páginas de un teamspace privado', async ({ request, page }) => {
  const ts = (await (await request.post('/api/docs/teamspaces', { data: { name: `Finance ${uid()}`, access: 'private', ai_knowledge: true } })).json()) as {
    id?: string;
    teamspace?: { id: string };
  };
  const tsId = ts.id ?? ts.teamspace!.id;
  const title = `Payroll ${uid()}`;
  const res = await request.post('/api/docs/pages', { data: { title, teamspace_id: tsId } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const agent = (await (await request.post('/api/agents', { data: { name: `Public bot ${uid()}` } })).json()) as { id?: string; agent?: { id: string } };
  const id = agent.id ?? agent.agent!.id;
  const patched = await request.patch(`/api/agents/${id}`, { data: { publicHandle: `pub-${uid()}` } });
  expect(patched.ok(), await patched.text()).toBeTruthy();
  await page.goto(`/en/app/agents/${id}?tab=tools`, { waitUntil: 'networkidle' });
  await page.getByRole('switch', { name: 'Write Docs pages' }).check();
  const pages = page.getByTestId('ag-docs-pages');
  await expect(page.getByTestId('ag-docs-private-public')).toHaveCount(0);
  await pages.getByLabel(title).check();
  await expect(page.getByTestId('ag-docs-private-public')).toBeVisible();
});

test('D4: el menú de IA y el panel de preguntas entran a 390px, en claro y oscuro', async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const doc = await pageWith(request, `Mobile ${uid()}`, [{ id: 'a', type: 'paragraph', content: '' }]);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
    await page.locator('.docs-blocks .docs-editable').first().click();
    await page.keyboard.press(' ');
    const menu = page.getByTestId('docs-ai-menu');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await page.goto('/en/app/docs?ask=1', { waitUntil: 'networkidle' });
    const panel = page.getByTestId('docs-ask-panel');
    await expect(panel).toBeVisible();
    const pb = (await panel.boundingBox())!;
    expect(pb.x + pb.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});
