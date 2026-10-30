import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { EMAIL_CODE_MAX_ATTEMPTS, normalizeLoginEmail, renderLoginCodeEmail, sendLoginCode, verifyLoginCode } from '@/lib/email-login';
import { renderInviteEmail } from '@/lib/invite-email';
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
});
