/**
 * Login de la app de escritorio (desktop/) sin Google dentro de una webview.
 *
 * 1. La app abre en el navegador del sistema /api/desktop/login con un
 *    challenge PKCE (S256 del verifier, que nunca sale de la app) y un state.
 * 2. Con sesión en el navegador, la persona confirma y se crea un código de
 *    un solo uso (acá se guarda su hash), atado a ella y al challenge, que
 *    vence en 2 minutos. El navegador vuelve a zerosoft://auth/callback.
 * 3. La app canjea código + verifier en POST /api/desktop/token: se reclama
 *    el código (compare-and-set sobre used_at), se verifica el verifier y se
 *    emite una cookie de sesión de NextAuth (el mismo JWT que el login web).
 *
 * Un código robado sin el verifier no sirve; uno usado o vencido tampoco.
 * Server-only.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { encode } from 'next-auth/jwt';
import { authOptions } from './auth';
import { getDb, getUserById, type UserRow } from './db';

export const DESKTOP_CODE_TTL_MS = 2 * 60_000;
/** Igual que la sesión web (NextAuth, 30 días). */
export const DESKTOP_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = (v: string) => createHash('sha256').update(v).digest();

/** S256 de PKCE: base64url(sha256(verifier)), 43 caracteres. */
export function pkceChallenge(verifier: string): string {
  return b64url(sha256(verifier));
}

export function isValidChallenge(v: unknown): v is string {
  return typeof v === 'string' && B64URL_43.test(v);
}

export function isValidState(v: unknown): v is string {
  return typeof v === 'string' && STATE_RE.test(v);
}

function hashCode(code: string): string {
  return sha256(`desktop-login|${code}`).toString('hex');
}

/** Código nuevo para la persona (id real, no el del dueño del workspace). */
export async function createDesktopLoginCode(userId: string, challenge: string, now = Date.now()): Promise<string> {
  if (!isValidChallenge(challenge)) throw new Error('invalid_challenge');
  const code = b64url(randomBytes(32));
  const db = getDb();
  // Limpieza de lo vencido hace rato (barata: índice por expires_at).
  await db.prepare('DELETE FROM desktop_login_codes WHERE expires_at < ?').run(new Date(now - 60 * 60_000).toISOString());
  await db
    .prepare('INSERT INTO desktop_login_codes (code_hash, user_id, challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashCode(code), userId, challenge, new Date(now).toISOString(), new Date(now + DESKTOP_CODE_TTL_MS).toISOString());
  return code;
}

/**
 * Canjea el código: lo reclama (un solo uso, aunque el verifier no coincida)
 * y devuelve la persona si el verifier es el del challenge. null si no.
 */
export async function exchangeDesktopLoginCode(code: unknown, verifier: unknown, now = Date.now()): Promise<UserRow | null> {
  if (typeof code !== 'string' || !B64URL_43.test(code) || typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return null;
  const db = getDb();
  const hash = hashCode(code);
  const claimed = await db
    .prepare('UPDATE desktop_login_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .run(new Date(now).toISOString(), hash, new Date(now).toISOString());
  if (claimed.changes !== 1) return null;
  const row = (await db.prepare('SELECT user_id, challenge FROM desktop_login_codes WHERE code_hash = ?').get(hash)) as
    | { user_id: string; challenge: string }
    | undefined;
  if (!row) return null;
  const expected = Buffer.from(row.challenge);
  const got = Buffer.from(pkceChallenge(verifier));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return (await getUserById(row.user_id)) ?? null;
}

/** Nombre, dominio y si es segura la cookie de sesión de NextAuth, como la arma lib/auth.ts. */
export function sessionCookieInfo(): { name: string; domain: string | null; secure: boolean } {
  const base = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const secure = base.startsWith('https://');
  const configured = authOptions.cookies?.sessionToken;
  return {
    name: configured?.name ?? `${secure ? '__Secure-' : ''}next-auth.session-token`,
    domain: (configured?.options?.domain as string | undefined) ?? null,
    secure,
  };
}

/** El JWT de sesión de NextAuth para la persona (mismos campos que el login con Google). */
export async function mintSessionToken(user: UserRow): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('missing_secret');
  return encode({
    token: { sub: user.id, uid: user.id, email: user.email, name: user.name ?? null, picture: user.image ?? null },
    secret,
    maxAge: DESKTOP_SESSION_MAX_AGE,
  });
}
