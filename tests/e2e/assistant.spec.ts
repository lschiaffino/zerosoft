import { createClient } from '@libsql/client';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Asistente de la plataforma con el modelo falso (ASSISTANT_FAKE=1): panel
 * con ⌘J, tarjetas de herramientas, confirmar una escritura y verla en la
 * app, permisos por app (un member sin CRM no recibe herramientas del CRM)
 * y el historial a página completa (nueva, renombrar, borrar).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('⌘J abre el panel, pregunta, tarjeta de herramienta, confirmar un pipeline y verlo en el CRM', async ({ page, request }) => {
  const errors = watchErrors(page);
  const name = `Renewals ${uid()}`;
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Assistant' })).toBeVisible();

  // Lectura: la tarjeta de la herramienta aparece colapsada y se expande.
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await expect(input).toBeFocused();
  await input.fill('Show deals closing this month');
  await input.press('Enter');
  const readCard = panel.locator('[data-testid="assistant-tool-card"][data-tool="crm_list_deals"]');
  await expect(readCard).toBeVisible();
  await expect(readCard).not.toHaveAttribute('open', '');
  await readCard.locator('summary').click();
  await expect(readCard.getByText('Result')).toBeVisible();
  await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText(/deals|No deals match/);

  // Escritura: queda una tarjeta para confirmar; nada cambia hasta el clic.
  await input.fill(`Create a pipeline ${name} with stages Contacted, Proposal, Signed`);
  await input.press('Enter');
  const action = panel.getByTestId('assistant-action').last();
  await expect(action).toHaveAttribute('data-status', 'pending');
  await expect(action).toContainText(`Create pipeline "${name}" with 3 stages`);
  await expect(action).toContainText('Proposal');
  const before = (await ok<{ rows: Array<{ name: string }> }>(request.get('/api/crm/pipelines'))).rows;
  expect(before.some((p) => p.name === name)).toBe(false);

  await action.getByRole('button', { name: 'Confirm' }).click();
  await expect(action).toHaveAttribute('data-status', 'done');
  await expect(action).toContainText(`Pipeline "${name}" created with 3 stages.`);
  const after = (await ok<{ rows: Array<{ name: string; stages: Array<{ name: string }> }> }>(request.get('/api/crm/pipelines'))).rows;
  expect(after.find((p) => p.name === name)?.stages.map((s) => s.name)).toEqual(['Contacted', 'Proposal', 'Signed']);

  // El resultado en la app: el link de la tarjeta lleva a los deals del pipeline nuevo.
  await action.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/en\/app\/crm\/deals\?pipeline=/);
  await expect(page.locator('main.app-content')).toContainText('Proposal');

  // El panel sigue abierto al navegar; Esc lo cierra y ⌘J lo vuelve a abrir con la misma charla.
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel.getByTestId('assistant-action').last()).toHaveAttribute('data-status', 'done');
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('cancelar una acción no cambia nada; el botón de la banda abre el panel', async ({ page, request }) => {
  const name = `Cancelled ${uid()}`;
  await page.goto('/en/app/docs', { waitUntil: 'networkidle' });
  await page.locator('[data-assistant-trigger]').click();
  const panel = page.getByTestId('assistant-panel');
  await panel.getByRole('button', { name: 'New chat' }).click();
  await panel.getByRole('textbox', { name: /Ask anything/ }).fill(`Create a pipeline ${name} with stages A, B`);
  await panel.getByRole('textbox', { name: /Ask anything/ }).press('Enter');
  const action = panel.getByTestId('assistant-action').last();
  await action.getByRole('button', { name: 'Cancel' }).click();
  await expect(action).toHaveAttribute('data-status', 'cancelled');
  const pipelines = (await ok<{ rows: Array<{ name: string }> }>(request.get('/api/crm/pipelines'))).rows;
  expect(pipelines.some((p) => p.name === name)).toBe(false);
});

test('un member sin CRM no recibe herramientas del CRM', async ({ browser, page }) => {
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `asst-${uid()}@darwin-e2e.io`;
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["docs"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);

    const status = await ok<{ state: string; admin: boolean; tools: Array<{ name: string; app: string | null }> }>(ctx.request.get('/api/assistant'));
    expect(status.state).toBe('ready');
    expect(status.admin).toBe(false);
    expect(status.tools.filter((t) => t.app === 'crm')).toEqual([]);
    expect(status.tools.map((t) => t.name)).toContain('docs_search');
    expect(status.tools.map((t) => t.name)).not.toContain('propose_invite_member');
    // El demo (owner) sí las tiene.
    const owner = await ok<{ tools: Array<{ app: string | null }> }>(page.request.get('/api/assistant'));
    expect(owner.tools.some((t) => t.app === 'crm')).toBe(true);

    // En el panel: pedir deals no usa ninguna herramienta del CRM.
    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await p.keyboard.press('ControlOrMeta+j');
    const panel = p.getByTestId('assistant-panel');
    await panel.getByRole('textbox', { name: /Ask anything/ }).fill('Show deals closing this month');
    await panel.getByRole('textbox', { name: /Ask anything/ }).press('Enter');
    await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText('I cannot use CRM in this workspace.');
    await expect(panel.getByTestId('assistant-tool-card')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('historial a página completa: preguntar desde el inicio, renombrar, buscar y borrar', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const home = page.getByTestId('home-assistant');
  await expect(home).toBeVisible();
  const question = `Who is in this workspace ${uid()}`;
  await home.getByRole('textbox').fill(question);
  await home.getByRole('button', { name: 'Ask' }).click();
  await expect(page).toHaveURL(/\/en\/app\/assistant/);
  // Shell de la plataforma (no el de Link) con el ítem del asistente marcado.
  await expect(page.locator('#app-side .side-stop[href$="/app/assistant"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.band-product-name')).not.toHaveText('Link');
  const assistantPage = page.getByTestId('assistant-page');
  await expect(assistantPage.getByTestId('assistant-msg-assistant').last()).toContainText('Members:');
  await expect(page).toHaveURL(/\?c=/);
  const history = assistantPage.getByTestId('assistant-history');
  await expect(history.getByRole('link', { name: question })).toHaveAttribute('aria-current', 'page');

  // Renombrar (Enter confirma).
  const renamed = `Team check ${uid()}`;
  // Renombrar y Borrar aparecen al pasar el mouse (o con foco) por la fila.
  await history.getByRole('link', { name: question }).hover();
  await history.getByRole('button', { name: `Rename: ${question}` }).click();
  const field = history.getByRole('textbox', { name: 'Chat name' });
  await field.fill(renamed);
  await field.press('Enter');
  await expect(history.getByRole('link', { name: renamed })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(history.getByRole('link', { name: renamed })).toBeVisible();
  // Recargar abre la misma charla con sus mensajes.
  await expect(assistantPage.getByTestId('assistant-msg-user').first()).toContainText(question);

  // Buscar.
  await assistantPage.getByRole('searchbox', { name: 'Search chats' }).fill('zzz-no-match');
  await expect(assistantPage.getByText('No chats match.')).toBeVisible();
  await assistantPage.getByRole('searchbox', { name: 'Search chats' }).fill('');

  // Borrar con confirmación.
  await history.getByRole('link', { name: renamed }).hover();
  await history.getByRole('button', { name: `Delete: ${renamed}` }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this chat?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(history.getByRole('link', { name: renamed })).toHaveCount(0);
  await expect(assistantPage.getByText('What do you need?')).toBeVisible();

  // Nueva charla: estado vacío con sugerencias.
  await assistantPage.getByRole('button', { name: 'New chat' }).click();
  await expect(assistantPage.getByRole('list', { name: 'Suggested questions' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('390px: el panel es una hoja a pantalla completa y no hay scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/assistant', { waitUntil: 'networkidle' });
  let { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const box = await page.getByTestId('assistant-panel').boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  expect(box?.y).toBe(0);
  ({ scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth })));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});

test('catálogo del MCP y contexto de la página: "what is this" en un doc, en oscuro', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  const title = `Runbook ${uid()}`;
  const doc = await ok<{ id: string }>(request.post('/api/docs/pages', { data: { title } }));
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await input.fill('What is this?');
  await input.press('Enter');
  // Lee la página abierta por el catálogo, con la misma operación que usa el servidor MCP.
  const cards = panel.locator('[data-testid="assistant-tool-card"][data-tool="run_operation"]');
  await expect(cards.first()).toBeVisible();
  await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText(`This is "${title}"`);

  await input.fill('list group chats');
  await input.press('Enter');
  await expect(cards.nth(1)).toBeVisible();
  await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText('Found');
  expect(errors, errors.join('\n')).toEqual([]);
});

// PNG de 1×1.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Pegar o soltar un archivo como lo hace el navegador (DataTransfer con un File). */
async function fileEvent(page: Page, selector: string, kind: 'paste' | 'drop', name: string, type: string, b64: string) {
  await page.evaluate(
    ({ selector, kind, name, type, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      const el = document.querySelector(selector)!;
      if (kind === 'paste') {
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        return;
      }
      el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { selector, kind, name, type, b64 },
  );
}

test('adjuntos: +, pegar y soltar; el modelo los recibe y uno se suma al doc con confirmación (390, oscuro)', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const doc = await ok<{ id: string }>(request.post('/api/docs/pages', { data: { title: `Specs ${uid()}` } }));
  await page.goto(`/en/app/docs/${doc.id}`, { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  const tray = panel.getByTestId('assistant-attachment');

  // +: elegir un archivo de texto.
  await panel.getByTestId('assistant-file-input').setInputFiles({ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Launch on Friday at noon.') });
  await expect(tray).toHaveCount(1);
  // Pegar una imagen en el campo.
  await fileEvent(page, '#asst-input-panel', 'paste', 'shot.png', 'image/png', PNG_B64);
  await expect(tray).toHaveCount(2);
  // Arrastrar y soltar otra sobre el panel.
  await fileEvent(page, '.asst-panel .asst-chat', 'drop', 'drop.png', 'image/png', PNG_B64);
  await expect(tray).toHaveCount(3);
  await expect(panel.locator('[data-testid="assistant-attachment"][data-status="ready"]')).toHaveCount(3);
  // Un tipo no permitido queda marcado y se puede quitar.
  await panel.getByTestId('assistant-file-input').setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<p>x</p>') });
  await expect(panel.locator('[data-testid="assistant-attachment"][data-status="error"]')).toContainText('not allowed');
  // Con un archivo que falló no se manda nada hasta quitarlo.
  await input.fill('Describe these files');
  await expect(panel.getByTestId('assistant-attachments-blocked')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Remove page.html' }).click();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled();
  await expect(tray).toHaveCount(3);

  await input.fill('Describe these files');
  await input.press('Enter');
  await expect(tray).toHaveCount(0);
  await expect(panel.getByTestId('assistant-msg-user').last().getByTestId('assistant-sent-attachment')).toHaveCount(3);
  // El modelo (falso) recibió las dos imágenes como partes y el texto del archivo.
  const reply = panel.getByTestId('assistant-msg-assistant').last();
  await expect(reply).toContainText('I can see 2 file(s): image/png (70 bytes), image/png (70 bytes)');
  await expect(reply).toContainText('The document starts with: "Launch on Friday at noon."');

  // Usar el adjunto en una acción: pasa por la tarjeta y recién al confirmar entra al doc.
  await input.fill('Add this to this doc');
  await input.press('Enter');
  const action = panel.getByTestId('assistant-action').last();
  await expect(action).toHaveAttribute('data-status', 'pending');
  await expect(action).toContainText('drop.png');
  const before = JSON.stringify(await ok(request.get(`/api/docs/pages/${doc.id}`)));
  expect(before).not.toContain('"type":"image"');
  await action.getByRole('button', { name: 'Confirm' }).click();
  await expect(action).toHaveAttribute('data-status', 'done');
  await expect.poll(async () => JSON.stringify(await ok(request.get(`/api/docs/pages/${doc.id}`)))).toContain('"type":"image"');

  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('un envío que no llega deja el texto y los adjuntos para reintentar, y dice que no hay conexión', async ({ page, context }) => {
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await expect(input).toBeFocused();
  await panel.getByTestId('assistant-file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(panel.locator('[data-testid="assistant-attachment"][data-status="ready"]')).toHaveCount(1);
  await context.setOffline(true);
  await input.fill('Summarize this file');
  await input.press('Enter');
  await expect(panel.getByRole('alert').filter({ hasText: 'You are offline' })).toBeVisible();
  await expect(input).toHaveValue('Summarize this file');
  await expect(panel.getByTestId('assistant-attachment')).toHaveCount(1);
  await context.setOffline(false);

  // Error del servidor: otro texto, y lo mismo vuelve al campo.
  await page.route('**/api/assistant/chat', (route) => route.fulfill({ status: 500, body: 'oops' }));
  await input.press('Enter');
  await expect(panel.getByRole('alert').filter({ hasText: 'The server had a problem' })).toBeVisible();
  await expect(input).toHaveValue('Summarize this file');
  await expect(panel.getByTestId('assistant-attachment')).toHaveCount(1);
  await page.unroute('**/api/assistant/chat');

  // Ya con red: sale, y la bandeja se vacía.
  await input.press('Enter');
  await expect(panel.getByTestId('assistant-attachment')).toHaveCount(0);
  await expect(panel.getByTestId('assistant-msg-user').last().getByTestId('assistant-sent-attachment')).toHaveCount(1);
});
