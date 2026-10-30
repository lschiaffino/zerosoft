/**
 * Entrar con un código por email (como Notion, Linear o Slack), para quien no
 * usa Google: la persona pone su email, le llega un código de 6 dígitos y lo
 * pega. Probar que recibe ese email es lo mismo que pide una invitación.
 *
 * - Se guarda el hash del código (email + código), nunca el código.
 * - Vence a los 10 minutos, sirve una vez (compare-and-set sobre used_at) y
 *   aguanta 5 intentos: cada intento suma primero (compare-and-set) y solo
 *   se compara si quedaba cupo, así 50 intentos en paralelo no pasan de 5.
 *   Un código nuevo invalida los anteriores.
 * - Límites por día (UTC) contados por email + IP, para que un tercero desde
 *   su IP no deje sin entrar a otra persona: 15 códigos y 20 intentos
 *   fallidos; además un tope alto por email solo (60 códigos, 100 fallos)
 *   contra un ataque desde muchas IPs. Solo cuenta como fallo un intento
 *   contra un código vigente (adivinar sin código no bloquea a nadie). El
 *   canje también tiene límite por IP.
 * - Pedir código responde igual exista o no la cuenta. Al llegar a un límite
 *   diario el mensaje es el mismo para cualquier email ("demasiados intentos
 *   con este email hoy"): no revela si hay cuenta.
 * - Sin proveedor de email en producción no se ofrece: el código no llegaría.
 *
 * La sesión la emite NextAuth (CredentialsProvider 'email-code' en lib/auth.ts).
 * Server-only.
 */
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { getDb, normalizeEmail } from './db';
import { clientIp, isRateLimited, rateLimit } from './rate-limit';
import { sendEmail, appSender, escapeHtml } from './email';

// Igual que lib/workspace-invites.ts (sin importarlo: lib/auth.ts no arrastra equipos).
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export const EMAIL_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Códigos por día por email + IP, y tope por email solo. */
export const EMAIL_CODE_DAILY_LIMIT = 15;
export const EMAIL_CODE_DAILY_LIMIT_EMAIL = 60;
/** Intentos fallidos (contra un código vigente) por día por email + IP, y tope por email solo. */
export const EMAIL_CODE_DAILY_FAILURES = 20;
export const EMAIL_CODE_DAILY_FAILURES_EMAIL = 100;
/** Canjes por IP cada 15 minutos (el callback de NextAuth no pasa por otra ruta con límite). */
export const EMAIL_CODE_VERIFY_PER_IP = 30;
const DAY_SEC = 86_400;
const sendKey = (email: string, ip: string) => `auth:email-code:day:${email}:${ip}`;
const sendEmailKey = (email: string) => `auth:email-code:day:${email}`;
const failKey = (email: string, ip: string) => `auth:email-code:fail:${email}:${ip}`;
const failEmailKey = (email: string) => `auth:email-code:fail:${email}`;

/** ¿Este email (desde esta IP, o desde demasiadas) llegó al tope de fallos del día? */
export async function emailLoginLocked(email: string, ip = 'unknown'): Promise<boolean> {
  return (
    (await isRateLimited(failKey(email, ip), EMAIL_CODE_DAILY_FAILURES, DAY_SEC)) ||
    (await isRateLimited(failEmailKey(email), EMAIL_CODE_DAILY_FAILURES_EMAIL, DAY_SEC))
  );
}

async function countFailure(email: string, ip: string): Promise<void> {
  await rateLimit(failKey(email, ip), EMAIL_CODE_DAILY_FAILURES, DAY_SEC);
  await rateLimit(failEmailKey(email), EMAIL_CODE_DAILY_FAILURES_EMAIL, DAY_SEC);
}

/** IP de una request de NextAuth (authorize recibe los headers como objeto). */
export function ipFromHeaders(headers: Record<string, unknown> | Headers | undefined | null): string {
  try {
    const h = new Headers();
    if (headers instanceof Headers) headers.forEach((v, k) => h.set(k, v));
    else for (const [k, v] of Object.entries(headers ?? {})) if (typeof v === 'string') h.set(k, v);
    return clientIp(new Request('http://localhost/', { headers: h }));
  } catch {
    return 'unknown';
  }
}

type Lang = 'en' | 'es' | 'pt';

/** ¿Se ofrece entrar por email? Solo si el código puede llegar (Resend) o fuera de producción (dev y e2e capturan el email). */
export function emailLoginEnabled(): boolean {
  if (process.env.EMAIL_LOGIN_DISABLED === 'true') return false;
  return Boolean(process.env.RESEND_API_KEY) || process.env.NODE_ENV !== 'production' || Boolean(process.env.EMAIL_CAPTURE_FILE && !process.env.VERCEL);
}

export function normalizeLoginEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = normalizeEmail(raw);
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`email-login|${email}|${code}`).digest('hex');
}

const COPY: Record<Lang, { subject: string; heading: string; line: string; expires: string; ignore: string }> = {
  en: {
    subject: 'Your zerosoft code: {code}',
    heading: 'Your sign-in code',
    line: 'Enter this code to sign in to zerosoft as {email}:',
    expires: 'It works once and expires in 10 minutes.',
    ignore: "If you didn't ask for it, you can ignore this email. Nobody can sign in without the code.",
  },
  es: {
    subject: 'Tu código de zerosoft: {code}',
    heading: 'Tu código para entrar',
    line: 'Ingresá este código para entrar a zerosoft como {email}:',
    expires: 'Sirve una sola vez y vence en 10 minutos.',
    ignore: 'Si no lo pediste, podés ignorar este email. Nadie entra sin el código.',
  },
  pt: {
    subject: 'Seu código do zerosoft: {code}',
    heading: 'Seu código para entrar',
    line: 'Digite este código para entrar no zerosoft como {email}:',
    expires: 'Funciona uma vez e vence em 10 minutos.',
    ignore: 'Se você não pediu, pode ignorar este email. Ninguém entra sem o código.',
  },
};

const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

/** Asunto, texto y HTML del email con el código (puro, para testear). */
export function renderLoginCodeEmail(email: string, code: string, locale?: string | null): { subject: string; text: string; html: string } {
  const l: Lang = locale === 'es' || locale === 'pt' ? locale : 'en';
  const c = COPY[l];
  const fill = (s: string) => s.replace('{code}', code).replace('{email}', email);
  const subject = fill(c.subject);
  const text = [c.heading, '', fill(c.line), '', code, '', c.expires, c.ignore].join('\n');
  const p = (s: string, extra = '') => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#111111;${extra}">${s}</p>`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;font-family:${MONO};">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#888888;">zerosoft</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:500;color:#000000;border-bottom:2px solid #000000;display:inline-block;padding-bottom:6px;">${escapeHtml(c.heading)}</h1>
    ${p(escapeHtml(fill(c.line)))}
    <p style="margin:16px 0 24px;font-size:28px;letter-spacing:0.3em;color:#000000;">${escapeHtml(code)}</p>
    ${p(escapeHtml(c.expires), 'font-size:12px;color:#666666;')}
    ${p(escapeHtml(c.ignore), 'font-size:12px;color:#666666;')}
    <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:11px;color:#999999;">zerosoft.ai</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Crea un código para `email` (invalida los anteriores) y lo manda. Devuelve
 * ok:false solo si el proveedor de email falló.
 */
export async function sendLoginCode(
  email: string,
  locale?: string | null,
  ip = 'unknown',
  now = Date.now(),
): Promise<{ ok: boolean; sent: boolean; error?: 'daily_limit' | 'send_failed' | string }> {
  // Tope del día: el mismo mensaje para cualquier email (no revela si hay cuenta).
  if (await emailLoginLocked(email, ip)) return { ok: false, sent: false, error: 'daily_limit' };
  if (!(await rateLimit(sendKey(email, ip), EMAIL_CODE_DAILY_LIMIT, DAY_SEC)).ok) return { ok: false, sent: false, error: 'daily_limit' };
  if (!(await rateLimit(sendEmailKey(email), EMAIL_CODE_DAILY_LIMIT_EMAIL, DAY_SEC)).ok) return { ok: false, sent: false, error: 'daily_limit' };
  const db = getDb();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.prepare('DELETE FROM email_login_codes WHERE email = ? OR expires_at < ?').run(email, new Date(now - 60 * 60_000).toISOString());
  await db
    .prepare('INSERT INTO email_login_codes (code_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashCode(email, code), email, new Date(now).toISOString(), new Date(now + EMAIL_CODE_TTL_MS).toISOString());
  const { subject, text, html } = renderLoginCodeEmail(email, code, locale);
  const res = await sendEmail({ to: email, subject, text, html, from: appSender() });
  return res.ok ? { ok: true, sent: true } : { ok: false, sent: false, error: res.error ?? 'send_failed' };
}

export type VerifyResult = { ok: true; email: string } | { ok: false; error: 'invalid' | 'daily_limit' | 'rate_limited' };

/**
 * Canjea el código. Primero reclama un intento (attempts + 1 solo si
 * quedaba cupo) y solo entonces compara. Solo un intento contra un código
 * vigente cuenta como fallo del día; sin código vigente no suma nada.
 */
export async function verifyLoginCode(rawEmail: unknown, rawCode: unknown, ip = 'unknown', now = Date.now()): Promise<VerifyResult> {
  if (!(await rateLimit(`auth:email-code:verify:${ip}`, EMAIL_CODE_VERIFY_PER_IP, 900)).ok) return { ok: false, error: 'rate_limited' };
  const email = normalizeLoginEmail(rawEmail);
  const code = typeof rawCode === 'string' ? rawCode.replace(/\D/g, '') : '';
  if (!email || code.length !== 6) return { ok: false, error: 'invalid' };
  if (await emailLoginLocked(email, ip)) return { ok: false, error: 'daily_limit' };
  const db = getDb();
  const nowIso = new Date(now).toISOString();
  const row = (await db
    .prepare(
      `UPDATE email_login_codes SET attempts = attempts + 1
       WHERE code_hash = (SELECT code_hash FROM email_login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1)
         AND used_at IS NULL AND attempts < ?
       RETURNING code_hash`,
    )
    .get(email, nowIso, EMAIL_CODE_MAX_ATTEMPTS)) as { code_hash: string } | undefined;
  // Sin código vigente (o sin intentos): no se compara ni se cuenta como fallo.
  if (!row) return { ok: false, error: 'invalid' };
  const want = Buffer.from(row.code_hash, 'hex');
  const got = Buffer.from(hashCode(email, code), 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    await countFailure(email, ip);
    return { ok: false, error: 'invalid' };
  }
  const claim = await db.prepare('UPDATE email_login_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').run(nowIso, row.code_hash);
  return claim.changes > 0 ? { ok: true, email } : { ok: false, error: 'invalid' };
}
