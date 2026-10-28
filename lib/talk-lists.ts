/**
 * Talk: listas del canal (como las Lists de Slack). Cada lista tiene campos
 * con tipo (texto, número, selección, persona, fecha, casilla), ítems con
 * esos valores, vistas guardadas (tabla o tablero agrupado por un campo de
 * selección, con filtro y orden) y un hilo de comentarios por ítem.
 *
 * Lee quien lee el canal; escribe quien es miembro y el canal no está
 * archivado. Los cambios llegan por el feed (evento 'list'). Server-only.
 */
import { getDb } from './db';
import { TalkError, canManageChannel, emitTalkEvent, nowIso, readableChannel, writableChannel, type TalkActor } from './talk';

export const LIST_MAX_ITEMS = 1000;
export const LIST_MAX_FIELDS = 20;
export const LISTS_PER_CHANNEL = 50;

export type ListFieldType = 'text' | 'number' | 'select' | 'person' | 'date' | 'checkbox';
const FIELD_TYPES: ListFieldType[] = ['text', 'number', 'select', 'person', 'date', 'checkbox'];

export interface ListField {
  id: string;
  name: string;
  type: ListFieldType;
  options?: string[];
}

export interface ListView {
  id: string;
  name: string;
  kind: 'table' | 'board';
  /** Tablero: campo de selección por el que se agrupa. */
  groupBy?: string | null;
  /** Orden: id de campo o 'title' / 'created'. */
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  /** Filtro de texto (título y valores). */
  filter?: string;
}

export interface ListItemDto {
  id: string;
  title: string;
  data: Record<string, string | number | boolean | null>;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  comments: number;
}

export interface ListDto {
  id: string;
  channelId: string;
  name: string;
  fields: ListField[];
  views: ListView[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  canEdit: boolean;
  canDelete: boolean;
}

type ListRow = { id: string; channel_id: string; name: string; fields: string; views: string; created_by: string | null; created_at: string; updated_at: string; item_count?: number };

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const shortId = () => crypto.randomUUID().slice(0, 8);

export function cleanFields(input: unknown): ListField[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ListField[] = [];
  for (const raw of input.slice(0, LIST_MAX_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Partial<ListField>;
    const name = String(f.name ?? '').trim().slice(0, 60);
    const type = FIELD_TYPES.includes(f.type as ListFieldType) ? (f.type as ListFieldType) : 'text';
    if (!name) continue;
    let id = typeof f.id === 'string' && /^[\w-]{1,40}$/.test(f.id) ? f.id : shortId();
    if (seen.has(id)) id = shortId();
    seen.add(id);
    const field: ListField = { id, name, type };
    if (type === 'select') {
      field.options = [...new Set((Array.isArray(f.options) ? f.options : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
    }
    out.push(field);
  }
  return out;
}

export function cleanViews(input: unknown, fields: ListField[]): ListView[] {
  const ids = new Set(fields.map((f) => f.id));
  const selects = new Set(fields.filter((f) => f.type === 'select').map((f) => f.id));
  const arr = Array.isArray(input) ? input : [];
  const out: ListView[] = [];
  for (const raw of arr.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Partial<ListView>;
    const kind = v.kind === 'board' ? 'board' : 'table';
    out.push({
      id: typeof v.id === 'string' && /^[\w-]{1,40}$/.test(v.id) ? v.id : shortId(),
      name: String(v.name ?? '').trim().slice(0, 60) || (kind === 'board' ? 'Board' : 'Table'),
      kind,
      groupBy: kind === 'board' && v.groupBy && selects.has(v.groupBy) ? v.groupBy : kind === 'board' ? ([...selects][0] ?? null) : null,
      sortBy: v.sortBy && (ids.has(v.sortBy) || v.sortBy === 'title' || v.sortBy === 'created') ? v.sortBy : null,
      sortDir: v.sortDir === 'desc' ? 'desc' : 'asc',
      filter: String(v.filter ?? '').slice(0, 100),
    });
  }
  return out.length ? out : [{ id: 'table', name: 'Table', kind: 'table', groupBy: null, sortBy: null, sortDir: 'asc', filter: '' }];
}

/** Valores de un ítem limpios según los campos (lo desconocido se descarta). */
export function cleanData(input: unknown, fields: ListField[], people: Set<string> | null): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const f of fields) {
    if (!(f.id in src)) continue;
    const v = src[f.id];
    if (v === null || v === '' || v === undefined) {
      out[f.id] = null;
      continue;
    }
    if (f.type === 'number') {
      const n = Number(v);
      out[f.id] = Number.isFinite(n) ? n : null;
    } else if (f.type === 'checkbox') out[f.id] = v === true || v === 'true' || v === 1;
    else if (f.type === 'select') out[f.id] = f.options?.includes(String(v)) ? String(v) : null;
    else if (f.type === 'person') out[f.id] = people && people.has(String(v)) ? String(v) : null;
    else if (f.type === 'date') out[f.id] = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
    else out[f.id] = String(v).slice(0, 2000);
  }
  return out;
}

async function access(actor: TalkActor, channelId: string) {
  const a = await readableChannel(actor, channelId);
  if (!a) throw new TalkError('not_found', 404);
  return a;
}

function toDto(actor: TalkActor, row: ListRow, a: Awaited<ReturnType<typeof access>>): ListDto {
  const fields = cleanFields(parse(row.fields, []));
  const canEdit = !!a.member && !a.channel.archived_at;
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    fields,
    views: cleanViews(parse(row.views, []), fields),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: Number(row.item_count ?? 0),
    canEdit,
    canDelete: canEdit && (row.created_by === actor.personId || canManageChannel(actor, a.channel, a.member) || a.channel.kind === 'dm' || a.channel.kind === 'group'),
  };
}

const LIST_SQL = 'SELECT l.*, (SELECT COUNT(*) FROM talk_list_items i WHERE i.list_id = l.id) AS item_count FROM talk_lists l';

export async function listLists(actor: TalkActor, channelId: string): Promise<ListDto[]> {
  const a = await access(actor, channelId);
  const rows = (await getDb().prepare(`${LIST_SQL} WHERE l.channel_id = ? ORDER BY l.created_at`).all(channelId)) as ListRow[];
  return rows.map((r) => toDto(actor, r, a));
}

/** La lista y su canal, si la persona lee el canal. */
async function loadList(actor: TalkActor, listId: string): Promise<{ row: ListRow; a: Awaited<ReturnType<typeof access>>; dto: ListDto }> {
  const row = (await getDb().prepare(`${LIST_SQL} WHERE l.id = ? AND l.workspace_id = ?`).get(listId, actor.workspaceId)) as ListRow | undefined;
  if (!row) throw new TalkError('not_found', 404);
  const a = await access(actor, row.channel_id);
  return { row, a, dto: toDto(actor, row, a) };
}

async function editable(actor: TalkActor, listId: string) {
  const l = await loadList(actor, listId);
  if (!l.dto.canEdit) throw new TalkError(l.a.member ? 'channel_archived' : 'not_member', l.a.member ? 409 : 403);
  return l;
}

async function touched(actor: TalkActor, channelId: string, listId: string, change: string, extra: Record<string, unknown> = {}) {
  await getDb().prepare('UPDATE talk_lists SET updated_at = ? WHERE id = ?').run(nowIso(), listId);
  await emitTalkEvent(actor.workspaceId, 'list', { channelId, actorId: actor.personId, payload: { listId, change, ...extra } });
}

export async function createList(actor: TalkActor, channelId: string, input: { name: string; template?: 'tasks' | 'blank' }): Promise<ListDto> {
  await writableChannel(actor, channelId);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new TalkError('invalid_name');
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM talk_lists WHERE channel_id = ?').get(channelId)) as { n: number };
  if (Number(count.n) >= LISTS_PER_CHANNEL) throw new TalkError('too_many_lists', 409);
  const fields: ListField[] =
    input.template === 'blank'
      ? [{ id: 'notes', name: 'Notes', type: 'text' }]
      : [
          { id: 'status', name: 'Status', type: 'select', options: ['To do', 'In progress', 'Done'] },
          { id: 'owner', name: 'Owner', type: 'person' },
          { id: 'due', name: 'Due', type: 'date' },
        ];
  const views: ListView[] = [
    { id: 'table', name: 'Table', kind: 'table', groupBy: null, sortBy: null, sortDir: 'asc', filter: '' },
    ...(input.template === 'blank' ? [] : [{ id: 'board', name: 'Board', kind: 'board' as const, groupBy: 'status', sortBy: null, sortDir: 'asc' as const, filter: '' }]),
  ];
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare('INSERT INTO talk_lists (id, workspace_id, channel_id, name, fields, views, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.workspaceId, channelId, name, JSON.stringify(fields), JSON.stringify(views), actor.personId, now, now);
  await emitTalkEvent(actor.workspaceId, 'list', { channelId, actorId: actor.personId, payload: { listId: id, change: 'created' } });
  return (await loadList(actor, id)).dto;
}

export async function updateList(actor: TalkActor, listId: string, input: { name?: string; fields?: unknown; views?: unknown }): Promise<ListDto> {
  const { row } = await editable(actor, listId);
  const db = getDb();
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new TalkError('invalid_name');
    await db.prepare('UPDATE talk_lists SET name = ? WHERE id = ?').run(name, listId);
  }
  let fields = cleanFields(parse(row.fields, []));
  if (input.fields !== undefined) {
    fields = cleanFields(input.fields);
    await db.prepare('UPDATE talk_lists SET fields = ? WHERE id = ?').run(JSON.stringify(fields), listId);
  }
  if (input.views !== undefined || input.fields !== undefined) {
    const views = cleanViews(input.views !== undefined ? input.views : parse(row.views, []), fields);
    await db.prepare('UPDATE talk_lists SET views = ? WHERE id = ?').run(JSON.stringify(views), listId);
  }
  await touched(actor, row.channel_id, listId, 'updated');
  return (await loadList(actor, listId)).dto;
}

export async function deleteList(actor: TalkActor, listId: string): Promise<void> {
  const { row, dto } = await loadList(actor, listId);
  if (!dto.canDelete) throw new TalkError('forbidden', 403);
  await getDb().prepare('DELETE FROM talk_lists WHERE id = ?').run(listId);
  await emitTalkEvent(actor.workspaceId, 'list', { channelId: row.channel_id, actorId: actor.personId, payload: { listId, change: 'deleted' } });
}

export async function getList(actor: TalkActor, listId: string): Promise<{ list: ListDto; items: ListItemDto[] }> {
  const { dto } = await loadList(actor, listId);
  const rows = (await getDb()
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM talk_list_comments c WHERE c.item_id = i.id) AS comments
       FROM talk_list_items i WHERE i.list_id = ? ORDER BY i.position, i.created_at LIMIT ?`,
    )
    .all(listId, LIST_MAX_ITEMS)) as Array<{ id: string; title: string; data: string; position: number; created_by: string | null; created_at: string; updated_at: string; comments: number }>;
  return {
    list: dto,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      data: parse<Record<string, string | number | boolean | null>>(r.data, {}),
      position: Number(r.position),
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      comments: Number(r.comments),
    })),
  };
}

async function channelPeople(channelId: string): Promise<Set<string>> {
  return new Set(((await getDb().prepare('SELECT user_id FROM talk_members WHERE channel_id = ?').all(channelId)) as Array<{ user_id: string }>).map((r) => r.user_id));
}

export async function addItem(actor: TalkActor, listId: string, input: { title: string; data?: unknown }): Promise<ListItemDto> {
  const { row, dto } = await editable(actor, listId);
  if (dto.itemCount >= LIST_MAX_ITEMS) throw new TalkError('list_full', 409);
  const title = input.title.trim().slice(0, 500);
  if (!title) throw new TalkError('invalid_name');
  const data = cleanData(input.data ?? {}, dto.fields, await channelPeople(row.channel_id));
  const db = getDb();
  const max = (await db.prepare('SELECT MAX(position) AS p FROM talk_list_items WHERE list_id = ?').get(listId)) as { p: number | null };
  const id = crypto.randomUUID();
  const now = nowIso();
  const position = Number(max.p ?? 0) + 1;
  await db
    .prepare('INSERT INTO talk_list_items (id, list_id, title, data, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, listId, title, JSON.stringify(data), position, actor.personId, now, now);
  await touched(actor, row.channel_id, listId, 'item', { itemId: id });
  return { id, title, data, position, createdBy: actor.personId, createdAt: now, updatedAt: now, comments: 0 };
}

async function itemOf(listId: string, itemId: string) {
  const it = (await getDb().prepare('SELECT * FROM talk_list_items WHERE id = ? AND list_id = ?').get(itemId, listId)) as { id: string; title: string; data: string; position: number } | undefined;
  if (!it) throw new TalkError('not_found', 404);
  return it;
}

export async function updateItem(actor: TalkActor, listId: string, itemId: string, input: { title?: string; data?: unknown; position?: number }): Promise<void> {
  const { row, dto } = await editable(actor, listId);
  const it = await itemOf(listId, itemId);
  const db = getDb();
  const sets: string[] = ['updated_at = ?'];
  const args: Array<string | number> = [nowIso()];
  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, 500);
    if (!title) throw new TalkError('invalid_name');
    sets.push('title = ?');
    args.push(title);
  }
  if (input.data !== undefined) {
    const merged = { ...parse<Record<string, unknown>>(it.data, {}), ...cleanData(input.data, dto.fields, await channelPeople(row.channel_id)) };
    sets.push('data = ?');
    args.push(JSON.stringify(merged));
  }
  if (input.position !== undefined && Number.isFinite(input.position)) {
    sets.push('position = ?');
    args.push(input.position);
  }
  await db.prepare(`UPDATE talk_list_items SET ${sets.join(', ')} WHERE id = ?`).run(...args, itemId);
  await touched(actor, row.channel_id, listId, 'item', { itemId });
}

export async function deleteItem(actor: TalkActor, listId: string, itemId: string): Promise<void> {
  const { row } = await editable(actor, listId);
  await itemOf(listId, itemId);
  await getDb().prepare('DELETE FROM talk_list_items WHERE id = ?').run(itemId);
  await touched(actor, row.channel_id, listId, 'item', { itemId, deleted: true });
}

export interface ListCommentDto {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}

export async function listComments(actor: TalkActor, listId: string, itemId: string): Promise<ListCommentDto[]> {
  await loadList(actor, listId);
  await itemOf(listId, itemId);
  const rows = (await getDb().prepare('SELECT * FROM talk_list_comments WHERE item_id = ? ORDER BY created_at LIMIT 500').all(itemId)) as Array<{
    id: string;
    user_id: string;
    body: string;
    created_at: string;
  }>;
  return rows.map((r) => ({ id: r.id, userId: r.user_id, body: r.body, createdAt: r.created_at }));
}

export async function addComment(actor: TalkActor, listId: string, itemId: string, body: string): Promise<ListCommentDto> {
  const { row } = await editable(actor, listId);
  await itemOf(listId, itemId);
  const text = body.trim().slice(0, 4000);
  if (!text) throw new TalkError('empty_message');
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb().prepare('INSERT INTO talk_list_comments (id, item_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, itemId, actor.personId, text, now);
  await touched(actor, row.channel_id, listId, 'comment', { itemId });
  return { id, userId: actor.personId, body: text, createdAt: now };
}

export async function deleteComment(actor: TalkActor, listId: string, itemId: string, commentId: string): Promise<void> {
  const { row } = await editable(actor, listId);
  const res = await getDb().prepare('DELETE FROM talk_list_comments WHERE id = ? AND item_id = ? AND user_id = ?').run(commentId, itemId, actor.personId);
  if (!res.changes) throw new TalkError('not_found', 404);
  await touched(actor, row.channel_id, listId, 'comment', { itemId });
}
