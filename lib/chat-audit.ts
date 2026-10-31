/**
 * Chat — registro de auditoría del workspace: quién exportó conversaciones
 * (y con qué alcance) y quién tocó equipos o mensajes salientes. Lo leen los
 * admins (GET /api/chat/audit). Escribir nunca rompe la acción original.
 * Server-only.
 */
import { getDb } from './db';

export type ChatAuditAction =
  | 'export.csv'
  | 'campaign.created'
  | 'visitor.opt_in'
  | 'campaign.sent'
  | 'import.done'
  | 'routing.updated'
  | 'widget.access'
  | 'export.json'
  | 'team.created'
  | 'team.updated'
  | 'team.deleted'
  | 'outbound.created'
  | 'outbound.updated'
  | 'outbound.deleted';

export interface ChatAuditEntry {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  action: ChatAuditAction;
  detail: string;
  ip: string | null;
  created_at: string;
}

export async function recordChatAudit(
  workspaceId: string,
  actorId: string | null,
  action: ChatAuditAction,
  detail: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  try {
    await getDb()
      .prepare('INSERT INTO chat_audit_log (id, workspace_id, actor_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), workspaceId, actorId, action, JSON.stringify(detail).slice(0, 2000), ip?.slice(0, 64) ?? null, new Date().toISOString());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[chat] audit failed', (err as Error)?.name ?? 'error');
  }
}

export async function listChatAudit(workspaceId: string, limit = 100): Promise<ChatAuditEntry[]> {
  return (await getDb()
    .prepare('SELECT * FROM chat_audit_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, Math.min(Math.max(limit, 1), 500))) as ChatAuditEntry[];
}
