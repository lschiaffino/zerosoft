/**
 * Charlas del asistente: cada persona ve solo las suyas dentro del workspace
 * activo (workspace_id = owner, person_id = la persona real). Acá viven
 * también las acciones de escritura pendientes de confirmación y el registro
 * de herramientas (assistant_audit). Server-only.
 */
import { getDb } from '../db';
import { cleanLine } from '../workspace';

export interface AssistantOwner {
  workspaceId: string;
  personId: string;
}

export interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Tarjeta de herramienta que se guarda con el mensaje (colapsada en la UI). */
export interface ToolCardPart {
  type: 'tool';
  tool: string;
  /** Resumen corto de lo que pidió el modelo (sin secretos). */
  input: Record<string, unknown>;
  /** Resultado ya redactado y recortado. */
  output: unknown;
  ok: boolean;
}

export interface ActionPart {
  type: 'action';
  actionId: string;
}

export type MessagePart = ToolCardPart | ActionPart;

export interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: MessagePart[];
  created_at: string;
}

export type ActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ActionRow {
  id: string;
  conversation_id: string;
  workspace_id: string;
  person_id: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  details: Array<{ label: string; before?: string | null; after: string }>;
  destructive: boolean;
  confirm_text: string | null;
  status: ActionStatus;
  result: { ok: boolean; message?: string; href?: string; error?: string } | null;
  created_at: string;
  decided_at: string | null;
}

const now = () => new Date().toISOString();

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function conversationTitle(raw: string): string {
  return cleanLine(raw, 80) || 'New chat';
}

export async function listConversations(o: AssistantOwner, opts: { q?: string; limit?: number } = {}): Promise<ConversationRow[]> {
  const args: Array<string | number> = [o.workspaceId, o.personId];
  let where = '';
  if (opts.q?.trim()) {
    where = " AND title LIKE ? ESCAPE '\\'";
    args.push(`%${opts.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  args.push(Math.min(Math.max(opts.limit ?? 100, 1), 200));
  return (await getDb()
    .prepare(
      `SELECT id, title, created_at, updated_at FROM assistant_conversations
       WHERE workspace_id = ? AND person_id = ?${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(...args)) as ConversationRow[];
}

export async function getConversation(o: AssistantOwner, id: string): Promise<ConversationRow | null> {
  const row = (await getDb()
    .prepare('SELECT id, title, created_at, updated_at FROM assistant_conversations WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(id, o.workspaceId, o.personId)) as ConversationRow | undefined;
  return row ?? null;
}

export async function createConversation(o: AssistantOwner, title: string): Promise<ConversationRow> {
  const row: ConversationRow = { id: crypto.randomUUID(), title: conversationTitle(title), created_at: now(), updated_at: now() };
  await getDb()
    .prepare('INSERT INTO assistant_conversations (id, workspace_id, person_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, o.workspaceId, o.personId, row.title, row.created_at, row.updated_at);
  return row;
}

export async function renameConversation(o: AssistantOwner, id: string, title: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE assistant_conversations SET title = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(conversationTitle(title), now(), id, o.workspaceId, o.personId);
  return res.changes > 0;
}

export async function deleteConversation(o: AssistantOwner, id: string): Promise<boolean> {
  const db = getDb();
  const conv = await getConversation(o, id);
  if (!conv) return false;
  // Sin depender de foreign_keys: mensajes y acciones se borran a mano.
  await db.prepare('DELETE FROM assistant_messages WHERE conversation_id = ?').run(id);
  await db.prepare('DELETE FROM assistant_actions WHERE conversation_id = ?').run(id);
  await db.prepare('DELETE FROM assistant_conversations WHERE id = ?').run(id);
  return true;
}

export async function touchConversation(id: string): Promise<void> {
  await getDb().prepare('UPDATE assistant_conversations SET updated_at = ? WHERE id = ?').run(now(), id);
}

export async function listMessages(conversationId: string, limit = 200): Promise<MessageRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, role, content, parts, created_at FROM (
         SELECT id, role, content, parts, created_at, rowid AS rid FROM assistant_messages WHERE conversation_id = ?
         ORDER BY created_at DESC, rid DESC LIMIT ?
       ) ORDER BY created_at ASC, rid ASC`,
    )
    .all(conversationId, limit)) as Array<Omit<MessageRow, 'parts'> & { parts: string }>;
  return rows.map((r) => ({ ...r, parts: parseJson<MessagePart[]>(r.parts, []) }));
}

export async function addMessage(conversationId: string, role: 'user' | 'assistant', content: string, parts: MessagePart[] = []): Promise<MessageRow> {
  const row: MessageRow = { id: crypto.randomUUID(), role, content: content.slice(0, 20_000), parts, created_at: now() };
  await getDb()
    .prepare('INSERT INTO assistant_messages (id, conversation_id, role, content, parts, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, conversationId, role, row.content, JSON.stringify(parts).slice(0, 200_000), row.created_at);
  await touchConversation(conversationId);
  return row;
}

// ---------- Acciones pendientes ----------

function toAction(r: Record<string, unknown>): ActionRow {
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    workspace_id: String(r.workspace_id),
    person_id: String(r.person_id),
    tool: String(r.tool),
    input: parseJson(r.input, {}),
    summary: String(r.summary ?? ''),
    details: parseJson(r.details, []),
    destructive: Number(r.destructive) === 1,
    confirm_text: (r.confirm_text as string | null) ?? null,
    status: String(r.status) as ActionStatus,
    result: parseJson(r.result, null),
    created_at: String(r.created_at),
    decided_at: (r.decided_at as string | null) ?? null,
  };
}

export async function createAction(a: {
  conversationId: string;
  owner: AssistantOwner;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  details: ActionRow['details'];
  destructive: boolean;
  confirmText: string | null;
}): Promise<ActionRow> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO assistant_actions (id, conversation_id, workspace_id, person_id, tool, input, summary, details, destructive, confirm_text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      id,
      a.conversationId,
      a.owner.workspaceId,
      a.owner.personId,
      a.tool,
      JSON.stringify(a.input),
      a.summary.slice(0, 500),
      JSON.stringify(a.details.slice(0, 30)),
      a.destructive ? 1 : 0,
      a.confirmText,
      now(),
    );
  return (await getAction(a.owner, id))!;
}

export async function getAction(o: AssistantOwner, id: string): Promise<ActionRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM assistant_actions WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(id, o.workspaceId, o.personId)) as Record<string, unknown> | undefined;
  return row ? toAction(row) : null;
}

export async function listActions(o: AssistantOwner, ids: string[]): Promise<ActionRow[]> {
  if (!ids.length) return [];
  const rows = (await getDb()
    .prepare(`SELECT * FROM assistant_actions WHERE workspace_id = ? AND person_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(o.workspaceId, o.personId, ...ids)) as Array<Record<string, unknown>>;
  return rows.map(toAction);
}

/**
 * Reclama la acción (compare-and-set pending → nuevo estado): un doble clic o
 * dos pestañas no la ejecutan dos veces. true si la reclamó esta llamada.
 */
export async function claimAction(o: AssistantOwner, id: string, to: 'running' | 'cancelled'): Promise<boolean> {
  const res = await getDb()
    .prepare(`UPDATE assistant_actions SET status = ?, decided_at = ? WHERE id = ? AND workspace_id = ? AND person_id = ? AND status = 'pending'`)
    .run(to, now(), id, o.workspaceId, o.personId);
  return res.changes > 0;
}

export async function finishAction(id: string, status: 'done' | 'failed', result: NonNullable<ActionRow['result']>): Promise<void> {
  await getDb().prepare('UPDATE assistant_actions SET status = ?, result = ? WHERE id = ?').run(status, JSON.stringify(result), id);
}

// ---------- Registro ----------

export async function audit(entry: {
  owner: AssistantOwner;
  conversationId: string | null;
  tool: string;
  kind: 'read' | 'propose' | 'execute' | 'cancel' | 'denied';
  input: unknown;
  outcome: string;
}): Promise<void> {
  await getDb()
    .prepare(
      'INSERT INTO assistant_audit (id, workspace_id, person_id, conversation_id, tool, kind, input, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      crypto.randomUUID(),
      entry.owner.workspaceId,
      entry.owner.personId,
      entry.conversationId,
      entry.tool,
      entry.kind,
      JSON.stringify(entry.input ?? {}).slice(0, 4000),
      entry.outcome.slice(0, 500),
      now(),
    )
    .catch(() => {});
}

export async function listAudit(workspaceId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
  return (await getDb()
    .prepare('SELECT * FROM assistant_audit WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workspaceId, limit)) as Array<Record<string, unknown>>;
}
