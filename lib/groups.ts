/**
 * Groups: números, chats (1:1 y grupos), mensajes, miembros, etiquetas,
 * propiedades, respuestas rápidas y ajustes. Server-only.
 *
 * Todo vive bajo el id del dueño del workspace (`ws`, como el resto de las
 * apps); `actor` es la persona real que hace la acción. Las credenciales de
 * cada número se guardan cifradas (secret-box) y nunca salen por la API: el
 * DTO solo dice qué campos están cargados.
 */
import { randomBytes, randomUUID } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';
import { emitEventSoon } from './events';
import {
  PROVIDER_CAPS,
  PROVIDER_KINDS,
  ProviderError,
  isGroupJid,
  isValidPhone,
  phoneDigits,
  splitPhones,
  type BridgeConfig,
  type CloudConfig,
  type ConnectState,
  type GroupsProvider,
  type InboundEvent,
  type MemberRole,
  type ParticipantAction,
  type ParticipantResult,
  type ProviderConfig,
  type ProviderKind,
} from './groups-provider';
import { cloudProvider } from './groups-provider-cloud';
import { bridgeProvider } from './groups-provider-bridge';
import { fakeProvider, fakeProviderAllowed } from './groups-provider-fake';
import { DEFAULT_SETTINGS, matchKeyword, mediaKind, normalizeSettings, reactionCreatesTicket, type GroupsSettings } from './groups-rules';

export { mediaKind };

const nowIso = () => new Date().toISOString();
const newId = () => randomUUID();

export class GroupsError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
    this.name = 'GroupsError';
  }
}

// ======================================================================
// Números
// ======================================================================

export interface NumberRow {
  id: string;
  user_id: string;
  name: string;
  provider: ProviderKind;
  phone: string;
  status: ConnectState['status'];
  config: string;
  webhook_secret: string;
  last_error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface NumberDto {
  id: string;
  name: string;
  provider: ProviderKind;
  phone: string;
  status: ConnectState['status'];
  lastError: string;
  caps: (typeof PROVIDER_CAPS)[ProviderKind];
  /** Campos de configuración cargados (los secretos nunca se devuelven). */
  configured: Record<string, boolean>;
  /** Campos no secretos, para editar. */
  settings: { baseUrl?: string; session?: string; phoneNumberId?: string; wabaId?: string };
  createdAt: string;
}

const SECRET_KEYS = ['accessToken', 'appSecret', 'verifyToken', 'apiKey'] as const;
const PLAIN_KEYS = ['baseUrl', 'session', 'phoneNumberId', 'wabaId', 'apiVersion'] as const;

export function readConfig(row: Pick<NumberRow, 'config'>): ProviderConfig {
  const plain = open(row.config);
  if (!plain) return {};
  try {
    return JSON.parse(plain) as ProviderConfig;
  } catch {
    return {};
  }
}

export function toNumberDto(row: NumberRow): NumberDto {
  const cfg = readConfig(row);
  const configured: Record<string, boolean> = {};
  for (const k of [...SECRET_KEYS, ...PLAIN_KEYS]) configured[k] = Boolean((cfg as Record<string, unknown>)[k]);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    phone: row.phone,
    status: row.status,
    lastError: row.last_error,
    caps: PROVIDER_CAPS[row.provider],
    configured,
    settings: { baseUrl: cfg.baseUrl, session: cfg.session, phoneNumberId: cfg.phoneNumberId, wabaId: cfg.wabaId },
    createdAt: row.created_at,
  };
}

/** Proveedores que esta instancia ofrece al conectar (el falso solo en tests/demo). */
export function availableProviders(): ProviderKind[] {
  return PROVIDER_KINDS.filter((k) => k !== 'fake' || fakeProviderAllowed());
}

function cleanConfig(kind: ProviderKind, input: Record<string, unknown>, prev: ProviderConfig = {}): ProviderConfig {
  const str = (k: string, max = 500) => {
    const v = input[k];
    if (typeof v !== 'string') return undefined;
    const t = v.trim().slice(0, max);
    return t || undefined;
  };
  const out: Record<string, string | undefined> = { ...(prev as Record<string, string | undefined>) };
  const keys: readonly string[] =
    kind === 'cloud'
      ? ['phoneNumberId', 'accessToken', 'appSecret', 'verifyToken', 'wabaId', 'apiVersion']
      : kind === 'fake'
        ? []
        : ['baseUrl', 'apiKey', 'session'];
  for (const k of keys) {
    const v = str(k, k === 'accessToken' ? 2000 : 500);
    // Un secreto vacío al editar conserva el anterior.
    if (v !== undefined) out[k] = v;
  }
  if (kind === 'cloud') {
    if (!out.phoneNumberId || !/^\d{5,30}$/.test(out.phoneNumberId)) throw new GroupsError('invalid_phone_number_id');
    if (!out.accessToken) throw new GroupsError('missing_access_token');
    if (!out.appSecret) throw new GroupsError('missing_app_secret');
    if (out.apiVersion && !/^v\d{1,2}\.\d$/.test(out.apiVersion)) throw new GroupsError('invalid_api_version');
    // Lo elige la persona y lo pega también en Meta: no hace falta devolverlo nunca.
    if (!out.verifyToken || out.verifyToken.length < 8) throw new GroupsError('missing_verify_token');
  } else if (kind === 'waha' || kind === 'evolution') {
    if (!out.baseUrl || !/^https?:\/\/[^\s]+$/.test(out.baseUrl)) throw new GroupsError('invalid_base_url');
    out.baseUrl = out.baseUrl.replace(/\/+$/, '');
    if (!out.apiKey) throw new GroupsError('missing_api_key');
    if (out.session && !/^[A-Za-z0-9_-]{1,60}$/.test(out.session)) throw new GroupsError('invalid_session');
  }
  return out as ProviderConfig;
}

export async function listNumbers(ws: string): Promise<NumberDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM groups_numbers WHERE user_id = ? ORDER BY created_at').all(ws)) as NumberRow[];
  return rows.map(toNumberDto);
}

export async function getNumberRow(ws: string, id: string): Promise<NumberRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_numbers WHERE id = ? AND user_id = ?').get(id, ws)) as NumberRow) ?? null;
}

export async function getNumberRowById(id: string): Promise<NumberRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_numbers WHERE id = ?').get(id)) as NumberRow) ?? null;
}

export async function createNumber(
  ws: string,
  actor: string,
  input: { name?: string; provider: string; config?: Record<string, unknown> },
): Promise<NumberDto> {
  const kind = input.provider as ProviderKind;
  if (!availableProviders().includes(kind)) throw new GroupsError('invalid_provider');
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_numbers WHERE user_id = ?').get(ws)) as { c: number };
  if (Number(count.c) >= 50) throw new GroupsError('too_many_numbers');
  const cfg = cleanConfig(kind, input.config ?? {});
  if ((kind === 'waha' || kind === 'evolution') && !cfg.session) cfg.session = `zs-${randomBytes(4).toString('hex')}`;
  const id = newId();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO groups_numbers (id, user_id, name, provider, status, config, webhook_secret, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .run(id, ws, (input.name ?? '').trim().slice(0, 80) || defaultNumberName(kind), kind, seal(JSON.stringify(cfg)), randomBytes(24).toString('hex'), actor, now, now);
  return toNumberDto((await getNumberRow(ws, id)) as NumberRow);
}

function defaultNumberName(kind: ProviderKind): string {
  return kind === 'cloud' ? 'WhatsApp Cloud API' : kind === 'waha' ? 'WAHA' : kind === 'evolution' ? 'Evolution API' : 'Demo number';
}

export async function updateNumber(
  ws: string,
  id: string,
  input: { name?: string; config?: Record<string, unknown> },
): Promise<NumberDto> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  const sets: string[] = [];
  const args: Array<string> = [];
  if (typeof input.name === 'string') {
    sets.push('name = ?');
    args.push(input.name.trim().slice(0, 80) || row.name);
  }
  if (input.config) {
    sets.push('config = ?');
    args.push(seal(JSON.stringify(cleanConfig(row.provider, input.config, readConfig(row)))));
  }
  if (sets.length) {
    await getDb()
      .prepare(`UPDATE groups_numbers SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(...args, nowIso(), id, ws);
  }
  return toNumberDto((await getNumberRow(ws, id)) as NumberRow);
}

export async function deleteNumber(ws: string, id: string): Promise<boolean> {
  const row = await getNumberRow(ws, id);
  if (!row) return false;
  await providerFor(row)
    .disconnect()
    .catch(() => null);
  const r = await getDb().prepare('DELETE FROM groups_numbers WHERE id = ? AND user_id = ?').run(id, ws);
  return r.changes > 0;
}

/** El adaptador del número, con sus credenciales descifradas. */
export function providerFor(row: NumberRow): GroupsProvider {
  const cfg = readConfig(row);
  switch (row.provider) {
    case 'cloud':
      return cloudProvider(cfg as CloudConfig);
    case 'waha':
    case 'evolution':
      return bridgeProvider(row.provider, cfg as BridgeConfig, { webhookSecret: row.webhook_secret });
    case 'fake':
      if (!fakeProviderAllowed()) throw new GroupsError('provider_unavailable', 503);
      return fakeProvider(row.id);
    default:
      throw new GroupsError('provider_unavailable', 503);
  }
}

/** Base pública para los webhooks (lo que el proveedor puede alcanzar). */
export function groupsBaseUrl(origin?: string | null): string {
  const env = process.env.GROUPS_WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return String(env || origin || 'http://localhost:3000').replace(/\/+$/, '');
}

export function webhookUrlFor(row: Pick<NumberRow, 'id' | 'webhook_secret'>, origin?: string | null): string {
  return `${groupsBaseUrl(origin)}/api/groups/webhook/${row.id}/${row.webhook_secret}`;
}

function providerErrorCode(err: unknown): string {
  if (err instanceof ProviderError) return err.code;
  if (err instanceof GroupsError) return err.code;
  return 'provider_error';
}

async function saveState(row: NumberRow, state: ConnectState | null, error = ''): Promise<void> {
  await getDb()
    .prepare('UPDATE groups_numbers SET status = ?, phone = ?, last_error = ?, updated_at = ? WHERE id = ?')
    .run(state?.status ?? 'error', state?.phone ? phoneDigits(state.phone) : row.phone, error, nowIso(), row.id);
}

export async function connectNumber(ws: string, id: string, origin?: string | null): Promise<ConnectState> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  try {
    const state = await providerFor(row).connect(webhookUrlFor(row, origin));
    await saveState(row, state);
    return state;
  } catch (err) {
    const code = providerErrorCode(err);
    await saveState(row, null, code);
    throw new GroupsError(code, 502);
  }
}

export async function refreshNumber(ws: string, id: string): Promise<ConnectState> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  try {
    const state = await providerFor(row).state();
    await saveState(row, state);
    return state;
  } catch (err) {
    const code = providerErrorCode(err);
    await saveState(row, null, code);
    throw new GroupsError(code, 502);
  }
}

export async function disconnectNumber(ws: string, id: string): Promise<void> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  await providerFor(row)
    .disconnect()
    .catch(() => null);
  await saveState(row, { status: 'disconnected' });
}

// ======================================================================
// Chats
// ======================================================================

export interface ChatRow {
  id: string;
  user_id: string;
  number_id: string;
  provider_chat_id: string;
  kind: 'dm' | 'group';
  name: string;
  phone: string;
  description: string;
  invite_link: string;
  member_count: number;
  assigned_to: string | null;
  properties: string;
  crm_contact_id: string | null;
  crm_company_id: string | null;
  agent_id: string | null;
  agent_conversation_id: string | null;
  status: 'open' | 'closed';
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
  awaiting_since: string | null;
  flagged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LabelDto {
  id: string;
  name: string;
  color: string;
}

export interface ChatDto {
  id: string;
  numberId: string;
  kind: 'dm' | 'group';
  name: string;
  phone: string;
  description: string;
  inviteLink: string;
  memberCount: number;
  assignedTo: string | null;
  properties: Record<string, unknown>;
  crmContactId: string | null;
  crmCompanyId: string | null;
  agentId: string | null;
  status: 'open' | 'closed';
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  awaitingSince: string | null;
  flagged: boolean;
  labels: LabelDto[];
  createdAt: string;
  /** Fragmento del mensaje que coincide con la búsqueda. */
  match?: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Nombre visible: el del grupo o contacto, o el teléfono con +. */
export function chatDisplayName(row: Pick<ChatRow, 'name' | 'phone' | 'provider_chat_id'>): string {
  return row.name || (row.phone ? `+${row.phone}` : row.provider_chat_id);
}

export function toChatDto(row: ChatRow, labels: LabelDto[] = []): ChatDto {
  return {
    id: row.id,
    numberId: row.number_id,
    kind: row.kind,
    name: chatDisplayName(row),
    phone: row.phone,
    description: row.description,
    inviteLink: row.invite_link,
    memberCount: row.member_count,
    assignedTo: row.assigned_to,
    properties: parseJson<Record<string, unknown>>(row.properties, {}),
    crmContactId: row.crm_contact_id,
    crmCompanyId: row.crm_company_id,
    agentId: row.agent_id,
    status: row.status,
    unread: row.unread_count,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    awaitingSince: row.awaiting_since,
    flagged: Boolean(row.flagged_at),
    labels,
    createdAt: row.created_at,
  };
}

async function labelsFor(chatIds: string[]): Promise<Map<string, LabelDto[]>> {
  const out = new Map<string, LabelDto[]>();
  if (chatIds.length === 0) return out;
  const marks = chatIds.map(() => '?').join(',');
  const rows = (await getDb()
    .prepare(
      `SELECT cl.chat_id, l.id, l.name, l.color FROM groups_chat_labels cl JOIN groups_labels l ON l.id = cl.label_id
       WHERE cl.chat_id IN (${marks}) ORDER BY l.name COLLATE NOCASE`,
    )
    .all(...chatIds)) as Array<{ chat_id: string; id: string; name: string; color: string }>;
  for (const r of rows) {
    const list = out.get(r.chat_id) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    out.set(r.chat_id, list);
  }
  return out;
}

export async function getChatRow(ws: string, id: string): Promise<ChatRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_chats WHERE id = ? AND user_id = ?').get(id, ws)) as ChatRow) ?? null;
}

export async function getChat(ws: string, id: string): Promise<ChatDto | null> {
  const row = await getChatRow(ws, id);
  if (!row) return null;
  return toChatDto(row, (await labelsFor([row.id])).get(row.id) ?? []);
}

export const CHAT_FILTERS = ['all', 'unread', 'unanswered', 'flagged', 'mine', 'unassigned', 'closed'] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];

export interface ChatQuery {
  filter?: ChatFilter;
  q?: string;
  labelId?: string;
  kind?: 'dm' | 'group';
  numberId?: string;
  limit?: number;
  offset?: number;
}

function likeArg(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listChats(ws: string, me: string, query: ChatQuery = {}): Promise<{ rows: ChatDto[]; total: number }> {
  const where: string[] = ['c.user_id = ?'];
  const args: Array<string | number> = [ws];
  const filter = query.filter ?? 'all';
  if (filter === 'closed') where.push("c.status = 'closed'");
  else where.push("c.status = 'open'");
  if (filter === 'unread') where.push('c.unread_count > 0');
  if (filter === 'unanswered') where.push('c.awaiting_since IS NOT NULL');
  if (filter === 'flagged') where.push('c.flagged_at IS NOT NULL');
  if (filter === 'mine') {
    where.push('c.assigned_to = ?');
    args.push(me);
  }
  if (filter === 'unassigned') where.push('c.assigned_to IS NULL');
  if (query.kind) {
    where.push('c.kind = ?');
    args.push(query.kind);
  }
  if (query.numberId) {
    where.push('c.number_id = ?');
    args.push(query.numberId);
  }
  if (query.labelId) {
    where.push('EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id AND cl.label_id = ?)');
    args.push(query.labelId);
  }
  const q = (query.q ?? '').trim().slice(0, 200);
  let matchSelect = 'NULL AS match';
  const matchArgs: string[] = [];
  if (q) {
    const like = likeArg(q);
    where.push(
      `(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM groups_messages m WHERE m.chat_id = c.id AND m.body LIKE ? ESCAPE '\\'))`,
    );
    args.push(like, like, like);
    matchSelect = `(SELECT body FROM groups_messages m WHERE m.chat_id = c.id AND m.body LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 1) AS match`;
    matchArgs.push(like);
  }
  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const offset = Math.max(0, query.offset ?? 0);
  const whereSql = where.join(' AND ');
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM groups_chats c WHERE ${whereSql}`).get(...args)) as { c: number };
  const rows = (await db
    .prepare(
      `SELECT c.*, ${matchSelect} FROM groups_chats c WHERE ${whereSql}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id LIMIT ? OFFSET ?`,
    )
    .all(...matchArgs, ...args, limit, offset)) as Array<ChatRow & { match: string | null }>;
  const labels = await labelsFor(rows.map((r) => r.id));
  return {
    rows: rows.map((r) => ({ ...toChatDto(r, labels.get(r.id) ?? []), ...(r.match ? { match: r.match.slice(0, 160) } : {}) })),
    total: Number(total.c),
  };
}

/** Busca o crea el chat de un número (por id del proveedor). */
export async function upsertChat(
  number: Pick<NumberRow, 'id' | 'user_id'>,
  input: { providerChatId: string; kind: 'dm' | 'group'; name?: string; phone?: string },
): Promise<ChatRow> {
  const db = getDb();
  const now = nowIso();
  await db
    .prepare(
      `INSERT OR IGNORE INTO groups_chats (id, user_id, number_id, provider_chat_id, kind, name, phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), number.user_id, number.id, input.providerChatId, input.kind, (input.name ?? '').slice(0, 200), input.phone ?? '', now, now);
  const row = (await db
    .prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?')
    .get(number.id, input.providerChatId)) as ChatRow;
  // El nombre de un 1:1 viene del perfil del contacto: se completa si faltaba.
  if (input.name && !row.name) {
    await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(input.name.slice(0, 200), row.id);
    row.name = input.name.slice(0, 200);
  }
  return row;
}

export interface ChatPatch {
  name?: string;
  description?: string;
  assignedTo?: string | null;
  status?: 'open' | 'closed';
  crmContactId?: string | null;
  crmCompanyId?: string | null;
  agentId?: string | null;
  properties?: Record<string, unknown>;
  labelIds?: string[];
  read?: boolean;
  flagged?: boolean;
}

async function assertWorkspacePerson(ws: string, personId: string): Promise<void> {
  const { isWorkspacePerson } = await import('./crm-refs');
  if (!(await isWorkspacePerson(ws, personId))) throw new GroupsError('invalid_assignee');
}

export async function updateChat(ws: string, id: string, patch: ChatPatch): Promise<ChatDto> {
  const row = await getChatRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };

  // Nombre y descripción de un grupo se cambian también en WhatsApp.
  if (patch.name !== undefined || patch.description !== undefined) {
    const name = patch.name !== undefined ? patch.name.trim().slice(0, 100) : undefined;
    const description = patch.description !== undefined ? patch.description.trim().slice(0, 2000) : undefined;
    if (name !== undefined && !name) throw new GroupsError('invalid_name');
    if (row.kind === 'group') {
      const number = await getNumberRow(ws, row.number_id);
      if (!number) throw new GroupsError('not_found', 404);
      try {
        await providerFor(number).updateGroup(row.provider_chat_id, { name, description });
      } catch (err) {
        throw new GroupsError(providerErrorCode(err), 502);
      }
    }
    if (name !== undefined) set('name', name);
    if (description !== undefined) set('description', description);
  }
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo) await assertWorkspacePerson(ws, patch.assignedTo);
    set('assigned_to', patch.assignedTo || null);
  }
  if (patch.status) set('status', patch.status);
  if (patch.crmContactId !== undefined) {
    if (patch.crmContactId) {
      const ok = await db.prepare('SELECT 1 AS x FROM crm_contacts WHERE id = ? AND user_id = ?').get(patch.crmContactId, ws);
      if (!ok) throw new GroupsError('invalid_contact');
    }
    set('crm_contact_id', patch.crmContactId || null);
  }
  if (patch.crmCompanyId !== undefined) {
    if (patch.crmCompanyId) {
      const ok = await db.prepare('SELECT 1 AS x FROM crm_companies WHERE id = ? AND user_id = ?').get(patch.crmCompanyId, ws);
      if (!ok) throw new GroupsError('invalid_company');
    }
    set('crm_company_id', patch.crmCompanyId || null);
  }
  if (patch.agentId !== undefined) {
    if (patch.agentId) {
      const ok = await db.prepare('SELECT 1 AS x FROM agents WHERE id = ? AND user_id = ?').get(patch.agentId, ws);
      if (!ok) throw new GroupsError('invalid_agent');
    }
    set('agent_id', patch.agentId || null);
    if (patch.agentId !== row.agent_id) set('agent_conversation_id', null);
  }
  if (patch.properties !== undefined) set('properties', JSON.stringify(await cleanProperties(ws, patch.properties)));
  if (patch.read) set('unread_count', 0);
  if (patch.flagged === false) {
    set('flagged_at', null);
    set('awaiting_since', null);
  }
  if (patch.flagged === true) set('flagged_at', nowIso());
  if (sets.length) {
    await db.prepare(`UPDATE groups_chats SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...args, nowIso(), id, ws);
  }
  if (patch.labelIds !== undefined) await setChatLabels(ws, id, patch.labelIds);
  return (await getChat(ws, id)) as ChatDto;
}

/**
 * Saca el chat de Groups (no borra el grupo en WhatsApp: no se puede). Si
 * llega un mensaje nuevo, vuelve a aparecer.
 */
export async function deleteChat(ws: string, id: string): Promise<boolean> {
  const r = await getDb().prepare('DELETE FROM groups_chats WHERE id = ? AND user_id = ?').run(id, ws);
  return r.changes > 0;
}

// ======================================================================
// Mensajes
// ======================================================================

export interface MessageRow {
  id: string;
  user_id: string;
  chat_id: string;
  number_id: string;
  provider_message_id: string | null;
  direction: 'in' | 'out' | 'note' | 'system';
  sender_phone: string;
  sender_name: string;
  author_id: string | null;
  author_kind: string;
  body: string;
  media_url: string;
  media_type: string;
  media_name: string;
  reply_to_id: string | null;
  reactions: string;
  status: string;
  error: string;
  created_at: string;
}

export interface Reaction {
  emoji: string;
  by: string;
  fromMe: boolean;
}

export interface MessageDto {
  id: string;
  chatId: string;
  direction: MessageRow['direction'];
  senderPhone: string;
  senderName: string;
  authorId: string | null;
  authorKind: string;
  body: string;
  media: { url: string; type: string; name: string } | null;
  replyToId: string | null;
  reactions: Reaction[];
  status: string;
  error: string;
  createdAt: string;
  ticketId?: string | null;
}

/** URL de la media para el navegador: las de proveedor pasan por el proxy autenticado. */
function mediaUrlFor(row: MessageRow): string {
  if (!row.media_url) return '';
  if (row.media_url.startsWith('meta:') || row.media_url.startsWith('bridge:')) return `/api/groups/media/${row.id}`;
  return row.media_url;
}

export function toMessageDto(row: MessageRow & { ticket_id?: string | null }): MessageDto {
  return {
    id: row.id,
    chatId: row.chat_id,
    direction: row.direction,
    senderPhone: row.sender_phone,
    senderName: row.sender_name,
    authorId: row.author_id,
    authorKind: row.author_kind,
    body: row.body,
    media: row.media_type ? { url: mediaUrlFor(row), type: row.media_type, name: row.media_name } : null,
    replyToId: row.reply_to_id,
    reactions: parseJson<Reaction[]>(row.reactions, []),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    ticketId: row.ticket_id ?? null,
  };
}

export async function listMessages(
  ws: string,
  chatId: string,
  opts: { after?: string; limit?: number } = {},
): Promise<MessageDto[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM (
         SELECT m.*, m.rowid AS rn, (SELECT t.id FROM groups_tickets t WHERE t.message_id = m.id) AS ticket_id
         FROM groups_messages m WHERE m.chat_id = ? AND m.user_id = ? AND (? IS NULL OR m.created_at > ?)
         ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?
       ) ORDER BY created_at ASC, rn ASC`,
    )
    .all(chatId, ws, opts.after ?? null, opts.after ?? null, limit)) as Array<MessageRow & { ticket_id: string | null }>;
  return rows.map(toMessageDto);
}

export async function getMessageRow(ws: string, id: string): Promise<MessageRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_messages WHERE id = ? AND user_id = ?').get(id, ws)) as MessageRow) ?? null;
}

/**
 * Vista previa de la lista: el texto, o el nombre del archivo, o un marcador
 * neutro ([image], [audio], [video], [file]) que la interfaz traduce.
 */
export function previewOf(body: string, mediaType: string, mediaName = ''): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 140);
  if (mediaName.trim()) return mediaName.trim().slice(0, 140);
  return mediaType ? `[${mediaKind(mediaType)}]` : '';
}

interface InsertMessage {
  ws: string;
  chatId: string;
  numberId: string;
  providerMessageId: string | null;
  direction: MessageRow['direction'];
  senderPhone?: string;
  senderName?: string;
  authorId?: string | null;
  authorKind?: string;
  body: string;
  media?: { url: string; type: string; name: string } | null;
  replyToId?: string | null;
  status: string;
  error?: string;
  createdAt?: string;
}

/** Inserta un mensaje. null si ya existía (mismo id del proveedor en el número). */
async function insertMessage(m: InsertMessage): Promise<MessageRow | null> {
  const id = newId();
  const r = await getDb()
    .prepare(
      `INSERT OR IGNORE INTO groups_messages (id, user_id, chat_id, number_id, provider_message_id, direction, sender_phone, sender_name,
         author_id, author_kind, body, media_url, media_type, media_name, reply_to_id, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      m.ws,
      m.chatId,
      m.numberId,
      m.providerMessageId,
      m.direction,
      m.senderPhone ?? '',
      (m.senderName ?? '').slice(0, 120),
      m.authorId ?? null,
      m.authorKind ?? 'person',
      m.body.slice(0, 8000),
      m.media?.url ?? '',
      m.media?.type ?? '',
      (m.media?.name ?? '').slice(0, 200),
      m.replyToId ?? null,
      m.status,
      m.error ?? '',
      m.createdAt ?? nowIso(),
    );
  if (r.changes === 0) return null;
  return (await getDb().prepare('SELECT * FROM groups_messages WHERE id = ?').get(id)) as MessageRow;
}

/** Después de responder: el chat deja de esperar y los tickets abiertos toman su primera respuesta. */
async function markAnswered(chatId: string, at: string): Promise<void> {
  const db = getDb();
  await db.prepare('UPDATE groups_chats SET awaiting_since = NULL, flagged_at = NULL, updated_at = ? WHERE id = ?').run(at, chatId);
  await db
    .prepare(
      "UPDATE groups_tickets SET first_response_at = ?, updated_at = ? WHERE chat_id = ? AND first_response_at IS NULL AND status IN ('open', 'in_progress')",
    )
    .run(at, at, chatId);
}

async function touchChat(chatId: string, at: string, preview: string, incoming: boolean): Promise<void> {
  const db = getDb();
  if (incoming) {
    await db
      .prepare(
        `UPDATE groups_chats SET last_message_at = ?, last_message_preview = ?, unread_count = unread_count + 1,
           awaiting_since = COALESCE(awaiting_since, ?), status = 'open', updated_at = ? WHERE id = ?`,
      )
      .run(at, preview, at, at, chatId);
  } else {
    await db
      .prepare('UPDATE groups_chats SET last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE id = ?')
      .run(at, preview, at, chatId);
  }
}

export interface SendInput {
  body: string;
  replyToId?: string | null;
  media?: { url: string; mimetype: string; filename: string } | null;
  note?: boolean;
  authorKind?: 'person' | 'agent' | 'broadcast' | 'scheduled' | 'flow' | 'api';
}

export async function sendMessage(ws: string, actor: string | null, chatId: string, input: SendInput): Promise<MessageDto> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  const body = (input.body ?? '').slice(0, 4096);
  if (!body.trim() && !input.media) throw new GroupsError('empty_message');

  if (input.note) {
    const row = await insertMessage({
      ws,
      chatId,
      numberId: chat.number_id,
      providerMessageId: null,
      direction: 'note',
      authorId: actor,
      body,
      status: 'sent',
    });
    return toMessageDto(row as MessageRow);
  }

  const number = await getNumberRow(ws, chat.number_id);
  if (!number) throw new GroupsError('not_found', 404);
  let replyProviderId: string | undefined;
  if (input.replyToId) {
    const target = await getMessageRow(ws, input.replyToId);
    if (!target || target.chat_id !== chatId) throw new GroupsError('invalid_reply');
    replyProviderId = target.provider_message_id ?? undefined;
  }
  const provider = providerFor(number);
  let providerId: string | null = null;
  let status = 'sent';
  let error = '';
  try {
    const res = input.media
      ? await provider.sendMedia(chat.provider_chat_id, { ...input.media, caption: body })
      : await provider.sendText(chat.provider_chat_id, body, { replyTo: replyProviderId });
    providerId = res.id || null;
  } catch (err) {
    status = 'failed';
    error = providerErrorCode(err);
  }
  const at = nowIso();
  const row = await insertMessage({
    ws,
    chatId,
    numberId: chat.number_id,
    providerMessageId: providerId,
    direction: 'out',
    authorId: actor,
    authorKind: input.authorKind ?? 'person',
    body,
    media: input.media ? { url: input.media.url, type: input.media.mimetype, name: input.media.filename } : null,
    replyToId: input.replyToId ?? null,
    status,
    error,
    createdAt: at,
  });
  if (status === 'sent') {
    await touchChat(chatId, at, previewOf(body, input.media?.mimetype ?? '', input.media?.filename ?? ''), false);
    // Un envío masivo no es una respuesta: el chat sigue esperando y el ticket sin primera respuesta.
    if (input.authorKind !== 'broadcast') await markAnswered(chatId, at);
  }
  // Un webhook con el mismo id del proveedor (eco de lo que mandamos) no duplica: lo frena el índice único.
  return toMessageDto(row as MessageRow);
}

export async function reactToMessage(ws: string, actor: string, messageId: string, emoji: string): Promise<MessageDto> {
  const msg = await getMessageRow(ws, messageId);
  if (!msg || msg.direction === 'note' || msg.direction === 'system') throw new GroupsError('not_found', 404);
  if (!msg.provider_message_id) throw new GroupsError('not_sent');
  const chat = await getChatRow(ws, msg.chat_id);
  const number = chat ? await getNumberRow(ws, chat.number_id) : null;
  if (!chat || !number) throw new GroupsError('not_found', 404);
  const clean = String(emoji ?? '').trim().slice(0, 16);
  try {
    await providerFor(number).react(chat.provider_chat_id, msg.provider_message_id, clean, msg.direction === 'out');
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await applyReaction(msg, { emoji: clean, by: actor, fromMe: true });
  if (clean) await maybeTicketFromReaction(ws, msg, clean, actor);
  return toMessageDto((await getMessageRow(ws, messageId)) as MessageRow);
}

async function applyReaction(msg: MessageRow, r: Reaction): Promise<void> {
  const list = parseJson<Reaction[]>(msg.reactions, []).filter((x) => x.by !== r.by);
  if (r.emoji) list.push(r);
  await getDb().prepare('UPDATE groups_messages SET reactions = ? WHERE id = ?').run(JSON.stringify(list.slice(-50)), msg.id);
}

async function maybeTicketFromReaction(ws: string, msg: MessageRow, emoji: string, actor: string | null): Promise<void> {
  const settings = await getSettings(ws);
  if (!reactionCreatesTicket(settings, emoji)) return;
  const { createTicket } = await import('./groups-tickets');
  await createTicket(ws, actor, { chatId: msg.chat_id, messageId: msg.id, source: 'reaction' }).catch(() => null);
}

// ======================================================================
// Webhook: eventos del proveedor
// ======================================================================

export interface IngestResult {
  messages: number;
  duplicates: number;
  ignored: number;
}

export async function ingestEvents(number: NumberRow, events: InboundEvent[]): Promise<IngestResult> {
  const res: IngestResult = { messages: 0, duplicates: 0, ignored: 0 };
  const ws = number.user_id;
  for (const ev of events.slice(0, 200)) {
    try {
      if (ev.type === 'message') {
        const isGroup = ev.isGroup || isGroupJid(ev.chatId);
        const chat = await upsertChat(number, {
          providerChatId: ev.chatId,
          kind: isGroup ? 'group' : 'dm',
          name: isGroup ? ev.chatName : ev.fromMe ? undefined : ev.senderName || ev.chatName,
          phone: isGroup ? '' : phoneDigits(ev.chatId),
        });
        let replyToId: string | null = null;
        if (ev.replyToProviderId) {
          const target = (await getDb()
            .prepare('SELECT id FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
            .get(number.id, ev.replyToProviderId)) as { id: string } | undefined;
          replyToId = target?.id ?? null;
        }
        const at = ev.timestamp && Number.isFinite(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toISOString() : nowIso();
        const row = await insertMessage({
          ws,
          chatId: chat.id,
          numberId: number.id,
          providerMessageId: ev.providerMessageId,
          direction: ev.fromMe ? 'out' : 'in',
          senderPhone: ev.senderPhone,
          senderName: ev.senderName,
          authorKind: ev.fromMe ? 'phone' : 'person',
          body: ev.body,
          media: ev.media && (ev.media.type || ev.media.url) ? ev.media : null,
          replyToId,
          status: ev.fromMe ? 'sent' : 'received',
          createdAt: at,
        });
        if (!row) {
          res.duplicates++;
          continue;
        }
        res.messages++;
        await touchChat(chat.id, at, previewOf(ev.body, ev.media?.type ?? '', ev.media?.name ?? ''), !ev.fromMe);
        // Grupo que no conocíamos: se traen sus miembros una vez (best effort).
        if (chat.kind === 'group' && chat.member_count === 0 && PROVIDER_CAPS[number.provider].groups) {
          await syncMembers(ws, chat.id).catch(() => null);
        }
        // Quien escribe en un grupo es miembro: se guarda (o completa) su nombre de perfil.
        if (chat.kind === 'group' && !ev.fromMe && ev.senderPhone) {
          const r = await getDb()
            .prepare(
              `INSERT INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, 'member', ?)
               ON CONFLICT(chat_id, phone) DO UPDATE SET name = excluded.name WHERE excluded.name != '' AND groups_members.name != excluded.name`,
            )
            .run(chat.id, phoneDigits(ev.senderPhone), (ev.senderName ?? '').slice(0, 120), at);
          if (r.changes > 0) await refreshMemberCount(chat.id);
        }
        if (ev.fromMe) {
          // Respondido desde el teléfono: también cuenta como respuesta.
          await markAnswered(chat.id, at);
          continue;
        }
        await afterInbound(ws, chat, row);
      } else if (ev.type === 'reaction') {
        const msg = (await getDb()
          .prepare('SELECT * FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
          .get(number.id, ev.targetProviderMessageId)) as MessageRow | undefined;
        if (!msg) {
          res.ignored++;
          continue;
        }
        await applyReaction(msg, { emoji: ev.emoji, by: ev.fromMe ? 'phone' : ev.senderPhone, fromMe: ev.fromMe });
        if (ev.emoji) await maybeTicketFromReaction(ws, msg, ev.emoji, null);
      } else if (ev.type === 'status') {
        // Nunca vuelve atrás (read no pasa a delivered).
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const row = (await getDb()
          .prepare('SELECT id, status FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
          .get(number.id, ev.providerMessageId)) as { id: string; status: string } | undefined;
        if (row && (rank[ev.status] ?? 0) > (rank[row.status] ?? 0)) {
          await getDb().prepare('UPDATE groups_messages SET status = ? WHERE id = ?').run(ev.status, row.id);
        }
      } else if (ev.type === 'participants') {
        const chat = (await getDb()
          .prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?')
          .get(number.id, ev.chatId)) as ChatRow | undefined;
        if (!chat) {
          res.ignored++;
          continue;
        }
        await applyMemberChange(chat.id, ev.action, ev.phones);
      } else if (ev.type === 'session') {
        await saveState(number, { status: ev.status, phone: ev.phone });
      }
    } catch (err) {
      res.ignored++;
      // eslint-disable-next-line no-console
      console.error('[groups] webhook event failed', (err as Error)?.name ?? 'error');
    }
  }
  return res;
}

/** Mensaje de cliente nuevo: ticket por palabra clave, eventos (Flow/webhooks) y agente. */
async function afterInbound(ws: string, chat: ChatRow, msg: MessageRow): Promise<void> {
  const settings = await getSettings(ws);
  const keyword = matchKeyword(settings.ticketKeywords, msg.body);
  if (keyword) {
    const { createTicket } = await import('./groups-tickets');
    await createTicket(ws, null, { chatId: chat.id, messageId: msg.id, source: 'keyword' }).catch(() => null);
  }
  await emitEventSoon(ws, 'groups.message.received', {
    message: { id: msg.id, body: msg.body, senderPhone: msg.sender_phone, senderName: msg.sender_name, createdAt: msg.created_at },
    chat: { id: chat.id, kind: chat.kind, name: chatDisplayName(chat), crmCompanyId: chat.crm_company_id, crmContactId: chat.crm_contact_id },
  });
  if (chat.agent_id && msg.body.trim()) {
    // El agente puede tardar (modelo, herramientas): contesta después de responderle al webhook.
    const job = async () => {
      const { replyWithAgent } = await import('./groups-agent');
      await replyWithAgent(ws, chat.id, msg.id).catch(() => null);
    };
    try {
      const { after } = await import('next/server');
      after(job);
    } catch {
      await job();
    }
  }
}

// ======================================================================
// Miembros y grupos
// ======================================================================

export interface MemberDto {
  phone: string;
  name: string;
  role: MemberRole;
}

export async function listMembers(ws: string, chatId: string): Promise<MemberDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.phone, m.name, m.role FROM groups_members m JOIN groups_chats c ON c.id = m.chat_id
       WHERE m.chat_id = ? AND c.user_id = ? ORDER BY CASE m.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.phone`,
    )
    .all(chatId, ws)) as MemberDto[];
  return rows;
}

async function refreshMemberCount(chatId: string): Promise<void> {
  await getDb()
    .prepare('UPDATE groups_chats SET member_count = (SELECT COUNT(*) FROM groups_members WHERE chat_id = ?) WHERE id = ?')
    .run(chatId, chatId);
}

async function applyMemberChange(chatId: string, action: ParticipantAction, phones: string[]): Promise<void> {
  const db = getDb();
  const now = nowIso();
  for (const raw of phones) {
    const phone = phoneDigits(raw);
    if (!phone) continue;
    if (action === 'add') {
      await db.prepare('INSERT OR IGNORE INTO groups_members (chat_id, phone, role, created_at) VALUES (?, ?, ?, ?)').run(chatId, phone, 'member', now);
    } else if (action === 'remove') {
      await db.prepare('DELETE FROM groups_members WHERE chat_id = ? AND phone = ?').run(chatId, phone);
    } else {
      await db
        .prepare("UPDATE groups_members SET role = ? WHERE chat_id = ? AND phone = ? AND role != 'superadmin'")
        .run(action === 'promote' ? 'admin' : 'member', chatId, phone);
    }
  }
  await refreshMemberCount(chatId);
}

async function groupContext(ws: string, chatId: string): Promise<{ chat: ChatRow; provider: GroupsProvider }> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (chat.kind !== 'group') throw new GroupsError('not_a_group');
  const number = await getNumberRow(ws, chat.number_id);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) throw new GroupsError('groups_unsupported');
  return { chat, provider };
}

/** Vuelve a leer los miembros desde WhatsApp. */
export async function syncMembers(ws: string, chatId: string): Promise<MemberDto[]> {
  const { chat, provider } = await groupContext(ws, chatId);
  let list;
  try {
    list = await provider.participants(chat.provider_chat_id);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  const db = getDb();
  const now = nowIso();
  // Los nombres que ya conocíamos (de sus mensajes) se conservan: WhatsApp no siempre los manda.
  const known = new Map(
    ((await db.prepare('SELECT phone, name FROM groups_members WHERE chat_id = ?').all(chatId)) as Array<{ phone: string; name: string }>).map((m) => [
      m.phone,
      m.name,
    ]),
  );
  await db.prepare('DELETE FROM groups_members WHERE chat_id = ?').run(chatId);
  for (const p of list.slice(0, 2000)) {
    if (!p.phone) continue;
    await db
      .prepare('INSERT OR REPLACE INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(chatId, p.phone, (p.name || known.get(p.phone) || '').slice(0, 120), p.role, now);
  }
  await refreshMemberCount(chatId);
  return listMembers(ws, chatId);
}

export interface BulkMemberResult {
  chatId: string;
  name: string;
  ok: boolean;
  error?: string;
  results: ParticipantResult[];
}

/** Agrega, quita, promueve o degrada los mismos teléfonos en varios grupos. */
export async function updateMembers(
  ws: string,
  chatIds: string[],
  action: ParticipantAction,
  rawPhones: string[],
): Promise<BulkMemberResult[]> {
  const phones = [...new Set(splitPhones(rawPhones).map(phoneDigits).filter((p) => isValidPhone(p)))].slice(0, 200);
  if (phones.length === 0) throw new GroupsError('invalid_phones');
  const ids = [...new Set(chatIds)].slice(0, 100);
  const out: BulkMemberResult[] = [];
  for (const chatId of ids) {
    try {
      const { chat, provider } = await groupContext(ws, chatId);
      const results = await provider.updateParticipants(chat.provider_chat_id, action, phones);
      await applyMemberChange(
        chatId,
        action,
        results.filter((r) => r.ok).map((r) => r.phone),
      );
      out.push({ chatId, name: chatDisplayName(chat), ok: true, results });
    } catch (err) {
      const chat = await getChatRow(ws, chatId);
      out.push({ chatId, name: chat ? chatDisplayName(chat) : chatId, ok: false, error: providerErrorCode(err), results: [] });
    }
  }
  return out;
}

export interface CreateGroupRow {
  name: string;
  phones: string[];
  description?: string;
  admins?: string[];
  labelIds?: string[];
  crmCompanyId?: string | null;
}

export interface CreateGroupResult {
  name: string;
  ok: boolean;
  chatId?: string;
  error?: string;
  /** Teléfonos que WhatsApp no dejó agregar (privacidad): reciben el link. */
  notAdded?: string[];
}

export const MAX_BULK_GROUPS = 50;

/** Crea uno o varios grupos desde un número (de a uno, en orden). */
export async function createGroups(ws: string, numberId: string, rows: CreateGroupRow[]): Promise<CreateGroupResult[]> {
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) throw new GroupsError('groups_unsupported');
  if (rows.length === 0) throw new GroupsError('empty');
  if (rows.length > MAX_BULK_GROUPS) throw new GroupsError('too_many_groups');
  const out: CreateGroupResult[] = [];
  for (const r of rows) {
    const name = String(r.name ?? '').trim().slice(0, 100);
    if (!name) {
      out.push({ name: '', ok: false, error: 'invalid_name' });
      continue;
    }
    const phones = [...new Set(splitPhones(r.phones ?? []).map(phoneDigits).filter((p) => isValidPhone(p)))].slice(0, 1000);
    try {
      const info = await provider.createGroup(name, phones);
      const chat = await upsertChat(number, { providerChatId: info.id, kind: 'group', name });
      const db = getDb();
      const now = nowIso();
      await db.prepare('UPDATE groups_chats SET name = ?, last_message_at = COALESCE(last_message_at, ?) WHERE id = ?').run(name, now, chat.id);
      // Miembros reales desde WhatsApp (los que no se pudieron agregar no aparecen).
      let members: Array<{ phone: string; role: MemberRole }> = [];
      try {
        members = await provider.participants(info.id);
      } catch {
        members = phones.map((phone) => ({ phone, role: 'member' as const }));
      }
      for (const m of members) {
        await db
          .prepare('INSERT OR REPLACE INTO groups_members (chat_id, phone, role, created_at) VALUES (?, ?, ?, ?)')
          .run(chat.id, m.phone, m.role, now);
      }
      await refreshMemberCount(chat.id);
      const added = new Set(members.map((m) => m.phone));
      const notAdded = phones.filter((p) => !added.has(p));
      if (r.description?.trim()) {
        await provider.updateGroup(info.id, { description: r.description.trim().slice(0, 2000) }).catch(() => null);
        await db.prepare('UPDATE groups_chats SET description = ? WHERE id = ?').run(r.description.trim().slice(0, 2000), chat.id);
      }
      const admins = (r.admins ?? []).map(phoneDigits).filter((p) => added.has(p));
      if (admins.length) {
        const res = await provider.updateParticipants(info.id, 'promote', admins).catch(() => []);
        await applyMemberChange(chat.id, 'promote', res.filter((x) => x.ok).map((x) => x.phone));
      }
      if (r.labelIds?.length) await setChatLabels(ws, chat.id, r.labelIds);
      if (r.crmCompanyId) await updateChat(ws, chat.id, { crmCompanyId: r.crmCompanyId }).catch(() => null);
      out.push({ name, ok: true, chatId: chat.id, notAdded });
    } catch (err) {
      out.push({ name, ok: false, error: providerErrorCode(err) });
    }
  }
  return out;
}

/**
 * CSV de grupos → filas. Columnas (con encabezado): name, participants
 * (teléfonos separados por espacio o ;), description, admins.
 */
export function parseGroupsCsv(rows: string[][]): { rows: CreateGroupRow[]; errors: Array<{ line: number; error: string }> } {
  const errors: Array<{ line: number; error: string }> = [];
  if (rows.length === 0) return { rows: [], errors: [{ line: 1, error: 'empty' }] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iName = col(['name', 'nombre', 'nome', 'group', 'grupo', 'subject']);
  const iPhones = col(['participants', 'members', 'phones', 'participantes', 'miembros', 'membros', 'telefonos', 'teléfonos', 'telefones']);
  const iDesc = col(['description', 'descripcion', 'descripción', 'descricao', 'descrição']);
  const iAdmins = col(['admins', 'administradores']);
  if (iName < 0) return { rows: [], errors: [{ line: 1, error: 'missing_name_column' }] };
  const out: CreateGroupRow[] = [];
  rows.slice(1).forEach((r, i) => {
    const name = (r[iName] ?? '').trim();
    if (!name && r.every((c) => !c.trim())) return;
    if (!name) {
      errors.push({ line: i + 2, error: 'invalid_name' });
      return;
    }
    const split = (v: string | undefined) =>
      String(v ?? '')
        .split(/[\s;,|]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const phones = iPhones >= 0 ? split(r[iPhones]) : [];
    const bad = phones.filter((p) => !isValidPhone(p));
    if (bad.length) errors.push({ line: i + 2, error: `invalid_phone:${bad.slice(0, 3).join(' ')}` });
    out.push({
      name,
      phones: phones.filter((p) => isValidPhone(p)).map(phoneDigits),
      description: iDesc >= 0 ? (r[iDesc] ?? '').trim() : '',
      admins: iAdmins >= 0 ? split(r[iAdmins]).filter((p) => isValidPhone(p)).map(phoneDigits) : [],
    });
  });
  return { rows: out, errors };
}

export async function groupInviteLink(ws: string, chatId: string, revoke = false): Promise<string> {
  const { chat, provider } = await groupContext(ws, chatId);
  let link: string;
  try {
    link = await provider.inviteLink(chat.provider_chat_id, revoke);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await getDb().prepare('UPDATE groups_chats SET invite_link = ?, updated_at = ? WHERE id = ?').run(link, nowIso(), chatId);
  return link;
}

/** Trae los grupos del número desde WhatsApp (y sus miembros, hasta 50 grupos). */
export async function syncGroups(ws: string, numberId: string): Promise<{ groups: number }> {
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) return { groups: 0 };
  let list;
  try {
    list = await provider.listGroups();
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  let n = 0;
  for (const g of list.slice(0, 1000)) {
    const chat = await upsertChat(number, { providerChatId: g.id, kind: 'group', name: g.name });
    if (g.name && g.name !== chat.name) await getDb().prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(g.name.slice(0, 200), chat.id);
    if (n < 50) await syncMembers(ws, chat.id).catch(() => null);
    n++;
  }
  return { groups: n };
}

// ======================================================================
// Etiquetas
// ======================================================================

export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;

export async function listLabels(ws: string): Promise<Array<LabelDto & { count: number }>> {
  return (await getDb()
    .prepare(
      `SELECT l.id, l.name, l.color, (SELECT COUNT(*) FROM groups_chat_labels cl WHERE cl.label_id = l.id) AS count
       FROM groups_labels l WHERE l.user_id = ? ORDER BY l.name COLLATE NOCASE`,
    )
    .all(ws)) as Array<LabelDto & { count: number }>;
}

function cleanLabel(input: { name?: string; color?: string }): { name: string; color: string } {
  const name = String(input.name ?? '').trim().slice(0, 40);
  if (!name) throw new GroupsError('invalid_name');
  const color = (LABEL_COLORS as readonly string[]).includes(String(input.color)) ? String(input.color) : 'gray';
  return { name, color };
}

export async function createLabel(ws: string, input: { name?: string; color?: string }): Promise<LabelDto> {
  const { name, color } = cleanLabel(input);
  const id = newId();
  const r = await getDb()
    .prepare('INSERT OR IGNORE INTO groups_labels (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, ws, name, color, nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_label', 409);
  return { id, name, color };
}

export async function updateLabel(ws: string, id: string, input: { name?: string; color?: string }): Promise<LabelDto> {
  const { name, color } = cleanLabel(input);
  try {
    const r = await getDb().prepare('UPDATE groups_labels SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(name, color, id, ws);
    if (r.changes === 0) throw new GroupsError('not_found', 404);
  } catch (err) {
    if (err instanceof GroupsError) throw err;
    throw new GroupsError('duplicate_label', 409);
  }
  return { id, name, color };
}

export async function deleteLabel(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_labels WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

export async function setChatLabels(ws: string, chatId: string, labelIds: string[]): Promise<void> {
  const db = getDb();
  const valid = (await db.prepare('SELECT id FROM groups_labels WHERE user_id = ?').all(ws)) as Array<{ id: string }>;
  const ok = new Set(valid.map((v) => v.id));
  const ids = [...new Set(labelIds)].filter((x) => ok.has(x)).slice(0, 20);
  await db.prepare('DELETE FROM groups_chat_labels WHERE chat_id = ?').run(chatId);
  for (const id of ids) await db.prepare('INSERT OR IGNORE INTO groups_chat_labels (chat_id, label_id) VALUES (?, ?)').run(chatId, id);
}

// ======================================================================
// Propiedades propias
// ======================================================================

export interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date';
  options: string[];
}

export async function listPropertyDefs(ws: string): Promise<PropertyDef[]> {
  const rows = (await getDb()
    .prepare('SELECT id, key, label, type, options FROM groups_property_defs WHERE user_id = ? ORDER BY position, created_at')
    .all(ws)) as Array<Omit<PropertyDef, 'options'> & { options: string }>;
  return rows.map((r) => ({ ...r, options: parseJson<string[]>(r.options, []) }));
}

export async function createPropertyDef(
  ws: string,
  input: { label?: string; type?: string; options?: string[] },
): Promise<PropertyDef> {
  const label = String(input.label ?? '').trim().slice(0, 60);
  if (!label) throw new GroupsError('invalid_name');
  const type = (['text', 'number', 'select', 'date'] as const).find((t) => t === input.type) ?? 'text';
  const key =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || `prop_${randomBytes(3).toString('hex')}`;
  const options = type === 'select' ? [...new Set((input.options ?? []).map((o) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 50) : [];
  if (type === 'select' && options.length === 0) throw new GroupsError('missing_options');
  const id = newId();
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_property_defs WHERE user_id = ?').get(ws)) as { c: number };
  const r = await getDb()
    .prepare('INSERT OR IGNORE INTO groups_property_defs (id, user_id, key, label, type, options, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, key, label, type, JSON.stringify(options), Number(count.c), nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_property', 409);
  return { id, key, label, type, options };
}

export async function deletePropertyDef(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_property_defs WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

/** Valores de propiedades → solo claves definidas y valores del tipo correcto. */
export async function cleanProperties(ws: string, input: Record<string, unknown>): Promise<Record<string, string | number>> {
  const defs = await listPropertyDefs(ws);
  const out: Record<string, string | number> = {};
  for (const d of defs) {
    const v = input[d.key];
    if (v === undefined || v === null || v === '') continue;
    if (d.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new GroupsError(`invalid_property:${d.key}`);
      out[d.key] = n;
    } else if (d.type === 'select') {
      if (!d.options.includes(String(v))) throw new GroupsError(`invalid_property:${d.key}`);
      out[d.key] = String(v);
    } else if (d.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new GroupsError(`invalid_property:${d.key}`);
      out[d.key] = String(v);
    } else out[d.key] = String(v).slice(0, 500);
  }
  return out;
}

// ======================================================================
// Respuestas rápidas
// ======================================================================

export interface QuickReply {
  id: string;
  shortcut: string;
  body: string;
}

export async function listQuickReplies(ws: string): Promise<QuickReply[]> {
  return (await getDb()
    .prepare('SELECT id, shortcut, body FROM groups_quick_replies WHERE user_id = ? ORDER BY shortcut')
    .all(ws)) as QuickReply[];
}

function cleanQuickReply(input: { shortcut?: string; body?: string }): { shortcut: string; body: string } {
  const shortcut = String(input.shortcut ?? '')
    .trim()
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30);
  const body = String(input.body ?? '').trim().slice(0, 4000);
  if (!shortcut) throw new GroupsError('invalid_shortcut');
  if (!body) throw new GroupsError('empty_message');
  return { shortcut, body };
}

export async function createQuickReply(ws: string, input: { shortcut?: string; body?: string }): Promise<QuickReply> {
  const { shortcut, body } = cleanQuickReply(input);
  const id = newId();
  const r = await getDb()
    .prepare('INSERT OR IGNORE INTO groups_quick_replies (id, user_id, shortcut, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, ws, shortcut, body, nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_shortcut', 409);
  return { id, shortcut, body };
}

export async function updateQuickReply(ws: string, id: string, input: { shortcut?: string; body?: string }): Promise<QuickReply> {
  const { shortcut, body } = cleanQuickReply(input);
  try {
    const r = await getDb().prepare('UPDATE groups_quick_replies SET shortcut = ?, body = ? WHERE id = ? AND user_id = ?').run(shortcut, body, id, ws);
    if (r.changes === 0) throw new GroupsError('not_found', 404);
  } catch (err) {
    if (err instanceof GroupsError) throw err;
    throw new GroupsError('duplicate_shortcut', 409);
  }
  return { id, shortcut, body };
}

export async function deleteQuickReply(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_quick_replies WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

// ======================================================================
// Ajustes
// ======================================================================

export async function getSettings(ws: string): Promise<GroupsSettings> {
  const row = (await getDb().prepare('SELECT data FROM groups_settings WHERE user_id = ?').get(ws)) as { data: string } | undefined;
  return row ? normalizeSettings(parseJson(row.data, {})) : { ...DEFAULT_SETTINGS };
}

export async function updateSettings(ws: string, patch: Partial<GroupsSettings>): Promise<GroupsSettings> {
  const next = normalizeSettings({ ...(await getSettings(ws)), ...patch });
  await getDb()
    .prepare(
      `INSERT INTO groups_settings (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(ws, JSON.stringify(next), nowIso());
  return next;
}

// ======================================================================
// Personas del workspace (asignar)
// ======================================================================

export interface GroupsPerson {
  id: string;
  name: string;
  email: string;
}

export async function listPeople(ws: string, teamId: string | null): Promise<GroupsPerson[]> {
  const db = getDb();
  const owner = (await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(ws)) as GroupsPerson | undefined;
  const people: GroupsPerson[] = owner ? [{ ...owner, name: owner.name ?? '' }] : [];
  if (teamId) {
    const rows = (await db
      .prepare('SELECT u.id, u.name, u.email FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ?')
      .all(teamId)) as GroupsPerson[];
    for (const r of rows) if (!people.some((p) => p.id === r.id)) people.push({ ...r, name: r.name ?? '' });
  }
  return people;
}

// ======================================================================
// CRM: chats vinculados a un registro
// ======================================================================

export interface CrmChatSummary {
  chat: ChatDto;
  messages: MessageDto[];
  openTickets: number;
}

/** Chats vinculados a un contacto o empresa, con sus últimos mensajes (timeline del registro). */
export async function chatsForCrmRecord(
  ws: string,
  kind: 'contact' | 'company',
  recordId: string,
  messagesPerChat = 5,
): Promise<CrmChatSummary[]> {
  const col = kind === 'contact' ? 'crm_contact_id' : 'crm_company_id';
  const rows = (await getDb()
    .prepare(`SELECT * FROM groups_chats WHERE user_id = ? AND ${col} = ? ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 10`)
    .all(ws, recordId)
    .catch(() => [])) as ChatRow[];
  const labels = await labelsFor(rows.map((r) => r.id));
  const out: CrmChatSummary[] = [];
  for (const r of rows) {
    const msgs = (await getDb()
      .prepare(
        "SELECT * FROM groups_messages WHERE chat_id = ? AND direction IN ('in', 'out') ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(r.id, messagesPerChat)) as MessageRow[];
    const open = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM groups_tickets WHERE chat_id = ? AND status IN ('open', 'in_progress')")
      .get(r.id)) as { c: number };
    out.push({ chat: toChatDto(r, labels.get(r.id) ?? []), messages: msgs.reverse().map(toMessageDto), openTickets: Number(open.c) });
  }
  return out;
}
