/**
 * Chat: opciones propias de posponer (como las de Intercom). Las crea un admin,
 * con su duración y, si quiere, para un solo equipo. Server-only.
 */
import { getDb } from './db';
import { ChatCollabError, teamBelongsTo } from './chat-collab';

export interface ChatSnoozeOption {
  id: string;
  label: string;
  minutes: number;
  team_id: string | null;
}

export const MAX_SNOOZE_OPTIONS = 20;
export const MAX_SNOOZE_MINUTES = 60 * 24 * 90;

/** Sin `userId`, todas (admin); con él, las generales y las de sus equipos. */
export async function listSnoozeOptions(workspaceId: string, userId: string | null): Promise<ChatSnoozeOption[]> {
  const db = getDb();
  if (userId === null) {
    return (await db.prepare('SELECT id, label, minutes, team_id FROM chat_snooze_options WHERE workspace_id = ? ORDER BY minutes').all(workspaceId)) as ChatSnoozeOption[];
  }
  return (await db
    .prepare(
      `SELECT id, label, minutes, team_id FROM chat_snooze_options
       WHERE workspace_id = ? AND (team_id IS NULL OR team_id IN (SELECT team_id FROM chat_team_members WHERE user_id = ?))
       ORDER BY minutes`,
    )
    .all(workspaceId, userId)) as ChatSnoozeOption[];
}

export async function createSnoozeOption(workspaceId: string, input: Record<string, unknown>): Promise<ChatSnoozeOption> {
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 60) : '';
  const minutes = Number(input.minutes);
  if (!label) throw new ChatCollabError('missing_name');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) throw new ChatCollabError('invalid_input');
  const teamId = typeof input.team_id === 'string' && input.team_id ? input.team_id : null;
  if (teamId && !(await teamBelongsTo(workspaceId, teamId))) throw new ChatCollabError('invalid_input');
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM chat_snooze_options WHERE workspace_id = ?').get(workspaceId)) as { n: number };
  if (Number(n.n) >= MAX_SNOOZE_OPTIONS) throw new ChatCollabError('too_many');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO chat_snooze_options (id, workspace_id, label, minutes, team_id) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, label, minutes, teamId);
  return { id, label, minutes, team_id: teamId };
}

export async function deleteSnoozeOption(workspaceId: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM chat_snooze_options WHERE workspace_id = ? AND id = ?').run(workspaceId, id)).changes > 0;
}
