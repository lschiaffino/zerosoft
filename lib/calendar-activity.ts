/**
 * Cal — registro de actividad del workspace (como el Activity log de
 * Calendly): quién creó, cambió o borró tipos de evento, encuestas y
 * horarios, quién canceló, movió o agendó reservas, cambios de ajustes,
 * conexiones y borrados de datos de invitados. Lo ven los admins en
 * Cal › Ajustes › Actividad. Se guardan los últimos MAX_ACTIVITY por
 * workspace. Nunca guarda secretos; los emails de invitados borrados quedan
 * enmascarados. Server-only.
 */
import { getDb, getUserById } from './db';

export const MAX_ACTIVITY = 5000;

export const ACTIVITY_GROUPS = ['event_type', 'booking', 'poll', 'schedule', 'settings', 'integration', 'privacy'] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export interface ActivityTarget {
  type: string;
  id?: string;
  /** Nombre visible (título del evento, invitado, proveedor). */
  summary?: string;
}

/** Persona real detrás de la sesión (la que actúa en el workspace de otro, o el dueño). */
export function actorIdOf(user: { id: string; actingUser?: { id: string } | null }): string {
  return user.actingUser?.id ?? user.id;
}

/** Registra una acción; nunca rompe a quien llama. */
export async function logCalActivity(workspaceId: string, actorId: string | null, action: string, target: ActivityTarget): Promise<void> {
  try {
    const db = getDb();
    await db
      .prepare(
        'INSERT INTO calendar_activity (id, user_id, actor_id, action, target_type, target_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        crypto.randomUUID(),
        workspaceId,
        actorId,
        action.slice(0, 64),
        target.type.slice(0, 32),
        (target.id ?? '').slice(0, 64),
        (target.summary ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200),
        new Date().toISOString(),
      );
    // Se poda de vez en cuando (1 de cada 50) para no contar en cada escritura.
    if (Math.random() < 0.02) {
      await db
        .prepare(
          `DELETE FROM calendar_activity WHERE user_id = ? AND id NOT IN (
             SELECT id FROM calendar_activity WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`,
        )
        .run(workspaceId, workspaceId, MAX_ACTIVITY);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cal:activity]', err);
  }
}

export interface ActivityEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
  actor: { id: string | null; name: string };
}

/** Grupo de una acción ("booking.cancelled" → booking). */
export function activityGroup(action: string): string {
  return action.split('.')[0] ?? '';
}

export async function listCalActivity(
  workspaceId: string,
  opts: { group?: string; limit?: number; before?: string } = {},
): Promise<ActivityEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where = ['user_id = ?'];
  const args: (string | number)[] = [workspaceId];
  if (opts.group && (ACTIVITY_GROUPS as readonly string[]).includes(opts.group)) {
    where.push('action LIKE ?');
    args.push(`${opts.group}.%`);
  }
  if (opts.before) {
    where.push('created_at < ?');
    args.push(opts.before);
  }
  const rows = (await getDb()
    .prepare(`SELECT * FROM calendar_activity WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, limit)) as Array<{
    id: string;
    actor_id: string | null;
    action: string;
    target_type: string;
    target_id: string;
    summary: string;
    created_at: string;
  }>;
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.actor_id && !names.has(r.actor_id)) {
      const u = await getUserById(r.actor_id);
      names.set(r.actor_id, u?.name || u?.email || '');
    }
  }
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    summary: r.summary,
    createdAt: r.created_at,
    actor: { id: r.actor_id, name: r.actor_id ? (names.get(r.actor_id) ?? '') : '' },
  }));
}

/** a***@dominio.com: para dejar rastro de un borrado sin guardar el dato. */
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().toLowerCase().split('@');
  if (!user || !domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}
