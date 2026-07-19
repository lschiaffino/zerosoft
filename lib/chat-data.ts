import { getDb, getUserById } from './db';
import type {
  ChatAssignmentRuleRow,
  ChatCannedResponseRow,
  ChatConversationRow,
  ChatMessageRow,
  ChatSlaPolicyRow,
  ChatVisitorRow,
  ChatWidgetRow,
  CrmContactRow,
  UserRow,
} from './db';

export type { ChatAssignmentRuleRow, ChatCannedResponseRow, ChatSlaPolicyRow } from './db';

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

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
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

export interface VisitorUpdatePayload {
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VisitorListOptions {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ChatVisitorListRow extends ChatVisitorRow {
  last_conversation_at: string | null;
  conversation_count: number;
}

export interface ChatVisitorWithStats extends ChatVisitorRow {
  conversations: Array<ChatConversationRow & { message_count: number }>;
  total_messages: number;
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

export async function searchChatVisitors(
  widgetIds: string[],
  q: string,
): Promise<ChatVisitorRow[]> {
  if (widgetIds.length === 0 || !q.trim()) return [];
  const like = `%${escapeLike(q.trim())}%`;
  return (await getDb()
    .prepare(
      `SELECT * FROM chat_visitors
       WHERE widget_id IN ${inClause(widgetIds.length)}
         AND (email LIKE ? OR name LIKE ? OR external_id LIKE ?)
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all(...widgetIds, like, like, like)) as ChatVisitorRow[];
}

export async function getChatVisitorCrmContact(
  ownerUserId: string,
  email: string | null,
): Promise<CrmContactRow | undefined> {
  if (!email) return undefined;
  return (await getDb()
    .prepare('SELECT * FROM crm_contacts WHERE user_id = ? AND email = ? COLLATE NOCASE')
    .get(ownerUserId, email.trim().toLowerCase())) as CrmContactRow | undefined;
}

export async function listChatVisitors(
  widgetIds: string[],
  options: VisitorListOptions = {},
): Promise<ChatVisitorListRow[]> {
  if (widgetIds.length === 0) return [];
  const db = getDb();
  const where: string[] = [`v.widget_id IN ${inClause(widgetIds.length)}`];
  const args: Array<string | number> = [...widgetIds];

  if (options.q) {
    where.push('(v.email LIKE ? OR v.name LIKE ?)');
    const like = `%${escapeLike(options.q)}%`;
    args.push(like, like);
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  return (await db
    .prepare(
      `SELECT v.*,
        MAX(c.updated_at) AS last_conversation_at,
        COUNT(c.id) AS conversation_count
       FROM chat_visitors v
       LEFT JOIN chat_conversations c ON c.visitor_id = v.id
       WHERE ${where.join(' AND ')}
       GROUP BY v.id
       ORDER BY last_conversation_at DESC NULLS LAST, v.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)) as ChatVisitorListRow[];
}

export async function countChatVisitors(
  widgetIds: string[],
  options: VisitorListOptions = {},
): Promise<number> {
  if (widgetIds.length === 0) return 0;
  const db = getDb();
  const where: string[] = [`widget_id IN ${inClause(widgetIds.length)}`];
  const args: Array<string | number> = [...widgetIds];

  if (options.q) {
    where.push('(email LIKE ? OR name LIKE ?)');
    const like = `%${escapeLike(options.q)}%`;
    args.push(like, like);
  }

  const row = (await db
    .prepare(`SELECT COUNT(*) AS c FROM chat_visitors WHERE ${where.join(' AND ')}`)
    .get(...args)) as { c: number } | undefined;
  return row?.c ?? 0;
}

export async function getChatVisitor(id: string): Promise<ChatVisitorRow | undefined> {
  return (await getDb().prepare('SELECT * FROM chat_visitors WHERE id = ?').get(id)) as
    | ChatVisitorRow
    | undefined;
}

export async function getChatVisitorWithStats(id: string): Promise<ChatVisitorWithStats | undefined> {
  const db = getDb();
  const visitor = await getChatVisitor(id);
  if (!visitor) return undefined;

  const conversations = (await db
    .prepare(
      `SELECT c.*, COUNT(m.id) AS message_count
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON m.conversation_id = c.id
       WHERE c.visitor_id = ?
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
    )
    .all(id)) as Array<ChatConversationRow & { message_count: number }>;

  const totalMessages = conversations.reduce((sum, c) => sum + (c.message_count ?? 0), 0);

  return { ...visitor, conversations, total_messages: totalMessages };
}

export async function updateChatVisitor(
  id: string,
  payload: VisitorUpdatePayload,
): Promise<ChatVisitorRow | undefined> {
  const db = getDb();
  const existing = await getChatVisitor(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name ?? null);
  }
  if (payload.email !== undefined) {
    fields.push('email = ?');
    args.push(payload.email ? payload.email.trim().toLowerCase() : null);
  }
  if (payload.notes !== undefined) {
    fields.push('notes = ?');
    args.push(payload.notes ?? null);
  }
  if (payload.metadata !== undefined) {
    fields.push('metadata = ?');
    args.push(JSON.stringify(payload.metadata ?? {}));
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE chat_visitors SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getChatVisitor(id);
}

// ---------- Conversations ----------

export interface ConversationListOptions {
  status?: string;
  assignedTo?: string | 'unassigned';
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationUpdatePayload {
  status?: 'open' | 'closed' | 'snoozed';
  assignedTo?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  subject?: string;
}

export interface ChatConversationListRow extends ChatConversationRow {
  visitor_email: string | null;
  visitor_name: string | null;
  visitor_external_id: string;
  last_message_body: string | null;
  assigned_name: string | null;
  assigned_email: string | null;
}

export interface ChatConversationWithVisitor extends ChatConversationRow {
  visitor: ChatVisitorRow;
  widget_name: string;
  widget_user_id: string;
  widget_team_id: string | null;
  widget_color: string;
  assigned_name: string | null;
  assigned_email: string | null;
  assigned_image: string | null;
  crm_contact: CrmContactRow | null;
}

export async function listChatConversations(
  widgetIds: string[],
  options: ConversationListOptions = {},
): Promise<ChatConversationListRow[]> {
  if (widgetIds.length === 0) return [];
  const db = getDb();
  const where: string[] = [`c.widget_id IN ${inClause(widgetIds.length)}`];
  const args: Array<string | number> = [...widgetIds];

  if (options.status) {
    where.push('c.status = ?');
    args.push(options.status);
  }
  if (options.assignedTo === 'unassigned') {
    where.push('c.assigned_to IS NULL');
  } else if (options.assignedTo) {
    where.push('c.assigned_to = ?');
    args.push(options.assignedTo);
  }
  if (options.q) {
    where.push('(c.subject LIKE ? OR v.name LIKE ? OR v.email LIKE ?)');
    const like = `%${escapeLike(options.q)}%`;
    args.push(like, like, like);
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const rows = (await db
    .prepare(
      `SELECT c.*,
        v.email AS visitor_email,
        v.name AS visitor_name,
        v.external_id AS visitor_external_id,
        u.name AS assigned_name,
        u.email AS assigned_email,
        (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_body
       FROM chat_conversations c
       JOIN chat_visitors v ON v.id = c.visitor_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)) as ChatConversationListRow[];

  return rows;
}

export async function countChatConversations(
  widgetIds: string[],
  options: ConversationListOptions = {},
): Promise<number> {
  if (widgetIds.length === 0) return 0;
  const db = getDb();
  const where: string[] = [`c.widget_id IN ${inClause(widgetIds.length)}`];
  const args: Array<string | number> = [...widgetIds];

  if (options.status) {
    where.push('c.status = ?');
    args.push(options.status);
  }
  if (options.assignedTo === 'unassigned') {
    where.push('c.assigned_to IS NULL');
  } else if (options.assignedTo) {
    where.push('c.assigned_to = ?');
    args.push(options.assignedTo);
  }
  if (options.q) {
    where.push('(c.subject LIKE ? OR v.name LIKE ? OR v.email LIKE ?)');
    const like = `%${escapeLike(options.q)}%`;
    args.push(like, like, like);
  }

  const row = (await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM chat_conversations c
       JOIN chat_visitors v ON v.id = c.visitor_id
       WHERE ${where.join(' AND ')}`,
    )
    .get(...args)) as { c: number } | undefined;
  return row?.c ?? 0;
}

export async function getChatConversation(id: string): Promise<ChatConversationRow | undefined> {
  return (await getDb().prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id)) as
    | ChatConversationRow
    | undefined;
}

export async function getChatConversationWithVisitor(
  id: string,
): Promise<ChatConversationWithVisitor | undefined> {
  const db = getDb();
  const row = (await db
    .prepare(
      `SELECT
        c.id, c.widget_id, c.visitor_id, c.status, c.assigned_to, c.priority, c.subject,
        c.created_at, c.updated_at,
        v.id AS v_id, v.widget_id AS v_widget_id, v.external_id AS v_external_id,
        v.email AS v_email, v.name AS v_name, v.notes AS v_notes, v.metadata AS v_metadata,
        v.created_at AS v_created_at,
        w.name AS widget_name, w.user_id AS widget_user_id, w.team_id AS widget_team_id, w.color AS widget_color,
        u.name AS assigned_name, u.email AS assigned_email, u.image AS assigned_image,
        co.id AS co_id, co.user_id AS co_user_id, co.owner_id AS co_owner_id,
        co.first_name AS co_first_name, co.last_name AS co_last_name,
        co.email AS co_email, co.phone AS co_phone, co.job_title AS co_job_title,
        co.website AS co_website, co.city AS co_city, co.country AS co_country,
        co.lifecycle_stage AS co_lifecycle_stage, co.lead_status AS co_lead_status,
        co.source AS co_source, co.company_id AS co_company_id, co.custom AS co_custom,
        co.created_at AS co_created_at, co.updated_at AS co_updated_at
       FROM chat_conversations c
       JOIN chat_visitors v ON v.id = c.visitor_id
       JOIN chat_widgets w ON w.id = c.widget_id
       LEFT JOIN users u ON u.id = c.assigned_to
       LEFT JOIN crm_contacts co ON co.user_id = w.user_id AND co.email = v.email
       WHERE c.id = ?`,
    )
    .get(id)) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const visitor: ChatVisitorRow = {
    id: row.v_id as string,
    widget_id: row.v_widget_id as string,
    external_id: row.v_external_id as string,
    email: (row.v_email as string | null) ?? null,
    name: (row.v_name as string | null) ?? null,
    notes: (row.v_notes as string | null) ?? null,
    metadata: (row.v_metadata as string) ?? '{}',
    created_at: row.v_created_at as string,
  };

  const crmContact: CrmContactRow | null = row.co_id
    ? {
        id: row.co_id as string,
        user_id: row.co_user_id as string,
        owner_id: (row.co_owner_id as string | null) ?? null,
        first_name: row.co_first_name as string,
        last_name: row.co_last_name as string,
        email: row.co_email as string,
        phone: row.co_phone as string,
        job_title: row.co_job_title as string,
        website: row.co_website as string,
        city: row.co_city as string,
        country: row.co_country as string,
        lifecycle_stage: row.co_lifecycle_stage as string,
        lead_status: row.co_lead_status as string,
        source: row.co_source as string,
        company_id: (row.co_company_id as string | null) ?? null,
        custom: row.co_custom as string,
        created_at: row.co_created_at as string,
        updated_at: row.co_updated_at as string,
      }
    : null;

  return {
    id: row.id as string,
    widget_id: row.widget_id as string,
    visitor_id: row.visitor_id as string,
    status: row.status as ChatConversationRow['status'],
    assigned_to: (row.assigned_to as string | null) ?? null,
    priority: row.priority as ChatConversationRow['priority'],
    subject: (row.subject as string | null) ?? null,
    first_response_at: (row.first_response_at as string | null) ?? null,
    resolved_at: (row.resolved_at as string | null) ?? null,
    sla_breach_at: (row.sla_breach_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    visitor,
    widget_name: row.widget_name as string,
    widget_user_id: row.widget_user_id as string,
    widget_team_id: (row.widget_team_id as string | null) ?? null,
    widget_color: row.widget_color as string,
    assigned_name: (row.assigned_name as string | null) ?? null,
    assigned_email: (row.assigned_email as string | null) ?? null,
    assigned_image: (row.assigned_image as string | null) ?? null,
    crm_contact: crmContact,
  };
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

export async function markConversationUpdated(id: string): Promise<void> {
  await touchChatConversation(id);
}

// ---------- Agents ----------

export interface ChatAgent {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export async function listChatAgents(
  userId: string,
  teamId?: string | null,
): Promise<ChatAgent[]> {
  const db = getDb();
  if (!teamId) {
    const u = await getUserById(userId);
    return u ? [{ id: u.id, email: u.email, name: u.name, image: u.image }] : [];
  }
  const rows = (await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.image
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY m.role = 'owner' DESC, m.created_at ASC`,
    )
    .all(teamId)) as ChatAgent[];
  return rows;
}

// ---------- Assignment rules ----------

export interface AssignmentRulePayload {
  name: string;
  matchType: 'all' | 'keyword' | 'time' | 'round_robin';
  matchValue?: string | null;
  assignTo?: string | null;
  position?: number;
  active?: boolean;
}

export async function listAssignmentRules(widgetId: string): Promise<ChatAssignmentRuleRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM chat_assignment_rules WHERE widget_id = ? ORDER BY position ASC, created_at ASC',
    )
    .all(widgetId)) as ChatAssignmentRuleRow[];
}

export async function getAssignmentRule(id: string): Promise<ChatAssignmentRuleRow | undefined> {
  return (await getDb().prepare('SELECT * FROM chat_assignment_rules WHERE id = ?').get(id)) as
    | ChatAssignmentRuleRow
    | undefined;
}

export async function createAssignmentRule(
  widgetId: string,
  payload: AssignmentRulePayload,
): Promise<ChatAssignmentRuleRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const max = (await db
    .prepare('SELECT MAX(position) AS p FROM chat_assignment_rules WHERE widget_id = ?')
    .get(widgetId)) as { p: number | null } | undefined;
  const position = payload.position ?? ((max?.p ?? -1) + 1);

  await db
    .prepare(
      'INSERT INTO chat_assignment_rules (id, widget_id, name, match_type, match_value, assign_to, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      widgetId,
      payload.name.trim(),
      payload.matchType,
      payload.matchValue?.trim() ?? null,
      payload.assignTo ?? null,
      position,
      payload.active === false ? 0 : 1,
      now,
      now,
    );

  return (await db.prepare('SELECT * FROM chat_assignment_rules WHERE id = ?').get(id)) as ChatAssignmentRuleRow;
}

export async function updateAssignmentRule(
  id: string,
  payload: Partial<AssignmentRulePayload>,
): Promise<ChatAssignmentRuleRow | undefined> {
  const db = getDb();
  const existing = await getAssignmentRule(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.matchType !== undefined) {
    fields.push('match_type = ?');
    args.push(payload.matchType);
  }
  if (payload.matchValue !== undefined) {
    fields.push('match_value = ?');
    args.push(payload.matchValue?.trim() ?? null);
  }
  if (payload.assignTo !== undefined) {
    fields.push('assign_to = ?');
    args.push(payload.assignTo ?? null);
  }
  if (payload.position !== undefined) {
    fields.push('position = ?');
    args.push(payload.position);
  }
  if (payload.active !== undefined) {
    fields.push('active = ?');
    args.push(payload.active ? 1 : 0);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE chat_assignment_rules SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getAssignmentRule(id);
}

export async function deleteAssignmentRule(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM chat_assignment_rules WHERE id = ?').run(id);
  return res.changes > 0;
}

export async function reorderAssignmentRules(
  widgetId: string,
  orderedIds: string[],
): Promise<void> {
  const db = getDb();
  await Promise.all(
    orderedIds.map((id, index) =>
      db.prepare('UPDATE chat_assignment_rules SET position = ?, updated_at = ? WHERE id = ? AND widget_id = ?').run(
        index,
        nowIso(),
        id,
        widgetId,
      ),
    ),
  );
}

function matchesKeyword(body: string, value: string | null): boolean {
  if (!value) return false;
  return body.toLowerCase().includes(value.toLowerCase());
}

function matchesTimeRange(value: string | null): boolean {
  if (!value) return false;
  const [start, end] = value.split('-');
  if (!start || !end) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const parse = (s: string) => {
    const [h, m] = s.trim().split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const s = parse(start);
  const e = parse(end);
  if (s == null || e == null) return false;
  if (s <= e) return current >= s && current <= e;
  return current >= s || current <= e;
}

export async function applyAssignmentRules(
  widgetId: string,
  conversationId: string,
  messageBody: string,
  teamMembers: ChatAgent[],
): Promise<string | null> {
  const db = getDb();
  const rules = await listAssignmentRules(widgetId);
  const activeRules = rules.filter((r) => r.active === 1);

  for (const rule of activeRules) {
    let matched = false;
    switch (rule.match_type) {
      case 'all':
        matched = true;
        break;
      case 'keyword':
        matched = matchesKeyword(messageBody, rule.match_value);
        break;
      case 'time':
        matched = matchesTimeRange(rule.match_value);
        break;
      case 'round_robin':
        matched = true;
        break;
    }
    if (!matched) continue;

    let assignTo: string | null = rule.assign_to;

    if (rule.match_type === 'round_robin' && teamMembers.length > 0) {
      const rows = (await db
        .prepare(
          `SELECT assigned_to, COUNT(*) AS c
           FROM chat_conversations
           WHERE widget_id = ? AND assigned_to IS NOT NULL
           GROUP BY assigned_to`,
        )
        .all(widgetId)) as Array<{ assigned_to: string; c: number }>;
      const counts = new Map(rows.map((r) => [r.assigned_to, r.c]));
      const sorted = [...teamMembers].sort((a, b) => {
        const ca = counts.get(a.id) ?? 0;
        const cb = counts.get(b.id) ?? 0;
        return ca - cb;
      });
      assignTo = sorted[0]?.id ?? null;
    }

    if (assignTo) {
      await db
        .prepare('UPDATE chat_conversations SET assigned_to = ?, updated_at = ? WHERE id = ?')
        .run(assignTo, nowIso(), conversationId);
      return assignTo;
    }
  }

  return null;
}

// ---------- SLA ----------

export interface SlaStatus {
  firstResponseDeadline: Date | null;
  resolutionDeadline: Date | null;
  breached: boolean;
  resolved: boolean;
  dueInMinutes: number | null;
}

function addMinutes(iso: string, minutes: number): Date {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

export async function getChatSlaStatus(conversation: ChatConversationRow): Promise<SlaStatus> {
  const now = new Date();
  const resolved = conversation.resolved_at != null;

  const policy = (await getDb()
    .prepare(
      'SELECT * FROM chat_sla_policies WHERE widget_id = ? AND priority = ? AND active = 1 LIMIT 1',
    )
    .get(conversation.widget_id, conversation.priority)) as ChatSlaPolicyRow | undefined;

  const firstResponseMinutes = policy?.first_response_minutes ?? 60;
  const resolutionMinutes = policy?.resolution_minutes ?? null;

  const firstResponseDeadline = conversation.first_response_at
    ? null
    : addMinutes(conversation.created_at, firstResponseMinutes);
  const resolutionDeadline = resolved
    ? null
    : resolutionMinutes != null
      ? addMinutes(conversation.created_at, resolutionMinutes)
      : null;

  let breached = false;
  if (resolved && conversation.resolved_at) {
    if (resolutionDeadline && new Date(conversation.resolved_at) > resolutionDeadline) {
      breached = true;
    }
  } else {
    if (firstResponseDeadline && now > firstResponseDeadline) {
      breached = true;
    }
    if (resolutionDeadline && now > resolutionDeadline) {
      breached = true;
    }
  }

  const dueInMinutes = firstResponseDeadline
    ? Math.max(0, Math.ceil((firstResponseDeadline.getTime() - now.getTime()) / 60_000))
    : null;

  return {
    firstResponseDeadline,
    resolutionDeadline,
    breached,
    resolved,
    dueInMinutes,
  };
}

export async function recordFirstResponse(conversationId: string): Promise<void> {
  const db = getDb();
  await db
    .prepare(
      "UPDATE chat_conversations SET first_response_at = COALESCE(first_response_at, ?), updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), nowIso(), conversationId);
}

export async function recordResolved(conversationId: string): Promise<void> {
  const db = getDb();
  await db
    .prepare("UPDATE chat_conversations SET resolved_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), conversationId);
}

// ---------- Canned responses ----------

export interface CannedResponsePayload {
  shortcut: string;
  title: string;
  body: string;
}

export async function listCannedResponses(widgetId: string): Promise<ChatCannedResponseRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM chat_canned_responses WHERE widget_id = ? ORDER BY shortcut ASC')
    .all(widgetId)) as ChatCannedResponseRow[];
}

export async function getCannedResponse(id: string): Promise<ChatCannedResponseRow | undefined> {
  return (await getDb().prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(id)) as
    | ChatCannedResponseRow
    | undefined;
}

export async function createCannedResponse(
  widgetId: string,
  payload: CannedResponsePayload,
): Promise<ChatCannedResponseRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO chat_canned_responses (id, widget_id, shortcut, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, widgetId, payload.shortcut.trim(), payload.title.trim(), payload.body, now, now);
  return (await db.prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(id)) as ChatCannedResponseRow;
}

export async function updateCannedResponse(
  id: string,
  payload: Partial<CannedResponsePayload>,
): Promise<ChatCannedResponseRow | undefined> {
  const db = getDb();
  const existing = await getCannedResponse(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.shortcut !== undefined) {
    fields.push('shortcut = ?');
    args.push(payload.shortcut.trim());
  }
  if (payload.title !== undefined) {
    fields.push('title = ?');
    args.push(payload.title.trim());
  }
  if (payload.body !== undefined) {
    fields.push('body = ?');
    args.push(payload.body);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE chat_canned_responses SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getCannedResponse(id);
}

export async function deleteCannedResponse(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM chat_canned_responses WHERE id = ?').run(id);
  return res.changes > 0;
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

export interface ChatMessageWithUser extends ChatMessageRow {
  user_name: string | null;
  user_email: string | null;
  user_image: string | null;
}

export async function listChatMessages(conversationId: string): Promise<ChatMessageRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .all(conversationId)) as ChatMessageRow[];
}

export async function listChatMessagesWithUsers(
  conversationId: string,
): Promise<ChatMessageWithUser[]> {
  return (await getDb()
    .prepare(
      `SELECT m.*, u.name AS user_name, u.email AS user_email, u.image AS user_image
       FROM chat_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(conversationId)) as ChatMessageWithUser[];
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

  await markConversationUpdated(conversationId);

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
