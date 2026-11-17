/**
 * El aspecto de la interfaz de cada persona (users.ui_look). Server-only.
 * Ver lib/look.ts.
 */
import { getDb } from './db';
import { DEFAULT_LOOK, isLook, type Look } from './look';

export async function getUserLook(userId: string): Promise<Look> {
  const row = (await getDb().prepare('SELECT ui_look FROM users WHERE id = ?').get(userId).catch(() => undefined)) as { ui_look?: string | null } | undefined;
  return isLook(row?.ui_look) ? row.ui_look : DEFAULT_LOOK;
}

export async function setUserLook(userId: string, look: Look): Promise<void> {
  await getDb().prepare('UPDATE users SET ui_look = ? WHERE id = ?').run(look, userId);
}

/** El aspecto de una fila de users ya leída (SELECT *). Sin valor guardado, el default. */
export function lookOf(row: { ui_look?: string | null } | null | undefined): Look {
  return isLook(row?.ui_look) ? row.ui_look : DEFAULT_LOOK;
}
