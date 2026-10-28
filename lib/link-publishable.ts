/**
 * Publishable key de Link (como la de Dub): va dentro de la app móvil o del
 * sitio, así que no es secreta y no sirve para la API v1. Solo identifica el
 * workspace en /api/v1/links/track/open (deep linking diferido). Una por
 * workspace; los admins la pueden rotar desde Ajustes › Conversiones.
 * Server-only.
 */
import { customAlphabet } from 'nanoid';
import { getDb } from './db';

export const PUBLISHABLE_PREFIX = 'zs_pk_';
const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 24);
export const PUBLISHABLE_RE = /^zs_pk_[A-Za-z0-9]{24}$/;

export async function getPublishableKey(ws: string, createdBy: string | null = null): Promise<string> {
  const db = getDb();
  const row = (await db.prepare('SELECT key FROM link_publishable_keys WHERE user_id = ?').get(ws)) as { key: string } | undefined;
  if (row) return row.key;
  const key = `${PUBLISHABLE_PREFIX}${nano()}`;
  await db.prepare('INSERT OR IGNORE INTO link_publishable_keys (user_id, key, created_by) VALUES (?, ?, ?)').run(ws, key, createdBy);
  return ((await db.prepare('SELECT key FROM link_publishable_keys WHERE user_id = ?').get(ws)) as { key: string }).key;
}

/** Nueva key: la anterior deja de funcionar al instante. */
export async function rotatePublishableKey(ws: string, createdBy: string | null): Promise<string> {
  const key = `${PUBLISHABLE_PREFIX}${nano()}`;
  await getDb()
    .prepare(
      `INSERT INTO link_publishable_keys (user_id, key, created_by) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET key = excluded.key, created_by = excluded.created_by, created_at = datetime('now')`,
    )
    .run(ws, key, createdBy);
  return key;
}

/** Workspace dueño de la key (null si no existe o no tiene el formato). */
export async function workspaceOfPublishableKey(key: string | null | undefined): Promise<string | null> {
  if (!key || !PUBLISHABLE_RE.test(key)) return null;
  const row = (await getDb().prepare('SELECT user_id FROM link_publishable_keys WHERE key = ?').get(key)) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}
