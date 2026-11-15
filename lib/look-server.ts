/**
 * El aspecto de la interfaz de cada persona (users.look). Server-only.
 * Ver lib/look.ts.
 */
import { getDb } from './db';
import { DEFAULT_LOOK, isLook, type Look } from './look';

export async function getUserLook(userId: string): Promise<Look> {
  const row = (await getDb().prepare('SELECT look FROM users WHERE id = ?').get(userId).catch(() => undefined)) as { look?: string } | undefined;
  return isLook(row?.look) ? row.look : DEFAULT_LOOK;
}

export async function setUserLook(userId: string, look: Look): Promise<void> {
  await getDb().prepare('UPDATE users SET look = ? WHERE id = ?').run(look, userId);
}

/** El aspecto de una fila de users ya leída (SELECT *). */
export function lookOf(row: { look?: string | null } | null | undefined): Look {
  return isLook(row?.look) ? row.look : DEFAULT_LOOK;
}
