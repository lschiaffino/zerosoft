/**
 * Groups: tickets creados desde mensajes (a mano, por reacción con emoji o
 * por palabra clave), con estado, prioridad, asignado y vencimientos de
 * primera respuesta y resolución. El cron marca los vencidos (breached_at)
 * con compare-and-set: dos corridas no avisan dos veces. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { emitEventSoon } from './events';
import {
  GroupsError,
  chatDisplayName,
  cleanProperties,
  getChatRow,
  getMessageRow,
  getSettings,
  listPropertyDefs,
  missingRequired,
  type ChatRow,
  type PropertyFilter,
  type PropertyValue,
} from './groups';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  isTicketBreached,
  ticketDue,
  ticketTitleFrom,
  type TicketPriority,
  type TicketStatus,
} from './groups-rules';

const nowIso = () => new Date().toISOString();

export interface TicketRow {
  id: string;
  user_id: string;
  number: number;
  chat_id: string | null;
  message_id: string | null;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  source: 'manual' | 'reaction' | 'keyword' | 'api' | 'flow';
  due_at: string | null;
  first_response_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  breached_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Campos propios del ticket (JSON). */
  fields?: string;
}

export interface TicketDto {
  id: string;
  number: number;
  chatId: string | null;
  chatName: string;
  messageId: string | null;
  messageBody: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  source: TicketRow['source'];
  dueAt: string | null;
  firstResponseDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  breached: boolean;
  createdAt: string;
  fields: Record<string, PropertyValue>;
}

type TicketJoin = TicketRow & { chat_name: string | null; chat_phone: string | null; chat_pid: string | null; message_body: string | null };

const SELECT = `SELECT t.*, c.name AS chat_name, c.phone AS chat_phone, c.provider_chat_id AS chat_pid, m.body AS message_body
  FROM groups_tickets t LEFT JOIN groups_chats c ON c.id = t.chat_id LEFT JOIN groups_messages m ON m.id = t.message_id`;

export function toTicketDto(row: TicketJoin, now = new Date()): TicketDto {
  return {
    id: row.id,
    number: row.number,
    chatId: row.chat_id,
    chatName: row.chat_pid ? chatDisplayName({ name: row.chat_name ?? '', phone: row.chat_phone ?? '', provider_chat_id: row.chat_pid }) : '',
    messageId: row.message_id,
    messageBody: row.message_body ?? '',
    title: row.title,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    source: row.source,
    dueAt: row.due_at,
    firstResponseDueAt: row.first_response_due_at,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    breached: Boolean(row.breached_at) || isTicketBreached(row, now),
    createdAt: row.created_at,
    fields: parseFields(row.fields),
  };
}

function parseFields(raw: string | undefined): Record<string, PropertyValue> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, PropertyValue>) : {};
  } catch {
    return {};
  }
}

export async function getTicket(ws: string, id: string): Promise<TicketDto | null> {
  const row = (await getDb().prepare(`${SELECT} WHERE t.id = ? AND t.user_id = ?`).get(id, ws)) as TicketJoin | undefined;
  return row ? toTicketDto(row) : null;
}

export interface CreateTicketInput {
  chatId: string;
  messageId?: string | null;
  title?: string;
  priority?: TicketPriority;
  assigneeId?: string | null;
  source?: TicketRow['source'];
  fields?: Record<string, unknown>;
}

/**
 * Crea un ticket. Un mensaje tiene a lo sumo un ticket: si ya existe, lo
 * devuelve (`created: false`) en vez de duplicar (reacción repetida, eco del
 * webhook, palabra clave y reacción en el mismo mensaje).
 */
export async function createTicket(
  ws: string,
  actor: string | null,
  input: CreateTicketInput,
): Promise<{ ticket: TicketDto; created: boolean }> {
  const chat = await getChatRow(ws, input.chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  const db = getDb();
  let body = '';
  if (input.messageId) {
    const msg = await getMessageRow(ws, input.messageId);
    if (!msg || msg.chat_id !== chat.id) throw new GroupsError('invalid_message');
    const existing = (await db.prepare('SELECT id FROM groups_tickets WHERE message_id = ?').get(msg.id)) as { id: string } | undefined;
    if (existing) return { ticket: (await getTicket(ws, existing.id)) as TicketDto, created: false };
    body = msg.body;
  }
  const settings = await getSettings(ws);
  const priority = (TICKET_PRIORITIES as readonly string[]).includes(String(input.priority))
    ? (input.priority as TicketPriority)
    : settings.defaultPriority;
  if (input.assigneeId) {
    const { isWorkspacePerson } = await import('./crm-refs');
    if (!(await isWorkspacePerson(ws, input.assigneeId))) throw new GroupsError('invalid_assignee');
  }
  const title = (input.title ?? '').trim().slice(0, 200) || ticketTitleFrom(body, chatDisplayName(chat));
  const fields = input.fields ? await cleanProperties(ws, input.fields, 'ticket') : {};
  const now = new Date();
  const due = ticketDue(priority, settings, now);
  const id = randomUUID();
  // Número correlativo por workspace; el UNIQUE(user_id, number) frena una carrera y se reintenta.
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = (await db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM groups_tickets WHERE user_id = ?').get(ws)) as { n: number };
    try {
      const r = await db
        .prepare(
          `INSERT INTO groups_tickets (id, user_id, number, chat_id, message_id, title, status, priority, assignee_id, source,
             due_at, first_response_due_at, created_by, created_at, updated_at, fields)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          ws,
          Number(next.n),
          chat.id,
          input.messageId ?? null,
          title,
          priority,
          input.assigneeId ?? chat.assigned_to ?? null,
          input.source ?? 'manual',
          due.dueAt,
          due.firstResponseDueAt,
          actor,
          now.toISOString(),
          now.toISOString(),
          JSON.stringify(fields),
        );
      if (r.changes > 0) break;
    } catch (err) {
      const msg = String(err);
      if (input.messageId && /groups_tickets\.message_id|idx_groups_tickets_message/.test(msg)) {
        const existing = (await db.prepare('SELECT id FROM groups_tickets WHERE message_id = ?').get(input.messageId)) as { id: string } | undefined;
        if (existing) return { ticket: (await getTicket(ws, existing.id)) as TicketDto, created: false };
      }
      if (!/UNIQUE/i.test(msg) || attempt === 4) throw err;
    }
  }
  const ticket = (await getTicket(ws, id)) as TicketDto;
  // Un ticket desde un mensaje es una forma de atenderlo: el chat deja de figurar sin responder (ajustable).
  if (input.messageId && settings.unflagOnTicket) {
    await db.prepare('UPDATE groups_chats SET awaiting_since = NULL, flagged_at = NULL WHERE id = ?').run(chat.id);
  }
  await emitEventSoon(ws, 'groups.ticket.created', { ticket: ticketEventData(ticket), chat: chatEventData(chat) });
  return { ticket, created: true };
}

function ticketEventData(t: TicketDto) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    source: t.source,
    dueAt: t.dueAt,
    messageBody: t.messageBody,
    fields: t.fields,
  };
}

function chatEventData(c: ChatRow) {
  return { id: c.id, kind: c.kind, name: chatDisplayName(c), crmCompanyId: c.crm_company_id, crmContactId: c.crm_contact_id };
}

export interface TicketQuery {
  status?: TicketStatus | 'active' | 'all';
  assignee?: string;
  chatId?: string;
  breached?: boolean;
  q?: string;
  /** Filtros por campo propio (mismos operadores que las propiedades de los chats). */
  fields?: PropertyFilter[];
  limit?: number;
}

export async function listTickets(ws: string, query: TicketQuery = {}): Promise<TicketDto[]> {
  const where = ['t.user_id = ?'];
  const args: Array<string | number> = [ws];
  const status = query.status ?? 'active';
  if (status === 'active') where.push("t.status IN ('open', 'in_progress')");
  else if (status !== 'all') {
    where.push('t.status = ?');
    args.push(status);
  }
  if (query.assignee === 'none') where.push('t.assignee_id IS NULL');
  else if (query.assignee) {
    where.push('t.assignee_id = ?');
    args.push(query.assignee);
  }
  if (query.chatId) {
    where.push('t.chat_id = ?');
    args.push(query.chatId);
  }
  if (query.q?.trim()) {
    where.push(`(t.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`);
    const like = `%${query.q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    args.push(like, like);
  }
  for (const f of (query.fields ?? []).slice(0, 10)) {
    if (!/^[a-z0-9_]{1,40}$/.test(f.key)) continue;
    const path = `$."${f.key}"`;
    if (f.op === 'set' || f.op === 'unset') {
      where.push(`json_extract(t.fields, ?) IS ${f.op === 'set' ? 'NOT ' : ''}NULL`);
      args.push(path);
    } else if (f.value) {
      where.push('EXISTS (SELECT 1 FROM json_each(t.fields, ?) je WHERE CAST(je.value AS TEXT) = ?)');
      args.push(path, f.value.slice(0, 200));
    }
  }
  const limit = Math.min(Math.max(1, query.limit ?? 200), 500);
  const rows = (await getDb()
    .prepare(
      `${SELECT} WHERE ${where.join(' AND ')}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC LIMIT ?`,
    )
    .all(...args, limit)) as TicketJoin[];
  const now = new Date();
  const list = rows.map((r) => toTicketDto(r, now));
  return query.breached ? list.filter((t) => t.breached) : list;
}

export interface TicketPatch {
  title?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  /** Reemplaza los campos propios (los que no vienen quedan vacíos). */
  fields?: Record<string, unknown>;
}

export async function updateTicket(ws: string, id: string, patch: TicketPatch): Promise<TicketDto> {
  const row = (await getDb().prepare('SELECT * FROM groups_tickets WHERE id = ? AND user_id = ?').get(id, ws)) as TicketRow | undefined;
  if (!row) throw new GroupsError('not_found', 404);
  const sets: string[] = [];
  const args: Array<string | null> = [];
  const set = (c: string, v: string | null) => {
    sets.push(`${c} = ?`);
    args.push(v);
  };
  const now = nowIso();
  if (patch.title !== undefined) {
    const t = patch.title.trim().slice(0, 200);
    if (!t) throw new GroupsError('invalid_title');
    set('title', t);
  }
  let fields = parseFields(row.fields);
  if (patch.fields !== undefined) {
    fields = await cleanProperties(ws, patch.fields, 'ticket');
    set('fields', JSON.stringify(fields));
  }
  const nextStatus = patch.status ?? row.status;
  if ((nextStatus === 'resolved' || nextStatus === 'closed') && (patch.status !== undefined || patch.fields !== undefined)) {
    // Campos obligatorios al resolver o cerrar.
    const missing = missingRequired(await listPropertyDefs(ws, 'ticket'), fields);
    if (missing.length) throw new GroupsError(`missing_fields:${missing.join(',')}`);
  }
  if (patch.status !== undefined) {
    if (!(TICKET_STATUSES as readonly string[]).includes(patch.status)) throw new GroupsError('invalid_status');
    set('status', patch.status);
    const done = patch.status === 'resolved' || patch.status === 'closed';
    set('resolved_at', done ? row.resolved_at ?? now : null);
  }
  if (patch.priority !== undefined) {
    if (!(TICKET_PRIORITIES as readonly string[]).includes(patch.priority)) throw new GroupsError('invalid_priority');
    if (patch.priority !== row.priority) {
      // Nueva prioridad: el vencimiento de resolución se recalcula desde que se creó.
      const settings = await getSettings(ws);
      set('priority', patch.priority);
      set('due_at', ticketDue(patch.priority, settings, new Date(row.created_at)).dueAt);
      set('breached_at', null);
    }
  }
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId) {
      const { isWorkspacePerson } = await import('./crm-refs');
      if (!(await isWorkspacePerson(ws, patch.assigneeId))) throw new GroupsError('invalid_assignee');
    }
    set('assignee_id', patch.assigneeId || null);
  }
  if (sets.length) {
    await getDb().prepare(`UPDATE groups_tickets SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...args, now, id, ws);
  }
  const ticket = (await getTicket(ws, id)) as TicketDto;
  if (sets.length) await emitEventSoon(ws, 'groups.ticket.updated', { ticket: ticketEventData(ticket) });
  return ticket;
}

export async function deleteTicket(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_tickets WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

/**
 * Cron: marca los tickets vencidos. El UPDATE con `breached_at IS NULL` es el
 * claim: si dos corridas lo ven, solo una cambia la fila y avisa.
 */
export async function markBreachedTickets(now = new Date(), limit = 500): Promise<number> {
  const db = getDb();
  const iso = now.toISOString();
  const rows = (await db
    .prepare(
      `SELECT * FROM groups_tickets WHERE breached_at IS NULL AND status IN ('open', 'in_progress')
       AND (due_at <= ? OR (first_response_at IS NULL AND first_response_due_at <= ?)) LIMIT ?`,
    )
    .all(iso, iso, limit)) as TicketRow[];
  let n = 0;
  for (const r of rows) {
    if (!isTicketBreached(r, now)) continue;
    const claim = await db.prepare('UPDATE groups_tickets SET breached_at = ? WHERE id = ? AND breached_at IS NULL').run(iso, r.id);
    if (claim.changes === 0) continue;
    n++;
    const t = await getTicket(r.user_id, r.id);
    if (!t) continue;
    await emitEventSoon(r.user_id, 'groups.ticket.updated', { ticket: ticketEventData(t), breached: true });
    // El aviso por email sale una vez: lo protege el mismo claim de breached_at.
    const { notifyBreach } = await import('./groups-sla');
    await notifyBreach(r.user_id, t, r.first_response_at === null && !!r.first_response_due_at && Date.parse(r.first_response_due_at) <= now.getTime() ? 'first_response' : 'resolution').catch(() => null);
  }
  return n;
}
