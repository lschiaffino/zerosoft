import { getDb } from './db';
import type {
  ChatConversationRow,
  ChatMessageRow,
  ChatVisitorRow,
  ChatWidgetRow,
} from './db';

// ---------- Helpers ----------

function nowIso(): string {
  return new Date().toISOString();
}

function jsonStringify<T>(value: T): string {
  return JSON.stringify(value ?? []);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---------- Widgets ----------

export interface ChatFieldDef {
  id: string;
  name: string;
  required: boolean;
  type: 'text' | 'email' | 'number';
}

export interface WidgetCreatePayload {
  name: string;
  color?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
  fields?: ChatFieldDef[];
}

export interface WidgetUpdatePayload {
  name?: string;
  color?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
  fields?: ChatFieldDef[];
}

export async function listChatWidgets(
  userId: string,
  teamId?: string | null,
): Promise<ChatWidgetRow[]> {
  const db = getDb();
  if (teamId) {
    return (await db
      .prepare('SELECT * FROM chat_widgets WHERE team_id = ? ORDER BY created_at DESC')
      .all(teamId)) as ChatWidgetRow[];
  }
  return (await db
    .prepare('SELECT * FROM chat_widgets WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)) as ChatWidgetRow[];
}

export async function getChatWidget(id: string): Promise<ChatWidgetRow | undefined> {
  return (await getDb().prepare('SELECT * FROM chat_widgets WHERE id = ?').get(id)) as
    | ChatWidgetRow
    | undefined;
}

export async function createChatWidget(
  userId: string,
  teamId: string | null,
  payload: WidgetCreatePayload,
): Promise<ChatWidgetRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO chat_widgets (id, team_id, user_id, name, color, position, welcome_message, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      teamId ?? null,
      userId,
      payload.name.trim(),
      payload.color?.trim() ?? '#000000',
      payload.position ?? 'bottom-right',
      payload.welcomeMessage?.trim() ?? null,
      jsonStringify(payload.fields),
      now,
      now,
    );
  return (await db.prepare('SELECT * FROM chat_widgets WHERE id = ?').get(id)) as ChatWidgetRow;
}

export async function updateChatWidget(
  id: string,
  payload: WidgetUpdatePayload,
): Promise<ChatWidgetRow | undefined> {
  const db = getDb();
  const existing = await getChatWidget(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.color !== undefined) {
    fields.push('color = ?');
    args.push(payload.color.trim());
  }
  if (payload.position !== undefined) {
    fields.push('position = ?');
    args.push(payload.position);
  }
  if (payload.welcomeMessage !== undefined) {
    fields.push('welcome_message = ?');
    args.push(payload.welcomeMessage.trim() ?? null);
  }
  if (payload.fields !== undefined) {
    fields.push('fields = ?');
    args.push(jsonStringify(payload.fields));
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE chat_widgets SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getChatWidget(id);
}

export async function deleteChatWidget(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM chat_widgets WHERE id = ?').run(id);
  return res.changes > 0;
}

// ---------- Visitors ----------

export interface VisitorPayload {
  email?: string | null;
  name?: string | null;
}

export async function getOrCreateChatVisitor(
  widgetId: string,
  externalId: string,
  payload?: VisitorPayload,
): Promise<ChatVisitorRow> {
  const db = getDb();
  const existing = (await db
    .prepare('SELECT * FROM chat_visitors WHERE widget_id = ? AND external_id = ?')
    .get(widgetId, externalId)) as ChatVisitorRow | undefined;

  if (existing) {
    if (payload?.email || payload?.name) {
      await db
        .prepare('UPDATE chat_visitors SET email = COALESCE(?, email), name = COALESCE(?, name) WHERE id = ?')
        .run(payload.email ?? null, payload.name ?? null, existing.id);
      return (await db.prepare('SELECT * FROM chat_visitors WHERE id = ?').get(existing.id)) as ChatVisitorRow;
    }
    return existing;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO chat_visitors (id, widget_id, external_id, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      widgetId,
      externalId,
      payload?.email ?? null,
      payload?.name ?? null,
      nowIso(),
    );
  return (await db.prepare('SELECT * FROM chat_visitors WHERE id = ?').get(id)) as ChatVisitorRow;
}

export async function getChatVisitorByExternalId(
  widgetId: string,
  externalId: string,
): Promise<ChatVisitorRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM chat_visitors WHERE widget_id = ? AND external_id = ?')
    .get(widgetId, externalId)) as ChatVisitorRow | undefined;
}

// ---------- Conversations ----------

export interface ConversationFilters {
  status?: string;
  assigned?: string;
  q?: string;
}

export interface ConversationUpdatePayload {
  status?: 'open' | 'closed' | 'snoozed';
  assignedTo?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  subject?: string;
}

export async function listChatConversations(
  widgetId: string,
  filters: ConversationFilters = {},
): Promise<ChatConversationRow[]> {
  const db = getDb();
  const where: string[] = ['widget_id = ?'];
  const args: Array<string | number> = [widgetId];

  if (filters.status) {
    where.push('status = ?');
    args.push(filters.status);
  }
  if (filters.assigned === 'me') {
    where.push('assigned_to IS NOT NULL');
  } else if (filters.assigned === 'unassigned') {
    where.push('assigned_to IS NULL');
  } else if (filters.assigned) {
    where.push('assigned_to = ?');
    args.push(filters.assigned);
  }
  if (filters.q) {
    where.push('subject LIKE ?');
    args.push(`%${filters.q}%`);
  }

  return (await db
    .prepare(
      `SELECT * FROM chat_conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`,
    )
    .all(...args)) as ChatConversationRow[];
}

export async function getChatConversation(id: string): Promise<ChatConversationRow | undefined> {
  return (await getDb().prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id)) as
    | ChatConversationRow
    | undefined;
}

export async function getOpenConversationByVisitor(
  widgetId: string,
  visitorId: string,
): Promise<ChatConversationRow | undefined> {
  return (await getDb()
    .prepare(
      'SELECT * FROM chat_conversations WHERE widget_id = ? AND visitor_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(widgetId, visitorId, 'open')) as ChatConversationRow | undefined;
}

export async function createChatConversation(
  widgetId: string,
  visitorId: string,
  subject?: string,
): Promise<ChatConversationRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO chat_conversations (id, widget_id, visitor_id, status, priority, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, widgetId, visitorId, 'open', 'normal', subject?.trim() ?? null, now, now);
  return (await db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id)) as ChatConversationRow;
}

export async function updateChatConversation(
  id: string,
  payload: ConversationUpdatePayload,
): Promise<ChatConversationRow | undefined> {
  const db = getDb();
  const existing = await getChatConversation(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.status !== undefined) {
    fields.push('status = ?');
    args.push(payload.status);
  }
  if (payload.assignedTo !== undefined) {
    fields.push('assigned_to = ?');
    args.push(payload.assignedTo ?? null);
  }
  if (payload.priority !== undefined) {
    fields.push('priority = ?');
    args.push(payload.priority);
  }
  if (payload.subject !== undefined) {
    fields.push('subject = ?');
    args.push(payload.subject.trim() ?? null);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE chat_conversations SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getChatConversation(id);
}

export async function touchChatConversation(id: string): Promise<void> {
  await getDb().prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(nowIso(), id);
}

// ---------- Messages ----------

export interface ChatAttachment {
  name: string;
  url: string;
  size: number;
  mime: string;
}

export interface MessageCreatePayload {
  body: string;
  userId?: string | null;
  attachments?: ChatAttachment[];
}

export async function listChatMessages(conversationId: string): Promise<ChatMessageRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .all(conversationId)) as ChatMessageRow[];
}

export async function createChatMessage(
  conversationId: string,
  senderType: 'visitor' | 'user' | 'system',
  payload: MessageCreatePayload,
): Promise<ChatMessageRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO chat_messages (id, conversation_id, sender_type, user_id, body, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      conversationId,
      senderType,
      payload.userId ?? null,
      payload.body,
      jsonStringify(payload.attachments),
      nowIso(),
    );

  await touchChatConversation(conversationId);

  return (await db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)) as ChatMessageRow;
}

// ---------- Public visitor helpers ----------

export interface VisitorConversationWithMessages {
  visitor: ChatVisitorRow;
  conversation: ChatConversationRow | null;
  messages: ChatMessageRow[];
}

export async function getVisitorConversationWithMessages(
  widgetId: string,
  externalId: string,
): Promise<VisitorConversationWithMessages | null> {
  const visitor = await getChatVisitorByExternalId(widgetId, externalId);
  if (!visitor) return null;

  const conversation = await getOpenConversationByVisitor(widgetId, visitor.id);
  const messages = conversation ? await listChatMessages(conversation.id) : [];

  return { visitor, conversation: conversation ?? null, messages };
}
