/**
 * Track — vistas guardadas personales de las listas que no son de un team
 * (Issues del workspace, My issues, la pestaña Issues de un project). Las de
 * un team viven en track_issue_views (lib/track-ux) y se pueden compartir;
 * estas son solo de quien las crea, por workspace y por lista.
 */
import { getDb } from './db';
import type { TrackSavedView } from './track-ux';
import { ISSUE_SORTS, type IssueSort } from './track-views';

interface ListViewRow {
  id: string;
  user_id: string;
  scope_id: string;
  list_key: string;
  name: string;
  view_type: string;
  filters: string;
  sort: string;
  created_at: string;
  updated_at: string;
}

const VIEW_TYPES = ['list', 'board', 'calendar', 'gantt'] as const;

/** Clave de lista válida: letras, números y separadores cortos (workspace-issues, mine:assigned, plan:<uuid>). */
export function isListKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-z][a-zA-Z0-9:_-]{0,79}$/.test(key);
}

function toView(row: ListViewRow): TrackSavedView {
  let filters: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.filters);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) filters = parsed as Record<string, unknown>;
  } catch {
    filters = {};
  }
  return {
    id: row.id,
    project_id: '',
    user_id: row.user_id,
    name: row.name,
    view_type: (VIEW_TYPES as readonly string[]).includes(row.view_type) ? (row.view_type as TrackSavedView['view_type']) : 'list',
    filters,
    sort: (ISSUE_SORTS as readonly string[]).includes(row.sort) ? (row.sort as IssueSort) : 'manual',
    columns: null,
    is_default: false,
    shared: false,
    favorite: false,
    owner_name: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listListViews(userId: string, scopeId: string, listKey: string): Promise<TrackSavedView[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM track_list_views WHERE user_id = ? AND scope_id = ? AND list_key = ? ORDER BY name ASC LIMIT 100')
    .all(userId, scopeId, listKey)) as ListViewRow[];
  return rows.map(toView);
}

export interface ListViewInput {
  name: string;
  viewType: TrackSavedView['view_type'];
  filters: Record<string, unknown>;
  sort: IssueSort;
}

export async function createListView(userId: string, scopeId: string, listKey: string, input: ListViewInput): Promise<TrackSavedView> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO track_list_views (id, user_id, scope_id, list_key, name, view_type, filters, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, scopeId, listKey, input.name, input.viewType, JSON.stringify(input.filters ?? {}), input.sort, now, now);
  return (await getListView(id, userId))!;
}

/** La vista, solo si es de esa persona. */
export async function getListView(id: string, userId: string): Promise<TrackSavedView | undefined> {
  const row = (await getDb().prepare('SELECT * FROM track_list_views WHERE id = ? AND user_id = ?').get(id, userId)) as ListViewRow | undefined;
  return row ? toView(row) : undefined;
}

export async function updateListView(id: string, userId: string, patch: Partial<ListViewInput>): Promise<TrackSavedView | undefined> {
  const sets: string[] = [];
  const args: Array<string> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name);
  }
  if (patch.viewType !== undefined) {
    sets.push('view_type = ?');
    args.push(patch.viewType);
  }
  if (patch.filters !== undefined) {
    sets.push('filters = ?');
    args.push(JSON.stringify(patch.filters));
  }
  if (patch.sort !== undefined) {
    sets.push('sort = ?');
    args.push(patch.sort);
  }
  if (sets.length) {
    await getDb()
      .prepare(`UPDATE track_list_views SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(...args, new Date().toISOString(), id, userId);
  }
  return getListView(id, userId);
}

export async function deleteListView(id: string, userId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_list_views WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}
