/**
 * Chat — API pública (v1) y webhooks del inbox. Server-only.
 *
 * - La API v1 ve las conversaciones de los widgets del workspace de la key
 *   (los personales y los del team del workspace).
 * - Webhooks: chat.message.created (mensajes del visitante, del equipo y del
 *   bot; las notas internas no salen), chat.conversation.assigned (cambia el
 *   agente asignado, también a nadie) y chat.conversation.resolved. Los emite
 *   lib/chat-data.ts desde las funciones por donde pasa todo cambio, así salen
 *   igual desde el inbox, la API, las reglas de asignación y el bot.
 */
import { getDb, type ChatConversationRow, type ChatMessageRow } from './db';
import type { WebhookEvent } from './webhooks-events';

export interface ApiChatConversation {
  id: string;
  widgetId: string;
  status: ChatConversationRow['status'];
  priority: ChatConversationRow['priority'];
  subject: string | null;
  assignedTo: string | null;
  visitor: { id: string; name: string | null; email: string | null };
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiChatMessage {
  id: string;
  conversationId: string;
  senderType: ChatMessageRow['sender_type'];
  userId: string | null;
  body: string;
  isNote: boolean;
  attachments: unknown[];
  createdAt: string;
}

type ConversationWithVisitor = ChatConversationRow & { visitor_name?: string | null; visitor_email?: string | null };

export function toApiConversation(c: ConversationWithVisitor): ApiChatConversation {
  return {
    id: c.id,
    widgetId: c.widget_id,
    status: c.status,
    priority: c.priority,
    subject: c.subject,
    assignedTo: c.assigned_to,
    visitor: { id: c.visitor_id, name: c.visitor_name ?? null, email: c.visitor_email ?? null },
    firstResponseAt: c.first_response_at,
    resolvedAt: c.resolved_at,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export function toApiMessage(m: ChatMessageRow): ApiChatMessage {
  let attachments: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(m.attachments || '[]');
    if (Array.isArray(parsed)) attachments = parsed;
  } catch {
    attachments = [];
  }
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderType: m.sender_type,
    userId: m.user_id,
    body: m.body,
    isNote: m.is_note === 1,
    attachments,
    createdAt: m.created_at,
  };
}

/** Widgets del workspace: los suyos y los de su team. */
export async function workspaceWidgetIds(workspaceId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM chat_widgets
       WHERE user_id = ? OR team_id IN (SELECT id FROM teams WHERE owner_id = ?)`,
    )
    .all(workspaceId, workspaceId)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

const CONVERSATION_SQL = `SELECT c.*, v.name AS visitor_name, v.email AS visitor_email
  FROM chat_conversations c JOIN chat_visitors v ON v.id = c.visitor_id`;

/** Conversación del workspace (null si no existe o es de otro). */
export async function getWorkspaceConversation(workspaceId: string, id: string): Promise<ConversationWithVisitor | null> {
  const row = (await getDb()
    .prepare(
      `${CONVERSATION_SQL}
       WHERE c.id = ? AND c.widget_id IN (
         SELECT id FROM chat_widgets WHERE user_id = ? OR team_id IN (SELECT id FROM teams WHERE owner_id = ?)
       )`,
    )
    .get(id, workspaceId, workspaceId)) as ConversationWithVisitor | undefined;
  return row ?? null;
}

/** Workspace dueño de la conversación (el user_id de su widget). */
async function conversationWorkspace(conversationId: string): Promise<{ workspaceId: string; row: ConversationWithVisitor } | null> {
  const row = (await getDb()
    .prepare(`SELECT c.*, v.name AS visitor_name, v.email AS visitor_email, w.user_id AS workspace_id
      FROM chat_conversations c JOIN chat_visitors v ON v.id = c.visitor_id JOIN chat_widgets w ON w.id = c.widget_id
      WHERE c.id = ?`)
    .get(conversationId)) as (ConversationWithVisitor & { workspace_id: string }) | undefined;
  return row ? { workspaceId: row.workspace_id, row } : null;
}

export type ChatWebhookEvent = Extract<WebhookEvent, `chat.${string}`>;

/**
 * Emite un evento de chat a los webhooks del workspace. Nunca tira: un
 * webhook no puede romper la respuesta ni la asignación que lo originó.
 */
export async function emitChatEvent(
  conversationId: string,
  event: ChatWebhookEvent,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const found = await conversationWorkspace(conversationId);
    if (!found) return;
    const { emitWebhook } = await import('./webhooks');
    await emitWebhook(found.workspaceId, event, { conversation: toApiConversation(found.row), ...extra });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[chat] webhook emit failed', err);
  }
}

/** Después de un UPDATE de la conversación: avisa asignación y resolución si cambiaron. */
export async function emitConversationChanges(
  before: Pick<ChatConversationRow, 'id' | 'status' | 'assigned_to'>,
  after: Pick<ChatConversationRow, 'status' | 'assigned_to'>,
): Promise<void> {
  if ((before.assigned_to ?? null) !== (after.assigned_to ?? null)) {
    await emitChatEvent(before.id, 'chat.conversation.assigned', { previousAssignedTo: before.assigned_to ?? null });
  }
  if (after.status === 'resolved' && before.status !== 'resolved') {
    await emitChatEvent(before.id, 'chat.conversation.resolved');
  }
}
