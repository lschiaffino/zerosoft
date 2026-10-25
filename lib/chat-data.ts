import { getDb, getUserById } from './db';
import { withVisibleContent } from './docs-visible';
import { emitChatEvent, emitConversationChanges, toApiMessage } from './chat-api';
import { inlineHtmlToText } from './docs-markdown';
import { aiKnowledgeFilterSql } from './docs-access';
import { mergeVisitorMetadata, type VisitorContextPatch } from './chat-visitor-context';
import type { ChatAttributeDef } from './chat-attributes';
import type {
  ChatAssignmentRuleRow,
  ChatCannedResponseRow,
  ChatConversationRow,
  ChatMessageRow,
  ChatSlaPolicyRow,
  ChatTypingRow,
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

// Timestamps: la app escribe ISO 8601 ('T'), pero filas viejas pueden venir del
// default SQLite datetime('now') ('YYYY-MM-DD HH:MM:SS', UTC). Normaliza ambos.
function parseTs(ts: string): number {
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  return new Date(iso).getTime();
}

// ---------- Widgets ----------

export interface ChatFieldDef {
  id: string;
  name: string;
  required: boolean;
  type: 'text' | 'email' | 'number';
}

// Office hours: days[i] con i = Date.getDay() (0 = domingo … 6 = sábado).
export interface OfficeHoursDay {
  enabled: boolean;
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
}

export interface OfficeHoursConfig {
  timezone: string; // IANA, ej. 'America/Argentina/Buenos_Aires'
  days: OfficeHoursDay[];
}

export interface WidgetCreatePayload {
  name: string;
  color?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
  fields?: ChatFieldDef[];
  botEnabled?: boolean;
  botGreeting?: string;
  botSource?: 'canned' | 'docs' | 'ai' | 'agent';
  officeHours?: OfficeHoursConfig | null;
  helpEnabled?: boolean;
  locale?: 'auto' | 'en' | 'es' | 'pt';
  /** Minutos sin leer antes de avisar por email al visitante (0 = nunca). */
  offlineEmailMinutes?: number;
  /** Atributos de conversación (lib/chat-attributes.ts). */
  conversationAttributes?: ChatAttributeDef[];
}

export interface WidgetUpdatePayload {
  name?: string;
  color?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
  fields?: ChatFieldDef[];
  botEnabled?: boolean;
  botGreeting?: string;
  botSource?: 'canned' | 'docs' | 'ai' | 'agent';
  officeHours?: OfficeHoursConfig | null;
  helpEnabled?: boolean;
  locale?: 'auto' | 'en' | 'es' | 'pt';
  /** Minutos sin leer antes de avisar por email al visitante (0 = nunca). */
  offlineEmailMinutes?: number;
  /** Atributos de conversación (lib/chat-attributes.ts). */
  conversationAttributes?: ChatAttributeDef[];
}

/** Espera por defecto antes de mandar por email una respuesta sin leer. */
export const DEFAULT_OFFLINE_EMAIL_MINUTES = 10;

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
      'INSERT INTO chat_widgets (id, team_id, user_id, name, color, position, welcome_message, fields, bot_enabled, bot_greeting, bot_source, office_hours, help_enabled, locale, offline_email_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      payload.botEnabled ? 1 : 0,
      payload.botGreeting?.trim() ?? null,
      payload.botSource ?? 'canned',
      payload.officeHours ? JSON.stringify(payload.officeHours) : null,
      payload.helpEnabled ? 1 : 0,
      payload.locale ?? 'auto',
      payload.offlineEmailMinutes ?? DEFAULT_OFFLINE_EMAIL_MINUTES,
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
  if (payload.botEnabled !== undefined) {
    fields.push('bot_enabled = ?');
    args.push(payload.botEnabled ? 1 : 0);
  }
  if (payload.botGreeting !== undefined) {
    fields.push('bot_greeting = ?');
    args.push(payload.botGreeting.trim() || null);
  }
  if (payload.botSource !== undefined) {
    fields.push('bot_source = ?');
    args.push(payload.botSource);
  }
  if (payload.officeHours !== undefined) {
    fields.push('office_hours = ?');
    args.push(payload.officeHours ? JSON.stringify(payload.officeHours) : null);
  }
  if (payload.helpEnabled !== undefined) {
    fields.push('help_enabled = ?');
    args.push(payload.helpEnabled ? 1 : 0);
  }
  if (payload.locale !== undefined) {
    fields.push('locale = ?');
    args.push(payload.locale);
  }
  if (payload.offlineEmailMinutes !== undefined) {
    fields.push('offline_email_minutes = ?');
    args.push(payload.offlineEmailMinutes);
  }
  if (payload.conversationAttributes !== undefined) {
    fields.push('conversation_attributes = ?');
    args.push(jsonStringify(payload.conversationAttributes));
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

// ---------- Office hours ----------

export function parseOfficeHours(raw: string | null): OfficeHoursConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfficeHoursConfig> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.timezone !== 'string' || !parsed.timezone) return null;
    if (!Array.isArray(parsed.days) || parsed.days.length !== 7) return null;
    const days = parsed.days.map((d) => ({
      enabled: d?.enabled === true,
      start: typeof d?.start === 'string' ? d.start : '09:00',
      end: typeof d?.end === 'string' ? d.end : '18:00',
    }));
    return { timezone: parsed.timezone, days };
  } catch {
    return null;
  }
}

function timeToMinutes(s: string): number | null {
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface LocalParts {
  y: number;
  m: number;
  d: number;
  day: number; // 0 = domingo
  minutes: number;
}

// Componentes de fecha/hora locales en una zona IANA. null si la zona es inválida.
function localParts(timeZone: string, date: Date): LocalParts | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const map: Record<string, string> = {};
    for (const p of dtf.formatToParts(date)) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const day = WEEKDAYS.indexOf(map.weekday ?? '');
    if (day < 0) return null;
    const hour = Number(map.hour) % 24;
    return {
      y: Number(map.year),
      m: Number(map.month),
      d: Number(map.day),
      day,
      minutes: hour * 60 + Number(map.minute),
    };
  } catch {
    return null;
  }
}

// Offset (ms) de la zona respecto a UTC en un instante dado. null si zona inválida.
function tzOffsetMs(timeZone: string, date: Date): number | null {
  const parts = localParts(timeZone, date);
  if (!parts) return null;
  const asUtc = Date.UTC(parts.y, parts.m - 1, parts.d, Math.floor(parts.minutes / 60), parts.minutes % 60);
  return asUtc - date.getTime();
}

export function isWithinOfficeHours(config: OfficeHoursConfig, now = new Date()): boolean {
  const local = localParts(config.timezone, now);
  if (!local) return true; // zona inválida: no bloquear al visitante
  const day = config.days[local.day];
  if (!day?.enabled) return false;
  const start = timeToMinutes(day.start);
  const end = timeToMinutes(day.end);
  if (start == null || end == null) return true;
  if (start <= end) return local.minutes >= start && local.minutes < end;
  return local.minutes >= start || local.minutes < end; // rango que cruza medianoche
}

// Próximo instante UTC de apertura (busca hasta 8 días adelante). null si no hay.
export function nextOfficeOpen(config: OfficeHoursConfig, now = new Date()): Date | null {
  const local = localParts(config.timezone, now);
  if (!local) return null;
  for (let ahead = 0; ahead <= 8; ahead++) {
    // Aritmética de días sobre la FECHA LOCAL en espacio UTC.
    const date = new Date(Date.UTC(local.y, local.m - 1, local.d + ahead));
    const cfg = config.days[date.getUTCDay()];
    if (!cfg?.enabled) continue;
    const start = timeToMinutes(cfg.start);
    if (start == null) continue;
    if (ahead === 0 && local.minutes >= start) continue; // hoy ya abrió
    let guess = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      Math.floor(start / 60),
      start % 60,
    );
    const off1 = tzOffsetMs(config.timezone, new Date(guess));
    if (off1 == null) return null;
    guess -= off1;
    // Segunda pasada por si el offset cambia entre la estimación y el instante (DST).
    const off2 = tzOffsetMs(config.timezone, new Date(guess));
    if (off2 != null && off2 !== off1) {
      guess =
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          Math.floor(start / 60),
          start % 60,
        ) - off2;
    }
    const openAt = new Date(guess);
    if (openAt.getTime() > now.getTime()) return openAt;
  }
  return null;
}

export interface OfficeHoursState {
  enabled: boolean;
  open: boolean;
  nextOpenAt: string | null;
}

export function getOfficeHoursState(widget: ChatWidgetRow, now = new Date()): OfficeHoursState {
  const config = parseOfficeHours(widget.office_hours);
  if (!config || !config.days.some((d) => d.enabled)) {
    return { enabled: false, open: true, nextOpenAt: null };
  }
  const open = isWithinOfficeHours(config, now);
  return {
    enabled: true,
    open,
    nextOpenAt: open ? null : (nextOfficeOpen(config, now)?.toISOString() ?? null),
  };
}

// ---------- Visitors ----------

export interface VisitorPayload {
  email?: string | null;
  name?: string | null;
  /**
   * true solo si el email vino firmado con el secreto del widget
   * (lib/chat-identity.ts). Sin firma, la identidad es declarada.
   */
  verified?: boolean;
}

export interface VisitorUpdatePayload {
  name?: string | null;
  email?: string | null;
  /** Un email que carga alguien del equipo cuenta como verificado. */
  emailVerified?: boolean;
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

/**
 * Email y nombre que manda el widget (identify de la página que lo embebe).
 * No están verificados: solo se aceptan si tienen forma válida y se recortan.
 */
export function cleanVisitorIdentity(email: unknown, name: unknown): { email: string | null; name: string | null } {
  const e = typeof email === 'string' ? email.trim().slice(0, 254) : '';
  // eslint-disable-next-line no-control-regex
  const n = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.toLowerCase() : null,
    name: n || null,
  };
}

export interface VisitorFormAnswers {
  /** Respuestas con la etiqueta del campo del widget, en el orden del formulario. */
  entries: Array<{ id: string; label: string; value: string }>;
  /** Primer campo de tipo email válido: identidad del visitante. */
  email: string | null;
}

/**
 * Respuestas del formulario pre-chat del widget, validadas contra los campos
 * configurados (ids desconocidos se descartan) y con sus etiquetas.
 */
export function visitorFormAnswers(widget: Pick<ChatWidgetRow, 'fields'>, raw: unknown): VisitorFormAnswers {
  const result: VisitorFormAnswers = { entries: [], email: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const defs = parseJson<unknown>(widget.fields ?? '[]', []);
  if (!Array.isArray(defs)) return result;
  const values = raw as Record<string, unknown>;
  for (const def of defs as ChatFieldDef[]) {
    if (!def || typeof def.id !== 'string') continue;
    const v = values[def.id];
    const value = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
    if (!value) continue;
    const label = typeof def.name === 'string' && def.name.trim() ? def.name.trim() : def.id;
    result.entries.push({ id: def.id, label, value });
    if (def.type === 'email' && !result.email) result.email = cleanVisitorIdentity(value, null).email;
  }
  return result;
}

/** Texto legible de las respuestas del formulario ("Empresa: Acme"). */
export function formatVisitorFormAnswers(answers: VisitorFormAnswers): string {
  return answers.entries.map((e) => `${e.label}: ${e.value}`).join('\n');
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

  if (existing) return applyVisitorIdentity(existing, payload);

  // Dos requests en paralelo del mismo visitante (formulario pre-chat + primer
  // mensaje) pasan los dos por el SELECT: el segundo INSERT no debe dar 500.
  await db
    .prepare(
      `INSERT INTO chat_visitors (id, widget_id, external_id, email, name, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(widget_id, external_id) DO NOTHING`,
    )
    .run(
      crypto.randomUUID(),
      widgetId,
      externalId,
      payload?.email ?? null,
      payload?.name ?? null,
      payload?.verified && payload.email ? 1 : 0,
      nowIso(),
    );
  const row = (await db
    .prepare('SELECT * FROM chat_visitors WHERE widget_id = ? AND external_id = ?')
    .get(widgetId, externalId)) as ChatVisitorRow;
  // Si otro request creó la fila primero, la identidad de este se aplica igual.
  return payload?.verified && row.email_verified !== 1 ? applyVisitorIdentity(row, payload) : row;
}

/**
 * Identidad que manda el widget para un visitante que ya existe:
 * - firmada (verified): reemplaza email y nombre y queda verificada;
 * - declarada: nunca pisa una identidad verificada; si no hay, la completa o
 *   la actualiza, y el email sigue sin verificar.
 */
async function applyVisitorIdentity(existing: ChatVisitorRow, payload?: VisitorPayload): Promise<ChatVisitorRow> {
  const db = getDb();
  if (payload?.verified && payload.email) {
    await db
      .prepare('UPDATE chat_visitors SET email = ?, name = COALESCE(?, name), email_verified = 1 WHERE id = ?')
      .run(payload.email, payload.name ?? null, existing.id);
  } else if (existing.email_verified === 1 || !(payload?.email || payload?.name)) {
    return existing;
  } else {
    await db
      .prepare('UPDATE chat_visitors SET email = COALESCE(?, email), name = COALESCE(?, name) WHERE id = ?')
      .run(payload.email ?? null, payload.name ?? null, existing.id);
  }
  return (await db.prepare('SELECT * FROM chat_visitors WHERE id = ?').get(existing.id)) as ChatVisitorRow;
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
    const email = payload.email ? payload.email.trim().toLowerCase() : null;
    fields.push('email = ?');
    args.push(email);
    // Un email distinto deja de estar verificado, salvo que lo cargue el equipo.
    if (email !== existing.email) {
      fields.push('email_verified = ?');
      args.push(email && payload.emailVerified ? 1 : 0);
    }
  }
  if (payload.notes !== undefined) {
    fields.push('notes = ?');
    args.push(payload.notes ?? null);
  }
  if (payload.metadata !== undefined) {
    fields.push('metadata = ?');
    args.push(JSON.stringify(payload.metadata ?? {}));
  }

  // chat_visitors no tiene updated_at: agregarlo rompía cada guardado con 500.
  if (fields.length > 0) {
    args.push(id);
    await db.prepare(`UPDATE chat_visitors SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getChatVisitor(id);
}

/** Guarda en la metadata del visitante el formulario pre-chat y/o la página desde la que escribe. */
export async function saveVisitorContext(visitor: ChatVisitorRow, patch: VisitorContextPatch): Promise<ChatVisitorRow> {
  const metadata = mergeVisitorMetadata(visitor.metadata, patch);
  if (!metadata) return visitor;
  return (await updateChatVisitor(visitor.id, { metadata })) ?? visitor;
}

// ---------- Conversations ----------

export interface ConversationListOptions {
  status?: string;
  assignedTo?: string | 'unassigned';
  /** Solo conversaciones con este tag. */
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationUpdatePayload {
  status?: 'open' | 'pending' | 'resolved' | 'snoozed';
  assignedTo?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  subject?: string;
  snoozedUntil?: string | null;
}

// ---------- SLA (campos computados) ----------

export const CHAT_SLA_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type ChatSlaPriority = (typeof CHAT_SLA_PRIORITIES)[number];

// Default aplicado cuando un widget no tiene policy activa para una
// prioridad: primera respuesta en 60 min, sin SLA de resolución.
export const DEFAULT_SLA_FIRST_RESPONSE_MINUTES = 60;

export type SlaBreachKind = 'first_response' | 'resolution';

export interface SlaComputedFields {
  sla_breached: 0 | 1;
  sla_breach_kind: SlaBreachKind | null;
  sla_due_in_minutes: number | null;
  /** Minutos desde que venció el objetivo, si está vencido y la conversación sigue abierta. */
  sla_overdue_minutes: number | null;
}

type SlaInput = Pick<
  ChatConversationRow,
  'widget_id' | 'priority' | 'created_at' | 'first_response_at' | 'resolved_at'
>;

async function loadActiveSlaPolicies(widgetIds: string[]): Promise<Map<string, ChatSlaPolicyRow>> {
  if (widgetIds.length === 0) return new Map();
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM chat_sla_policies WHERE widget_id IN ${inClause(widgetIds.length)} AND active = 1`,
    )
    .all(...widgetIds)) as ChatSlaPolicyRow[];
  return new Map(rows.map((r) => [`${r.widget_id}:${r.priority}`, r]));
}

// Badge de SLA derivado de la policy activa del widget+priority.
export function computeSlaFields(
  c: SlaInput,
  policies: Map<string, ChatSlaPolicyRow>,
  now = new Date(),
): SlaComputedFields {
  const policy = policies.get(`${c.widget_id}:${c.priority}`);
  const firstMinutes = policy?.first_response_minutes ?? DEFAULT_SLA_FIRST_RESPONSE_MINUTES;
  const resolutionMinutes = policy?.resolution_minutes ?? null;
  const created = parseTs(c.created_at);
  const firstDue = created + firstMinutes * 60_000;
  const resDue = resolutionMinutes != null ? created + resolutionMinutes * 60_000 : null;
  const nowMs = now.getTime();

  if (c.resolved_at) {
    const resolvedMs = parseTs(c.resolved_at);
    if (resDue != null && resolvedMs > resDue) {
      return { sla_breached: 1, sla_breach_kind: 'resolution', sla_due_in_minutes: null, sla_overdue_minutes: null };
    }
    return { sla_breached: 0, sla_breach_kind: null, sla_due_in_minutes: null, sla_overdue_minutes: null };
  }
  const overdue = (due: number) => Math.max(1, Math.floor((nowMs - due) / 60_000));
  if (!c.first_response_at && nowMs > firstDue) {
    return { sla_breached: 1, sla_breach_kind: 'first_response', sla_due_in_minutes: null, sla_overdue_minutes: overdue(firstDue) };
  }
  if (resDue != null && nowMs > resDue) {
    return { sla_breached: 1, sla_breach_kind: 'resolution', sla_due_in_minutes: null, sla_overdue_minutes: overdue(resDue) };
  }
  const dueIn = !c.first_response_at
    ? Math.max(0, Math.ceil((firstDue - nowMs) / 60_000))
    : resDue != null
      ? Math.max(0, Math.ceil((resDue - nowMs) / 60_000))
      : null;
  return { sla_breached: 0, sla_breach_kind: null, sla_due_in_minutes: dueIn, sla_overdue_minutes: null };
}

// Reabre conversaciones cuyo snooze ya venció (lazy un-snooze al listar).
export async function reopenExpiredSnoozes(widgetIds: string[]): Promise<void> {
  if (widgetIds.length === 0) return;
  await getDb()
    .prepare(
      `UPDATE chat_conversations
       SET status = 'open', snoozed_until = NULL, updated_at = ?
       WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?
         AND widget_id IN ${inClause(widgetIds.length)}`,
    )
    .run(nowIso(), nowIso(), ...widgetIds);
}

const SNOOZE_SWEEP_INTERVAL_MS = 60_000;
const lastSnoozeSweep = new Map<string, number>();

/**
 * Igual que reopenExpiredSnoozes pero como mucho una vez por minuto por widget:
 * el inbox lo dispara en cada poll de cada agente y sin cambios era una
 * escritura inútil. Se llama antes de listar y contar, así ambos ven lo mismo.
 */
export async function reopenExpiredSnoozesThrottled(
  widgetIds: string[],
  now: number = Date.now(),
): Promise<void> {
  const due = widgetIds.filter((id) => now - (lastSnoozeSweep.get(id) ?? 0) >= SNOOZE_SWEEP_INTERVAL_MS);
  if (due.length === 0) return;
  for (const id of due) lastSnoozeSweep.set(id, now);
  await reopenExpiredSnoozes(due);
}

export interface ChatConversationListRow extends ChatConversationRow, SlaComputedFields {
  visitor_email: string | null;
  visitor_name: string | null;
  visitor_external_id: string;
  last_message_body: string | null;
  assigned_name: string | null;
  assigned_email: string | null;
  /** Tags separados por coma (GROUP_CONCAT); ver ConversationList. */
  tags: string | null;
  /** Con búsqueda (q): fragmento del mensaje más reciente que coincide. */
  match_snippet?: string | null;
}

export interface ChatConversationWithVisitor extends ChatConversationRow, SlaComputedFields {
  visitor: ChatVisitorRow;
  widget_name: string;
  widget_user_id: string;
  widget_team_id: string | null;
  widget_color: string;
  /** JSON ChatAttributeDef[] del widget (lib/chat-attributes.ts). */
  widget_attributes: string;
  assigned_name: string | null;
  assigned_email: string | null;
  assigned_image: string | null;
  crm_contact: CrmContactRow | null;
}

/**
 * Búsqueda del inbox: asunto, nombre y email del visitante, y el texto de
 * cualquier mensaje de la conversación (notas internas incluidas: el inbox
 * lo ven solo los agentes).
 */
function conversationSearch(q: string): { sql: string; args: string[] } {
  const like = `%${escapeLike(q.trim())}%`;
  return {
    sql: `(c.subject LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR v.email LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM chat_messages sm WHERE sm.conversation_id = c.id AND sm.deleted_at IS NULL AND sm.body LIKE ? ESCAPE '\\'))`,
    args: [like, like, like, like],
  };
}

/** Fragmento del texto alrededor de la primera coincidencia (para la fila del inbox). */
export function matchSnippet(body: string, q: string, radius = 60): string {
  const text = body.replace(/\s+/g, ' ').trim();
  const needle = q.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2).trimEnd()}…` : text;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
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
  if (options.tag) {
    where.push('EXISTS (SELECT 1 FROM chat_conversation_tags t WHERE t.conversation_id = c.id AND t.tag = ?)');
    args.push(options.tag);
  }
  if (options.q) {
    const search = conversationSearch(options.q);
    where.push(search.sql);
    args.push(...search.args);
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
        (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id AND m.is_note = 0 AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
        (SELECT GROUP_CONCAT(tag, ',') FROM (SELECT tag FROM chat_conversation_tags t WHERE t.conversation_id = c.id ORDER BY tag)) AS tags${
          options.q
            ? `,
        (SELECT body FROM chat_messages sm WHERE sm.conversation_id = c.id AND sm.deleted_at IS NULL AND sm.body LIKE ? ESCAPE '\\' ORDER BY sm.created_at DESC LIMIT 1) AS match_body`
            : ''
        }
       FROM chat_conversations c
       JOIN chat_visitors v ON v.id = c.visitor_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...(options.q ? [`%${escapeLike(options.q.trim())}%`] : []), ...args, limit, offset)) as Array<
    Omit<ChatConversationListRow, keyof SlaComputedFields> & { match_body?: string | null }
  >;

  const policies = await loadActiveSlaPolicies(widgetIds);
  const now = new Date();
  return rows.map(({ match_body, ...row }) => ({
    ...row,
    match_snippet: match_body && options.q ? matchSnippet(match_body, options.q) : null,
    ...computeSlaFields(row, policies, now),
  }));
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
  if (options.tag) {
    where.push('EXISTS (SELECT 1 FROM chat_conversation_tags t WHERE t.conversation_id = c.id AND t.tag = ?)');
    args.push(options.tag);
  }
  if (options.q) {
    const search = conversationSearch(options.q);
    where.push(search.sql);
    args.push(...search.args);
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
        c.first_response_at, c.resolved_at, c.sla_breach_at, c.snoozed_until,
        c.csat_score, c.csat_comment, c.attributes,
        c.created_at, c.updated_at,
        v.id AS v_id, v.widget_id AS v_widget_id, v.external_id AS v_external_id,
        v.email AS v_email, v.name AS v_name, v.notes AS v_notes, v.metadata AS v_metadata,
        v.email_verified AS v_email_verified, v.created_at AS v_created_at,
        w.name AS widget_name, w.user_id AS widget_user_id, w.team_id AS widget_team_id, w.color AS widget_color,
        w.conversation_attributes AS widget_attributes,
        u.name AS assigned_name, u.email AS assigned_email, u.image AS assigned_image,
        co.id AS co_id, co.user_id AS co_user_id, co.owner_id AS co_owner_id,
        co.first_name AS co_first_name, co.last_name AS co_last_name,
        co.email AS co_email, co.phone AS co_phone, co.job_title AS co_job_title,
        co.website AS co_website, co.city AS co_city, co.country AS co_country,
        co.lifecycle_stage AS co_lifecycle_stage, co.lead_status AS co_lead_status,
        co.source AS co_source, co.company_id AS co_company_id, co.custom AS co_custom,
        co.score AS co_score, co.score_breakdown AS co_score_breakdown, co.score_updated_at AS co_score_updated_at,
        co.created_at AS co_created_at, co.updated_at AS co_updated_at
       FROM chat_conversations c
       JOIN chat_visitors v ON v.id = c.visitor_id
       JOIN chat_widgets w ON w.id = c.widget_id
       LEFT JOIN users u ON u.id = c.assigned_to
       -- El contacto del CRM: por email solo si está verificado; si no, el
       -- contacto donde alguien del equipo ya guardó esta conversación.
       LEFT JOIN crm_contacts co ON co.user_id = w.user_id AND (
         (v.email_verified = 1 AND co.email = v.email)
         OR co.id = (SELECT a.contact_id FROM crm_activities a WHERE a.user_id = w.user_id AND a.chat_conversation_id = c.id LIMIT 1)
       )
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
    email_verified: Number(row.v_email_verified ?? 0) === 1 ? 1 : 0,
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
        score: Number(row.co_score ?? 0),
        score_breakdown: (row.co_score_breakdown as string | null) ?? '[]',
        score_updated_at: (row.co_score_updated_at as string | null) ?? null,
        created_at: row.co_created_at as string,
        updated_at: row.co_updated_at as string,
      }
    : null;

  const policies = await loadActiveSlaPolicies([row.widget_id as string]);
  const sla = computeSlaFields(
    {
      widget_id: row.widget_id as string,
      priority: row.priority as ChatConversationRow['priority'],
      created_at: row.created_at as string,
      first_response_at: (row.first_response_at as string | null) ?? null,
      resolved_at: (row.resolved_at as string | null) ?? null,
    },
    policies,
  );

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
    snoozed_until: (row.snoozed_until as string | null) ?? null,
    csat_score: (row.csat_score as number | null) ?? null,
    csat_comment: (row.csat_comment as string | null) ?? null,
    attributes: (row.attributes as string | null) ?? '{}',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    ...sla,
    visitor,
    widget_name: row.widget_name as string,
    widget_user_id: row.widget_user_id as string,
    widget_team_id: (row.widget_team_id as string | null) ?? null,
    widget_color: row.widget_color as string,
    widget_attributes: (row.widget_attributes as string | null) ?? '[]',
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
  // open/pending/snoozed siguen siendo la "misma" conversación para el
  // visitante; resolved cierra y la próxima conversación es nueva.
  return (await getDb()
    .prepare(
      "SELECT * FROM chat_conversations WHERE widget_id = ? AND visitor_id = ? AND status IN ('open', 'pending', 'snoozed') ORDER BY created_at DESC LIMIT 1",
    )
    .get(widgetId, visitorId)) as ChatConversationRow | undefined;
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
    .run(id, widgetId, visitorId, 'open', 'medium', subject?.trim() ?? null, now, now);
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
    if (payload.status === 'resolved') {
      // Conserva el resolved_at original si se re-resuelve.
      fields.push("resolved_at = COALESCE(resolved_at, ?)");
      args.push(nowIso());
      fields.push('snoozed_until = NULL');
    } else if (payload.status === 'snoozed') {
      const until =
        payload.snoozedUntil ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      fields.push('snoozed_until = ?');
      args.push(until);
      fields.push('resolved_at = NULL');
    } else {
      fields.push('snoozed_until = NULL');
      fields.push('resolved_at = NULL');
    }
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

  const updated = await getChatConversation(id);
  // Webhooks: asignación y resolución (lib/chat-api.ts).
  if (updated) await emitConversationChanges(existing, updated);
  if (updated && fields.length > 0) await emitConversationEvents(existing, updated);
  return updated;
}

function conversationEventBase(conv: ChatConversationRow, widget: ChatWidgetRow) {
  return {
    conversation: {
      id: conv.id,
      status: conv.status,
      priority: conv.priority,
      subject: conv.subject ?? '',
      assignedTo: conv.assigned_to,
    },
    widget: { id: widget.id, name: widget.name },
  };
}

/** Disparadores de Flow del ciclo de una conversación: asignada a alguien y resuelta. */
async function emitConversationEvents(before: ChatConversationRow, after: ChatConversationRow): Promise<void> {
  const resolved = after.status === 'resolved' && before.status !== 'resolved';
  const assigned = !!after.assigned_to && after.assigned_to !== before.assigned_to;
  if (!resolved && !assigned) return;
  const widget = await getChatWidget(after.widget_id);
  if (!widget) return;
  const { emitEvent } = await import('./events');
  const base = conversationEventBase(after, widget);
  if (assigned) {
    const user = await getUserById(after.assigned_to!);
    await emitEvent(widget.user_id, 'conversation.assigned', {
      ...base,
      assignee: { id: after.assigned_to, name: user?.name ?? '', email: user?.email ?? '' },
    });
  }
  if (resolved) await emitEvent(widget.user_id, 'conversation.resolved', base);
}

/** Una respuesta del agente a una conversación resuelta la vuelve a abrir. */
export async function reopenIfResolved(conversation: Pick<ChatConversationRow, 'id' | 'status'>): Promise<void> {
  if (conversation.status === 'resolved') {
    await updateChatConversation(conversation.id, { status: 'open' });
  }
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
  /** Marcó "ausente": el round-robin no le asigna conversaciones nuevas. */
  away?: boolean;
}

export async function listChatAgents(
  userId: string,
  teamId?: string | null,
): Promise<ChatAgent[]> {
  const db = getDb();
  if (!teamId) {
    const u = await getUserById(userId);
    return u ? [{ id: u.id, email: u.email, name: u.name, image: u.image, away: await isChatAgentAway(u.id) }] : [];
  }
  const rows = (await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.image, COALESCE(s.away, 0) AS away
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN chat_agent_status s ON s.user_id = u.id
       WHERE m.team_id = ?
       ORDER BY m.role = 'owner' DESC, m.created_at ASC`,
    )
    .all(teamId)) as Array<Omit<ChatAgent, 'away'> & { away: number }>;
  return rows.map((r) => ({ ...r, away: Number(r.away) === 1 }));
}

// ---------- Estado del agente (ausente) ----------

export async function isChatAgentAway(userId: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT away FROM chat_agent_status WHERE user_id = ?').get(userId)) as
    | { away: number }
    | undefined;
  return Number(row?.away ?? 0) === 1;
}

/**
 * Marca al agente como ausente o disponible. Con reassign (solo al pasar a
 * ausente), sus conversaciones abiertas o pendientes en los widgets dados se
 * reparten por round-robin entre los agentes disponibles de cada widget; si
 * no queda nadie disponible, quedan sin asignar. Devuelve cuántas se movieron.
 */
export async function setChatAgentAway(
  userId: string,
  away: boolean,
  opts: { reassign?: boolean; widgets?: ChatWidgetRow[] } = {},
): Promise<{ away: boolean; reassigned: number }> {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO chat_agent_status (user_id, away, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET away = excluded.away, updated_at = excluded.updated_at`,
    )
    .run(userId, away ? 1 : 0, nowIso());
  let reassigned = 0;
  if (away && opts.reassign && opts.widgets?.length) {
    for (const widget of opts.widgets) {
      const agents = (await listChatAgents(widget.user_id, widget.team_id)).filter((a) => a.id !== userId);
      const rows = (await db
        .prepare(
          `SELECT id FROM chat_conversations
           WHERE widget_id = ? AND assigned_to = ? AND status IN ('open', 'pending')
           ORDER BY created_at ASC`,
        )
        .all(widget.id, userId)) as Array<{ id: string }>;
      for (const row of rows) {
        const next = await pickRoundRobinAgent(widget.id, row.id, agents);
        // Compare-and-set: si otro agente la tomó mientras tanto, no se pisa.
        const res = await db
          .prepare('UPDATE chat_conversations SET assigned_to = ?, updated_at = ? WHERE id = ? AND assigned_to = ?')
          .run(next, nowIso(), row.id, userId);
        reassigned += res.changes;
        if (res.changes && next !== userId) {
          await emitChatEvent(row.id, 'chat.conversation.assigned', { previousAssignedTo: userId });
        }
      }
    }
  }
  return { away, reassigned };
}

/**
 * Siguiente agente del round-robin: el de menos carga ACTIVA (open/pending),
 * no el histórico (si no, un agente nuevo absorbería todas las entrantes
 * hasta emparejar el total). Empate: a quien le tocó hace más tiempo (o
 * nunca). Los ausentes no entran.
 */
export async function pickRoundRobinAgent(
  widgetId: string,
  conversationId: string,
  candidates: ChatAgent[],
): Promise<string | null> {
  const available = candidates.filter((a) => !a.away);
  if (available.length === 0) return null;
  const rows = (await getDb()
    .prepare(
      `SELECT assigned_to,
              SUM(CASE WHEN status IN ('open', 'pending') THEN 1 ELSE 0 END) AS active,
              MAX(created_at) AS last_at
       FROM chat_conversations
       WHERE widget_id = ? AND assigned_to IS NOT NULL AND id != ?
       GROUP BY assigned_to`,
    )
    .all(widgetId, conversationId)) as Array<{ assigned_to: string; active: number; last_at: string | null }>;
  const stats = new Map(rows.map((r) => [r.assigned_to, r]));
  const sorted = [...available].sort((a, b) => {
    const sa = stats.get(a.id);
    const sb = stats.get(b.id);
    const diff = Number(sa?.active ?? 0) - Number(sb?.active ?? 0);
    if (diff !== 0) return diff;
    return (sa?.last_at ?? '').localeCompare(sb?.last_at ?? '');
  });
  return sorted[0]?.id ?? null;
}

/** El usuario atiende el widget (owner en un workspace personal o miembro del team). */
export async function isChatAgentOfWidget(widget: ChatWidgetRow, userId: string): Promise<boolean> {
  return (await listChatAgents(widget.user_id, widget.team_id)).some((a) => a.id === userId);
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

// El rango se interpreta en la zona del widget (horario de atención); sin zona
// configurada, en UTC. Antes usaba la hora del proceso (UTC en Vercel).
export function matchesTimeRange(value: string | null, timeZone: string | null, now = new Date()): boolean {
  if (!value) return false;
  const [start, end] = value.split('-');
  if (!start || !end) return false;
  const current =
    localParts(timeZone || 'UTC', now)?.minutes ?? now.getUTCHours() * 60 + now.getUTCMinutes();
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
  // No pisar una asignación existente (manual o previa): las reglas solo
  // auto-asignan conversaciones sin dueño.
  const current = await getChatConversation(conversationId);
  // Si el asignado ya no es agente del widget (salió del team), se reparte de nuevo.
  if (current?.assigned_to && teamMembers.some((m) => m.id === current.assigned_to)) return current.assigned_to;

  const rules = await listAssignmentRules(widgetId);
  const activeRules = rules.filter((r) => r.active === 1);
  const widget = activeRules.some((r) => r.match_type === 'time') ? await getChatWidget(widgetId) : undefined;
  const ruleTimeZone = parseOfficeHours(widget?.office_hours ?? null)?.timezone ?? null;

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
        matched = matchesTimeRange(rule.match_value, ruleTimeZone);
        break;
      case 'round_robin':
        matched = true;
        break;
    }
    if (!matched) continue;

    // Una regla que apunta a alguien que ya no es agente del widget no asigna.
    let assignTo: string | null =
      rule.assign_to && teamMembers.some((m) => m.id === rule.assign_to) ? rule.assign_to : null;

    if (rule.match_type === 'round_robin' && teamMembers.length > 0) {
      // Saltea a los ausentes; si están todos ausentes, la regla no asigna
      // y sigue la próxima.
      assignTo = await pickRoundRobinAgent(widgetId, conversationId, teamMembers);
    }

    if (assignTo) {
      const prev = (await db.prepare('SELECT assigned_to FROM chat_conversations WHERE id = ?').get(conversationId)) as
        | { assigned_to: string | null }
        | undefined;
      await db
        .prepare('UPDATE chat_conversations SET assigned_to = ?, updated_at = ? WHERE id = ?')
        .run(assignTo, nowIso(), conversationId);
      if ((prev?.assigned_to ?? null) !== assignTo) {
        await emitChatEvent(conversationId, 'chat.conversation.assigned', { previousAssignedTo: prev?.assigned_to ?? null });
      }
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

  const firstResponseMinutes = policy?.first_response_minutes ?? DEFAULT_SLA_FIRST_RESPONSE_MINUTES;
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

// ---------- SLA policies (CRUD) ----------

export interface SlaPolicyPayload {
  priority: ChatSlaPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number | null;
}

export async function listSlaPolicies(widgetId: string): Promise<ChatSlaPolicyRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM chat_sla_policies WHERE widget_id = ? ORDER BY priority ASC')
    .all(widgetId)) as ChatSlaPolicyRow[];
}

// Upsert por (widget_id, priority): la tabla no tiene UNIQUE en ese par,
// así que se actualiza la fila existente (si hay) o se inserta una nueva.
export async function upsertSlaPolicy(
  widgetId: string,
  payload: SlaPolicyPayload,
): Promise<ChatSlaPolicyRow> {
  const db = getDb();
  const now = nowIso();
  const name = `SLA ${payload.priority}`;
  const existing = (await db
    .prepare(
      'SELECT id FROM chat_sla_policies WHERE widget_id = ? AND priority = ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(widgetId, payload.priority)) as { id: string } | undefined;

  if (existing) {
    await db
      .prepare(
        'UPDATE chat_sla_policies SET name = ?, first_response_minutes = ?, resolution_minutes = ?, active = 1, updated_at = ? WHERE id = ?',
      )
      .run(name, payload.firstResponseMinutes, payload.resolutionMinutes, now, existing.id);
    return (await db
      .prepare('SELECT * FROM chat_sla_policies WHERE id = ?')
      .get(existing.id)) as ChatSlaPolicyRow;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO chat_sla_policies (id, widget_id, name, first_response_minutes, resolution_minutes, priority, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    )
    .run(
      id,
      widgetId,
      name,
      payload.firstResponseMinutes,
      payload.resolutionMinutes,
      payload.priority,
      now,
      now,
    );
  return (await db.prepare('SELECT * FROM chat_sla_policies WHERE id = ?').get(id)) as ChatSlaPolicyRow;
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

// ---------- Bot (Chatbase-lite) ----------

/**
 * Bot por keyword matching. Heurística:
 * - Se normaliza el texto (minúsculas, sin tildes) y se parte en palabras de
 *   3 o más caracteres, sin palabras vacías comunes (es/en/pt).
 * - Cada candidato (canned response o página de docs) suma 2 puntos por
 *   palabra presente en su título/shortcut y 1 punto por palabra en su cuerpo.
 *   La coincidencia es por palabra entera ("pro" no coincide con "problema");
 *   se acepta una variante con hasta 2 letras de más al final para plurales
 *   ("precio" y "precios") cuando la palabra tiene 4 o más letras.
 * - Gana el candidato con mayor score si llega a BOT_MIN_SCORE (una palabra
 *   en el título o dos en el cuerpo). Sin match, se manda solo el greeting
 *   (si está configurado); sin greeting ni match, el bot calla.
 * - Solo responde una vez por conversación: si ya contestó un humano o el
 *   bot, no vuelve a hablar.
 * No hay llamadas a AI externas: todo es matching local. El bot con AI
 * (bot_source = 'ai') vive en lib/chat-bot-ai.ts y usa esto como fallback.
 */
export interface BotReply {
  body: string;
  matchedTitle: string | null;
}

export const BOT_MIN_SCORE = 2;

// Palabras demasiado comunes para decidir una respuesta.
const BOT_STOPWORDS = new Set([
  // es
  'que', 'para', 'por', 'con', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'del', 'como', 'esta', 'este', 'esto',
  'pero', 'mas', 'muy', 'hay', 'son', 'tengo', 'tiene', 'puedo', 'quiero', 'hola', 'gracias', 'cual', 'cuando',
  'donde', 'sus', 'mis', 'tus', 'nos', 'les', 'ese', 'eso', 'esa', 'sobre', 'tambien', 'algo', 'buenas', 'buenos',
  // en
  'the', 'and', 'for', 'you', 'your', 'are', 'can', 'how', 'what', 'with', 'this', 'that', 'have', 'has', 'not',
  'but', 'from', 'about', 'there', 'when', 'where', 'which', 'would', 'could', 'please', 'thanks', 'hello', 'hey',
  // pt
  'voce', 'nao', 'sim', 'uma', 'com', 'dos', 'das', 'aos', 'pelo', 'pela', 'isso', 'isto', 'esse', 'essa', 'ola',
  'obrigado', 'obrigada', 'qual', 'quando', 'onde', 'tem', 'meu', 'minha', 'seu', 'sua', 'mais',
]);

// Minúsculas y sin diacríticos: "Cuánto" y "cuanto" son la misma palabra.
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

function words(text: string): string[] {
  return normalizeForMatch(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
}

export function tokenize(text: string): string[] {
  return [...new Set(words(text).filter((w) => !BOT_STOPWORDS.has(w)))];
}

function hasWord(haystack: Set<string>, token: string): boolean {
  if (haystack.has(token)) return true;
  if (token.length < 4) return false;
  for (const w of haystack) {
    // Plurales y variantes cortas en ambos sentidos: precio/precios, plan/planes.
    const [short, long] = w.length >= token.length ? [token, w] : [w, token];
    if (short.length >= 4 && long.length - short.length <= 2 && long.startsWith(short)) return true;
  }
  return false;
}

export function scoreCandidate(tokens: string[], title: string, body: string): number {
  const hayTitle = new Set(words(title));
  const hayBody = new Set(words(body));
  let score = 0;
  for (const token of tokens) {
    if (hasWord(hayTitle, token)) score += 2;
    else if (hasWord(hayBody, token)) score += 1;
  }
  return score;
}

// Extrae texto plano de docs_pages.content (JSON DocsBlock[]) de forma tolerante.
export function extractDocsText(content: string, maxChars = 2000): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    const texts: string[] = [];
    const walk = (value: unknown): void => {
      if (texts.join(' ').length > maxChars) return;
      if (typeof value === 'string') {
        // El contenido de los bloques es HTML-lite (<strong>, &amp;): a texto plano.
        texts.push(inlineHtmlToText(value));
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, val] of Object.entries(value)) {
          if (key === 'text' || key === 'content' || key === 'children') walk(val);
        }
      }
    };
    walk(parsed);
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return content.slice(0, maxChars);
  }
}

// Corta en el último espacio antes del límite para no partir una palabra.
function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export async function findBotReply(
  widget: ChatWidgetRow,
  messageBody: string,
): Promise<BotReply | null> {
  if (widget.bot_enabled !== 1) return null;
  const greeting = widget.bot_greeting?.trim() || null;
  const tokens = tokenize(messageBody);
  let best: { score: number; text: string; title: string } | null = null;

  // 'ai' sin AI disponible (o si falla) cae acá: busca en docs y canned.
  const useDocs = widget.bot_source === 'docs' || widget.bot_source === 'ai';
  const useCanned = widget.bot_source !== 'docs';
  if (useDocs) {
    const pages = (await getDb()
      .prepare(
        // Solo lo que la IA puede leer (is_public) o ya es público (published):
        // antes respondía con cualquier página privada del workspace.
        // Ni páginas de teamspaces cerrados o privados (salvo que el teamspace lo habilite).
        `SELECT id, title, content FROM docs_pages WHERE user_id = ? AND archived = 0 AND (is_public = 1 OR published = 1)${aiKnowledgeFilterSql()} ORDER BY updated_at DESC LIMIT 100`,
      )
      .all(widget.user_id)) as Array<{ id: string; title: string; content: string }>;
    // Sincronizados: solo si su origen también es conocimiento de la IA (lib/docs-visible.ts).
    for (const page of await withVisibleContent(widget.user_id, pages, { knowledge: [] })) {
      const text = extractDocsText(page.content);
      const score = scoreCandidate(tokens, page.title, text);
      if (score >= BOT_MIN_SCORE && (!best || score > best.score)) {
        best = {
          score,
          text: `${page.title}: ${clipAtWord(text, 280)}`.trim(),
          title: page.title,
        };
      }
    }
  }
  if (useCanned) {
    const canned = await listCannedResponses(widget.id);
    for (const response of canned) {
      const score = scoreCandidate(tokens, `${response.shortcut} ${response.title}`, response.body);
      if (score >= BOT_MIN_SCORE && (!best || score > best.score)) {
        best = { score, text: response.body, title: response.title };
      }
    }
  }

  const parts: string[] = [];
  if (greeting) parts.push(greeting);
  if (best) parts.push(best.text);
  if (parts.length === 0) return null;
  return { body: parts.join('\n\n'), matchedTitle: best?.title ?? null };
}

export async function maybeRunChatBot(
  widget: ChatWidgetRow,
  conversation: ChatConversationRow,
  messageBody: string,
): Promise<ChatMessageRow | null> {
  if (widget.bot_enabled !== 1) return null;
  const replied = (await getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM chat_messages WHERE conversation_id = ? AND sender_type IN ('user', 'bot') AND is_note = 0",
    )
    .get(conversation.id)) as { c: number } | undefined;
  if ((replied?.c ?? 0) > 0) return null;
  const reply = await findBotReply(widget, messageBody);
  if (!reply) return null;
  return createChatMessage(conversation.id, 'bot', { body: reply.body });
}

// ---------- Messages ----------

export type ChatAttachmentType = 'image' | 'audio' | 'file';

export interface ChatAttachment {
  name: string;
  url: string;
  size: number;
  mime: string;
  type: ChatAttachmentType;
}

export function chatAttachmentType(mime: string): ChatAttachmentType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export interface MessageCreatePayload {
  body: string;
  userId?: string | null;
  attachments?: ChatAttachment[];
  /** Nota interna: solo agentes (nunca el visitante, el bot ni la API pública). */
  isNote?: boolean;
}

export interface ChatMessageWithUser extends ChatMessageRow {
  user_name: string | null;
  user_email: string | null;
  user_image: string | null;
}

/**
 * Mensajes de la conversación. Por defecto SIN notas internas: lo usan el
 * widget (visitante), el CRM y el roadmap. El inbox de agentes usa
 * listChatMessagesWithUsers, que sí las incluye.
 */
export async function listChatMessages(
  conversationId: string,
  opts: { includeNotes?: boolean } = {},
): Promise<ChatMessageRow[]> {
  return (await getDb()
    .prepare(
      // Los borrados por su autor no salen nunca de acá (visitante, CRM, roadmap).
      `SELECT * FROM chat_messages WHERE conversation_id = ? AND deleted_at IS NULL${opts.includeNotes ? '' : ' AND is_note = 0'} ORDER BY created_at ASC`,
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
  senderType: 'visitor' | 'user' | 'system' | 'bot',
  payload: MessageCreatePayload,
): Promise<ChatMessageRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO chat_messages (id, conversation_id, sender_type, user_id, body, attachments, is_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      conversationId,
      senderType,
      payload.userId ?? null,
      payload.body,
      jsonStringify(payload.attachments),
      payload.isNote && senderType === 'user' ? 1 : 0,
      nowIso(),
    );

  await markConversationUpdated(conversationId);

  const message = (await db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)) as ChatMessageRow;
  // Webhook: las notas internas y los mensajes de sistema no salen del workspace.
  if (message.is_note !== 1 && senderType !== 'system') {
    await emitChatEvent(conversationId, 'chat.message.created', { message: toApiMessage(message) });
  }
  return message;
}

// ---------- Editar y borrar (solo el autor) ----------

export type ChatMessageEditError = 'not_found' | 'forbidden' | 'deleted' | 'invalid_input';

/**
 * Solo quien escribió un mensaje o una nota del equipo puede editarlo o
 * borrarlo (no los del visitante, el bot ni el sistema).
 */
export function canEditChatMessage(
  message: Pick<ChatMessageRow, 'sender_type' | 'user_id'>,
  userId: string,
): boolean {
  return message.sender_type === 'user' && !!message.user_id && message.user_id === userId;
}

async function getOwnMessage(
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<{ message?: ChatMessageRow; error?: ChatMessageEditError }> {
  const message = (await getDb()
    .prepare('SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId)) as ChatMessageRow | undefined;
  if (!message) return { error: 'not_found' };
  if (!canEditChatMessage(message, userId)) return { error: 'forbidden' };
  if (message.deleted_at) return { error: 'deleted' };
  return { message };
}

/** Cambia el texto de un mensaje o nota propio y lo marca como editado. */
export async function editChatMessage(
  conversationId: string,
  messageId: string,
  userId: string,
  body: string,
): Promise<{ message?: ChatMessageRow; error?: ChatMessageEditError }> {
  const text = body.trim();
  const own = await getOwnMessage(conversationId, messageId, userId);
  if (!own.message) return own;
  // Un adjunto puede quedarse sin texto; un mensaje solo de texto, no.
  const hasAttachments = parseJson<unknown[]>(own.message.attachments ?? '[]', []).length > 0;
  if ((!text && !hasAttachments) || text.length > 5000) return { error: 'invalid_input' };
  if (text === own.message.body) return { message: own.message };
  await getDb()
    .prepare('UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?')
    .run(text, nowIso(), messageId);
  return { message: (await getDb().prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId)) as ChatMessageRow };
}

/**
 * Borra un mensaje o nota propio: queda la fila con la marca (el inbox
 * muestra "mensaje borrado") pero sin texto ni adjuntos, y el visitante deja
 * de verlo (listChatMessages filtra deleted_at).
 */
export async function deleteChatMessage(
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<{ message?: ChatMessageRow; error?: ChatMessageEditError }> {
  const own = await getOwnMessage(conversationId, messageId, userId);
  if (!own.message) return own;
  await getDb()
    .prepare("UPDATE chat_messages SET body = '', attachments = '[]', deleted_at = ? WHERE id = ?")
    .run(nowIso(), messageId);
  await markConversationUpdated(conversationId);
  return { message: (await getDb().prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId)) as ChatMessageRow };
}

export async function markMessagesRead(
  conversationId: string,
  readerType: 'visitor' | 'user',
): Promise<void> {
  const db = getDb();
  if (readerType === 'visitor') {
    // El visitante marca como leídos los mensajes del agente y del bot.
    await db
      .prepare(
        `UPDATE chat_messages
         SET read_at = COALESCE(read_at, ?)
         WHERE conversation_id = ? AND sender_type IN ('user', 'bot') AND is_note = 0 AND deleted_at IS NULL AND read_at IS NULL`,
      )
      .run(nowIso(), conversationId);
    return;
  }
  await db
    .prepare(
      `UPDATE chat_messages
       SET read_at = COALESCE(read_at, ?)
       WHERE conversation_id = ? AND sender_type = 'visitor' AND read_at IS NULL`,
    )
    .run(nowIso(), conversationId);
}

// ---------- Typing indicators ----------

export async function setTyping(
  conversationId: string,
  senderType: 'visitor' | 'user',
  userId?: string | null,
  expiresInSeconds = 5,
): Promise<void> {
  const db = getDb();
  // Id determinístico: con user_id NULL (visitante) el UNIQUE no choca nunca en
  // SQLite y cada "escribiendo" insertaba una fila nueva. El upsert por id lo cubre.
  const id = `${conversationId}:${senderType}:${userId ?? ''}`;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO chat_typing (id, conversation_id, sender_type, user_id, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET expires_at = excluded.expires_at
       ON CONFLICT (conversation_id, sender_type, user_id) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .run(id, conversationId, senderType, userId ?? null, expiresAt);
  // Limpieza de indicadores vencidos de la conversación (filas viejas incluidas).
  await db
    .prepare('DELETE FROM chat_typing WHERE conversation_id = ? AND expires_at <= ?')
    .run(conversationId, nowIso());
}

export async function listTyping(conversationId: string): Promise<ChatTypingRow[]> {
  const db = getDb();
  const now = nowIso();
  return (await db
    .prepare(
      `SELECT * FROM chat_typing
       WHERE conversation_id = ? AND expires_at > ?
       ORDER BY expires_at DESC`,
    )
    .all(conversationId, now)) as ChatTypingRow[];
}

export async function clearTyping(
  conversationId: string,
  senderType: 'visitor' | 'user',
  userId?: string | null,
): Promise<void> {
  const db = getDb();
  if (userId !== undefined) {
    await db
      .prepare(
        'DELETE FROM chat_typing WHERE conversation_id = ? AND sender_type = ? AND user_id = ?',
      )
      .run(conversationId, senderType, userId ?? null);
  } else {
    await db
      .prepare('DELETE FROM chat_typing WHERE conversation_id = ? AND sender_type = ?')
      .run(conversationId, senderType);
  }
}

// ---------- Public visitor helpers ----------

/** Proyección del visitante para rutas públicas: sin notas internas ni metadata. */
export function toPublicVisitor(visitor: ChatVisitorRow): Pick<ChatVisitorRow, 'id' | 'email' | 'name'> {
  return { id: visitor.id, email: visitor.email, name: visitor.name };
}

export type PublicChatMessage = Pick<ChatMessageRow, 'id' | 'conversation_id' | 'sender_type' | 'body' | 'read_at' | 'created_at'> & {
  attachments: ChatAttachment[];
  /** El agente editó el mensaje (el widget muestra "editado"). */
  edited_at: string | null;
};

/**
 * Proyección del mensaje para rutas públicas (widget): attachments ya parseado
 * (en la base es texto JSON y el widget espera un array) y sin el user id del agente.
 */
export function toPublicMessage(message: ChatMessageRow): PublicChatMessage {
  const parsed = parseJson<unknown>(message.attachments ?? '[]', []);
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_type: message.sender_type,
    body: message.body,
    attachments: Array.isArray(parsed) ? (parsed as ChatAttachment[]) : [],
    read_at: message.read_at,
    edited_at: message.edited_at ?? null,
    created_at: message.created_at,
  };
}

/**
 * Proyección de la conversación para rutas públicas (widget): sin los
 * atributos de conversación, que completa el equipo y son internos.
 */
export function toPublicConversation<T extends ChatConversationRow | null>(conversation: T): T {
  if (!conversation) return conversation;
  const { attributes: _attributes, ...rest } = conversation;
  void _attributes;
  return rest as T;
}

/** Proyección del indicador de escribiendo para rutas públicas: sin ids de agentes. */
export function toPublicTyping(rows: ChatTypingRow[]): Array<Pick<ChatTypingRow, 'sender_type'>> {
  return rows.map((r) => ({ sender_type: r.sender_type }));
}

export interface VisitorConversationWithMessages {
  visitor: ChatVisitorRow;
  conversation: ChatConversationRow | null;
  messages: ChatMessageRow[];
  csat: { conversationId: string; score: number | null } | null;
}

// Última conversación resuelta del visitante que todavía no tiene CSAT.
export async function getPendingCsatConversation(
  widgetId: string,
  visitorId: string,
): Promise<ChatConversationRow | undefined> {
  return (await getDb()
    .prepare(
      "SELECT * FROM chat_conversations WHERE widget_id = ? AND visitor_id = ? AND status = 'resolved' AND csat_score IS NULL ORDER BY resolved_at DESC LIMIT 1",
    )
    .get(widgetId, visitorId)) as ChatConversationRow | undefined;
}

// Última conversación del visitante si quedó resuelta: el widget la sigue
// mostrando (con la encuesta CSAT) hasta que el visitante escriba de nuevo.
async function getLatestResolvedConversationByVisitor(
  widgetId: string,
  visitorId: string,
): Promise<ChatConversationRow | undefined> {
  const latest = (await getDb()
    .prepare('SELECT * FROM chat_conversations WHERE widget_id = ? AND visitor_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(widgetId, visitorId)) as ChatConversationRow | undefined;
  return latest?.status === 'resolved' ? latest : undefined;
}

export async function getVisitorConversationWithMessages(
  widgetId: string,
  externalId: string,
  // includeResolved: lo usa el poll del widget. Al escribir (POST) se pide
  // solo la abierta: un mensaje después de resolver abre una conversación nueva.
  options: { includeResolved?: boolean } = {},
): Promise<VisitorConversationWithMessages | null> {
  const visitor = await getChatVisitorByExternalId(widgetId, externalId);
  if (!visitor) return null;

  const conversation =
    (await getOpenConversationByVisitor(widgetId, visitor.id)) ??
    (options.includeResolved ? await getLatestResolvedConversationByVisitor(widgetId, visitor.id) : undefined);
  // Los mensajes de sistema son internos (p. ej. la derivación del bot AI).
  const messages = conversation
    ? (await listChatMessages(conversation.id)).filter((m) => m.sender_type !== 'system')
    : [];
  const pendingCsat = await getPendingCsatConversation(widgetId, visitor.id);

  return {
    visitor,
    conversation: conversation ?? null,
    messages,
    csat: pendingCsat ? { conversationId: pendingCsat.id, score: null } : null,
  };
}

// ---------- CSAT ----------

// Valida que la conversación pertenece al visitor+widget (ruta pública).
export async function getConversationForCsat(
  widgetId: string,
  externalId: string,
  conversationId: string,
): Promise<ChatConversationRow | undefined> {
  return (await getDb()
    .prepare(
      `SELECT c.* FROM chat_conversations c
       JOIN chat_visitors v ON v.id = c.visitor_id
       WHERE c.id = ? AND c.widget_id = ? AND v.external_id = ?`,
    )
    .get(conversationId, widgetId, externalId)) as ChatConversationRow | undefined;
}

export async function submitConversationCsat(
  conversationId: string,
  score: number,
  comment?: string,
): Promise<ChatConversationRow | undefined> {
  const db = getDb();
  // Solo la primera respuesta cuenta (idempotente ante doble submit).
  const res = await db
    .prepare(
      'UPDATE chat_conversations SET csat_score = ?, csat_comment = ?, updated_at = ? WHERE id = ? AND csat_score IS NULL',
    )
    .run(score, comment ?? null, nowIso(), conversationId);
  const conv = await getChatConversation(conversationId);
  if (conv && res.changes === 1) {
    const widget = await getChatWidget(conv.widget_id);
    if (widget) {
      const { emitEvent } = await import('./events');
      await emitEvent(widget.user_id, 'conversation.rated', {
        ...conversationEventBase(conv, widget),
        rating: { score, comment: comment ?? '' },
      });
    }
  }
  return conv;
}

// ---------- Report (settings) ----------

export interface ChatReport {
  avgFirstResponseMinutes: number | null;
  firstResponseCount: number;
  firstResponseWithinSlaPercent: number | null;
  avgResolutionMinutes: number | null;
  resolvedCount: number;
  csatAverage: number | null;
  csatCount: number;
}

export async function getChatReport(widgetIds: string[]): Promise<ChatReport> {
  const empty: ChatReport = {
    avgFirstResponseMinutes: null,
    firstResponseCount: 0,
    firstResponseWithinSlaPercent: null,
    avgResolutionMinutes: null,
    resolvedCount: 0,
    csatAverage: null,
    csatCount: 0,
  };
  if (widgetIds.length === 0) return empty;
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT widget_id, priority, created_at, first_response_at, resolved_at, csat_score
       FROM chat_conversations
       WHERE widget_id IN ${inClause(widgetIds.length)}
       ORDER BY created_at DESC
       LIMIT 1000`,
    )
    .all(...widgetIds)) as Array<{
    widget_id: string;
    priority: ChatConversationRow['priority'];
    created_at: string;
    first_response_at: string | null;
    resolved_at: string | null;
    csat_score: number | null;
  }>;

  const policies = await loadActiveSlaPolicies(widgetIds);

  const firstResponseMinutes: number[] = [];
  let withinSla = 0;
  const resolutionMinutes: number[] = [];
  const csatScores: number[] = [];

  for (const row of rows) {
    const created = parseTs(row.created_at);
    if (row.first_response_at) {
      const mins = (parseTs(row.first_response_at) - created) / 60_000;
      firstResponseMinutes.push(mins);
      const policy = policies.get(`${row.widget_id}:${row.priority}`);
      const allowed = policy?.first_response_minutes ?? 60;
      if (mins <= allowed) withinSla += 1;
    }
    if (row.resolved_at) {
      resolutionMinutes.push((parseTs(row.resolved_at) - created) / 60_000);
    }
    if (row.csat_score != null) csatScores.push(row.csat_score);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    avgFirstResponseMinutes: avg(firstResponseMinutes),
    firstResponseCount: firstResponseMinutes.length,
    firstResponseWithinSlaPercent: firstResponseMinutes.length
      ? Math.round((withinSla / firstResponseMinutes.length) * 100)
      : null,
    avgResolutionMinutes: avg(resolutionMinutes),
    resolvedCount: resolutionMinutes.length,
    csatAverage: avg(csatScores),
    csatCount: csatScores.length,
  };
}
