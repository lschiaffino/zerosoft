/**
 * Preferencias de email (Ajustes › Avisos) y bajas sin sesión.
 *
 * Solo afectan a los emails de ciclo de vida (lib/lifecycle). Los
 * transaccionales (códigos de ingreso, invitaciones, reservas, avisos de
 * Track) siguen saliendo igual.
 *
 * El link de baja lleva un token firmado (HMAC con NEXTAUTH_SECRET) con la
 * persona y la categoría ('all' = todas): abrirlo muestra una confirmación y
 * el POST (o el one-click de List-Unsubscribe-Post) la aplica.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db';
import { DEFAULT_PREFS, isLifecycleCategory, LIFECYCLE_CATEGORIES, type EmailPrefs, type LifecycleCategory } from './types';

export type UnsubscribeScope = LifecycleCategory | 'all';

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'zerosoft-lifecycle';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(`lifecycle-unsub|${payload}`).digest('base64url').slice(0, 32);
}

/** Token de baja: <userId>.<scope>.<firma>, en base64url para que viaje bien en la URL. */
export function unsubscribeToken(userId: string, scope: UnsubscribeScope): string {
  const payload = `${userId}|${scope}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function parseUnsubscribeToken(token: unknown): { userId: string; scope: UnsubscribeScope } | null {
  if (typeof token !== 'string' || token.length > 400) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const [userId, scope] = payload.split('|');
  if (!userId || !(scope === 'all' || isLifecycleCategory(scope))) return null;
  return { userId, scope };
}

function parseOptedOut(raw: unknown): LifecycleCategory[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.filter(isLifecycleCategory) : [];
  } catch {
    return [];
  }
}

export async function getEmailPrefs(userId: string): Promise<EmailPrefs> {
  const row = (await getDb()
    .prepare('SELECT unsubscribed_all, opted_out, digest FROM email_preferences WHERE user_id = ?')
    .get(userId)
    .catch(() => undefined)) as { unsubscribed_all: number; opted_out: string; digest: number } | undefined;
  if (!row) return { ...DEFAULT_PREFS, optedOut: [] };
  return { unsubscribedAll: row.unsubscribed_all === 1, optedOut: parseOptedOut(row.opted_out), digest: row.digest === 1 };
}

export async function saveEmailPrefs(userId: string, prefs: EmailPrefs): Promise<EmailPrefs> {
  const optedOut = LIFECYCLE_CATEGORIES.filter((c) => prefs.optedOut.includes(c));
  const clean: EmailPrefs = { unsubscribedAll: !!prefs.unsubscribedAll, optedOut, digest: !!prefs.digest };
  await getDb()
    .prepare(
      `INSERT INTO email_preferences (user_id, unsubscribed_all, opted_out, digest, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET unsubscribed_all = excluded.unsubscribed_all, opted_out = excluded.opted_out,
         digest = excluded.digest, updated_at = excluded.updated_at`,
    )
    .run(userId, clean.unsubscribedAll ? 1 : 0, JSON.stringify(clean.optedOut), clean.digest ? 1 : 0, new Date().toISOString());
  return clean;
}

/** Aplica una baja (link del email o one-click). Idempotente. */
export async function applyUnsubscribe(userId: string, scope: UnsubscribeScope): Promise<EmailPrefs | null> {
  const exists = await getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!exists) return null;
  const current = await getEmailPrefs(userId);
  if (scope === 'all') return saveEmailPrefs(userId, { ...current, unsubscribedAll: true });
  const optedOut = current.optedOut.includes(scope) ? current.optedOut : [...current.optedOut, scope];
  return saveEmailPrefs(userId, { ...current, optedOut, digest: scope === 'digest' ? false : current.digest });
}
