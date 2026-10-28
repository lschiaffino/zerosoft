/**
 * Groups, bandeja: lo que se hace sobre los mensajes (editar, borrar para
 * todos, fijar, reenviar), notas con @menciones, historial y avisos de
 * asignación, acciones en masa sobre chats, equipos, disponibilidad,
 * asignación automática round-robin y registro de llamadas. Server-only.
 *
 * El historial vive en el mismo hilo: mensajes `system` con author_kind
 * 'event' (asignado, equipo, cerrado, reabierto) o 'call' (llamadas), con el
 * detalle en `meta`. Ni el resumen AI, ni las métricas, ni el CRM los
 * cuentan (filtran por direction 'in' / 'out').
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { createNotification } from './notifications';
import { findMentions, newMentions } from './crm-mentions';
import {
  GroupsError,
  chatDisplayName,
  getChatRow,
  getMessageRow,
  getNumberRow,
  insertMessage,
  listPeople,
  refreshChatPreview,
  markAnswered,
  providerErrorCode,
  providerFor,
  sendMessage,
  toMessageDto,
  touchChat,
  upsertChat,
  type ChatPatch,
  type ChatRow,
  type GroupsPerson,
  type MessageDto,
  type MessageRow,
  type NumberRow,
} from './groups';
import { PROVIDER_CAPS, phoneDigits, type InboundEvent } from './groups-provider';
import { MAX_FORWARD_TARGETS, MAX_PINNED, callStatusRank, messageActions, nextInRotation, ruleMatches } from './groups-inbox-rules';

const nowIso = () => new Date().toISOString();

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ======================================================================
// Personas
// ======================================================================

/** Dueño del workspace y miembros de sus teams (a quién se puede asignar o mencionar). Misma lista que listPeople. */
export async function workspacePeople(ws: string): Promise<GroupsPerson[]> {
  return listPeople(ws);
}

async function personName(id: string | null): Promise<string> {
  if (!id) return '';
  const r = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(id)) as { name: string | null; email: string } | undefined;
  return r ? r.name || r.email : '';
}

// ======================================================================
// Historial y avisos
// ======================================================================

export type ChatEvent =
  | { event: 'assigned' | 'unassigned'; to: string | null; by: string | null }
  | { event: 'auto_assigned'; to: string; rule: string }
  | { event: 'team'; team: string | null; teamName: string; by: string | null }
  | { event: 'closed' | 'reopened'; by: string | null };

async function logEvent(ws: string, chat: Pick<ChatRow, 'id' | 'number_id'>, actor: string | null, meta: ChatEvent): Promise<void> {
  await insertMessage({
    ws,
    chatId: chat.id,
    numberId: chat.number_id,
    providerMessageId: null,
    direction: 'system',
    authorId: actor,
    authorKind: 'event',
    body: '',
    status: 'sent',
    meta: meta as unknown as Record<string, unknown>,
  });
}

const chatHref = (chatId: string, messageId?: string) => `/app/groups/inbox/${chatId}${messageId ? `#m-${messageId}` : ''}`;

async function notifyAssigned(actor: string | null, chat: ChatRow, personId: string, rule?: string): Promise<void> {
  const actorName = rule ? '' : await personName(actor);
  const chatName = chatDisplayName(chat);
  await createNotification({
    userId: personId,
    type: 'assigned',
    title: rule ? `New WhatsApp chat for you: ${chatName}` : `${actorName || 'Someone'} assigned you ${chatName}`,
    href: chatHref(chat.id),
    sourceType: 'groups_chat',
    sourceId: chat.id,
    meta: { actorName, chatName, ...(rule ? { rule } : {}) },
  }).catch(() => null);
}

/** Después de updateChat: historial de asignación y cierre, aviso a quien recibe el chat y asignación automática. */
export async function afterChatChange(ws: string, actor: string | null, before: ChatRow, patch: ChatPatch): Promise<void> {
  const db = getDb();
  if (patch.assignedTo !== undefined && (patch.assignedTo || null) !== before.assigned_to) {
    const to = patch.assignedTo || null;
    await logEvent(ws, before, actor, { event: to ? 'assigned' : 'unassigned', to, by: actor });
    if (to && to !== actor) await notifyAssigned(actor, before, to);
  }
  if (patch.assignedTeamId !== undefined && (patch.assignedTeamId || null) !== (before.assigned_team_id ?? null)) {
    const team = patch.assignedTeamId || null;
    const name = team ? ((await db.prepare('SELECT name FROM groups_teams WHERE id = ?').get(team)) as { name: string } | undefined)?.name ?? '' : '';
    await logEvent(ws, before, actor, { event: 'team', team, teamName: name, by: actor });
  }
  if (patch.status && patch.status !== before.status) {
    await logEvent(ws, before, actor, { event: patch.status === 'closed' ? 'closed' : 'reopened', by: actor });
  }
  // Una etiqueta nueva o un chat reabierto pueden caer en una regla.
  if (patch.labelIds !== undefined || (patch.status === 'open' && before.status !== 'open')) {
    await autoAssignChat(ws, before.id).catch(() => null);
  }
}

/** Nota guardada o editada: guarda las menciones y avisa a las personas nuevas. */
export async function afterNoteSaved(ws: string, actor: string | null, chat: ChatRow, row: MessageRow, previousBody: string): Promise<MessageRow> {
  const people = await workspacePeople(ws);
  const mentions = findMentions(row.body, people);
  const meta = { ...parseJson<Record<string, unknown>>(row.meta, {}), mentions };
  await getDb().prepare('UPDATE groups_messages SET meta = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
  const fresh = newMentions(previousBody, row.body, people).filter((id) => id !== actor);
  if (fresh.length) {
    const actorName = await personName(actor);
    const chatName = chatDisplayName(chat);
    for (const userId of fresh) {
      await createNotification({
        userId,
        type: 'mention',
        title: `${actorName || 'Someone'} mentioned you in ${chatName}`,
        body: row.body.slice(0, 280),
        href: chatHref(chat.id, row.id),
        sourceType: 'groups_chat',
        sourceId: chat.id,
        meta: { actorName, chatName, messageId: row.id },
      }).catch(() => null);
    }
  }
  return { ...row, meta: JSON.stringify(meta) };
}

// ======================================================================
// Acciones sobre mensajes
// ======================================================================

async function messageContext(ws: string, messageId: string) {
  const msg = await getMessageRow(ws, messageId);
  if (!msg) throw new GroupsError('not_found', 404);
  const chat = await getChatRow(ws, msg.chat_id);
  if (!chat) throw new GroupsError('not_found', 404);
  const number = await getNumberRow(ws, chat.number_id);
  if (!number) throw new GroupsError('not_found', 404);
  return { msg, chat, number, caps: PROVIDER_CAPS[number.provider] };
}

function actionsFor(msg: MessageRow, caps: (typeof PROVIDER_CAPS)['fake'], viewer: { me: string; isAdmin: boolean }) {
  const dto = toMessageDto(msg);
  // Sin id del proveedor no hay nada que tocar en WhatsApp.
  const sent = msg.direction !== 'out' || Boolean(msg.provider_message_id);
  return messageActions({ ...dto, status: sent ? dto.status : 'failed' }, caps, viewer);
}

async function freshDto(ws: string, id: string): Promise<MessageDto> {
  return toMessageDto((await getMessageRow(ws, id)) as MessageRow);
}

/** Edita una nota (cualquier momento, quien la escribió o un admin) o un mensaje propio en WhatsApp (15 min). */
export async function editMessage(ws: string, viewer: { me: string; isAdmin: boolean }, messageId: string, text: string): Promise<MessageDto> {
  const { msg, chat, number, caps } = await messageContext(ws, messageId);
  const body = String(text ?? '').slice(0, 4096);
  if (!body.trim()) throw new GroupsError('empty_message');
  if (!actionsFor(msg, caps, viewer).edit) {
    if (msg.direction === 'out' && !caps.edit) throw new GroupsError('unsupported');
    if (msg.direction === 'note') throw new GroupsError('forbidden', 403);
    throw new GroupsError('edit_window');
  }
  if (body === msg.body) return toMessageDto(msg);
  if (msg.direction === 'out') {
    try {
      await providerFor(number).editMessage(chat.provider_chat_id, msg.provider_message_id as string, body);
    } catch (err) {
      throw new GroupsError(providerErrorCode(err), 502);
    }
  }
  await getDb().prepare('UPDATE groups_messages SET body = ?, edited_at = ? WHERE id = ?').run(body, nowIso(), msg.id);
  await refreshChatPreview(msg.id);
  if (msg.direction === 'note') {
    const updated = (await getMessageRow(ws, msg.id)) as MessageRow;
    return toMessageDto(await afterNoteSaved(ws, viewer.me, chat, updated, msg.body));
  }
  return freshDto(ws, msg.id);
}

/**
 * Borra una nota (de verdad) o un mensaje propio para todos en WhatsApp: el
 * mensaje queda en el hilo marcado como borrado, con el texto para el equipo.
 */
export async function deleteMessage(
  ws: string,
  viewer: { me: string; isAdmin: boolean },
  messageId: string,
): Promise<{ removed: boolean; message: MessageDto | null }> {
  const { msg, chat, number, caps } = await messageContext(ws, messageId);
  if (!actionsFor(msg, caps, viewer).delete) {
    if (msg.direction === 'out' && !caps.deleteForAll) throw new GroupsError('unsupported');
    if (msg.direction === 'note') throw new GroupsError('forbidden', 403);
    if (msg.direction === 'out') throw new GroupsError('delete_window');
    throw new GroupsError('message_not_deletable');
  }
  if (msg.direction === 'note') {
    await getDb().prepare('DELETE FROM groups_messages WHERE id = ? AND user_id = ?').run(msg.id, ws);
    return { removed: true, message: null };
  }
  try {
    await providerFor(number).deleteMessage(chat.provider_chat_id, msg.provider_message_id as string);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await getDb().prepare('UPDATE groups_messages SET deleted_at = ?, pinned_at = NULL, pinned_by = NULL WHERE id = ?').run(nowIso(), msg.id);
  await refreshChatPreview(msg.id);
  return { removed: false, message: await freshDto(ws, msg.id) };
}

/**
 * Fija o desfija. Si el proveedor fija en WhatsApp (WAHA) también lo hace
 * ahí; si no (Cloud API, Evolution, notas), queda fijado solo en Groups.
 */
export async function pinMessage(
  ws: string,
  actor: string,
  messageId: string,
  pin: boolean,
): Promise<{ message: MessageDto; inWhatsApp: boolean }> {
  const { msg, chat, number, caps } = await messageContext(ws, messageId);
  if (pin && !actionsFor(msg, caps, { me: actor, isAdmin: true }).pin) throw new GroupsError('not_pinnable');
  const db = getDb();
  if (pin && !msg.pinned_at) {
    const count = (await db.prepare('SELECT COUNT(*) AS c FROM groups_messages WHERE chat_id = ? AND pinned_at IS NOT NULL').get(chat.id)) as { c: number };
    if (Number(count.c) >= MAX_PINNED) throw new GroupsError('too_many_pins');
  }
  const inWhatsApp = caps.pin && msg.direction !== 'note' && Boolean(msg.provider_message_id);
  if (inWhatsApp) {
    try {
      await providerFor(number).pinMessage(chat.provider_chat_id, msg.provider_message_id as string, pin);
    } catch (err) {
      throw new GroupsError(providerErrorCode(err), 502);
    }
  }
  await db
    .prepare('UPDATE groups_messages SET pinned_at = ?, pinned_by = ? WHERE id = ?')
    .run(pin ? msg.pinned_at || nowIso() : null, pin ? actor : null, msg.id);
  return { message: await freshDto(ws, msg.id), inWhatsApp };
}

/** Mensajes fijados del chat (los más nuevos primero). */
export async function listPinned(ws: string, chatId: string): Promise<MessageDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM groups_messages WHERE chat_id = ? AND user_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC LIMIT ?')
    .all(chatId, ws, MAX_PINNED)) as MessageRow[];
  return rows.map(toMessageDto);
}

export interface ForwardResult {
  chatId: string;
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * Reenvía a otros chats. Con el mismo número y un proveedor que reenvía
 * (WAHA, falso) usa el reenvío de WhatsApp; si no, manda una copia del texto
 * y del archivo (si el archivo tiene una URL pública: lo que llegó por la
 * Cloud API o el puente no se puede copiar).
 */
export async function forwardMessage(ws: string, actor: string, messageId: string, chatIds: string[]): Promise<ForwardResult[]> {
  const { msg, chat: source, number, caps } = await messageContext(ws, messageId);
  if (!actionsFor(msg, caps, { me: actor, isAdmin: true }).forward) throw new GroupsError('not_forwardable');
  const ids = [...new Set(chatIds)].filter((id) => id && id !== source.id).slice(0, MAX_FORWARD_TARGETS);
  if (ids.length === 0) throw new GroupsError('no_recipients');
  const copyableMedia = msg.media_type && /^(https:\/\/|\/uploads\/)/.test(msg.media_url) ? { url: msg.media_url, mimetype: msg.media_type, filename: msg.media_name || 'file' } : null;
  const out: ForwardResult[] = [];
  for (const id of ids) {
    const target = await getChatRow(ws, id);
    if (!target) {
      out.push({ chatId: id, name: id, ok: false, error: 'not_found' });
      continue;
    }
    const name = chatDisplayName(target);
    try {
      if (target.number_id === number.id && caps.forward && msg.provider_message_id) {
        const res = await providerFor(number).forwardMessage(target.provider_chat_id, source.provider_chat_id, msg.provider_message_id);
        const at = nowIso();
        await insertMessage({
          ws,
          chatId: target.id,
          numberId: number.id,
          providerMessageId: res.id || null,
          direction: 'out',
          authorId: actor,
          body: msg.body,
          media: msg.media_type ? { url: msg.media_url, type: msg.media_type, name: msg.media_name } : null,
          status: 'sent',
          createdAt: at,
          forwarded: true,
        });
        await touchChat(target.id, at, (msg.body || msg.media_name || '').slice(0, 140), false);
        await markAnswered(target.id, at);
        out.push({ chatId: id, name, ok: true });
        continue;
      }
      if (msg.media_type && !copyableMedia) throw new GroupsError('cannot_forward_media');
      const sent = await sendMessage(ws, actor, target.id, { body: msg.body, media: copyableMedia, forwarded: true });
      out.push(sent.status === 'failed' ? { chatId: id, name, ok: false, error: sent.error || 'send_failed' } : { chatId: id, name, ok: true });
    } catch (err) {
      out.push({ chatId: id, name, ok: false, error: providerErrorCode(err) });
    }
  }
  return out;
}

// ======================================================================
// Acciones en masa sobre chats
// ======================================================================

export const BULK_ACTIONS = ['close', 'reopen', 'read', 'unread', 'pin', 'unpin', 'assign'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export async function bulkChats(
  ws: string,
  actor: string,
  chatIds: string[],
  action: BulkAction,
  value?: string | null,
): Promise<{ updated: number; failed: number }> {
  if (!(BULK_ACTIONS as readonly string[]).includes(action)) throw new GroupsError('invalid_action');
  const patch: ChatPatch =
    action === 'close'
      ? { status: 'closed' }
      : action === 'reopen'
        ? { status: 'open' }
        : action === 'read'
          ? { read: true }
          : action === 'unread'
            ? { read: false }
            : action === 'pin'
              ? { pinned: true }
              : action === 'unpin'
                ? { pinned: false }
                : { assignedTo: value || null };
  let updated = 0;
  let failed = 0;
  // Como un cambio de a uno: auditoría, eventos (webhooks, Flow) y push al asignado.
  const { patchChatAs } = await import('./groups-chat-ops');
  for (const id of [...new Set(chatIds)].slice(0, 200)) {
    try {
      await patchChatAs(ws, { id: actor }, id, patch);
      updated++;
    } catch (err) {
      // Una persona que no es del workspace falla igual en todos: se corta.
      if (err instanceof GroupsError && err.code === 'invalid_assignee') throw err;
      failed++;
    }
  }
  return { updated, failed };
}

// ======================================================================
// Equipos y disponibilidad
// ======================================================================

export interface TeamDto {
  id: string;
  name: string;
  memberIds: string[];
}

export async function listTeams(ws: string): Promise<TeamDto[]> {
  const db = getDb();
  const teams = (await db.prepare('SELECT id, name FROM groups_teams WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(ws)) as Array<{
    id: string;
    name: string;
  }>;
  if (teams.length === 0) return [];
  const members = (await db
    .prepare(`SELECT team_id, person_id FROM groups_team_members WHERE team_id IN (${teams.map(() => '?').join(',')})`)
    .all(...teams.map((t) => t.id))) as Array<{ team_id: string; person_id: string }>;
  return teams.map((t) => ({ ...t, memberIds: members.filter((m) => m.team_id === t.id).map((m) => m.person_id) }));
}

async function cleanMemberIds(ws: string, ids: unknown): Promise<string[]> {
  const people = new Set((await workspacePeople(ws)).map((p) => p.id));
  return [...new Set(Array.isArray(ids) ? ids.map(String) : [])].filter((id) => people.has(id)).slice(0, 200);
}

async function setTeamMembers(teamId: string, ids: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM groups_team_members WHERE team_id = ?').run(teamId);
  for (const id of ids) await db.prepare('INSERT OR IGNORE INTO groups_team_members (team_id, person_id) VALUES (?, ?)').run(teamId, id);
}

function cleanName(raw: unknown, max = 60): string {
  const name = String(raw ?? '').trim().slice(0, max);
  if (!name) throw new GroupsError('invalid_name');
  return name;
}

export async function createTeam(ws: string, input: { name?: unknown; memberIds?: unknown }): Promise<TeamDto> {
  const name = cleanName(input.name);
  const id = randomUUID();
  const r = await getDb().prepare('INSERT OR IGNORE INTO groups_teams (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, ws, name, nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_team', 409);
  const memberIds = await cleanMemberIds(ws, input.memberIds);
  await setTeamMembers(id, memberIds);
  await syncWorkspaceGroup(ws, id);
  return { id, name, memberIds };
}

export async function updateTeam(ws: string, id: string, input: { name?: unknown; memberIds?: unknown }): Promise<TeamDto> {
  const db = getDb();
  const row = (await db.prepare('SELECT id, name FROM groups_teams WHERE id = ? AND user_id = ?').get(id, ws)) as { id: string; name: string } | undefined;
  if (!row) throw new GroupsError('not_found', 404);
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    try {
      await db.prepare('UPDATE groups_teams SET name = ? WHERE id = ?').run(name, id);
    } catch {
      throw new GroupsError('duplicate_team', 409);
    }
  }
  if (input.memberIds !== undefined) await setTeamMembers(id, await cleanMemberIds(ws, input.memberIds));
  await syncWorkspaceGroup(ws, id);
  return (await listTeams(ws)).find((t) => t.id === id) as TeamDto;
}

/** Borra el equipo: los chats quedan sin equipo y las reglas que lo usaban, apagadas. */
export async function deleteTeam(ws: string, id: string): Promise<boolean> {
  const db = getDb();
  const r = await db.prepare('DELETE FROM groups_teams WHERE id = ? AND user_id = ?').run(id, ws);
  if (r.changes === 0) return false;
  await db.prepare('UPDATE groups_chats SET assigned_team_id = NULL WHERE user_id = ? AND assigned_team_id = ?').run(ws, id);
  await db.prepare('UPDATE groups_assign_rules SET team_id = NULL, enabled = 0 WHERE user_id = ? AND team_id = ?').run(ws, id);
  await syncWorkspaceGroup(ws, id);
  return true;
}

/** El equipo es un subequipo del workspace: el directorio de Ajustes › Equipos y las demás apps se enteran. */
async function syncWorkspaceGroup(ws: string, id: string): Promise<void> {
  const { syncGroupFromApp } = await import('./workspace-groups');
  await syncGroupFromApp('groups', ws, id);
}

/** Disponibilidad por persona. Sin fila = disponible. */
export async function getAvailability(ws: string): Promise<Record<string, boolean>> {
  const rows = (await getDb().prepare('SELECT person_id, available FROM groups_availability WHERE user_id = ?').all(ws)) as Array<{
    person_id: string;
    available: number;
  }>;
  return Object.fromEntries(rows.map((r) => [r.person_id, r.available === 1]));
}

export async function setAvailability(ws: string, personId: string, available: boolean): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO groups_availability (user_id, person_id, available, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, person_id) DO UPDATE SET available = excluded.available, updated_at = excluded.updated_at`,
    )
    .run(ws, personId, available ? 1 : 0, nowIso());
  // Alguien volvió: los chats que esperaban sin nadie pueden ir a esa persona.
  if (available) await sweepAutoAssign({ ws, limit: 50 }).catch(() => null);
}

// ======================================================================
// Reglas de asignación automática
// ======================================================================

interface RuleRow {
  id: string;
  user_id: string;
  name: string;
  enabled: number;
  position: number;
  number_id: string | null;
  label_id: string | null;
  kind: 'dm' | 'group' | null;
  team_id: string | null;
  person_ids: string;
  last_person_id: string | null;
}

export interface AssignRuleDto {
  id: string;
  name: string;
  enabled: boolean;
  numberId: string | null;
  labelId: string | null;
  kind: 'dm' | 'group' | null;
  teamId: string | null;
  personIds: string[];
  lastPersonId: string | null;
}

function toRuleDto(r: RuleRow): AssignRuleDto {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    numberId: r.number_id,
    labelId: r.label_id,
    kind: r.kind,
    teamId: r.team_id,
    personIds: parseJson<string[]>(r.person_ids, []),
    lastPersonId: r.last_person_id,
  };
}

export async function listRules(ws: string): Promise<AssignRuleDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM groups_assign_rules WHERE user_id = ? ORDER BY position, created_at').all(ws)) as RuleRow[];
  return rows.map(toRuleDto);
}

interface RuleInput {
  name?: unknown;
  enabled?: unknown;
  numberId?: unknown;
  labelId?: unknown;
  kind?: unknown;
  teamId?: unknown;
  personIds?: unknown;
}

async function cleanRule(ws: string, input: RuleInput, prev?: AssignRuleDto): Promise<Omit<AssignRuleDto, 'id' | 'lastPersonId'>> {
  const db = getDb();
  const ref = async (v: unknown, table: string, fallback: string | null) => {
    if (v === undefined) return fallback;
    if (v === null || v === '') return null;
    const ok = await db.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ? AND user_id = ?`).get(String(v), ws);
    if (!ok) throw new GroupsError('invalid_rule');
    return String(v);
  };
  const out = {
    name: input.name !== undefined ? cleanName(input.name) : (prev?.name ?? cleanName('')),
    enabled: input.enabled !== undefined ? input.enabled === true : (prev?.enabled ?? true),
    numberId: await ref(input.numberId, 'groups_numbers', prev?.numberId ?? null),
    labelId: await ref(input.labelId, 'groups_labels', prev?.labelId ?? null),
    kind: input.kind !== undefined ? (input.kind === 'dm' || input.kind === 'group' ? input.kind : null) : (prev?.kind ?? null),
    teamId: await ref(input.teamId, 'groups_teams', prev?.teamId ?? null),
    personIds: input.personIds !== undefined ? await cleanMemberIds(ws, input.personIds) : (prev?.personIds ?? []),
  };
  // A quién rota: un equipo o una lista de personas.
  if (out.teamId) out.personIds = [];
  if (!out.teamId && out.personIds.length === 0) throw new GroupsError('rule_needs_people');
  return out;
}

export async function createRule(ws: string, input: RuleInput): Promise<AssignRuleDto> {
  const r = await cleanRule(ws, input);
  const id = randomUUID();
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM groups_assign_rules WHERE user_id = ?').get(ws)) as { c: number };
  if (Number(count.c) >= 50) throw new GroupsError('too_many_rules');
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO groups_assign_rules (id, user_id, name, enabled, position, number_id, label_id, kind, team_id, person_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ws, r.name, r.enabled ? 1 : 0, Number(count.c), r.numberId, r.labelId, r.kind, r.teamId, JSON.stringify(r.personIds), now, now);
  if (r.enabled) await sweepAutoAssign({ ws, limit: 50 }).catch(() => null);
  return (await listRules(ws)).find((x) => x.id === id) as AssignRuleDto;
}

export async function updateRule(ws: string, id: string, input: RuleInput): Promise<AssignRuleDto> {
  const prev = (await listRules(ws)).find((x) => x.id === id);
  if (!prev) throw new GroupsError('not_found', 404);
  const r = await cleanRule(ws, input, prev);
  await getDb()
    .prepare(
      `UPDATE groups_assign_rules SET name = ?, enabled = ?, number_id = ?, label_id = ?, kind = ?, team_id = ?, person_ids = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(r.name, r.enabled ? 1 : 0, r.numberId, r.labelId, r.kind, r.teamId, JSON.stringify(r.personIds), nowIso(), id, ws);
  if (r.enabled) await sweepAutoAssign({ ws, limit: 50 }).catch(() => null);
  return (await listRules(ws)).find((x) => x.id === id) as AssignRuleDto;
}

export async function deleteRule(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_assign_rules WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

/**
 * Asigna un chat abierto y sin asignar con la primera regla que aplica y
 * tiene alguien disponible. La rotación avanza con compare-and-set sobre
 * last_person_id y el chat se reclama con assigned_to IS NULL: dos mensajes
 * a la vez (o webhook y cron) no asignan dos veces ni saltean a nadie.
 */
export async function autoAssignChat(ws: string, chatId: string): Promise<string | null> {
  const db = getDb();
  const chat = await getChatRow(ws, chatId);
  if (!chat || chat.status !== 'open' || chat.assigned_to) return null;
  const rules = (await db
    .prepare('SELECT * FROM groups_assign_rules WHERE user_id = ? AND enabled = 1 ORDER BY position, created_at')
    .all(ws)) as RuleRow[];
  if (rules.length === 0) return null;
  const labelIds = ((await db.prepare('SELECT label_id FROM groups_chat_labels WHERE chat_id = ?').all(chat.id)) as Array<{ label_id: string }>).map(
    (r) => r.label_id,
  );
  const people = new Set((await workspacePeople(ws)).map((p) => p.id));
  const availability = await getAvailability(ws);
  for (const rule of rules) {
    if (!ruleMatches({ ...toRuleDto(rule), enabled: true }, { numberId: chat.number_id, kind: chat.kind, labelIds })) continue;
    const pool = rule.team_id
      ? ((await db.prepare('SELECT person_id FROM groups_team_members WHERE team_id = ?').all(rule.team_id)) as Array<{ person_id: string }>).map(
          (r) => r.person_id,
        )
      : parseJson<string[]>(rule.person_ids, []);
    const candidates = pool.filter((id) => people.has(id) && availability[id] !== false);
    if (candidates.length === 0) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = (await db.prepare('SELECT last_person_id FROM groups_assign_rules WHERE id = ?').get(rule.id)) as
        | { last_person_id: string | null }
        | undefined;
      if (!current) break;
      const pick = nextInRotation(candidates, current.last_person_id);
      if (!pick) break;
      const moved = await db
        .prepare('UPDATE groups_assign_rules SET last_person_id = ?, updated_at = ? WHERE id = ? AND last_person_id IS ?')
        .run(pick, nowIso(), rule.id, current.last_person_id);
      if (moved.changes === 0) continue;
      const claimed = await db
        .prepare(
          "UPDATE groups_chats SET assigned_to = ?, assigned_team_id = COALESCE(assigned_team_id, ?), updated_at = ? WHERE id = ? AND assigned_to IS NULL AND status = 'open'",
        )
        .run(pick, rule.team_id, nowIso(), chat.id);
      if (claimed.changes === 0) return null;
      await logEvent(ws, chat, null, { event: 'auto_assigned', to: pick, rule: rule.name });
      await notifyAssigned(null, chat, pick, rule.name);
      return pick;
    }
  }
  return null;
}

/** Cron: chats abiertos que esperan respuesta sin nadie asignado, en workspaces con reglas. */
export async function sweepAutoAssign(opts: { ws?: string; limit?: number } = {}): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.user_id, c.id FROM groups_chats c
       WHERE c.status = 'open' AND c.assigned_to IS NULL AND c.awaiting_since IS NOT NULL AND (? IS NULL OR c.user_id = ?)
         AND EXISTS (SELECT 1 FROM groups_assign_rules r WHERE r.user_id = c.user_id AND r.enabled = 1)
       ORDER BY c.awaiting_since LIMIT ?`,
    )
    .all(opts.ws ?? null, opts.ws ?? null, opts.limit ?? 100)) as Array<{ user_id: string; id: string }>;
  let n = 0;
  for (const r of rows) if (await autoAssignChat(r.user_id, r.id).catch(() => null)) n++;
  return n;
}

// ======================================================================
// Llamadas
// ======================================================================

export interface CallMeta {
  direction: 'in' | 'out';
  status: 'ringing' | 'answered' | 'ended' | 'missed' | 'rejected';
  durationSec?: number;
  recordingUrl?: string;
  isVideo?: boolean;
  startedAt: string;
  answeredAt?: string;
  endedAt?: string;
}

/**
 * Una llamada del proveedor → una línea en el chat (system, author_kind
 * 'call'), una por llamada: los eventos siguientes (atendida, terminada)
 * actualizan la misma. Una atendida cuenta como respuesta al cliente.
 */
export async function ingestCall(number: NumberRow, ev: Extract<InboundEvent, { type: 'call' }>): Promise<void> {
  const ws = number.user_id;
  const db = getDb();
  const chat = await upsertChat(number, {
    providerChatId: ev.chatId,
    kind: 'dm',
    name: ev.senderName || undefined,
    phone: phoneDigits(ev.chatId),
  });
  const at = ev.timestamp && Number.isFinite(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toISOString() : nowIso();
  const pid = `call:${ev.callId}`.slice(0, 200);
  const existing = (await db.prepare('SELECT * FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(number.id, pid)) as
    | MessageRow
    | undefined;
  const prev = existing ? parseJson<CallMeta>(existing.meta, { direction: ev.direction, status: 'ringing', startedAt: existing.created_at }) : null;
  const meta: CallMeta = prev ? { ...prev } : { direction: ev.direction, status: ev.status, startedAt: at };
  if (prev && callStatusRank(ev.status) >= callStatusRank(prev.status)) meta.status = ev.status;
  if (ev.status === 'answered') meta.answeredAt = meta.answeredAt ?? at;
  if (ev.isVideo) meta.isVideo = true;
  if (ev.recordingUrl && /^https:\/\//.test(ev.recordingUrl)) meta.recordingUrl = ev.recordingUrl.slice(0, 1000);
  if (callStatusRank(ev.status) === 3) {
    meta.endedAt = at;
    if (ev.durationSec && ev.durationSec > 0) meta.durationSec = Math.round(ev.durationSec);
    else if (ev.status === 'ended' && meta.answeredAt) meta.durationSec = Math.max(0, Math.round((Date.parse(at) - Date.parse(meta.answeredAt)) / 1000));
    // Terminó sin que nadie atienda: es una perdida.
    if (ev.status === 'ended' && !meta.durationSec && !meta.answeredAt) meta.status = 'missed';
  }
  if (existing) {
    await db.prepare('UPDATE groups_messages SET meta = ? WHERE id = ?').run(JSON.stringify(meta), existing.id);
  } else {
    await insertMessage({
      ws,
      chatId: chat.id,
      numberId: number.id,
      providerMessageId: pid,
      direction: 'system',
      senderPhone: ev.senderPhone,
      senderName: ev.senderName ?? '',
      authorKind: 'call',
      body: '',
      status: 'received',
      createdAt: at,
      meta: meta as unknown as Record<string, unknown>,
    });
    await touchChat(chat.id, at, '[call]', ev.direction === 'in');
  }
  if (meta.answeredAt || (meta.durationSec ?? 0) > 0) await markAnswered(chat.id, at);
}
