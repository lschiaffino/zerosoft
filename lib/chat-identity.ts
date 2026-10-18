/**
 * Chat — verificación de identidad del visitante (como el user_hash de
 * Intercom). El sitio que embebe el widget firma el email de la persona
 * logueada con el secreto del widget:
 *
 *   userHash = HMAC-SHA256(secret, email en minúsculas), en hex
 *
 * y lo pasa con window.zsChat.identify({ email, name, userHash }). Solo un
 * email con firma válida queda como verificado; el resto es declarado y no
 * pisa una identidad verificada ni se asocia solo a un contacto del CRM.
 * Server-only.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';

const HASH_RE = /^[0-9a-f]{64}$/i;

export function visitorIdentityHash(secret: string, email: string): string {
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex');
}

export async function getWidgetIdentitySecret(widgetId: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT secret FROM chat_widget_secrets WHERE widget_id = ?').get(widgetId)) as
    | { secret: string }
    | undefined;
  return row?.secret ?? null;
}

/** Genera un secreto nuevo (o lo reemplaza): las firmas hechas con el anterior dejan de valer. */
export async function rotateWidgetIdentitySecret(widgetId: string): Promise<string> {
  const secret = `zsid_${randomBytes(32).toString('hex')}`;
  await getDb()
    .prepare(
      `INSERT INTO chat_widget_secrets (widget_id, secret, created_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(widget_id) DO UPDATE SET secret = excluded.secret, created_at = excluded.created_at`,
    )
    .run(widgetId, secret);
  return secret;
}

/** Apaga la verificación: ningún email nuevo del widget queda como verificado. */
export async function deleteWidgetIdentitySecret(widgetId: string): Promise<void> {
  await getDb().prepare('DELETE FROM chat_widget_secrets WHERE widget_id = ?').run(widgetId);
}

/** true solo si el widget tiene secreto y `hash` es la firma de `email` con ese secreto. */
export async function verifyVisitorIdentity(widgetId: string, email: string | null, hash: unknown): Promise<boolean> {
  if (!email || typeof hash !== 'string' || !HASH_RE.test(hash)) return false;
  const secret = await getWidgetIdentitySecret(widgetId);
  if (!secret) return false;
  const expected = Buffer.from(visitorIdentityHash(secret, email), 'hex');
  const given = Buffer.from(hash.toLowerCase(), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
