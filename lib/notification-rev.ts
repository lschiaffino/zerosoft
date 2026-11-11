/**
 * La campana de avisos consulta cada 30 s. Para que "nada cambió" no lea los
 * avisos de la persona, cada cambio en notifications sube una versión por
 * persona (notification_rev, la mantienen triggers: migración 393_fewer_reads)
 * y la respuesta lleva un ETag con esa versión. Si el pedido trae el mismo,
 * sale 304 leyendo una fila.
 *
 * Lo único que cambia la respuesta sin escribir nada es un aviso pospuesto
 * que vuelve: el ETag lleva también cuándo vuelve el próximo, y pasado ese
 * momento deja de valer. Server-only.
 */
import { createHash } from 'crypto';
import { getDb } from './db';

/** La versión de los avisos de la persona (una fila por clave primaria; 0 si nunca tuvo). */
export async function notificationRev(userId: string): Promise<number> {
  const r = (await getDb().prepare('SELECT rev FROM notification_rev WHERE user_id = ?').get(userId)) as { rev: number } | undefined;
  return Number(r?.rev ?? 0);
}

/** Cuándo vuelve el próximo aviso pospuesto (epoch ms; 0 si no hay). Una fila por idx_notifications_snoozed. */
export async function nextSnoozeWake(userId: string, now = new Date()): Promise<number> {
  const r = (await getDb()
    .prepare('SELECT MIN(snoozed_until) AS at FROM notifications WHERE user_id = ? AND snoozed_until > ?')
    .get(userId, now.toISOString())) as { at: string | null } | undefined;
  const at = r?.at ? Date.parse(r.at) : 0;
  return Number.isFinite(at) ? at : 0;
}

/** Lo que distingue un pedido de otro de la misma persona: los filtros y las apps cuyos avisos no ve. */
export function notificationKey(userId: string, search: string, hidePaths: readonly string[]): string {
  return createHash('sha1')
    .update(JSON.stringify([userId, search, [...hidePaths].sort()]))
    .digest('base64url')
    .slice(0, 16);
}

export function notificationTag(rev: number, wakeAt: number, key: string): string {
  return `W/"n${rev}.${wakeAt}.${key}"`;
}

/**
 * ¿Sigue valiendo el ETag que mandó el navegador? Misma versión, mismo pedido
 * y todavía no volvió ningún pospuesto. Pura.
 */
export function notificationTagFresh(sent: string | null, rev: number, key: string, now = Date.now()): boolean {
  if (!sent) return false;
  for (const raw of sent.split(',')) {
    const m = /^W\/"n(\d+)\.(\d+)\.([\w-]+)"$/.exec(raw.trim());
    if (!m) continue;
    const wake = Number(m[2]);
    if (Number(m[1]) === rev && m[3] === key && (wake === 0 || now < wake)) return true;
  }
  return false;
}
