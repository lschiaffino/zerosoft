import { createClient } from '@libsql/client';
import { createHmac } from 'crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Ajustes › Seguridad de punta a punta: activar la verificación en dos pasos con un código
 * real del autenticador, ver los códigos de recuperación, exigirla en el workspace, ver el
 * registro y bajarlo en CSV; un member sin dos pasos queda frenado hasta activarla.
 * Claro, oscuro y 390px.
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

async function as(browser: Browser, email: string, opts: { width?: number; dark?: boolean } = {}): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width ?? 1280, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

function totp(secretB32: string, step = Math.floor(Date.now() / 1000 / 30)): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32.replace(/\s/g, '')) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function onboard(email: string) {
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [email]);
}

test('dos pasos, exigencia en el workspace y registro', async ({ browser }) => {
  const ownerEmail = `sec-owner-${uid()}@sec-e2e.io`;
  const owner = await as(browser, ownerEmail);
  const p = await owner.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await onboard(ownerEmail);
    await p.goto('/en/app/settings/security', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('mfa-off')).toBeVisible();

    // Alta: QR y clave, un código equivocado avisa, el correcto activa.
    await p.getByTestId('mfa-start').click();
    await expect(p.getByTestId('mfa-setup')).toBeVisible();
    await expect(p.locator('.st-mfa-qr svg')).toBeVisible();
    const secret = (await p.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await p.locator('#mfa-confirm-input').fill('000000');
    await p.getByRole('button', { name: 'Turn on' }).click();
    await expect(p.locator('#mfa-confirm-error')).toBeVisible();
    await p.locator('#mfa-confirm-input').fill(totp(secret));
    await p.getByRole('button', { name: 'Turn on' }).click();
    const codes = p.getByTestId('recovery-codes');
    await expect(codes).toBeVisible();
    expect((await codes.locator('pre').innerText()).trim().split('\n')).toHaveLength(10);
    await p.getByRole('button', { name: 'I saved them' }).click();
    await expect(p.getByTestId('mfa-on')).toBeVisible();
    await expect(p.getByTestId('mfa-on')).toContainText('10 recovery codes left');

    // El secreto quedó cifrado en la base.
    const row = (await sql('SELECT mfa_secret FROM users WHERE email = ?', [ownerEmail]))[0];
    expect(String(row.mfa_secret)).not.toContain(secret);

    // Exigirla en el workspace: queda en el registro.
    await p.getByTestId('require-mfa').check();
    await expect(p.getByTestId('require-mfa')).toBeChecked();
    await p.reload({ waitUntil: 'networkidle' });
    await expect(p.getByTestId('require-mfa')).toBeChecked();
    const log = p.getByTestId('security-events').first();
    await expect(log).toContainText('Two-step requirement changed');
    await expect(log).toContainText('Two-step verification on');

    // A 390px el registro se lee como tarjetas: sin cabecera visible ni scroll lateral.
    await p.setViewportSize({ width: 390, height: 900 });
    await expect(p.locator('.st-events thead').first()).toHaveCSS('position', 'absolute');
    const wrapOverflow = await log.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(wrapOverflow).toBeLessThanOrEqual(0);
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.setViewportSize({ width: 1280, height: 900 });

    // CSV del registro.
    const csv = await p.request.get('/api/account/audit?format=csv');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('workspace.require_mfa');

    // Apagarla pide un código y, con la exigencia prendida, no se puede.
    await p.getByTestId('mfa-disable-open').click();
    await p.locator('#mfa-disable-input').fill(totp(secret, Math.floor(Date.now() / 1000 / 30) + 1));
    await p.locator('[data-testid="mfa-disable"] button[type="submit"]').click();
    await expect(p.locator('#mfa-disable-error')).toContainText('requires two-step verification');

    // Un member sin dos pasos no entra al workspace: lo manda a activarla.
    const team = (await sql('SELECT t.id FROM teams t JOIN users u ON u.id = t.owner_id WHERE u.email = ? LIMIT 1', [ownerEmail]))[0];
    const memberEmail = `sec-member-${uid()}@sec-e2e.io`;
    const token = `sec${uid()}${uid()}${uid()}`;
    const ownerId = String((await sql('SELECT id FROM users WHERE email = ?', [ownerEmail]))[0].id);
    await sql(
      "INSERT INTO team_invites (id, team_id, email, token, invited_by, role, apps, expires_at) VALUES (?, ?, ?, ?, ?, 'member', '*', datetime('now', '+3 days'))",
      [`is-${uid()}`, String(team.id), memberEmail, token, ownerId],
    );
    const member = await as(browser, memberEmail, { width: 390 });
    const m = await member.newPage();
    await m.goto(`/en/invite/${token}`, { waitUntil: 'networkidle' });
    await m.getByRole('button', { name: /^Join/ }).click();
    await m.waitForURL(/\/app\/welcome/);
    await onboard(memberEmail);
    await m.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await m.waitForURL(/\/app\/settings\/security/);
    await expect(m.getByTestId('mfa-required')).toBeVisible();
    await expect(m.getByTestId('mfa-off')).toBeVisible();
    expect(await overflow(m)).toBeLessThanOrEqual(0);
    // La activa desde ahí mismo y vuelve a entrar al workspace.
    await m.getByTestId('mfa-start').click();
    const memberSecret = (await m.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
    await m.locator('#mfa-confirm-input').fill(totp(memberSecret));
    await m.getByRole('button', { name: 'Turn on' }).click();
    await expect(m.getByTestId('recovery-codes')).toBeVisible();
    await m.getByRole('button', { name: 'I saved them' }).click();
    await expect(m.getByTestId('mfa-on')).toBeVisible();
    await m.goto('/en/app/docs', { waitUntil: 'networkidle' });
    expect(m.url()).toContain('/app/docs');
    await member.close();
  } finally {
    await owner.close();
  }
});

test('Ajustes › Seguridad en oscuro y a 390px', async ({ browser }) => {
  const email = `sec-dark-${uid()}@sec-e2e.io`;
  const ctx = await as(browser, email, { width: 390, dark: true });
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await onboard(email);
    await p.goto('/en/app/settings/security', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('security-settings')).toBeVisible();
    await p.getByTestId('mfa-start').click();
    await expect(p.getByTestId('mfa-setup')).toBeVisible();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.keyboard.press('Tab');
    await p.screenshot({ path: test.info().outputPath('security-dark-390.png'), fullPage: true });
  } finally {
    await ctx.close();
  }
});
