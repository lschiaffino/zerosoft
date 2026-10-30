import fs from 'fs';
import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Migrar un equipo, de punta a punta: el owner (usuario demo) invita desde
 * Ajustes › Miembros con apps limitadas (CRM y Docs), la invitada abre el
 * link SIN sesión, entra con un código por email (no usa Google), acepta,
 * pasa el onboarding corto en portugués y cae en el workspace solo con sus
 * apps, viendo a sus compañeros. Una persona que ya tenía cuenta se suma con
 * su link y cambia de workspace. Reenviar y revocar desde la lista.
 *
 * Los emails se leen del archivo de captura (EMAIL_CAPTURE_FILE en
 * playwright.config.ts); zs_e2e_as=session usa la sesión real de NextAuth.
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

function mailsTo(email: string): Array<{ subject: string; text: string }> {
  const file = process.env.E2E_MAIL_FILE!;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
    .filter((m) => m.to === email);
}

async function lastMail(email: string, match: RegExp): Promise<{ subject: string; text: string }> {
  let found: { subject: string; text: string } | undefined;
  await expect.poll(() => (found = mailsTo(email).filter((m) => match.test(m.subject)).pop()) !== undefined).toBe(true);
  return found!;
}

async function context(browser: Browser, as: string, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, ...opts });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: as, url: baseURL }]);
  return ctx;
}

test('invitar con apps limitadas, entrar sin Google con un código por email y sumarse al workspace', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const marta = `marta-${uid()}@outlook-e2e.io`;
  const olga = `olga-${uid()}@acme-e2e.io`;
  const rita = `rita-${uid()}@acme-e2e.io`;
  const team = String((await sql("SELECT name FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].name);
  // Olga ya usa zerosoft (cuenta terminada) antes de que la inviten.
  const olgaCtx = await context(browser, olga);
  const olgaPage = await olgaCtx.newPage();
  await olgaPage.goto('/en/app/welcome', { waitUntil: 'networkidle' });
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = 'Olga Old' WHERE email = ?", [olga]);

  const martaCtx = await context(browser, 'session', { locale: 'pt-BR' });
  try {
    // 1. El owner invita: Member, solo CRM y Docs (quitar "Todas" deja marcadas las 29 apps; se desmarcan las demás).
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await page.getByLabel('Emails').fill(`${marta}, ${olga}, ${rita}`);
    const form = page.locator('form.ws-invite');
    await form.getByLabel('All apps', { exact: true }).uncheck();
    for (const box of await form.locator('input[type=checkbox][id^="ws-inv-app"]').all()) {
      const label = (await page.locator(`label[for="${await box.getAttribute('id')}"]`).innerText()).trim();
      if (label !== 'All apps' && label !== 'CRM' && label !== 'Docs' && (await box.isChecked())) await box.uncheck();
    }
    await page.getByRole('button', { name: 'Send invitations' }).click();
    await expect(page.getByTestId('invite-result')).toHaveCount(3);

    // Pendientes: se reenvía y se revoca sin recargar.
    const ritaRow = page.getByRole('row').filter({ hasText: rita });
    await expect(ritaRow).toBeVisible();
    const before = mailsTo(rita).length;
    await ritaRow.getByRole('button', { name: 'Resend' }).click();
    await expect.poll(() => mailsTo(rita).length).toBe(before + 1);
    await ritaRow.getByRole('button', { name: 'Revoke' }).click();
    const confirm = page.getByRole('alertdialog');
    if (await confirm.count()) await confirm.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('row').filter({ hasText: rita })).toHaveCount(0);

    // 2. El email de invitación: link, asunto y las apps que le tocan.
    const invite = await lastMail(marta, /invited you to/);
    expect(invite.subject).toContain(`invited you to ${team} on zerosoft`);
    expect(invite.text).toContain('You will use CRM and Docs with the rest of the team.');
    const link = /(http:\/\/\S+\/invite\/[\w-]+)/.exec(invite.text)![1];
    const ritaLink = /(http:\/\/\S+\/invite\/[\w-]+)/.exec((await lastMail(rita, /invited you to/)).text)![1];

    // 3. Marta abre el link sin sesión (390px, oscuro): Google o un código por email.
    const m = await martaCtx.newPage();
    // Con la página del owner abierta, esta tiene que estar al frente para que el foco sea real.
    await m.bringToFront();
    await m.setViewportSize({ width: 390, height: 844 });
    await m.emulateMedia({ colorScheme: 'dark' });
    await m.goto(new URL(ritaLink).pathname, { waitUntil: 'networkidle' });
    await expect(m.getByRole('heading', { name: 'This invitation no longer works' })).toBeVisible();
    await m.goto(new URL(link).pathname.replace('/en/', '/pt/'), { waitUntil: 'networkidle' });
    await expect(m.getByRole('heading', { name: `Entre em ${team}` })).toBeVisible();
    await expect(m.getByText('Você vai usar CRM e Docs com o resto da equipe.')).toBeVisible();
    await expect(m.getByRole('button', { name: 'Continuar com o Google' })).toBeVisible();
    await expect(m.getByLabel('Email de trabalho')).toHaveValue(marta);
    expect(await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await m.getByRole('button', { name: 'Me envie um código' }).click();
    // El foco pasa al campo del código.
    await expect(m.getByLabel('Código')).toBeFocused();
    const codeMail = await lastMail(marta, /Seu código do zerosoft/);
    const code = /\b(\d{6})\b/.exec(codeMail.text)![1];
    // Un código equivocado lo dice; Enter confirma.
    await m.getByLabel('Código').fill(code === '000000' ? '111111' : '000000');
    await m.keyboard.press('Enter');
    await expect(m.locator('.auth-email .ui-error')).toContainText('O código está errado ou venceu');
    await m.getByLabel('Código').fill(code);
    await m.keyboard.press('Enter');
    // Ya con sesión, la misma página ofrece sumarse.
    await m.getByRole('button', { name: `Entrar em ${team}` }).click();
    await m.waitForURL(/\/pt\/app\/welcome\?invited=1/);
    // Onboarding corto (nombre, idioma y zona), no el de una cuenta nueva.
    await expect(m.getByRole('heading', { name: `Boas-vindas a ${team}` })).toBeVisible();
    await expect(m.getByText('Com a minha equipe')).toHaveCount(0);
    await m.getByLabel('Seu nome').fill('Marta Mail');
    await m.getByRole('button', { name: `Ir para ${team}` }).click();
    await m.waitForURL(/\/pt\/app$/);
    await expect(m.getByTestId('workspace-switcher')).toContainText(team);
    // Solo sus apps: CRM sí, Track no (vuelve al inicio con aviso).
    await m.goto('/pt/app/track', { waitUntil: 'networkidle' });
    await expect(m).toHaveURL(/\/pt\/app\?blocked=track/);
    await m.goto('/pt/app/crm', { waitUntil: 'networkidle' });
    await expect(m).toHaveURL(/\/pt\/app\/crm/);
    // Ve a sus compañeros.
    await m.goto('/pt/app/settings/members', { waitUntil: 'networkidle' });
    await expect(m.getByTestId('member-row').filter({ hasText: 'demo@zerosoft.ai' })).toBeVisible();
    const row = (await sql("SELECT u.locale, u.onboarded_at, m.apps FROM users u JOIN team_members m ON m.user_id = u.id AND m.role = 'member' WHERE u.email = ?", [marta]))[0];
    expect(row.locale).toBe('pt');
    expect(row.onboarded_at).toBeTruthy();
    expect(JSON.parse(String(row.apps)).sort()).toEqual(['crm', 'docs']);
    // El código ya se usó: no sirve dos veces.
    expect(String((await sql('SELECT used_at FROM email_login_codes WHERE email = ?', [marta]))[0].used_at)).toBeTruthy();

    // 4. Olga (ya tenía cuenta) se suma con su link y tiene los dos workspaces.
    const olgaLink = /(http:\/\/\S+\/invite\/[\w-]+)/.exec((await lastMail(olga, /invited you to/)).text)![1];
    await olgaPage.goto(new URL(olgaLink).pathname, { waitUntil: 'networkidle' });
    await olgaPage.getByRole('button', { name: `Join ${team}` }).click();
    await olgaPage.waitForURL(/\/en\/app$/);
    await olgaPage.getByTestId('workspace-switcher').click();
    await expect(olgaPage.getByTestId('workspace-entry')).toHaveCount(2);
    await olgaPage.keyboard.press('Escape');
  } finally {
    await martaCtx.close();
    await olgaCtx.close();
    for (const email of [marta, olga]) {
      await sql("DELETE FROM team_members WHERE user_id = (SELECT id FROM users WHERE email = ?)", [email]);
      await sql('UPDATE users SET active_team_id = NULL WHERE email = ?', [email]);
    }
  }
});

test('la página de entrar ofrece Google y código por email', async ({ browser }) => {
  const ctx = await context(browser, 'session');
  const p = await ctx.newPage();
  try {
    await p.goto('/es/auth/signin', { waitUntil: 'networkidle' });
    await expect(p.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    await p.getByLabel('Email de trabajo').fill('no-es-un-email');
    await p.getByRole('button', { name: 'Mandame un código' }).click();
    await expect(p.locator('.auth-email .ui-error')).toContainText('Eso no parece un email');
    const email = `nuevo-${uid()}@fastmail-e2e.io`;
    await p.getByLabel('Email de trabajo').fill(email);
    await p.keyboard.press('Enter');
    const code = /\b(\d{6})\b/.exec((await lastMail(email, /Tu código de zerosoft/)).text)![1];
    await p.getByLabel('Código').fill(code);
    await p.keyboard.press('Enter');
    // Cuenta nueva: el onboarding completo.
    await p.waitForURL(/\/es\/app\/welcome/);
    await expect(p.getByRole('heading', { name: '¿Cómo vas a usar zerosoft?' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
