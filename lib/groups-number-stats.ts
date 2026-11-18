/**
 * Lines: lo que la tabla de Ajustes › Números muestra de cada línea además de
 * su estado: cuándo fue el último mensaje (entrante o saliente, sin contenido)
 * y cuántos chats tiene abiertos (sin cerrar, sin archivar y sin eliminar).
 * Cuenta solo los chats que quien mira puede ver (acceso por línea y por
 * etiqueta). Dos consultas agrupadas por línea sobre índices existentes
 * (idx_groups_chats_number_recent e idx_groups_chats_line_list). Server-only.
 */
import { getDb } from './db';
import { chatAccessSql, type GroupsViewer } from './groups-access';

export interface NumberStats {
  /** Hora del último mensaje de la línea; null si todavía no tiene. */
  lastMessageAt: string | null;
  /** Chats abiertos de la línea. */
  openChats: number;
}

export async function numberStats(ws: string, viewer?: GroupsViewer | null): Promise<Map<string, NumberStats>> {
  const db = getDb();
  const access = chatAccessSql(viewer);
  const extra = access ? ` AND ${access.sql}` : '';
  const args = access?.args ?? [];
  const [last, open] = await Promise.all([
    db
      .prepare(`SELECT c.number_id, MAX(c.last_message_at) AS at FROM groups_chats c WHERE c.user_id = ? AND c.hidden_at IS NULL${extra} GROUP BY c.number_id`)
      .all(ws, ...args) as Promise<Array<{ number_id: string; at: string | null }>>,
    db
      .prepare(
        `SELECT c.number_id, COUNT(*) AS n FROM groups_chats c
         WHERE c.user_id = ? AND c.status = 'open' AND c.hidden_at IS NULL AND c.archived_at IS NULL${extra} GROUP BY c.number_id`,
      )
      .all(ws, ...args) as Promise<Array<{ number_id: string; n: number }>>,
  ]);
  const out = new Map<string, NumberStats>();
  const get = (id: string) => out.get(id) ?? out.set(id, { lastMessageAt: null, openChats: 0 }).get(id)!;
  for (const r of last) get(r.number_id).lastMessageAt = r.at ?? null;
  for (const r of open) get(r.number_id).openChats = Number(r.n) || 0;
  return out;
}

/** Las líneas con sus números (las que no tienen chats quedan en cero). */
export async function withNumberStats<T extends { id: string }>(ws: string, viewer: GroupsViewer | null | undefined, numbers: T[]): Promise<Array<T & { stats: NumberStats }>> {
  if (numbers.length === 0) return [];
  const stats = await numberStats(ws, viewer);
  return numbers.map((n) => ({ ...n, stats: stats.get(n.id) ?? { lastMessageAt: null, openChats: 0 } }));
}
