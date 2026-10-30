import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Forms de punta a punta: un formulario desde la plantilla de bug report (con
 * lógica), CRM prendido y publicado; responderlo en /f/<slug> solo con el
 * teclado, tomando la rama de "Crítico" y subiendo un archivo; ver la
 * respuesta y el gráfico del resumen; exportar el CSV (con la guarda de
 * fórmulas); el contacto creado en el CRM; el embed dentro de otra página; y
 * una persona sin la app, bloqueada.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Otra persona del workspace demo (cookie zs_e2e_as) con las apps dadas. */
async function member(browser: Browser, baseURL: string, label: string, apps: string): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `${label}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  await p.close();
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [id]);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)`, [demoTeam, id, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return { ctx, id };
}

test('Forms: plantilla con lógica, respuesta con teclado y archivo, resumen, CSV, CRM, embed y acceso', async ({ page, browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const noApp = await member(browser, baseURL!, 'noforms', '["crm"]');
  const name = `Bug reports ${uid()}`;
  const email = `reporter-${uid()}@example.com`;
  try {
    // 1. Desde la plantilla (con lógica), CRM prendido y publicar.
    await page.goto('/en/app/forms/new', { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: /Bug report/ }).check();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create form' }).click();
    await expect(page).toHaveURL(/\/en\/app\/forms\/fm_[a-z0-9]+$/);
    const formId = /forms\/(fm_[a-z0-9]+)/.exec(page.url())![1];
    await expect(page.locator('#fm-name')).toHaveValue(name);

    await page.getByRole('tab', { name: 'Logic' }).click();
    await page.getByLabel('When leaving question').selectOption({ label: '5. A screenshot helps (optional) (1)' });
    await expect(page.getByText('Rule 1')).toBeVisible();
    await expect(page.getByLabel('Action 1: where to jump')).toHaveValue('end:end_urgent');

    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByLabel('Create a CRM contact from each response').check();
    await page.getByLabel('Email question').selectOption({ label: 'What is your email?' });
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published. The link is live.')).toBeVisible();
    const { form } = (await (await request.get(`/api/forms/${formId}`)).json()) as { form: { slug: string; status: string; settings: { crm: { enabled: boolean } } } };
    expect(form.status).toBe('published');
    expect(form.settings.crm.enabled).toBe(true);

    // 2. Responder en /f/<slug> solo con el teclado (el archivo entra como desde el diálogo del sistema).
    const visitor = await browser.newContext({ baseURL });
    const v = await visitor.newPage();
    await v.goto(`/en/f/${form.slug}`, { waitUntil: 'networkidle' });
    await expect(v.getByRole('heading', { name: /What is your email/ })).toBeVisible();
    await v.keyboard.type(email);
    await v.keyboard.press('Enter');
    await expect(v.getByRole('heading', { name: /On which page did it happen/ })).toBeVisible();
    await v.keyboard.type('example.com/app');
    await v.keyboard.press('Enter');
    await expect(v.getByRole('heading', { name: /How bad is it/ })).toBeVisible();
    await v.keyboard.press('c');
    await expect(v.getByRole('radio', { name: /Critical/ })).toBeChecked();
    await v.keyboard.press('Enter');
    await expect(v.getByRole('heading', { name: /What did you do/ })).toBeVisible();
    await v.keyboard.type('=SUM(1,2) breaks the export');
    await v.keyboard.press('Enter');
    await expect(v.getByRole('heading', { name: /A screenshot helps/ })).toBeVisible();
    await expect(v.locator('input[type="file"]')).toBeFocused();
    await v.locator('input[type="file"]').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });
    await expect(v.getByText('screen.png')).toBeVisible();
    await expect(v.getByRole('button', { name: 'Submit' })).toBeFocused();
    // Playwright responde en menos del tiempo mínimo anti-spam (2 s desde el render, firmado por el
    // servidor): el envío recibe too_fast, la página espera lo que falta y reintenta sola.
    await v.keyboard.press('Enter');
    // Rama de "Crítico": su propio final.
    await expect(v.getByRole('heading', { name: /Critical reports go straight to the team on call/ })).toBeVisible();
    await visitor.close();

    // 3. La respuesta en la tabla, su detalle con el archivo y el gráfico del resumen.
    await page.goto(`/en/app/forms/${formId}/responses`, { waitUntil: 'networkidle' });
    await expect(page.getByText('1 response')).toBeVisible();
    await page.locator('.fm-responses tbody a').first().click();
    await expect(page.locator('.fm-answers').getByText(email)).toBeVisible();
    await expect(page.getByRole('link', { name: /screen\.png/ })).toBeVisible();
    const fileHref = await page.getByRole('link', { name: /screen\.png/ }).getAttribute('href');
    expect((await request.get(fileHref!)).headers()['content-type']).toBe('image/png');

    await page.goto(`/en/app/forms/${formId}/summary`, { waitUntil: 'networkidle' });
    const chart = page.getByRole('list', { name: 'How bad is it?' });
    await expect(chart.getByRole('listitem').filter({ hasText: 'Critical' })).toContainText('1 · 100%');
    await expect(page.getByRole('list', { name: 'Drop-off' })).toBeVisible();

    // 4. CSV: una columna por pregunta y la guarda de fórmulas.
    const csv = await (await request.get(`/api/forms/${formId}/export`)).text();
    expect(csv).toContain('How bad is it?');
    expect(csv).toContain(email);
    expect(csv).toContain(`"'=SUM(1,2) breaks the export"`);

    // 5. El contacto quedó creado en el CRM con el email de la respuesta.
    const contacts = await sql("SELECT id FROM crm_contacts WHERE user_id = 'demo' AND lower(email) = ?", [email]);
    expect(contacts).toHaveLength(1);

    // 6. Embed: el script en otra página pone el form en un iframe y se puede responder ahí.
    const host = await browser.newPage();
    await host.setContent(`<!doctype html><html><body><h1>Partner site</h1><script src="${baseURL}/api/forms/embed.js" data-form="${form.slug}"></script></body></html>`, { waitUntil: 'load' });
    const frame = host.frameLocator('iframe[data-zs-form]');
    await expect(frame.getByRole('heading', { name: /What is your email/ })).toBeVisible({ timeout: 30_000 });
    await host.close();

    // 7. Sin la app Forms: la página redirige con el aviso y la API responde como sin sesión.
    const np = await noApp.ctx.newPage();
    await np.goto('/en/app/forms', { waitUntil: 'networkidle' });
    await expect(np).toHaveURL(/\/en\/app\?blocked=forms/);
    expect((await noApp.ctx.request.get('/api/forms')).status()).toBe(401);
    expect((await noApp.ctx.request.get(`/api/forms/${formId}/responses`)).status()).toBe(401);
    expect((await noApp.ctx.request.get(fileHref!)).status()).toBe(401);
    await np.close();
  } finally {
    await noApp.ctx.close();
  }
});

test('Forms: modo clásico, cierre por tope y pantalla de cerrado', async ({ page, request }) => {
  const { form } = (await (await request.post('/api/forms', { data: { name: `Classic ${uid()}`, template: 'contact' } })).json()) as { form: { id: string; slug: string } };
  expect((await request.patch(`/api/forms/${form.id}`, { data: { status: 'published', settings: { mode: 'classic', responseLimit: 1 } } })).ok()).toBe(true);
  await page.goto(`/en/f/${form.slug}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Check the highlighted answers.')).toBeVisible();
  await page.getByRole('textbox', { name: /What is your name/ }).fill('Ana');
  await page.getByRole('textbox', { name: /What is your email/ }).fill('ana@example.com');
  await expect(page.getByRole('heading', { name: /How can we help, Ana\?/ })).toBeVisible();
  await page.getByRole('textbox', { name: /How can we help/ }).fill('Hello');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Thanks, Ana!' })).toBeVisible();
  await page.goto(`/en/f/${form.slug}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'This form is no longer accepting responses.' })).toBeVisible();
});

test('Forms: el popup del embed abre, atrapa el foco y Esc lo cierra desde dentro del formulario', async ({ browser, request, baseURL }) => {
  const { form } = (await (await request.post('/api/forms', { data: { name: `Popup ${uid()}`, template: 'contact' } })).json()) as { form: { id: string; slug: string } };
  expect((await request.patch(`/api/forms/${form.id}`, { data: { status: 'published' } })).ok()).toBe(true);
  const host = await browser.newPage();
  await host.setContent(
    `<!doctype html><html><body><h1>Partner</h1><script src="${baseURL}/api/forms/embed.js" data-form="${form.slug}" data-mode="popup" data-button="Give feedback"></script><a href="#x">After</a></body></html>`,
    { waitUntil: 'load' },
  );
  await host.getByRole('button', { name: 'Give feedback' }).click();
  const dialog = host.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = host.frameLocator('iframe[data-zs-form]').getByRole('textbox', { name: /What is your name/ });
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.click();
  await host.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(host.getByRole('button', { name: 'Give feedback' })).toBeFocused();
  await host.close();
});
