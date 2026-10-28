/**
 * Chat — conversaciones anteriores del visitante en el widget (el "Messages"
 * del Messenger de Intercom). Ruta pública: solo ve las conversaciones del
 * mismo widget que son de su visitorId; si el sitio firmó la identidad
 * (userHash, lib/chat-identity.ts), también las de su email verificado en
 * otros dispositivos. Nunca las de otro visitante ni otro widget, ni notas
 * internas, mensajes de sistema o borrados. Server-only.
 */
import { getDb } from './db';
import type { ChatConversationRow } from './db';
import { getChatVisitorByExternalId, listChatMessages, toPublicMessage, type PublicChatMessage } from './chat-data';
import { verifyVisitorIdentity } from './chat-identity';

export const HISTORY_LIMIT = 20;

export interface VisitorHistoryItem {
  id: string;
  status: ChatConversationRow['status'];
  subject: string | null;
  last_body: string;
  last_sender: string | null;
  updated_at: string;
  created_at: string;
}

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
}

/** Los visitantes (filas) que son esta persona: su visitorId y, con firma válida, su email verificado. */
export async function historyVisitorIds(
  widgetId: string,
  externalId: string,
  identity: { email?: unknown; userHash?: unknown } = {},
): Promise<string[]> {
  const ids = new Set<string>();
  const own = await getChatVisitorByExternalId(widgetId, externalId);
  if (own) ids.add(own.id);
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase().slice(0, 254) : '';
  if (email && (await verifyVisitorIdentity(widgetId, email, identity.userHash))) {
    const rows = (await getDb()
      .prepare('SELECT id FROM chat_visitors WHERE widget_id = ? AND email_verified = 1 AND lower(email) = ? LIMIT 20')
      .all(widgetId, email)) as Array<{ id: string }>;
    for (const r of rows) ids.add(r.id);
  }
  return [...ids];
}

export async function listVisitorHistory(widgetId: string, visitorIds: string[]): Promise<VisitorHistoryItem[]> {
  if (visitorIds.length === 0) return [];
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.status, c.subject, c.created_at, c.updated_at,
              (SELECT m.body FROM chat_messages m WHERE m.conversation_id = c.id AND m.is_note = 0 AND m.deleted_at IS NULL
                 AND m.sender_type != 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT m.sender_type FROM chat_messages m WHERE m.conversation_id = c.id AND m.is_note = 0 AND m.deleted_at IS NULL
                 AND m.sender_type != 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_sender
       FROM chat_conversations c
       WHERE c.widget_id = ? AND c.visitor_id IN ${inClause(visitorIds.length)}
       ORDER BY c.updated_at DESC LIMIT ${HISTORY_LIMIT}`,
    )
    .all(widgetId, ...visitorIds)) as Array<VisitorHistoryItem & { last_body: string | null }>;
  return rows
    .filter((r) => r.last_body !== null)
    .map((r) => ({ ...r, last_body: String(r.last_body ?? '').slice(0, 140) }));
}

/** Una conversación del historial con sus mensajes públicos, o null si no es de esta persona. */
export async function getVisitorHistoryConversation(
  widgetId: string,
  visitorIds: string[],
  conversationId: string,
): Promise<{ conversation: Pick<ChatConversationRow, 'id' | 'status' | 'subject' | 'created_at'>; messages: PublicChatMessage[] } | null> {
  if (visitorIds.length === 0) return null;
  const c = (await getDb()
    .prepare(`SELECT id, status, subject, created_at FROM chat_conversations WHERE id = ? AND widget_id = ? AND visitor_id IN ${inClause(visitorIds.length)}`)
    .get(conversationId, widgetId, ...visitorIds)) as Pick<ChatConversationRow, 'id' | 'status' | 'subject' | 'created_at'> | undefined;
  if (!c) return null;
  const messages = (await listChatMessages(c.id)).filter((m) => m.sender_type !== 'system').map(toPublicMessage);
  return { conversation: c, messages };
}
