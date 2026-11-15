/**
 * Track — vistas guardadas de las listas que no son de un team (Issues del
 * workspace, My issues, la pestaña Issues de un project). Las de un team viven
 * en track_issue_views (lib/track-ux). Estas son de quien las crea, por
 * workspace y por lista, y se pueden compartir con el workspace (como las
 * "workspace views" de Linear): las ven todos sus miembros en esa lista y solo
 * quien la creó la edita o la borra. Las de My issues no se comparten (cada uno
 * ve sus issues) y sin workspace no hay con quién compartir.
 *
 * scope_id es la clave de siempre de las propias (el team viejo, o vacío en los
 * workspaces nuevos) y workspace_id el workspace con el que se comparte: las
 * de otros se buscan por workspace_id, nunca por scope_id vacío (juntaría a
 * todos los workspaces nuevos).
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
  shared?: number | null;
  workspace_id?: string | null;
  owner_name?: string | null;
}

const VIEW_TYPES = ['list', 'board', 'calendar', 'gantt'] as const;

/** Clave de lista válida: letras, números y separadores cortos (workspace-issues, mine:assigned, plan:<uuid>). */
export function isListKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-z][a-zA-Z0-9:_-]{0,79}$/.test(key);
}

/** ¿Las vistas de esta lista se pueden compartir con el workspace? (My issues no: cada uno ve las suyas.) */
export function isShareableListKey(key: string, workspaceId: string): boolean {
  return Boolean(workspaceId) && !key.startsWith('mine:');
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
    shared: Boolean(row.shared),
    favorite: false,
    owner_name: row.owner_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Todas las vistas personales de la persona (sidebar: favoritas), con la lista de cada una. */
export async function listAllListViews(userId: string, scopeId: string): Promise<Array<{ id: string; name: string; listKey: string }>> {
  const rows = (await getDb()
    .prepare('SELECT id, name, list_key FROM track_list_views WHERE user_id = ? AND scope_id = ? ORDER BY name ASC LIMIT 50')
    .all(userId, scopeId)) as Array<{ id: string; name: string; list_key: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, listKey: r.list_key }));
}

/** Las vistas de la lista: las mías y las que otros compartieron con este workspace. */
export async function listListViews(userId: string, scopeId: string, listKey: string, workspaceId = ''): Promise<TrackSavedView[]> {
  const shareable = isShareableListKey(listKey, workspaceId);
  const rows = (await getDb()
    .prepare(
      `SELECT v.*, u.name AS owner_name FROM track_list_views v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.list_key = ? AND ((v.user_id = ? AND v.scope_id = ?) OR (? = 1 AND v.shared = 1 AND v.workspace_id = ?))
       ORDER BY v.name ASC LIMIT 200`,
    )
    .all(listKey, userId, scopeId, shareable ? 1 : 0, workspaceId)) as ListViewRow[];
  return rows.map(toView);
}

export interface ListViewInput {
  name: string;
  viewType: TrackSavedView['view_type'];
  filters: Record<string, unknown>;
  sort: IssueSort;
  shared?: boolean;
}

export async function createListView(
  userId: string,
  scopeId: string,
  listKey: string,
  input: ListViewInput,
  workspaceId = '',
): Promise<TrackSavedView> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const shared = input.shared && isShareableListKey(listKey, workspaceId) ? 1 : 0;
  await getDb()
    .prepare(
      `INSERT INTO track_list_views (id, user_id, scope_id, workspace_id, list_key, name, view_type, filters, sort, shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, scopeId, workspaceId || null, listKey, input.name, input.viewType, JSON.stringify(input.filters ?? {}), input.sort, shared, now, now);
  return (await getListView(id, userId))!;
}

/** La vista, solo si es de esa persona (para editarla o borrarla). */
export async function getListView(id: string, userId: string): Promise<TrackSavedView | undefined> {
  const row = (await getDb()
    .prepare('SELECT v.*, u.name AS owner_name FROM track_list_views v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = ? AND v.user_id = ?')
    .get(id, userId)) as ListViewRow | undefined;
  return row ? toView(row) : undefined;
}

/**
 * Cambia una vista propia. Compartir una vista de antes (sin workspace) la ata
 * al workspace activo de quien la comparte.
 */
export async function updateListView(
  id: string,
  userId: string,
  patch: Partial<ListViewInput>,
  workspaceId = '',
): Promise<TrackSavedView | undefined> {
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
  if (patch.shared !== undefined) {
    const row = (await getDb().prepare('SELECT workspace_id, list_key FROM track_list_views WHERE id = ? AND user_id = ?').get(id, userId)) as
      | { workspace_id: string | null; list_key: string }
      | undefined;
    if (!row) return undefined;
    const ws = row.workspace_id || workspaceId;
    if (!row.workspace_id && ws) {
      sets.push('workspace_id = ?');
      args.push(ws);
    }
    sets.push('shared = ?');
    args.push(patch.shared && isShareableListKey(row.list_key, ws) ? '1' : '0');
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
