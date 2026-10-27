import { expect, test, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

// Lo que crean los tests se borra al final: la base demo queda limpia.
const createdFlows: string[] = [];
const createdFolders: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of createdFlows.splice(0)) await page.request.delete(`/api/flow/flows/${id}`).catch(() => null);
  for (const id of createdFolders.splice(0)) await page.request.delete(`/api/flow/folders/${id}`).catch(() => null);
});

async function apiFlow(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/flow/flows', { data });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  createdFlows.push(id);
  return id;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner + 1);
}

test('Flow: carpetas, búsqueda y filtros, exportar e importar JSON', async ({ page }) => {
  const name = `Parity ${uid()}`;
  const id = await apiFlow(page, { name, template: 'webhookToContact' });
  await page.goto('/en/app/flow', { waitUntil: 'networkidle' });

  // Carpeta nueva desde la lista (Enter confirma).
  const folder = `Folder ${uid()}`;
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(folder);
  await page.keyboard.press('Enter');
  const folderButton = page.getByRole('button', { name: new RegExp(`^${folder}`) });
  await expect(folderButton).toHaveAttribute('aria-pressed', 'true');
  const folders = (await (await page.request.get('/api/flow/folders')).json()) as { folders: Array<{ id: string; name: string }> };
  createdFolders.push(folders.folders.find((f) => f.name === folder)!.id);
  await expect(page.getByText('This folder is empty')).toBeVisible();

  // Mover el flow a la carpeta desde el menú de la fila.
  await page.getByRole('button', { name: /^All/ }).click();
  await page.getByRole('button', { name: `Flow actions: ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Move to folder' }).click();
  await page.getByRole('dialog').getByLabel('Folder').selectOption({ label: folder });
  await page.getByRole('dialog').getByRole('button', { name: 'Move to folder' }).click();
  await folderButton.click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(folderButton).toContainText('1');

  // Búsqueda: sin coincidencias muestra el estado vacío; Esc la limpia.
  const search = page.getByRole('searchbox', { name: 'Search flows' });
  await search.fill('zzz-no-match');
  await expect(page.getByText('No flows match')).toBeVisible();
  await search.press('Escape');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();

  // Exportar: baja un .flow.json con el grafo.
  await page.getByRole('button', { name: `Flow actions: ${name}` }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export JSON' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.flow\.json$/);
  const exported = JSON.parse(await (await download.createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8'))) as {
    format: string;
    graph: { nodes: unknown[] };
  };
  expect(exported.format).toBe('zerosoft-flow');
  expect(exported.graph.nodes.length).toBeGreaterThan(1);

  // Importar ese JSON: abre el editor del flow nuevo.
  await page.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a flow' });
  await dialog.getByLabel('Or paste the JSON').fill(JSON.stringify({ ...exported, name: `Imported ${uid()}` }));
  await dialog.getByRole('button', { name: 'Import' }).click();
  await page.waitForURL(/\/app\/flow\/[0-9a-f-]{36}$/);
  createdFlows.push(page.url().split('/').pop()!);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  expect(id).toBeTruthy();
});

test('Flow: autoguardado como borrador, notas, copiar y pegar, publicar con autor', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const id = await apiFlow(page, { name: `Draft ${uid()}`, template: 'webhookToContact' });
  await page.goto(`/en/app/flow/${id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const before = await page.locator('.react-flow__node').count();

  // Nota desde la paleta.
  await page.getByRole('searchbox', { name: 'Search nodes' }).fill('note');
  await page.locator('.flow-palette-item', { hasText: 'Note' }).click();
  await page.locator('.flow-side').getByLabel('Note').fill('Explains the flow');
  await expect(page.locator('.flow-note-card')).toContainText('Explains the flow');
  // Se guarda solo como borrador.
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Unpublished changes/)).toBeVisible();

  // Copiar y pegar un paso (Cmd/Ctrl+C, Cmd/Ctrl+V).
  await page.locator('.react-flow__node').filter({ hasText: 'Explains the flow' }).click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } }).catch(() => null);
  await page.locator('.react-flow__node').filter({ hasText: 'Explains the flow' }).click();
  await page.keyboard.press(`${mod}+c`);
  await expect(page.getByRole('status').filter({ hasText: 'One step copied' })).toBeVisible();
  await page.keyboard.press(`${mod}+v`);
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 2);

  // Al recargar sigue el borrador.
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.flow-note-card')).toHaveCount(2);

  // Publicar: versión nueva con autor, sin borrador.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Published\. Now at version/ })).toBeVisible();
  await expect(page.getByText(/Unpublished changes/)).toBeHidden();
  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.locator('.flow-version').first()).toContainText(/by /);
});

test('Flow: historial global con tablero, filtros y exportación', async ({ page }) => {
  const name = `History ${uid()}`;
  const id = await apiFlow(page, { name });
  const run = await page.request.post(`/api/flow/flows/${id}/run`, { data: { input: { hello: 'world' } } });
  expect(run.ok()).toBeTruthy();
  await page.goto('/en/app/flow/runs', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Run history' })).toBeVisible();
  await expect(page.locator('.flow-kpi').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Flow' }).selectOption({ label: name });
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  // Búsqueda por dato (capturado por el usuario demo).
  await page.getByRole('searchbox', { name: /Search by run ID/ }).fill('world');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed');
  await expect(page.getByText('No runs match')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^flow-runs-.*\.csv$/);
  // Abrir una corrida lleva a su flow.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('combobox', { name: 'Flow' }).selectOption({ label: name });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await page.waitForURL(new RegExp(`/app/flow/${id}\\?run=`));
  await expect(page.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true');
});

test('Flow: variables propias en su página', async ({ page }) => {
  const key = `k_${uid()}`;
  await page.goto('/en/app/flow/variables', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New variable' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(key);
  await dialog.getByLabel('Value').fill('https://api.example.com');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: `{{vars.${key}}}` })).toBeVisible();
  await page.getByRole('button', { name: `Delete ${key}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: `{{vars.${key}}}` })).toBeHidden();
});

test('Flow: formulario hospedado valida y corre el flow', async ({ page }) => {
  const id = await apiFlow(page, { name: `Form ${uid()}`, template: 'formToCrm' });
  expect((await page.request.patch(`/api/flow/flows/${id}`, { data: { enabled: true } })).ok()).toBeTruthy();
  const { webhooks } = (await (await page.request.get(`/api/flow/flows/${id}`)).json()) as { webhooks: Array<{ token: string }> };
  await page.goto(`/en/flow/form/${webhooks[0].token}`);
  await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('This field is required.').first()).toBeVisible();
  await expect(page.getByLabel('Name *')).toBeFocused();
  await page.getByLabel('Name *').fill('Ada');
  await page.getByLabel('Email *').fill('ada@example.com');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thanks! We got your answer.')).toBeVisible();
  const runs = (await (await page.request.get(`/api/flow/flows/${id}/runs`)).json()) as { runs: Array<{ triggerType: string }> };
  expect(runs.runs[0]?.triggerType).toBe('trigger.form');
});

test('Flow: armar con IA muestra ai_disabled sin IA y arma el flow con el modelo falso', async ({ page, context, baseURL }) => {
  await page.goto('/en/app/flow', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Build with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Describe your flow' });
  await dialog.getByLabel('What should it do?').fill('When someone fills a form, add the contact to the CRM and post to Slack');
  await dialog.getByRole('button', { name: 'Build flow' }).click();
  await expect(dialog.getByText("AI isn't set up in this workspace.")).toBeVisible();
  await context.addCookies([{ name: 'flow_ai_fake', value: 'on', url: baseURL! }]);
  await dialog.getByRole('button', { name: 'Build flow' }).click();
  await page.waitForURL(/\/app\/flow\/[0-9a-f-]{36}$/);
  createdFlows.push(page.url().split('/').pop()!);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__node').first()).toContainText('Form');
});

for (const theme of ['light', 'dark'] as const) {
  test(`Flow: historial y variables en tema ${theme} a 390px sin scroll horizontal`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/en/app/flow', '/en/app/flow/runs', '/en/app/flow/variables']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await noHorizontalScroll(page);
    }
  });
}
