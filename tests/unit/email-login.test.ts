import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, getUserByEmail, upsertUser } from '@/lib/db';
import { EMAIL_CODE_DAILY_FAILURES, EMAIL_CODE_DAILY_LIMIT, EMAIL_CODE_DAILY_LIMIT_EMAIL, EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_VERIFY_PER_IP, emailLoginLocked, normalizeLoginEmail, renderLoginCodeEmail, sendLoginCode, verifyLoginCode } from '@/lib/email-login';
import { renderInviteEmail } from '@/lib/invite-email';
import { describeApps } from '@/lib/app-access-label';
import { APP_SWITCHER_ORDER } from '@/lib/products';
import { POST as requestCode } from '@/app/api/auth/email-code/route';
import { authOptions } from '@/lib/auth';

const uid = () => Math.random().toString(36).slice(2, 8);
/** Una IP propia por test: los límites por IP no se pisan entre tests. */
const newIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Manda un código y lo lee del email "mandado" (sin Resend va a la consola). */
async function codeFor(email: string, ip: string, locale = 'en'): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const res = await sendLoginCode(email, locale, ip);
    expect(res).toEqual({ ok: true, sent: true });
    const text = log.mock.calls.map((c) => String(c[0])).join('\n');
    return /\b(\d{6})\b/.exec(text)![1];
  } finally {
    log.mockRestore();
  }
}

const emailOf = (r: Awaited<ReturnType<typeof verifyLoginCode>>) => (r.ok ? r.email : null);
const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

describe('login con código por email', () => {
  it('normaliza el email y rechaza lo que no es un email', () => {
    expect(normalizeLoginEmail('  Ana@Empresa.COM ')).toBe('ana@empresa.com');
    expect(normalizeLoginEmail('ana')).toBeNull();
    expect(normalizeLoginEmail('a b@x.com')).toBeNull();
    expect(normalizeLoginEmail(42)).toBeNull();
  });

  it('el código sirve una vez, para ese email, y no se guarda en claro', async () => {
    const ip = newIp();
    const email = `ana-${uid()}@empresa.io`;
    const code = await codeFor(email, ip);
    const rows = (await getDb().prepare('SELECT code_hash FROM email_login_codes WHERE email = ?').all(email)) as Array<{ code_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(code);
    expect(emailOf(await verifyLoginCode(`otra-${uid()}@empresa.io`, code, ip))).toBeNull();
    expect(emailOf(await verifyLoginCode(email.toUpperCase(), code.split('').join(' '), ip))).toBe(email);
    expect(emailOf(await verifyLoginCode(email, code, ip))).toBeNull();
  });

  it('un código nuevo invalida el anterior y vence a los 10 minutos', async () => {
    const ip = newIp();
    const email = `leo-${uid()}@empresa.io`;
    const first = await codeFor(email, ip);
    const second = await codeFor(email, ip);
    if (first !== second) expect(emailOf(await verifyLoginCode(email, first, ip))).toBeNull();
    expect(emailOf(await verifyLoginCode(email, second, ip, Date.now() + 11 * 60_000))).toBeNull();
    expect(emailOf(await verifyLoginCode(email, second, ip))).toBe(email);
  });

  it('a los 5 intentos fallidos el código deja de servir', async () => {
    const ip = newIp();
    const email = `mia-${uid()}@empresa.io`;
    const code = await codeFor(email, ip);
    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) expect(emailOf(await verifyLoginCode(email, wrongOf(code), ip))).toBeNull();
    expect(emailOf(await verifyLoginCode(email, code, ip))).toBeNull();
  });

  it('50 intentos equivocados en paralelo (desde varias IPs): attempts queda en 5 y el código correcto ya no sirve', async () => {
    const email = `par-${uid()}@empresa.io`;
    const code = await codeFor(email, newIp());
    const ips = Array.from({ length: 5 }, newIp);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => verifyLoginCode(email, wrongOf(code), ips[i % 5])));
    expect(results.every((r) => !r.ok)).toBe(true);
    const row = (await getDb().prepare('SELECT attempts FROM email_login_codes WHERE email = ?').get(email)) as { attempts: number };
    expect(Number(row.attempts)).toBe(EMAIL_CODE_MAX_ATTEMPTS);
    expect(emailOf(await verifyLoginCode(email, code, newIp()))).toBeNull();
  });

  it('el canje tiene límite por IP', async () => {
    const ip = newIp();
    const email = `ipl-${uid()}@empresa.io`;
    for (let i = 0; i < EMAIL_CODE_VERIFY_PER_IP; i++) await verifyLoginCode(email, '000000', ip);
    expect(await verifyLoginCode(email, '000000', ip)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('ataque: 20 canjes falsos sin código vigente no bloquean a la persona', async () => {
    const email = `victima-${uid()}@empresa.io`;
    const attacker = newIp();
    for (let i = 0; i < 25; i++) expect(await verifyLoginCode(email, '000000', attacker)).toEqual({ ok: false, error: 'invalid' });
    expect(await emailLoginLocked(email, attacker)).toBe(false);
    // La persona, desde su IP, pide un código y entra.
    const mine = newIp();
    const code = await codeFor(email, mine);
    expect(emailOf(await verifyLoginCode(email, code, mine))).toBe(email);
  });

  it('ataque: fallos contra un código vigente desde otra IP bloquean esa IP, no a la persona', async () => {
    const email = `victima2-${uid()}@empresa.io`;
    const attacker = newIp();
    for (let round = 0; round < EMAIL_CODE_DAILY_FAILURES / EMAIL_CODE_MAX_ATTEMPTS; round++) {
      const code = await codeFor(email, attacker);
      for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) await verifyLoginCode(email, wrongOf(code), attacker);
    }
    expect(await emailLoginLocked(email, attacker)).toBe(true);
    expect(await sendLoginCode(email, 'en', attacker)).toEqual({ ok: false, sent: false, error: 'daily_limit' });
    const mine = newIp();
    expect(await emailLoginLocked(email, mine)).toBe(false);
    const code = await codeFor(email, mine);
    expect(emailOf(await verifyLoginCode(email, code, mine))).toBe(email);
  });

  it('tope diario de envíos por email + IP, y uno más alto por email solo', async () => {
    const email = `day-${uid()}@empresa.io`;
    const ip = newIp();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (let i = 0; i < EMAIL_CODE_DAILY_LIMIT; i++) expect(await sendLoginCode(email, 'en', ip)).toEqual({ ok: true, sent: true });
      expect(await sendLoginCode(email, 'en', ip)).toEqual({ ok: false, sent: false, error: 'daily_limit' });
      // Desde otra IP sigue pudiendo, hasta el tope por email.
      let sent = EMAIL_CODE_DAILY_LIMIT;
      while (sent < EMAIL_CODE_DAILY_LIMIT_EMAIL) {
        const other = newIp();
        for (let i = 0; i < EMAIL_CODE_DAILY_LIMIT && sent < EMAIL_CODE_DAILY_LIMIT_EMAIL; i++, sent++) expect((await sendLoginCode(email, 'en', other)).sent).toBe(true);
      }
      expect(await sendLoginCode(email, 'en', newIp())).toEqual({ ok: false, sent: false, error: 'daily_limit' });
    } finally {
      log.mockRestore();
    }
  });

  it('la cuenta se encuentra sin importar mayúsculas ni la forma Unicode (no se duplica)', async () => {
    const id = `u-${uid()}`;
    const mixed = `Ana.${id}@Empresa.IO`;
    // Una fila vieja con mayúsculas y sin email_norm (antes no se normalizaba).
    await getDb().prepare('INSERT INTO users (id, email, handle) VALUES (?, ?, ?)').run(id, mixed, id);
    expect((await getUserByEmail(mixed.toLowerCase()))?.id).toBe(id);
    expect((await getUserByEmail(`  ${mixed.toUpperCase()} `))?.id).toBe(id);
    const again = await upsertUser({ email: mixed.toLowerCase(), name: 'Ana' });
    expect(again.id).toBe(id);
    expect(again.email_norm).toBe(mixed.toLowerCase());
    // No ASCII: "ÉLISE" y "élise" (y en NFD) son la misma cuenta; lower() de SQLite no lo ve, email_norm sí.
    const el = await upsertUser({ email: `Élise.${id}@Exito.com` });
    expect(el.email).toBe(`élise.${id}@exito.com`);
    expect((await upsertUser({ email: `ÉLISE.${id}@EXITO.COM` })).id).toBe(el.id);
    expect((await upsertUser({ email: `élise.${id}@exito.com`.normalize('NFD') })).id).toBe(el.id);
    const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE email_norm = ?').get(`élise.${id}@exito.com`)) as { n: number };
    expect(Number(n.n)).toBe(1);
    expect(normalizeLoginEmail('Ana@Éxito.com'.normalize('NFD'))).toBe('ana@éxito.com'.normalize('NFC'));
  });

  it('Google solo entra con el email verificado por Google', async () => {
    const signIn = authOptions.callbacks!.signIn!;
    const user = { id: 'x', email: `g-${uid()}@gmail.com`, name: 'G' };
    const account = { provider: 'google', type: 'oauth', providerAccountId: '1' } as never;
    expect(await signIn({ user, account, profile: { email_verified: false } as never })).toBe(false);
    expect(await signIn({ user, account, profile: {} as never })).toBe(false);
    expect(await signIn({ user, account, profile: { email_verified: true } as never })).toBe(true);
  });

  it('el email del código está en en, es y pt', () => {
    expect(renderLoginCodeEmail('a@x.com', '123456', 'es').subject).toBe('Tu código de zerosoft: 123456');
    expect(renderLoginCodeEmail('a@x.com', '123456', 'pt').subject).toBe('Seu código do zerosoft: 123456');
    const en = renderLoginCodeEmail('a@x.com', '123456', 'fr');
    expect(en.subject).toBe('Your zerosoft code: 123456');
    expect(en.text).toContain('a@x.com');
    expect(en.html).toContain('123456');
  });

  it('la ruta valida el email, limita por email + IP y avisa el tope del día', async () => {
    const ip = newIp();
    const post = (body: unknown, from = ip) =>
      requestCode(new NextRequest('http://localhost/api/auth/email-code', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': from } }));
    expect((await post({ email: 'nope' })).status).toBe(400);
    const email = `rate-${uid()}@empresa.io`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (let i = 0; i < 5; i++) expect((await post({ email, locale: 'es' })).status).toBe(200);
      expect((await post({ email })).status).toBe(429);
      // Otra IP no queda frenada por lo que hizo la primera.
      expect((await post({ email }, newIp())).status).toBe(200);
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
