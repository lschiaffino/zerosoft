/**
 * Baja del email del resumen del día (lib/daily-brief-email.ts) sin sesión: un token firmado (HMAC con el secreto de
 * la sesión, con su propio propósito) con la persona. Va en el link del pie (abre la confirmación en
 * /[locale]/email/unsubscribe) y en List-Unsubscribe con List-Unsubscribe-Post (RFC 8058: el cliente de correo hace
 * el POST de un clic a /api/daily-brief/unsubscribe). Solo apaga el email del resumen (daily_brief_prefs.email);
 * la tarjeta sigue en Lines e Inbox. Server-only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prefijo de estos tokens: no se confunden con los de los emails de ciclo de vida (lib/lifecycle/prefs.ts). */
const PREFIX = 'db1';

/** El secreto de la sesión. En producción sin secreto no hay token (y el email sale sin link de baja de un clic). */
function secret(): string | null {
  const s = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '';
  if (s) return s;
  return process.env.NODE_ENV === 'production' ? null : 'zerosoft-dev-daily-brief';
}

function sign(key: string, userId: string): string {
  return createHmac('sha256', key).update(`daily-brief-unsub|${userId}`).digest('base64url').slice(0, 32);
}

/** Token de baja: db1.<userId en base64url>.<firma>. null si no hay secreto. */
export function briefUnsubscribeToken(userId: string): string | null {
  const key = secret();
  if (!key || !userId) return null;
  return `${PREFIX}.${Buffer.from(userId).toString('base64url')}.${sign(key, userId)}`;
}

/** La persona del token, o null si no es de esta baja, está incompleto o la firma no coincide. */
export function parseBriefUnsubscribeToken(token: unknown): { userId: string } | null {
  if (typeof token !== 'string' || token.length > 400) return null;
  const key = secret();
  if (!key) return null;
  const [prefix, body, sig, ...rest] = token.split('.');
  if (prefix !== PREFIX || !body || !sig || rest.length) return null;
  const userId = Buffer.from(body, 'base64url').toString('utf8');
  if (!userId || userId.length > 200 || /[\p{Cc}|]/u.test(userId)) return null;
  const expected = Buffer.from(sign(key, userId));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return { userId };
}

/** Los links de baja de una persona: la página (pie del email) y el POST de un clic (List-Unsubscribe). */
export function briefUnsubscribeLinks(userId: string, locale: string, origin: string): { pageUrl: string; oneClickUrl: string } | null {
  const token = briefUnsubscribeToken(userId);
  if (!token) return null;
  const t = encodeURIComponent(token);
  return { pageUrl: `${origin}/${locale}/email/unsubscribe?t=${t}`, oneClickUrl: `${origin}/api/daily-brief/unsubscribe?t=${t}` };
}

/** Los encabezados de baja de un clic (RFC 8058) para el email, o ninguno si no hay link. */
export function briefUnsubscribeHeaders(links: { oneClickUrl: string } | null): Record<string, string> {
  return links ? { 'List-Unsubscribe': `<${links.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {};
}
