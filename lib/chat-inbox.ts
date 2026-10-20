import { getDb } from './db';
import type { ChatCannedResponseRow, ChatConversationRow } from './db';
import {
  getChatConversation,
  getChatWidget,
  listChatAgents,
  updateChatConversation,
  type ConversationUpdatePayload,
} from './chat-data';

/**
 * Herramientas del inbox de Chat: tags de conversación, macros (canned
 * responses con acciones) y reportes por rango de fechas / por agente.
 * El acceso al widget/conversación lo validan las rutas (lib/chat-access.ts).
 */

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
}

// ---------- Tags ----------

export const TAG_MAX = 40;

/** "  Facturación  urgente " → "facturación-urgente". */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, TAG_MAX);
}

export async function listConversationTags(conversationId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT tag FROM chat_conversation_tags WHERE conversation_id = ? ORDER BY tag ASC')
    .all(conversationId)) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

export async function addConversationTag(conversationId: string, raw: string): Promise<string[]> {
  const tag = normalizeTag(raw);
  if (tag) {
    await getDb()
      .prepare('INSERT OR IGNORE INTO chat_conversation_tags (conversation_id, tag) VALUES (?, ?)')
      .run(conversationId, tag);
  }
  return listConversationTags(conversationId);
}

export async function removeConversationTag(conversationId: string, raw: string): Promise<string[]> {
  await getDb()
    .prepare('DELETE FROM chat_conversation_tags WHERE conversation_id = ? AND tag = ?')
    .run(conversationId, normalizeTag(raw));
  return listConversationTags(conversationId);
}

/** Tags en uso en los widgets del workspace (para el filtro del inbox). */
export async function listWorkspaceTags(widgetIds: string[]): Promise<Array<{ tag: string; count: number }>> {
  if (widgetIds.length === 0) return [];
  return (await getDb()
    .prepare(
      `SELECT t.tag AS tag, COUNT(*) AS count
       FROM chat_conversation_tags t
       JOIN chat_conversations c ON c.id = t.conversation_id
       WHERE c.widget_id IN ${inClause(widgetIds.length)}
       GROUP BY t.tag
       ORDER BY count DESC, t.tag ASC
       LIMIT 100`,
    )
    .all(...widgetIds)) as Array<{ tag: string; count: number }>;
}

// ---------- Macros ----------

/**
 * Acciones de una canned response (macro). `assignTo`: 'me' = quien la
 * aplica, '' = desasignar, otro valor = id de un agente del widget.
 */
export interface CannedActions {
  status?: 'open' | 'pending' | 'resolved';
  assignTo?: string;
  addTags?: string[];
  snoozeHours?: number;
}

export function parseCannedActions(raw: string | null | undefined): CannedActions {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: CannedActions = {};
    if (v.status === 'open' || v.status === 'pending' || v.status === 'resolved') out.status = v.status;
    if (typeof v.assignTo === 'string') out.assignTo = v.assignTo.slice(0, 64);
    if (Array.isArray(v.addTags)) {
      out.addTags = v.addTags.filter((t): t is string => typeof t === 'string').map(normalizeTag).filter(Boolean).slice(0, 10);
    }
    if (typeof v.snoozeHours === 'number' && v.snoozeHours > 0) out.snoozeHours = Math.min(Math.round(v.snoozeHours), 24 * 30);
    return out;
  } catch {
    return {};
  }
}

export function hasCannedActions(actions: CannedActions): boolean {
  return Boolean(actions.status || actions.assignTo !== undefined || actions.addTags?.length || actions.snoozeHours);
}

export async function setCannedActions(responseId: string, actions: CannedActions): Promise<void> {
  await getDb()
    .prepare('UPDATE chat_canned_responses SET actions = ? WHERE id = ?')
    .run(JSON.stringify(parseCannedActions(JSON.stringify(actions))), responseId);
}

export interface MacroResult {
  conversation: ChatConversationRow | undefined;
  tags: string[];
}

/**
 * Aplica las acciones de una macro a la conversación. El texto de la
 * respuesta lo inserta el composer (el agente lo puede editar antes de mandar).
 * Snooze gana sobre status (es un status con fecha).
 */
export async function applyCannedMacro(
  conversationId: string,
  response: Pick<ChatCannedResponseRow, 'widget_id' | 'actions'>,
  actingUserId: string,
): Promise<MacroResult | null> {
  const conversation = await getChatConversation(conversationId);
  if (!conversation || conversation.widget_id !== response.widget_id) return null;
  const actions = parseCannedActions(response.actions);
  const patch: ConversationUpdatePayload = {};
  if (actions.snoozeHours) {
    patch.status = 'snoozed';
    patch.snoozedUntil = new Date(Date.now() + actions.snoozeHours * 3_600_000).toISOString();
  } else if (actions.status) {
    patch.status = actions.status;
  }
  if (actions.assignTo !== undefined) {
    if (actions.assignTo === '') patch.assignedTo = null;
    else {
      const target = actions.assignTo === 'me' ? actingUserId : actions.assignTo;
      const widget = await getChatWidget(conversation.widget_id);
      const agents = widget ? await listChatAgents(widget.user_id, widget.team_id) : [];
      // Solo agentes del workspace del widget (un id de otro workspace se ignora).
      if (agents.some((a) => a.id === target)) patch.assignedTo = target;
    }
  }
  let tags: string[] | null = null;
  for (const tag of actions.addTags ?? []) tags = await addConversationTag(conversationId, tag);
  const updated = Object.keys(patch).length > 0 ? await updateChatConversation(conversationId, patch) : conversation;
  return { conversation: updated, tags: tags ?? (await listConversationTags(conversationId)) };
}

// ---------- Acciones en lote ----------

/** Tope de conversaciones por acción en lote (una página larga del inbox). */
export const BULK_MAX = 100;

/** Las mismas acciones que existen de a una en la conversación. */
export type BulkAction =
  | { type: 'assign'; assignedTo: string | null }
  | { type: 'tag'; tag: string }
  | { type: 'snooze'; until: string }
  | { type: 'resolve' };

/** Valida el cuerpo del POST /api/chat/conversations/bulk. */
export function parseBulkRequest(raw: unknown, now = new Date()): { ids: string[]; action: BulkAction } | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { ids?: unknown; action?: unknown };
  if (!Array.isArray(body.ids)) return null;
  const ids = [
    ...new Set(body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)),
  ];
  if (ids.length === 0 || ids.length > BULK_MAX) return null;
  const a = body.action as Record<string, unknown> | null | undefined;
  if (!a || typeof a !== 'object') return null;
  switch (a.type) {
    case 'assign':
      if (a.assignedTo === null || (typeof a.assignedTo === 'string' && a.assignedTo.length <= 64 && a.assignedTo)) {
        return { ids, action: { type: 'assign', assignedTo: a.assignedTo as string | null } };
      }
      return null;
    case 'tag': {
      const tag = typeof a.tag === 'string' ? normalizeTag(a.tag) : '';
      return tag ? { ids, action: { type: 'tag', tag } } : null;
    }
    case 'snooze': {
      const at = typeof a.until === 'string' ? Date.parse(a.until) : NaN;
      // Solo a futuro y como mucho 30 días (igual que los snoozes de macro).
      if (!Number.isFinite(at) || at <= now.getTime() || at - now.getTime() > 30 * 86_400_000) return null;
      return { ids, action: { type: 'snooze', until: new Date(at).toISOString() } };
    }
    case 'resolve':
      return { ids, action: { type: 'resolve' } };
    default:
      return null;
  }
}

/**
 * Aplica una acción a una conversación ya validada (acceso lo chequea la
 * ruta). Asignar solo a agentes del widget de esa conversación: si no lo es,
 * se saltea. Devuelve la conversación tal como quedó o null si se salteó.
 */
export async function applyBulkAction(
  conversation: ChatConversationRow,
  action: BulkAction,
): Promise<ChatConversationRow | null> {
  switch (action.type) {
    case 'assign': {
      if (action.assignedTo) {
        const widget = await getChatWidget(conversation.widget_id);
        const agents = widget ? await listChatAgents(widget.user_id, widget.team_id) : [];
        if (!agents.some((a) => a.id === action.assignedTo)) return null;
      }
      return (await updateChatConversation(conversation.id, { assignedTo: action.assignedTo })) ?? null;
    }
    case 'tag':
      await addConversationTag(conversation.id, action.tag);
      return conversation;
    case 'snooze':
      if (conversation.status === 'resolved') return null;
      return (await updateChatConversation(conversation.id, { status: 'snoozed', snoozedUntil: action.until })) ?? null;
    case 'resolve':
      return (await updateChatConversation(conversation.id, { status: 'resolved' })) ?? null;
  }
}

// ---------- Reportes ----------

export interface ReportRange {
  /** ISO (inclusive). */
  from: string;
  /** ISO (exclusive). */
  to: string;
}

/**
 * Rango a partir de ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive, día UTC).
 * Por defecto: últimos 30 días. Fechas inválidas caen al default.
 */
export function parseReportRange(from: string | null | undefined, to: string | null | undefined, now = new Date()): ReportRange & {
  fromDate: string;
  toDate: string;
} {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const toDate = to && day.test(to) && !Number.isNaN(Date.parse(`${to}T00:00:00Z`)) ? to : now.toISOString().slice(0, 10);
  const defFrom = new Date(Date.parse(`${toDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  let fromDate = from && day.test(from) && !Number.isNaN(Date.parse(`${from}T00:00:00Z`)) ? from : defFrom;
  if (fromDate > toDate) fromDate = toDate;
  const end = new Date(Date.parse(`${toDate}T00:00:00Z`) + 86_400_000).toISOString();
  return { from: `${fromDate}T00:00:00.000Z`, to: end, fromDate, toDate };
}

export interface ChatRangeMetrics {
  conversations: number;
  firstResponseCount: number;
  avgFirstResponseMinutes: number | null;
  resolvedCount: number;
  avgResolutionMinutes: number | null;
  csatAverage: number | null;
  csatCount: number;
}

export interface ChatAgentMetrics extends ChatRangeMetrics {
  agentId: string | null;
  name: string | null;
  email: string | null;
}

export interface ChatRangeReport {
  totals: ChatRangeMetrics;
  agents: ChatAgentMetrics[];
}

interface Acc {
  conversations: number;
  first: number[];
  resolution: number[];
  csat: number[];
}

function finish(acc: Acc): ChatRangeMetrics {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    conversations: acc.conversations,
    firstResponseCount: acc.first.length,
    avgFirstResponseMinutes: avg(acc.first),
    resolvedCount: acc.resolution.length,
    avgResolutionMinutes: avg(acc.resolution),
    csatAverage: avg(acc.csat),
    csatCount: acc.csat.length,
  };
}

/**
 * Métricas de las conversaciones CREADAS en el rango, totales y por agente
 * asignado (sin asignar = agentId null). Las conversaciones fuera del rango
 * no cuentan.
 */
export async function getChatRangeReport(widgetIds: string[], range: ReportRange): Promise<ChatRangeReport> {
  const empty = (): Acc => ({ conversations: 0, first: [], resolution: [], csat: [] });
  if (widgetIds.length === 0) return { totals: finish(empty()), agents: [] };
  const rows = (await getDb()
    .prepare(
      `SELECT c.assigned_to, c.created_at, c.first_response_at, c.resolved_at, c.csat_score,
              u.name AS agent_name, u.email AS agent_email
       FROM chat_conversations c
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.widget_id IN ${inClause(widgetIds.length)} AND c.created_at >= ? AND c.created_at < ?
       ORDER BY c.created_at DESC
       LIMIT 20000`,
    )
    .all(...widgetIds, range.from, range.to)) as Array<{
    assigned_to: string | null;
    created_at: string;
    first_response_at: string | null;
    resolved_at: string | null;
    csat_score: number | null;
    agent_name: string | null;
    agent_email: string | null;
  }>;

  const totals = empty();
  const byAgent = new Map<string, { acc: Acc; name: string | null; email: string | null; id: string | null }>();
  for (const r of rows) {
    const key = r.assigned_to ?? '';
    let entry = byAgent.get(key);
    if (!entry) {
      entry = { acc: empty(), name: r.agent_name, email: r.agent_email, id: r.assigned_to };
      byAgent.set(key, entry);
    }
    const created = Date.parse(r.created_at);
    for (const acc of [totals, entry.acc]) {
      acc.conversations += 1;
      if (r.first_response_at) acc.first.push((Date.parse(r.first_response_at) - created) / 60_000);
      if (r.resolved_at) acc.resolution.push((Date.parse(r.resolved_at) - created) / 60_000);
      if (r.csat_score != null) acc.csat.push(r.csat_score);
    }
  }
  const agents = [...byAgent.values()]
    .map((e) => ({ agentId: e.id, name: e.name, email: e.email, ...finish(e.acc) }))
    .sort((a, b) => (a.agentId === null ? 1 : b.agentId === null ? -1 : b.conversations - a.conversations));
  return { totals: finish(totals), agents };
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  // Evita inyección de fórmulas al abrir el CSV en una planilla.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

export function chatReportToCsv(report: ChatRangeReport, labels: { unassigned: string; total: string }): string {
  const header = [
    'agent',
    'email',
    'conversations',
    'first_responses',
    'avg_first_response_min',
    'resolved',
    'avg_resolution_min',
    'csat_avg',
    'csat_responses',
  ];
  const line = (name: string, email: string | null, m: ChatRangeMetrics) =>
    [
      name,
      email,
      m.conversations,
      m.firstResponseCount,
      round1(m.avgFirstResponseMinutes),
      m.resolvedCount,
      round1(m.avgResolutionMinutes),
      round1(m.csatAverage),
      m.csatCount,
    ]
      .map(csvCell)
      .join(',');
  return [
    header.join(','),
    ...report.agents.map((a) => line(a.agentId ? a.name || a.email || a.agentId : labels.unassigned, a.email, a)),
    line(labels.total, null, report.totals),
  ].join('\n') + '\n';
}
