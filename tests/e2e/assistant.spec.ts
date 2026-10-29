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

  // Esc cierra el panel y el foco vuelve al botón de la banda.
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
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
  const assistantPage = page.getByTestId('assistant-page');
  await expect(assistantPage.getByTestId('assistant-msg-assistant').last()).toContainText('Members:');
  await expect(page).toHaveURL(/\?c=/);
  const history = assistantPage.getByTestId('assistant-history');
  await expect(history.getByRole('link', { name: question })).toHaveAttribute('aria-current', 'page');

  // Renombrar (Enter confirma).
  const renamed = `Team check ${uid()}`;
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
