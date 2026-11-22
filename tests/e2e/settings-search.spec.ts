import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Búsqueda de Ajustes (como la del Mac): "oscuro" encuentra el tema de
 * Apariencia con sus migas, Enter lleva a la página, baja hasta el ajuste y lo
 * marca; un member no ve los ajustes de admins; la caja de los ajustes de una
 * app encuentra un ajuste de otra; ⌘K también encuentra ajustes. A 1280 y a
 * 390 (sin scroll horizontal), con capturas en claro y en retro oscuro.
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

/** Un member (no admin) del workspace demo, con su cuenta y el workspace activo. */
async function memberContext(browser: Browser, opts: { dark?: boolean; look?: string } = {}) {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `member-${uid()}@settings-search-e2e.io`;
  const demo = await browser.newContext({ baseURL });
  await demo.addCookies([{ name: 'zs_e2e_as', value: 'session-demo', url: baseURL }]);
  await demo.request.get('/api/teams/members');
  await demo.close();
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  // El primer pedido crea la cuenta (zs_e2e_as); en next dev la ruta puede tardar en compilar.
  let rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 5 && !rows.length; i++) {
    const res = await ctx.request.get('/api/teams/members', { timeout: 90_000 });
    rows = await sql('SELECT id FROM users WHERE email = ?', [email]);
    expect(res.status()).toBe(200);
  }
  const id = String(rows[0].id);
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [`Member ${uid()}`, team, id]);
  await sql("INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  // El aspecto es de la cuenta: se pone en la de este member, no en la del owner que usan los demás tests.
  if (opts.look) await sql('UPDATE users SET ui_look = ? WHERE id = ?', [opts.look, id]);
  return ctx;
}

/** La caja, ya hidratada y con el índice cargado (data-ready): tipear antes se perdía en next dev. */
const search = (page: Page, variant: 'nav' | 'header' = 'nav') => page.locator(`[data-testid="settings-search-${variant}"][data-ready]`).getByRole('combobox');
const result = (page: Page, id: string) => page.locator(`[data-setting-result="${id}"]`);

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  const dir = process.env.SETTINGS_SEARCH_SHOTS;
  await page.screenshot({ path: dir ? `${dir}/${name}.png` : test.info().outputPath(`${name}.png`) });
}

for (const width of [1280, 390]) {
  test(`"oscuro" encuentra el tema, Enter lleva, baja y lo marca (${width})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 860 });
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    const box = search(page);
    await expect(box).toBeVisible();
    await box.fill('oscuro');
    const theme = result(page, 'appearance-theme');
    await expect(theme).toBeVisible();
    // Primer resultado, con el área y las migas.
    await expect(page.locator('[data-setting-result]').first()).toHaveAttribute('data-setting-result', 'appearance-theme');
    await expect(theme).toContainText('Theme');
    await expect(theme).toContainText('Settings › Appearance');
    await expect(theme).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeHidden();
    await noHorizontalScroll(page, `results ${width}`);
    await shot(page, `settings-search-results-${width}`);

    await box.press('Enter');
    await expect(page).toHaveURL(/\/en\/app\/settings\/appearance$/, { timeout: 60_000 });
    await expect(page.locator('html')).toHaveAttribute('data-setting-flashed', 'appearance-theme', { timeout: 20_000 });
    const section = page.locator('[data-setting="appearance-theme"]');
    await expect(section).toBeInViewport();
    await shot(page, `settings-search-flash-${width}`);

    // Esc limpia; la lista vuelve.
    const again = search(page);
    await again.fill('zzzzqq');
    await expect(page.getByTestId('settings-search-empty')).toContainText('No settings match “zzzzqq”');
    // Las sugerencias buscan.
    await page.getByTestId('settings-search-empty').getByRole('button', { name: 'webhooks' }).click();
    await expect(result(page, 'api-webhooks')).toBeVisible();
    await again.press('Escape');
    await expect(again).toHaveValue('');
  });
}

test('flechas y Enter en un ajuste de otra pestaña de una app: baja hasta él y lo marca', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
  // "/" enfoca la caja desde la página.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  const box = search(page);
  await expect(box).toBeFocused();
  await page.keyboard.type('keep archived');
  await expect(result(page, 'lines-keep-archived')).toContainText('Lines › Settings › Tickets and SLA');
  const first = await page.locator('[data-setting-result]').first().getAttribute('data-setting-result');
  if (first !== 'lines-keep-archived') {
    // Bajar con flechas hasta el ajuste.
    for (let i = 0; i < 10 && (await result(page, 'lines-keep-archived').getAttribute('aria-selected')) !== 'true'; i++) await box.press('ArrowDown');
  }
  await box.press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/lines\/settings\?tab=tickets$/, { timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('data-setting-flashed', 'lines-keep-archived', { timeout: 20_000 });
  await expect(page.locator('[data-setting="lines-keep-archived"]')).toBeInViewport();

  // La caja de los ajustes de la app encuentra ajustes de la plataforma.
  const header = search(page, 'header');
  await header.fill('2fa');
  await expect(result(page, 'security-mfa')).toBeVisible();
  await header.press('Enter');
  await expect(page).toHaveURL(/\/en\/app\/settings\/security$/, { timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('data-setting-flashed', 'security-mfa', { timeout: 20_000 });
});

test('un member no ve los ajustes de admins; el owner sí', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
  await search(page).fill('invite');
  await expect(result(page, 'members-invite')).toBeVisible();

  const ctx = await memberContext(browser);
  try {
    const mp = await ctx.newPage();
    await mp.goto('/en/app/settings', { waitUntil: 'networkidle' });
    await search(mp).fill('invite');
    // Encuentra lo que sí puede abrir (la lista de miembros), no la invitación de admins.
    await expect(result(mp, 'members-list')).toBeVisible();
    await expect(result(mp, 'members-invite')).toHaveCount(0);
    await search(mp).fill('security log');
    await expect(result(mp, 'security-audit')).toHaveCount(0);
    const index = (await (await mp.request.get('/api/settings/search?locale=en')).json()) as { items: Array<{ id: string }> };
    const ids = index.items.map((i) => i.id);
    expect(ids).toContain('appearance-theme');
    for (const id of ['members-invite', 'members-pending', 'security-workspace', 'workspace-danger', 'admin-feedback']) expect(ids).not.toContain(id);
  } finally {
    await ctx.close();
  }
});

test('⌘K encuentra un ajuste y lo marca', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('input.cmdk-input')).toBeFocused();
  await page.keyboard.type('webhooks');
  // El ajuste (con sus migas), no la sección "Settings: API and webhooks" que la paleta ya tenía.
  const option = page.locator('.cmdk-results [role="option"]', { hasText: 'Settings › API and webhooks' });
  // La paleta busca en el servidor (/api/search): la primera vez en next dev compila.
  await expect(option.first()).toBeVisible({ timeout: 60_000 });
  await option.first().click();
  await expect(page).toHaveURL(/\/en\/app\/settings\/api$/, { timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('data-setting-flashed', 'api-webhooks', { timeout: 20_000 });
});

test('retro oscuro: resultados y marca con los tokens del aspecto', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await memberContext(browser, { dark: true, look: 'retro' });
  const page = await ctx.newPage();
  try {
    await page.goto('/en/app/crm/settings', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-look', 'retro');
    const header = search(page, 'header');
    await header.click();
    await expect(page.getByText('Type a word from a setting, in any language.')).toBeVisible();
    await header.fill('pipelin');
    await expect(result(page, 'crm-pipelines')).toBeVisible();
    await noHorizontalScroll(page, 'retro header');
    await shot(page, 'settings-search-retro-dark-header');
    await header.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-setting-flashed', 'crm-pipelines', { timeout: 20_000 });
    await shot(page, 'settings-search-retro-dark-flash');
    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
    await search(page).fill('tema');
    await expect(result(page, 'appearance-theme')).toBeVisible();
    await noHorizontalScroll(page, 'retro 390');
    await shot(page, 'settings-search-retro-dark-390');
  } finally {
    await ctx.close();
  }
});
