/**
 * Groups: log de auditoría por chat. Quién asignó, cerró, cambió etiquetas,
 * renombró, sacó de Groups, exportó, cambió miembros o tickets. Lo escriben
 * las rutas (que saben quién actúa) y nunca rompe la operación que lo origina.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import type { ChatDto } from './groups';

export const AUDIT_ACTIONS = [
  'assigned',
  'unassigned',
  'closed',
  'reopened',
  'labels',
  'renamed',
  'properties',
  'crm_link',
  'agent',
  'flag_cleared',
  'deleted',
  'exported',
  'members',
  'ticket_created',
  'ticket_updated',
  'ticket_deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  id: string;
  chatId: string | null;
  chatName: string;
  actorId: string | null;
  actorKind: string;
  action: AuditAction;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AuditInput {
  chatId: string | null;
  chatName?: string;
  actorId: string | null;
  actorKind?: 'person' | 'api' | 'mcp' | 'flow' | 'system';
  action: AuditAction;
  detail?: Record<string, unknown>;
}

export async function recordAudit(ws: string, input: AuditInput): Promise<void> {
  try {
    await getDb()
      .prepare(
        `INSERT INTO groups_audit (id, user_id, chat_id, chat_name, actor_id, actor_kind, action, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        ws,
        input.chatId,
        (input.chatName ?? '').slice(0, 200),
        input.actorId,
        input.actorKind ?? 'person',
        input.action,
        JSON.stringify(input.detail ?? {}).slice(0, 4000),
        new Date().toISOString(),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[groups] audit failed', (err as Error)?.name ?? 'error');
  }
}

/**
 * Cambios de un PATCH de chat → entradas del log (puro: lo prueban los tests).
 * Compara antes y después para no anotar lo que no cambió.
 */
export function chatChanges(before: ChatDto, after: ChatDto): Array<{ action: AuditAction; detail: Record<string, unknown> }> {
  const out: Array<{ action: AuditAction; detail: Record<string, unknown> }> = [];
  if (before.assignedTo !== after.assignedTo) {
    out.push(after.assignedTo ? { action: 'assigned', detail: { from: before.assignedTo, to: after.assignedTo } } : { action: 'unassigned', detail: { from: before.assignedTo } });
  }
  if (before.status !== after.status) out.push({ action: after.status === 'closed' ? 'closed' : 'reopened', detail: {} });
  const bl = before.labels.map((l) => l.name).sort();
  const al = after.labels.map((l) => l.name).sort();
  if (bl.join('\u0000') !== al.join('\u0000')) {
    out.push({ action: 'labels', detail: { added: al.filter((x) => !bl.includes(x)), removed: bl.filter((x) => !al.includes(x)) } });
  }
  if (before.name !== after.name) out.push({ action: 'renamed', detail: { from: before.name, to: after.name } });
  if (JSON.stringify(before.properties) !== JSON.stringify(after.properties)) out.push({ action: 'properties', detail: {} });
  if (before.crmCompanyId !== after.crmCompanyId || before.crmContactId !== after.crmContactId) {
    out.push({ action: 'crm_link', detail: { companyId: after.crmCompanyId, contactId: after.crmContactId } });
  }
  if (before.agentId !== after.agentId) out.push({ action: 'agent', detail: { agentId: after.agentId } });
  if ((before.flagged || before.awaitingSince) && !after.flagged && !after.awaitingSince) out.push({ action: 'flag_cleared', detail: {} });
  return out;
}

export async function recordChatChanges(
  ws: string,
  actor: { id: string | null; kind?: AuditInput['actorKind'] },
  before: ChatDto,
  after: ChatDto,
): Promise<void> {
  for (const c of chatChanges(before, after)) {
    await recordAudit(ws, { chatId: after.id, chatName: after.name, actorId: actor.id, actorKind: actor.kind, action: c.action, detail: c.detail });
  }
}

export interface AuditQuery {
  chatId?: string;
  action?: string;
  actorId?: string;
  /** Chats visibles (acceso por etiqueta). null = todos. */
  chatIds?: Set<string> | null;
  limit?: number;
}

export async function listAudit(ws: string, q: AuditQuery = {}): Promise<AuditEntry[]> {
  const where = ['user_id = ?'];
  const args: Array<string | number> = [ws];
  if (q.chatId) {
    where.push('chat_id = ?');
    args.push(q.chatId);
  }
  if (q.action && (AUDIT_ACTIONS as readonly string[]).includes(q.action)) {
    where.push('action = ?');
    args.push(q.action);
  }
  if (q.actorId) {
    where.push('actor_id = ?');
    args.push(q.actorId);
  }
  const rows = (await getDb()
    .prepare(`SELECT * FROM groups_audit WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...args, Math.min(Math.max(1, q.limit ?? 100), 500))) as Array<{
    id: string;
    chat_id: string | null;
    chat_name: string;
    actor_id: string | null;
    actor_kind: string;
    action: AuditAction;
    detail: string;
    created_at: string;
  }>;
  return rows
    .filter((r) => !q.chatIds || (r.chat_id && q.chatIds.has(r.chat_id)))
    .map((r) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = JSON.parse(r.detail) as Record<string, unknown>;
      } catch {
        /* vacío */
      }
      return {
        id: r.id,
        chatId: r.chat_id,
        chatName: r.chat_name,
        actorId: r.actor_id,
        actorKind: r.actor_kind,
        action: r.action,
        detail,
        createdAt: r.created_at,
      };
    });
}
