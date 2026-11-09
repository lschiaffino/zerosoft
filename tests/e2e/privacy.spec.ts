import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Tus datos: descargar el ZIP, pedir el borrado de la cuenta (se confirma tipeando el email),
 * ver el aviso con la fecha y cancelarlo; lo mismo con el workspace desde Ajustes › Workspace.
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

async function as(browser: Browser, email: string, width = 1280): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

test('exportar, pedir el borrado de la cuenta y cancelarlo', async ({ browser }) => {
  const email = `priv-${uid()}@privacy-e2e.io`;
  const ctx = await as(browser, email);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
    await p.goto('/en/app/settings', { waitUntil: 'networkidle' });

    const zip = await p.request.get('/api/account/export');
    expect(zip.status()).toBe(200);
    expect(zip.headers()['content-type']).toContain('application/zip');
    expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');

    await p.getByTestId('account-delete').click();
    const confirm = p.getByTestId('delete-confirm');
    await expect(confirm).toBeDisabled();
    await p.getByTestId('delete-confirm-input').fill('otro@ejemplo.com');
    await expect(confirm).toBeDisabled();
    // Esc cierra sin pedir nada.
    await p.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await p.getByTestId('account-delete').click();
    await p.getByTestId('delete-confirm-input').fill(email.toUpperCase());
    await p.getByTestId('delete-confirm').click();
    await p.waitForURL((u) => !u.pathname.includes('/settings'));

    const row = (await sql("SELECT kind, due_at FROM privacy_erasures e JOIN users u ON u.id = e.user_id WHERE u.email = ? AND e.cancelled_at IS NULL", [email]))[0];
    expect(row.kind).toBe('account');
    const days = (Date.parse(String(row.due_at)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);

    await p.goto('/en/app/settings', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('erasure-pending')).toBeVisible();
    await expect(p.getByTestId('account-delete')).toHaveCount(0);
    await p.getByTestId('erasure-cancel').click();
    await expect(p.getByTestId('erasure-pending')).toHaveCount(0);
    await expect(p.getByTestId('account-delete')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('borrar el workspace se pide desde Ajustes › Workspace y se puede cancelar (390px)', async ({ browser }) => {
  const email = `privws-${uid()}@privacy-e2e.io`;
  const ctx = await as(browser, email, 390);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
    const name = String((await sql('SELECT t.name FROM teams t JOIN users u ON u.id = t.owner_id WHERE u.email = ?', [email]))[0].name);
    await p.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
    await p.getByTestId('workspace-delete').click();
    await p.getByTestId('delete-confirm-input').fill(name);
    await p.getByTestId('delete-confirm').click();
    await expect(p.getByTestId('erasure-pending')).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await p.getByTestId('erasure-cancel').click();
    await expect(p.getByTestId('workspace-delete')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
