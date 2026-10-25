/**
 * Groups: ajustes del grupo en WhatsApp (foto, solo admins escriben o
 * editan, mensajes temporales), entrar por invitación y salir, plantillas de
 * grupo con miembros fijos y listas guardadas de chats. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import {
  CHAT_FILTERS,
  GroupsError,
  createGroups,
  getChat,
  getNumberRow,
  groupContext,
  groupsBaseUrl,
  listChats,
  providerErrorCode,
  providerFor,
  refreshMemberCount,
  sendMessage,
  syncMembers,
  upsertChat,
  type ChatDto,
  type ChatFilter,
  type ChatQuery,
  type CreateGroupResult,
  type CreateGroupRow,
  type PropertyFilter,
} from './groups';
import { EPHEMERAL_OPTIONS, inviteCodeFrom, isValidPhone, phoneDigits, splitPhones, type GroupSettingsPatch } from './groups-provider';

const nowIso = () => new Date().toISOString();

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function phonesOf(raw: unknown, max = 500): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  return [...new Set(splitPhones(list).map(phoneDigits).filter((p) => isValidPhone(p)))].slice(0, max);
}

// ======================================================================
// Ajustes del grupo
// ======================================================================

export interface GroupSettingsInput extends GroupSettingsPatch {
  /** URL de la foto (subida con /api/groups/upload) o null para sacarla. */
  picture?: { url: string; mimetype: string } | null;
}

/** URL que el gateway puede bajar: las subidas locales (/uploads/...) pasan a absolutas. */
export function publicUrl(url: string, origin?: string | null): string {
  return url.startsWith('/') ? `${groupsBaseUrl(origin)}${url}` : url;
}

export async function updateGroupSettings(ws: string, chatId: string, input: GroupSettingsInput, origin?: string | null): Promise<ChatDto> {
  const { chat, provider } = await groupContext(ws, chatId);
  if (chat.left_at) throw new GroupsError('group_left');
  const patch: GroupSettingsPatch = {};
  if (typeof input.announce === 'boolean') patch.announce = input.announce;
  if (typeof input.locked === 'boolean') patch.locked = input.locked;
  if (input.ephemeral !== undefined) {
    const e = Number(input.ephemeral);
    if (!(EPHEMERAL_OPTIONS as readonly number[]).includes(e)) throw new GroupsError('invalid_ephemeral');
    if (!provider.caps.ephemeral) throw new GroupsError('unsupported', 400);
    patch.ephemeral = e;
  }
  let picture: string | undefined;
  if (input.picture !== undefined) {
    if (input.picture && !/^image\/(png|jpe?g|webp)$/.test(input.picture.mimetype)) throw new GroupsError('invalid_image');
    if (input.picture && !/^(\/uploads\/|https:\/\/)/.test(input.picture.url)) throw new GroupsError('invalid_image');
    picture = input.picture?.url ?? '';
  }
  try {
    if (Object.keys(patch).length) await provider.updateGroupSettings(chat.provider_chat_id, patch);
    if (picture !== undefined) {
      await provider.setGroupPicture(
        chat.provider_chat_id,
        input.picture ? { url: publicUrl(input.picture.url, origin), mimetype: input.picture.mimetype } : null,
      );
    }
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  const sets: string[] = [];
  const args: Array<string | number> = [];
  const set = (col: string, v: string | number) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.announce !== undefined) set('announce', Number(patch.announce));
  if (patch.locked !== undefined) set('locked', Number(patch.locked));
  if (patch.ephemeral !== undefined) set('ephemeral', patch.ephemeral);
  if (picture !== undefined) set('picture_url', picture);
  if (sets.length) {
    await getDb().prepare(`UPDATE groups_chats SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...args, nowIso(), chatId, ws);
  }
  return (await getChat(ws, chatId)) as ChatDto;
}

// ======================================================================
// Entrar y salir
// ======================================================================

/** Entra a un grupo con el link (o código) de invitación desde un número y lo trae a Groups. */
export async function joinGroup(ws: string, numberId: string, invite: string): Promise<ChatDto> {
  const code = inviteCodeFrom(invite);
  if (!code) throw new GroupsError('invalid_invite');
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) throw new GroupsError('groups_unsupported');
  let info: { id: string; name?: string };
  try {
    info = await provider.joinGroup(code);
  } catch (err) {
    const c = providerErrorCode(err);
    throw new GroupsError(c === 'not_found' ? 'invite_invalid' : c, c === 'not_found' ? 400 : 502);
  }
  let name = info.name ?? '';
  if (!name) {
    const list = await provider.listGroups().catch(() => []);
    name = list.find((g) => g.id === info.id)?.name ?? '';
  }
  const chat = await upsertChat(number, { providerChatId: info.id, kind: 'group', name });
  const now = nowIso();
  await getDb()
    .prepare(
      "UPDATE groups_chats SET left_at = NULL, status = 'open', name = CASE WHEN ? != '' THEN ? ELSE name END, last_message_at = COALESCE(last_message_at, ?), updated_at = ? WHERE id = ?",
    )
    .run(name, name.slice(0, 200), now, now, chat.id);
  await syncMembers(ws, chat.id).catch(() => null);
  return (await getChat(ws, chat.id)) as ChatDto;
}

/** Sale del grupo en WhatsApp. El chat queda en Groups como historial, cerrado y sin miembros. */
export async function leaveGroup(ws: string, chatId: string): Promise<ChatDto> {
  const { chat, provider } = await groupContext(ws, chatId);
  if (chat.left_at) throw new GroupsError('group_left');
  try {
    await provider.leaveGroup(chat.provider_chat_id);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  const now = nowIso();
  const db = getDb();
  await db
    .prepare("UPDATE groups_chats SET left_at = ?, status = 'closed', awaiting_since = NULL, flagged_at = NULL, invite_link = '', updated_at = ? WHERE id = ?")
    .run(now, now, chatId);
  await db.prepare('DELETE FROM groups_members WHERE chat_id = ?').run(chatId);
  await refreshMemberCount(chatId);
  return (await getChat(ws, chatId)) as ChatDto;
}

// ======================================================================
// Plantillas de grupo
// ======================================================================

export interface TemplateSettings {
  announce?: boolean;
  locked?: boolean;
  ephemeral?: number;
}

export interface TemplateDto {
  id: string;
  name: string;
  /** Nombre del grupo con variables: "{{company}} · Soporte". */
  groupName: string;
  description: string;
  members: string[];
  admins: string[];
  labelIds: string[];
  welcome: string;
  settings: TemplateSettings;
  /** Variables que pide al usarla (las de nombre, descripción y bienvenida, sin las automáticas). */
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  group_name: string;
  description: string;
  members: string;
  admins: string;
  label_ids: string;
  welcome: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

/** Variables que se completan solas al crear el grupo. */
export const AUTO_VARIABLES = ['date', 'month', 'year'] as const;

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]{1,40})\s*\}\}/g;

export function templateVariables(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of String(t ?? '').matchAll(VAR_RE)) if (!(AUTO_VARIABLES as readonly string[]).includes(m[1])) out.add(m[1]);
  return [...out];
}

/** Variables de la plantilla que faltan o vienen vacías (todas son obligatorias). */
export function missingVariables(template: Pick<TemplateDto, 'variables'>, vars: Record<string, string>): string[] {
  return template.variables.filter((v) => !(vars[v] ?? '').trim());
}

/** Reemplaza {{var}}; las automáticas (date, month, year) salen de `now`. Las que faltan quedan vacías. */
export function renderTemplate(text: string, vars: Record<string, string>, now = new Date()): string {
  const auto: Record<string, string> = {
    date: now.toISOString().slice(0, 10),
    month: now.toISOString().slice(0, 7),
    year: String(now.getUTCFullYear()),
  };
  return String(text ?? '')
    .replace(VAR_RE, (_m, k: string) => (vars[k] ?? auto[k] ?? '').trim())
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function toTemplateDto(r: TemplateRow): TemplateDto {
  return {
    id: r.id,
    name: r.name,
    groupName: r.group_name,
    description: r.description,
    members: parseJson<string[]>(r.members, []),
    admins: parseJson<string[]>(r.admins, []),
    labelIds: parseJson<string[]>(r.label_ids, []),
    welcome: r.welcome,
    settings: parseJson<TemplateSettings>(r.settings, {}),
    variables: templateVariables(r.group_name, r.description, r.welcome),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTemplates(ws: string): Promise<TemplateDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM groups_templates WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(ws)) as TemplateRow[];
  return rows.map(toTemplateDto);
}

export async function getTemplate(ws: string, id: string): Promise<TemplateDto | null> {
  const r = (await getDb().prepare('SELECT * FROM groups_templates WHERE id = ? AND user_id = ?').get(id, ws)) as TemplateRow | undefined;
  return r ? toTemplateDto(r) : null;
}

export interface TemplateInput {
  name?: string;
  groupName?: string;
  description?: string;
  members?: unknown;
  admins?: unknown;
  labelIds?: unknown;
  welcome?: string;
  settings?: TemplateSettings;
}

/** Cuerpo de la API → TemplateInput (solo los tipos esperados). */
export function templateInput(b: Record<string, unknown>): TemplateInput {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  return {
    name: text(b.name, 80),
    groupName: text(b.groupName, 100),
    description: text(b.description, 2000),
    members: b.members,
    admins: b.admins,
    labelIds: b.labelIds,
    welcome: text(b.welcome, 4000),
    settings: b.settings && typeof b.settings === 'object' ? (b.settings as TemplateSettings) : undefined,
  };
}

async function cleanTemplate(ws: string, input: TemplateInput, prev?: TemplateDto) {
  const name = (input.name ?? prev?.name ?? '').trim().slice(0, 80);
  if (!name) throw new GroupsError('invalid_name');
  // Vacío: al crear se usa el nombre de la plantilla (y sigue si se renombra).
  const groupName = (input.groupName ?? prev?.groupName ?? '').trim().slice(0, 100);
  const members = input.members !== undefined ? phonesOf(input.members) : (prev?.members ?? []);
  // Un admin tiene que ser miembro: se suma si no estaba.
  const admins = input.admins !== undefined ? phonesOf(input.admins, 50) : (prev?.admins ?? []);
  for (const a of admins) if (!members.includes(a)) members.push(a);
  let labelIds = prev?.labelIds ?? [];
  if (Array.isArray(input.labelIds)) {
    const valid = new Set(((await getDb().prepare('SELECT id FROM groups_labels WHERE user_id = ?').all(ws)) as Array<{ id: string }>).map((l) => l.id));
    labelIds = [...new Set(input.labelIds.map(String))].filter((id) => valid.has(id)).slice(0, 20);
  }
  const s = input.settings ?? prev?.settings ?? {};
  const settings: TemplateSettings = {};
  if (typeof s.announce === 'boolean') settings.announce = s.announce;
  if (typeof s.locked === 'boolean') settings.locked = s.locked;
  if (s.ephemeral !== undefined && (EPHEMERAL_OPTIONS as readonly number[]).includes(Number(s.ephemeral))) settings.ephemeral = Number(s.ephemeral);
  return {
    name,
    groupName,
    description: (input.description ?? prev?.description ?? '').trim().slice(0, 2000),
    members,
    admins,
    labelIds,
    welcome: (input.welcome ?? prev?.welcome ?? '').trim().slice(0, 4000),
    settings,
  };
}

export async function createTemplate(ws: string, actor: string, input: TemplateInput): Promise<TemplateDto> {
  const t = await cleanTemplate(ws, input);
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_templates WHERE user_id = ?').get(ws)) as { c: number };
  if (Number(count.c) >= 200) throw new GroupsError('too_many_templates');
  const id = randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO groups_templates (id, user_id, name, group_name, description, members, admins, label_ids, welcome, settings, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ws, t.name, t.groupName, t.description, JSON.stringify(t.members), JSON.stringify(t.admins), JSON.stringify(t.labelIds), t.welcome, JSON.stringify(t.settings), actor, now, now);
  return (await getTemplate(ws, id)) as TemplateDto;
}

export async function updateTemplate(ws: string, id: string, input: TemplateInput): Promise<TemplateDto> {
  const prev = await getTemplate(ws, id);
  if (!prev) throw new GroupsError('not_found', 404);
  const t = await cleanTemplate(ws, input, prev);
  await getDb()
    .prepare(
      `UPDATE groups_templates SET name = ?, group_name = ?, description = ?, members = ?, admins = ?, label_ids = ?, welcome = ?, settings = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(t.name, t.groupName, t.description, JSON.stringify(t.members), JSON.stringify(t.admins), JSON.stringify(t.labelIds), t.welcome, JSON.stringify(t.settings), nowIso(), id, ws);
  return (await getTemplate(ws, id)) as TemplateDto;
}

export async function deleteTemplate(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_templates WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

export interface TemplateUse {
  vars: Record<string, string>;
  /** Teléfonos extra de este grupo (además de los fijos). */
  phones?: string[];
}

/**
 * CSV para crear muchos grupos con una plantilla: una columna por variable
 * y, opcional, `participants` con teléfonos extra.
 */
export function parseTemplateCsv(rows: string[][], template: TemplateDto): { rows: TemplateUse[]; errors: Array<{ line: number; error: string }> } {
  const errors: Array<{ line: number; error: string }> = [];
  if (rows.length === 0) return { rows: [], errors: [{ line: 1, error: 'empty' }] };
  const head = rows[0].map((h) => h.trim());
  const lower = head.map((h) => h.toLowerCase());
  const iPhones = lower.findIndex((h) => ['participants', 'members', 'phones', 'participantes', 'miembros', 'membros', 'telefonos', 'teléfonos', 'telefones'].includes(h));
  const missing = template.variables.filter((v) => !head.includes(v));
  if (missing.length) return { rows: [], errors: [{ line: 1, error: `missing_columns:${missing.join(' ')}` }] };
  const out: TemplateUse[] = [];
  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => !c.trim())) return;
    const vars: Record<string, string> = {};
    head.forEach((h, j) => {
      if (j !== iPhones && h) vars[h] = (r[j] ?? '').trim();
    });
    const empty = missingVariables(template, vars);
    if (empty.length) {
      errors.push({ line: i + 2, error: `missing_variables:${empty.join(' ')}` });
      return;
    }
    if (!renderTemplate(template.groupName || template.name, vars)) {
      errors.push({ line: i + 2, error: 'invalid_name' });
      return;
    }
    const raw = iPhones >= 0 ? String(r[iPhones] ?? '').split(/[\s;,|]+/).filter(Boolean) : [];
    const bad = raw.filter((p) => !isValidPhone(p));
    if (bad.length) errors.push({ line: i + 2, error: `invalid_phone:${bad.slice(0, 3).join(' ')}` });
    out.push({ vars, phones: raw.filter((p) => isValidPhone(p)).map(phoneDigits) });
  });
  return { rows: out.slice(0, 50), errors };
}

/** Nombre y descripción que tendría cada grupo (vista previa). */
export function previewTemplateUse(template: TemplateDto, uses: TemplateUse[]): Array<{ name: string; description: string; phones: number }> {
  return uses.map((u) => ({
    name: renderTemplate(template.groupName || template.name, u.vars).slice(0, 100),
    description: renderTemplate(template.description, u.vars),
    phones: new Set([...template.members, ...(u.phones ?? [])]).size,
  }));
}

/**
 * Crea uno o varios grupos con la plantilla: miembros y admins fijos,
 * etiquetas, ajustes y el mensaje de bienvenida (con las mismas variables).
 */
export async function createFromTemplate(
  ws: string,
  actor: string,
  numberId: string,
  templateId: string,
  uses: TemplateUse[],
): Promise<CreateGroupResult[]> {
  const template = await getTemplate(ws, templateId);
  if (!template) throw new GroupsError('not_found', 404);
  if (uses.length === 0) throw new GroupsError('empty');
  if (uses.some((u) => missingVariables(template, u.vars).length > 0)) throw new GroupsError('missing_variables');
  const rows: CreateGroupRow[] = uses.map((u) => ({
    name: renderTemplate(template.groupName || template.name, u.vars).slice(0, 100),
    phones: [...new Set([...template.members, ...phonesOf(u.phones ?? [])])],
    description: renderTemplate(template.description, u.vars),
    admins: template.admins,
    labelIds: template.labelIds,
  }));
  const results = await createGroups(ws, numberId, rows);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok || !r.chatId) continue;
    const { announce, locked, ephemeral } = template.settings;
    if (announce !== undefined || locked !== undefined) await updateGroupSettings(ws, r.chatId, { announce, locked }).catch(() => null);
    // Mensajes temporales aparte: un proveedor sin ellos (WAHA) no frena lo demás.
    if (ephemeral) await updateGroupSettings(ws, r.chatId, { ephemeral }).catch(() => null);
    const welcome = renderTemplate(template.welcome, uses[i].vars);
    if (welcome) await sendMessage(ws, actor, r.chatId, { body: welcome }).catch(() => null);
  }
  return results;
}

// ======================================================================
// Listas guardadas
// ======================================================================

export interface SavedListFilters {
  filter?: ChatFilter;
  q?: string;
  labelIds?: string[];
  assignee?: string;
  kind?: 'dm' | 'group';
  numberId?: string;
  props?: PropertyFilter[];
}

export interface SavedListDto {
  id: string;
  name: string;
  shared: boolean;
  ownerId: string;
  filters: SavedListFilters;
  count?: number;
  createdAt: string;
  updatedAt: string;
}

interface SavedListRow {
  id: string;
  user_id: string;
  owner_id: string;
  shared: number;
  name: string;
  filters: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export function cleanListFilters(raw: unknown): SavedListFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SavedListFilters = {};
  if ((CHAT_FILTERS as readonly string[]).includes(String(r.filter)) && r.filter !== 'all') out.filter = r.filter as ChatFilter;
  if (typeof r.q === 'string' && r.q.trim()) out.q = r.q.trim().slice(0, 200);
  if (Array.isArray(r.labelIds)) {
    const ids = [...new Set(r.labelIds.filter((x): x is string => typeof x === 'string' && x.length <= 100))].slice(0, 20);
    if (ids.length) out.labelIds = ids;
  }
  if (typeof r.assignee === 'string' && r.assignee && r.assignee.length <= 100) out.assignee = r.assignee;
  if (r.kind === 'dm' || r.kind === 'group') out.kind = r.kind;
  if (typeof r.numberId === 'string' && r.numberId && r.numberId.length <= 100) out.numberId = r.numberId;
  if (Array.isArray(r.props)) {
    const props = (r.props as Array<Record<string, unknown>>)
      .map((p) => ({ key: String(p?.key ?? ''), op: (['is', 'set', 'unset'].includes(String(p?.op)) ? p.op : 'is') as PropertyFilter['op'], value: p?.value == null ? undefined : String(p.value).slice(0, 200) }))
      .filter((p) => /^[a-z0-9_]{1,40}$/.test(p.key) && (p.op !== 'is' || (p.value ?? '') !== ''))
      .slice(0, 10);
    if (props.length) out.props = props;
  }
  return out;
}

export function listQuery(f: SavedListFilters): ChatQuery {
  return { filter: f.filter ?? 'all', q: f.q, labelIds: f.labelIds, assignee: f.assignee, kind: f.kind, numberId: f.numberId, props: f.props };
}

function toListDto(r: SavedListRow): SavedListDto {
  return {
    id: r.id,
    name: r.name,
    shared: Boolean(r.shared),
    ownerId: r.owner_id,
    filters: cleanListFilters(parseJson(r.filters, {})),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Las compartidas del workspace y las propias de la persona. */
export async function listSavedLists(ws: string, me: string, opts: { counts?: boolean } = {}): Promise<SavedListDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM groups_saved_lists WHERE user_id = ? AND (shared = 1 OR owner_id = ?) ORDER BY position, name COLLATE NOCASE')
    .all(ws, me)) as SavedListRow[];
  const lists = rows.map(toListDto);
  if (opts.counts) {
    for (const l of lists) l.count = (await listChats(ws, me, { ...listQuery(l.filters), limit: 1 })).total;
  }
  return lists;
}

export async function getSavedList(ws: string, me: string, id: string): Promise<SavedListDto | null> {
  const r = (await getDb()
    .prepare('SELECT * FROM groups_saved_lists WHERE id = ? AND user_id = ? AND (shared = 1 OR owner_id = ?)')
    .get(id, ws, me)) as SavedListRow | undefined;
  return r ? toListDto(r) : null;
}

export async function createSavedList(ws: string, me: string, input: { name?: string; shared?: boolean; filters?: unknown }): Promise<SavedListDto> {
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new GroupsError('invalid_name');
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_saved_lists WHERE user_id = ?').get(ws)) as { c: number };
  if (Number(count.c) >= 200) throw new GroupsError('too_many_lists');
  const id = randomUUID();
  const now = nowIso();
  await getDb()
    .prepare('INSERT INTO groups_saved_lists (id, user_id, owner_id, shared, name, filters, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, me, input.shared ? 1 : 0, name, JSON.stringify(cleanListFilters(input.filters)), Number(count.c), now, now);
  return (await getSavedList(ws, me, id)) as SavedListDto;
}

/** Edita la persona que la creó o, si es compartida, un admin. */
async function editableList(ws: string, me: string, id: string, isAdmin: boolean): Promise<SavedListDto> {
  const l = await getSavedList(ws, me, id);
  if (!l) throw new GroupsError('not_found', 404);
  if (l.ownerId !== me && !(l.shared && isAdmin)) throw new GroupsError('forbidden', 403);
  return l;
}

export async function updateSavedList(
  ws: string,
  me: string,
  id: string,
  input: { name?: string; shared?: boolean; filters?: unknown },
  isAdmin = false,
): Promise<SavedListDto> {
  const prev = await editableList(ws, me, id, isAdmin);
  const name = input.name !== undefined ? String(input.name).trim().slice(0, 60) : prev.name;
  if (!name) throw new GroupsError('invalid_name');
  const shared = input.shared !== undefined ? Boolean(input.shared) : prev.shared;
  const filters = input.filters !== undefined ? cleanListFilters(input.filters) : prev.filters;
  await getDb()
    .prepare('UPDATE groups_saved_lists SET name = ?, shared = ?, filters = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(name, shared ? 1 : 0, JSON.stringify(filters), nowIso(), id, ws);
  return (await getSavedList(ws, me, id)) as SavedListDto;
}

export async function deleteSavedList(ws: string, me: string, id: string, isAdmin = false): Promise<boolean> {
  await editableList(ws, me, id, isAdmin);
  return (await getDb().prepare('DELETE FROM groups_saved_lists WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

/** Ids de los chats de una lista (audiencia de un envío masivo), hasta 500. */
export async function savedListChatIds(ws: string, me: string, id: string): Promise<Array<{ id: string; name: string }>> {
  const l = await getSavedList(ws, me, id);
  if (!l) throw new GroupsError('not_found', 404);
  const out: Array<{ id: string; name: string }> = [];
  for (let offset = 0; offset < 500; offset += 200) {
    const page = await listChats(ws, me, { ...listQuery(l.filters), limit: 200, offset });
    out.push(...page.rows.map((c) => ({ id: c.id, name: c.name })));
    if (page.rows.length < 200) break;
  }
  return out;
}
