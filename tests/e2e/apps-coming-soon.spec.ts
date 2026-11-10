import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Apps "Próximamente" y Apps del workspace, de punta a punta:
 * - una persona cualquiera ve Chat como Próximamente en el inicio, el switcher
 *   y Cmd+K; /app/chat lleva a la lista de espera, se suma en un clic y la API
 *   de Chat responde 403;
 * - las cuentas de esta suite son @soon-e2e.io: el servidor de e2e abre las Próximamente para el resto
 *   (E2E_COMING_SOON_OPEN, solo CI y tests), no para ellas;
 * - el staff (ADMIN_EMAILS: demo) abre Chat con el aviso de vista previa interna;
 * - en la página de producto del sitio la lista de espera pide email;
 * - Ajustes › Apps del workspace: el owner deja CRM "solo admins" y después la
 *   apaga; el member deja de verla (página, sidebar y API) y el owner también
 *   cuando está apagada; los datos quedan.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function as(browser: Browser, email: string | null, opts: { width?: number; dark?: boolean } = {}): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width ?? 1280, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  if (email) await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** Cuenta nueva ya onboardeada (sin pasar el onboarding a mano). */
async function person(browser: Browser, label: string, opts: { width?: number; dark?: boolean } = {}) {
  // En minúsculas: la identidad de prueba (zs_e2e_as) guarda el email así y el SELECT de abajo lo busca igual.
  // El dominio @soon-e2e.io no abre las Próximamente aunque el servidor de e2e las abra para el resto (lib/workspace-apps.ts).
  const email = `${label}-${uid()}@soon-e2e.io`.toLowerCase();
  const ctx = await as(browser, email, opts);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [label, id]);
  return { ctx, p, email, id };
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Próximamente: inicio, switcher y Cmd+K la ofrecen; la página es la lista de espera y la API responde 403', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, p, email } = await person(browser, 'Sole');
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const soon = p.getByTestId('home-soon');
    await expect(soon).toContainText('Chat');
    await expect(soon).toContainText('Books');
    // No cuentan como apps del workspace.
    await expect(p.getByTestId('home-featured').getByRole('link', { name: /Open Chat/ })).toHaveCount(0);

    // Switcher: abajo, en "Coming soon".
    await p.locator('.band-product').click();
    await expect(p.getByTestId('switcher-soon-agents')).toBeVisible();
    await p.keyboard.press('Escape');

    // La ruta de la app lleva a la lista de espera.
    await p.goto('/en/app/chat', { waitUntil: 'networkidle' });
    await p.waitForURL(/\/en\/app\/soon\/chat/);
    await expect(p.getByRole('heading', { name: "Chat isn't available yet" })).toBeVisible();
    await p.getByLabel('What would you use it for? (optional)').fill('Website support');
    await p.getByTestId('waitlist-join').click();
    await expect(p.getByTestId('waitlist-joined')).toContainText(`You're on the Chat waitlist. We'll write to ${email}`);
    const rows = await sql('SELECT use_case, source FROM app_waitlist WHERE app = ? AND email = ?', ['chat', email]);
    expect(rows).toEqual([{ use_case: 'Website support', source: 'app' }]);
    // Al volver, ya dice que está en la lista.
    await p.reload({ waitUntil: 'networkidle' });
    await expect(p.getByTestId('waitlist-joined')).toContainText("You're already on the Chat waitlist");

    // La API de Chat: 403 con el motivo.
    const api = await p.request.get('/api/chat/widgets');
    expect(api.status()).toBe(403);
    expect(await api.json()).toMatchObject({ error: 'coming_soon', app: 'chat' });

    // Cmd+K: "Chat" lleva a la lista de espera.
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await p.keyboard.press('ControlOrMeta+k');
    await p.keyboard.type('Chat');
    await expect(p.getByRole('option', { name: /Chat: waitlist/ })).toBeVisible();
    await p.keyboard.press('Escape');
  } finally {
    await ctx.close();
  }
});

test('Próximamente a 390 px y en oscuro: sin scroll horizontal', async ({ browser }) => {
  const { ctx, p } = await person(browser, 'Movil', { width: 390, dark: true });
  try {
    await p.goto('/en/app/soon/robots', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('coming-soon-page')).toBeVisible();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
  } finally {
    await ctx.close();
  }
});

test('staff: abre Chat con el aviso de vista previa interna', async ({ page }) => {
  await page.goto('/en/app/chat', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/en\/app\/chat/);
  await expect(page.getByTestId('preview-banner')).toContainText("Chat isn't available to customers yet");
});

test('sitio: la página de producto dice Próximamente y la lista de espera pide email', async ({ browser }) => {
  // Sin sesión de verdad: con DEMO_MODE todo visitante sin cookie es el usuario demo, y el formulario del sitio no se vería.
  const ctx = await as(browser, 'session');
  const p = await ctx.newPage();
  try {
    await p.goto('/en/products/shop', { waitUntil: 'networkidle' });
    await expect(p.locator('.pd-building')).toHaveText('Coming soon');
    const form = p.locator('#waitlist');
    await form.getByTestId('waitlist-join').click();
    await expect(form.getByRole('alert')).toHaveText('Check the email.');
    const email = `site-${uid()}@soon-e2e.io`;
    await form.getByLabel('Your email').fill(email);
    await form.getByTestId('waitlist-join').click();
    await expect(form.getByTestId('waitlist-joined')).toContainText("We'll email you the day Shop is ready to use");
    expect(await sql('SELECT source FROM app_waitlist WHERE app = ? AND email = ?', ['shop', email])).toEqual([{ source: 'site' }]);
  } finally {
    await ctx.close();
  }
});

test('Apps del workspace: solo admins y apagada cortan página, sidebar y API para quien corresponde', async ({ browser }) => {
  test.setTimeout(150_000);
  const owner = await person(browser, 'Olga');
  const member = await person(browser, 'Mario');
  try {
    const team = String((await sql('SELECT id FROM teams WHERE owner_id = ? ORDER BY created_at LIMIT 1', [owner.id]))[0].id);
    await sql("UPDATE teams SET use_mode = 'team' WHERE id = ?", [team]);
    await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, member.id]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [team, member.id]);
    // Un contacto del owner: tiene que seguir ahí después de apagar CRM.
    const made = await owner.p.request.post('/api/crm/contacts', { data: { firstName: 'Keep', email: `keep-${uid()}@x.io` } });
    expect(made.status()).toBe(201);

    // El member entra a CRM.
    await member.p.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await expect(member.p).toHaveURL(/\/en\/app\/crm/);

    // El owner la deja solo para admins desde Ajustes.
    await owner.p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
    await expect(owner.p.getByTestId('ws-app-chat')).toHaveCount(0);
    await expect(owner.p.getByTestId('ws-app-inbox')).toHaveCount(0);
    await expect(owner.p.getByTestId('ws-app-notes')).toBeVisible();
    await owner.p.getByTestId('ws-app-mode-crm').selectOption('admins');
    await expect(owner.p.getByTestId('ws-app-crm')).toContainText('Only the owner and admins.');

    await member.p.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await member.p.waitForURL(/\/en\/app\?blocked=crm/);
    await expect(member.p.getByTestId('home-blocked')).toBeVisible();
    expect((await member.p.request.get('/api/crm/contacts')).status()).toBe(403);
    // El owner la sigue usando.
    expect((await owner.p.request.get('/api/crm/contacts')).status()).toBe(200);

    // "Todos" con el member excluido a mano: sigue afuera; sin la excepción, entra.
    await owner.p.getByTestId('ws-app-mode-crm').selectOption('all');
    await owner.p.getByTestId('ws-app-edit-crm').click();
    await owner.p.getByTestId('ws-apps-pick').getByLabel(/Mario/).selectOption('deny');
    await owner.p.getByRole('button', { name: 'Save' }).click();
    await expect(owner.p.getByTestId('ws-app-crm')).toContainText('1 person excluded');
    expect((await member.p.request.get('/api/crm/contacts')).status()).toBe(403);
    await owner.p.getByTestId('ws-app-edit-crm').click();
    await owner.p.getByTestId('ws-apps-pick').getByLabel(/Mario/).selectOption('default');
    await owner.p.getByRole('button', { name: 'Save' }).click();
    expect((await member.p.request.get('/api/crm/contacts')).status()).toBe(200);
    await owner.p.getByTestId('ws-app-mode-crm').selectOption('admins');
    await expect(owner.p.getByTestId('ws-app-crm')).toContainText('Only the owner and admins.');

    // "Solo algunos" con el member elegido: vuelve a entrar.
    await owner.p.getByTestId('ws-app-mode-crm').selectOption('some');
    const pick = owner.p.getByTestId('ws-apps-pick');
    await pick.getByLabel(/Mario/).selectOption('allow');
    await owner.p.getByRole('button', { name: 'Save' }).click();
    await expect(owner.p.getByTestId('ws-app-crm')).toContainText('1 person');
    expect((await member.p.request.get('/api/crm/contacts')).status()).toBe(200);

    // Apagada: nadie, ni el owner; desaparece del switcher; los datos quedan.
    await owner.p.getByTestId('ws-app-switch-crm').uncheck();
    await expect(owner.p.getByTestId('ws-app-crm')).toContainText('Off for everyone');
    // Aviso claro para quien llega por link: apagada, sin pedir acceso.
    await member.p.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await member.p.waitForURL(/\/en\/app\?blocked=crm/);
    await expect(member.p.getByTestId('home-blocked')).toContainText('turned off in this workspace');
    expect((await owner.p.request.get('/api/crm/contacts')).status()).toBe(403);
    await owner.p.goto('/en/app', { waitUntil: 'networkidle' });
    await owner.p.locator('.band-product').click();
    await expect(owner.p.locator('.band-switcher-panel')).not.toContainText('CRM');
    await owner.p.keyboard.press('Escape');
    const kept = await sql("SELECT COUNT(*) AS n FROM crm_contacts WHERE user_id = ? AND first_name = 'Keep'", [owner.id]);
    expect(Number(kept[0].n)).toBe(1);

    // De nuevo para todos: vuelve con sus datos.
    await owner.p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
    await owner.p.getByTestId('ws-app-switch-crm').check();
    await expect(owner.p.getByTestId('ws-app-crm')).toContainText('Everyone who has it enabled');
    expect((await owner.p.request.get('/api/crm/contacts')).status()).toBe(200);
  } finally {
    await owner.ctx.close();
    await member.ctx.close();
  }
});
