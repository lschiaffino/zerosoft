import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, getUserByEmail, upsertUser } from '@/lib/db';
import { EMAIL_CODE_DAILY_FAILURES, EMAIL_CODE_DAILY_LIMIT, EMAIL_CODE_MAX_ATTEMPTS, emailLoginLocked, normalizeLoginEmail, renderLoginCodeEmail, sendLoginCode, verifyLoginCode } from '@/lib/email-login';
import { renderInviteEmail } from '@/lib/invite-email';
import { describeApps } from '@/lib/app-access-label';
import { APP_SWITCHER_ORDER } from '@/lib/products';
import { POST as requestCode } from '@/app/api/auth/email-code/route';

/** Código vigente de un email, leído del texto del email "mandado" (sin Resend va a la consola). */
async function codeFor(email: string, locale = 'en'): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await sendLoginCode(email, locale);
    const text = log.mock.calls.map((c) => String(c[0])).join('\n');
    return /\b(\d{6})\b/.exec(text)![1];
  } finally {
    log.mockRestore();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);

describe('login con código por email', () => {
  it('normaliza el email y rechaza lo que no es un email', () => {
    expect(normalizeLoginEmail('  Ana@Empresa.COM ')).toBe('ana@empresa.com');
    expect(normalizeLoginEmail('ana')).toBeNull();
    expect(normalizeLoginEmail('a b@x.com')).toBeNull();
    expect(normalizeLoginEmail(42)).toBeNull();
  });

  it('el código sirve una vez, para ese email, y no se guarda en claro', async () => {
    const email = `ana-${uid()}@empresa.io`;
    const code = await codeFor(email);
    const rows = (await getDb().prepare('SELECT code_hash FROM email_login_codes WHERE email = ?').all(email)) as Array<{ code_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(code);
    expect(await verifyLoginCode(`otra-${uid()}@empresa.io`, code)).toBeNull();
    expect(await verifyLoginCode(email.toUpperCase(), code.split('').join(' '))).toBe(email);
    expect(await verifyLoginCode(email, code)).toBeNull();
  });

  it('un código nuevo invalida el anterior y vence a los 10 minutos', async () => {
    const email = `leo-${uid()}@empresa.io`;
    const first = await codeFor(email);
    const second = await codeFor(email);
    if (first !== second) expect(await verifyLoginCode(email, first)).toBeNull();
    expect(await verifyLoginCode(email, second, Date.now() + 11 * 60_000)).toBeNull();
    expect(await verifyLoginCode(email, second)).toBe(email);
  });

  it('a los 5 intentos fallidos el código deja de servir', async () => {
    const email = `mia-${uid()}@empresa.io`;
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) expect(await verifyLoginCode(email, wrong)).toBeNull();
    expect(await verifyLoginCode(email, code)).toBeNull();
  });

  it('50 intentos equivocados en paralelo: attempts queda en 5 y el código correcto ya no sirve', async () => {
    const email = `par-${uid()}@empresa.io`;
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await Promise.all(Array.from({ length: 50 }, () => verifyLoginCode(email, wrong)));
    expect(results.every((r) => r === null)).toBe(true);
    const row = (await getDb().prepare('SELECT attempts FROM email_login_codes WHERE email = ?').get(email)) as { attempts: number };
    expect(Number(row.attempts)).toBe(EMAIL_CODE_MAX_ATTEMPTS);
    expect(await verifyLoginCode(email, code)).toBeNull();
  });

  it('como mucho 15 códigos por día por email; después no se manda nada pero la respuesta es la misma', async () => {
    const email = `day-${uid()}@empresa.io`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (let i = 0; i < EMAIL_CODE_DAILY_LIMIT; i++) expect(await sendLoginCode(email)).toEqual({ ok: true, sent: true });
      expect(await sendLoginCode(email)).toEqual({ ok: true, sent: false });
    } finally {
      log.mockRestore();
    }
  });

  it('20 intentos fallidos en el día bloquean el email: ni códigos nuevos ni canjes', async () => {
    const email = `lock-${uid()}@empresa.io`;
    for (let round = 0; round < EMAIL_CODE_DAILY_FAILURES / EMAIL_CODE_MAX_ATTEMPTS; round++) {
      const code = await codeFor(email);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) await verifyLoginCode(email, wrong);
    }
    expect(await emailLoginLocked(email)).toBe(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await sendLoginCode(email)).toEqual({ ok: true, sent: false });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
    // Aun con un código vigente en la base, el canje se niega mientras dure el bloqueo.
    const fresh = '123456';
    const { createHash } = await import('crypto');
    await getDb()
      .prepare('INSERT INTO email_login_codes (code_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(createHash('sha256').update(`email-login|${email}|${fresh}`).digest('hex'), email, new Date().toISOString(), new Date(Date.now() + 600_000).toISOString());
    expect(await verifyLoginCode(email, fresh)).toBeNull();
  });

  it('la cuenta se encuentra sin importar mayúsculas (no se duplica)', async () => {
    const id = `u-${uid()}`;
    const mixed = `Ana.${id}@Empresa.IO`;
    // Una fila vieja con mayúsculas (antes no se normalizaba).
    await getDb().prepare('INSERT INTO users (id, email, handle) VALUES (?, ?, ?)').run(id, mixed, id);
    expect((await getUserByEmail(mixed.toLowerCase()))?.id).toBe(id);
    expect((await getUserByEmail(`  ${mixed.toUpperCase()} `))?.id).toBe(id);
    const again = await upsertUser({ email: mixed.toLowerCase(), name: 'Ana' });
    expect(again.id).toBe(id);
    const count = (await getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE lower(email) = ?').get(mixed.toLowerCase())) as { n: number };
    expect(Number(count.n)).toBe(1);
    // Las cuentas nuevas se guardan normalizadas.
    const fresh = await upsertUser({ email: `  Leo.${id}@X.COM ` });
    expect(fresh.email).toBe(`leo.${id}@x.com`);
    expect(normalizeLoginEmail('Ana@E\u0301xito.com'.normalize('NFD'))).toBe('ana@éxito.com'.normalize('NFC'));
  });

  it('el email del código está en en, es y pt', () => {
    expect(renderLoginCodeEmail('a@x.com', '123456', 'es').subject).toBe('Tu código de zerosoft: 123456');
    expect(renderLoginCodeEmail('a@x.com', '123456', 'pt').subject).toBe('Seu código do zerosoft: 123456');
    const en = renderLoginCodeEmail('a@x.com', '123456', 'fr');
    expect(en.subject).toBe('Your zerosoft code: 123456');
    expect(en.text).toContain('a@x.com');
    expect(en.html).toContain('123456');
  });

  it('la ruta valida el email y limita los pedidos por email', async () => {
    const post = (body: unknown) =>
      requestCode(new NextRequest('http://localhost/api/auth/email-code', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.1` } }));
    expect((await post({ email: 'nope' })).status).toBe(400);
    const email = `rate-${uid()}@empresa.io`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (let i = 0; i < 5; i++) expect((await post({ email, locale: 'es' })).status).toBe(200);
      expect((await post({ email })).status).toBe(429);
    } finally {
      log.mockRestore();
    }
  });
});

describe('email de invitación con apps limitadas', () => {
  it('dice a qué apps entra en vez de "las mismas apps"', () => {
    const base = { to: 'leo@x.com', url: 'https://zerosoft.ai/es/invite/abc', workspaceName: 'Acme', inviterName: 'Fer', expiresAt: null };
    const limited = renderInviteEmail({ ...base, role: 'member', locale: 'es', apps: ['CRM', 'Docs'] });
    expect(limited.text).toContain('Vas a usar CRM y Docs con el resto del equipo.');
    expect(limited.text).not.toContain('las mismas apps');
    const all = renderInviteEmail({ ...base, role: 'member', locale: 'en' });
    expect(all.text).toContain('the same apps and data');
    const admin = renderInviteEmail({ ...base, role: 'admin', locale: 'pt', apps: ['Track'] });
    expect(admin.text).toContain('Você entra como admin');
    expect(admin.text).toContain('Você vai usar Track com o resto da equipe.');
  });

  it('con la mayoría de las apps nombra las que faltan', () => {
    expect(describeApps('*')).toEqual({ kind: 'all' });
    expect(describeApps([...APP_SWITCHER_ORDER])).toEqual({ kind: 'all' });
    expect(describeApps(['crm', 'docs'])).toEqual({ kind: 'list', names: ['CRM', 'Docs'] });
    expect(describeApps(APP_SWITCHER_ORDER.filter((k) => k !== 'track'))).toEqual({ kind: 'except', names: ['Track'] });
    const base = { to: 'leo@x.com', url: 'https://zerosoft.ai/es/invite/abc', workspaceName: 'Acme', inviterName: 'Fer', expiresAt: null };
    expect(renderInviteEmail({ ...base, role: 'member', locale: 'es', appsExcept: ['Track'] }).text).toContain('Vas a usar todas las apps menos Track, con el resto del equipo.');
  });
});
