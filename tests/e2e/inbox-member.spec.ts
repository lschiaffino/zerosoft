import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Inbox es personal: un miembro con las apps restringidas (solo CRM) la
 * encuentra igual en el switcher, el sidebar del inicio y ⌘K, y desde la
 * bandeja vacía vincula WhatsApp con QR sin pasar por Ajustes.
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

async function member(browser: Browser, baseURL: string, apps: string): Promise<BrowserContext> {
  // El inicio del demo crea la base y su workspace si esta suite corre sola.
  const demo = await browser.newContext({ baseURL });
  await (await demo.newPage()).goto('/en/app', { waitUntil: 'networkidle' });
  await demo.close();
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `ibm-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  await page.close();
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = 'Ines' WHERE id = ?", [id]);
  await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)", [demoTeam, id, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return ctx;
}

test('un miembro solo con CRM ve Inbox en el switcher, el inicio y ⌘K, y vincula WhatsApp desde la bandeja vacía', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await member(browser, baseURL!, '["crm"]');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    // Switcher: Inbox (trabajo diario) sí; Docs, que no tiene, no.
    await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await page.locator('.band-product').click();
    await expect(page.getByRole('menuitem', { name: /^Inbox/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Docs/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Sidebar del inicio.
    await page.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(page.locator('.side-line').getByRole('link', { name: /^Inbox/ })).toBeVisible();

    // ⌘K.
    await page.keyboard.press('ControlOrMeta+k');
    const search = page.getByRole('dialog', { name: 'Search' });
    await search.getByRole('combobox').fill('Inbox');
    const option = search.getByRole('option', { name: /Open Inbox/ }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(/\/app\/inbox$/);

    // Bandeja vacía: el QR se abre desde acá.
    const cta = page.getByTestId('inbox-empty-qr');
    await expect(cta).toHaveText('Link WhatsApp with QR');
    await cta.click();
    const dialog = page.getByRole('dialog', { name: 'Link WhatsApp' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^Linked|Point your phone/).first()).toBeVisible();
    await expect(dialog.getByText(/^Linked/)).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    // Con la cuenta vinculada, la bandeja deja de pedir que conectes una.
    await expect(cta).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
