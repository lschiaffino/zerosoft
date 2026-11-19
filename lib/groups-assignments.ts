/**
 * Lines: historial de asignaciones por chat (groups_assignment_events). Lo
 * escriben la asignación a mano (afterChatChange), la regla automática y la
 * reasignación al desconectarse (lib/groups-inbox.ts). Nunca rompe la
 * operación que lo origina. El acceso al chat lo valida la ruta. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';

export const ASSIGNMENT_REASONS = ['manual', 'auto', 'offline'] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export interface AssignmentEventDto {
  id: string;
  from: string | null;
  to: string | null;
  actorId: string | null;
  reason: AssignmentReason;
  rule: string | null;
  createdAt: string;
}

export interface AssignmentInput {
  chatId: string;
  from: string | null;
  to: string | null;
  actorId: string | null;
  reason: AssignmentReason;
  rule?: string | null;
}

export async function recordAssignment(ws: string, input: AssignmentInput): Promise<void> {
  if ((input.from ?? null) === (input.to ?? null)) return;
  try {
    await getDb()
      .prepare(
        `INSERT INTO groups_assignment_events (id, user_id, chat_id, from_person, to_person, actor_id, reason, rule_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), ws, input.chatId, input.from, input.to, input.actorId, input.reason, input.rule ? input.rule.slice(0, 200) : null, new Date().toISOString());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[groups] assignment history failed', (err as Error)?.name ?? 'error');
  }
}

/** Historial de un chat del workspace, del más nuevo al más viejo. */
export async function listAssignments(ws: string, chatId: string, limit = 100): Promise<AssignmentEventDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, from_person, to_person, actor_id, reason, rule_name, created_at FROM groups_assignment_events
       WHERE user_id = ? AND chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(ws, chatId, Math.min(Math.max(1, limit), 500))) as Array<{
    id: string;
    from_person: string | null;
    to_person: string | null;
    actor_id: string | null;
    reason: AssignmentReason;
    rule_name: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    from: r.from_person,
    to: r.to_person,
    actorId: r.actor_id,
    reason: r.reason,
    rule: r.rule_name,
    createdAt: r.created_at,
  }));
}
