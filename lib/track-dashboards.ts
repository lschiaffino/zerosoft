/**
 * Track — dashboards (como Linear): tableros con widgets de Insights
 * (gráfico, tabla o número). Los filtros del dashboard se suman a los de cada
 * widget. Un dashboard es del workspace (lo ve todo el equipo) o personal
 * (solo quien lo creó).
 */
import { getDb } from './db';
import { insightFiltersSchema, insightQuerySchema, type InsightFilters, type InsightQuery } from './track-planning-schema';
import { inScope, scopeWhere, type WorkspaceScope } from './track-plans';

export interface TrackDashboardRow {
  id: string;
  team_id: string | null;
  owner_id: string | null;
  user_id: string;
  name: string;
  description: string;
  visibility: 'personal' | 'workspace';
  filters: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWidget {
  id: string;
  dashboard_id: string;
  title: string;
  kind: 'chart' | 'table' | 'metric';
  query: InsightQuery;
  width: 1 | 2;
  position: number;
}

export interface DashboardSummary extends Omit<TrackDashboardRow, 'filters'> {
  filters: InsightFilters;
  user_name: string | null;
  widget_count: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseFilters(raw: string): InsightFilters {
  try {
    const p = insightFiltersSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : {};
  } catch {
    return {};
  }
}

function parseQuery(raw: string): InsightQuery {
  try {
    const p = insightQuerySchema.safeParse(JSON.parse(raw));
    if (p.success) return p.data;
  } catch {
    // cae al default
  }
  return insightQuerySchema.parse({});
}

/** Visible para la persona: del workspace, o personal y suyo. */
export function canSeeDashboard(d: TrackDashboardRow, scope: WorkspaceScope, userId: string): boolean {
  return inScope(d, scope) && (d.visibility === 'workspace' || d.user_id === userId);
}

export async function getDashboard(id: string): Promise<TrackDashboardRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_dashboards WHERE id = ?').get(id)) as TrackDashboardRow | undefined;
}

export async function getVisibleDashboard(id: string, scope: WorkspaceScope, userId: string): Promise<TrackDashboardRow | undefined> {
  const d = await getDashboard(id);
  return d && canSeeDashboard(d, scope, userId) ? d : undefined;
}

export async function listDashboards(scope: WorkspaceScope, userId: string, q?: string): Promise<DashboardSummary[]> {
  const s = scopeWhere(scope, 'd');
  const rows = (await getDb()
    .prepare(
      `SELECT d.*, u.name AS user_name, (SELECT COUNT(*) FROM track_dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
       FROM track_dashboards d LEFT JOIN users u ON u.id = d.user_id
       WHERE ${s.where} AND (d.visibility = 'workspace' OR d.user_id = ?)
       ORDER BY d.updated_at DESC LIMIT 200`,
    )
    .all(s.arg, userId)) as Array<TrackDashboardRow & { user_name: string | null; widget_count: number }>;
  const needle = q?.trim().toLowerCase();
  return rows
    .filter((r) => !needle || r.name.toLowerCase().includes(needle))
    .map((r) => ({ ...r, filters: parseFilters(r.filters) }));
}

export async function createDashboard(
  scope: WorkspaceScope,
  userId: string,
  payload: { name: string; description?: string; visibility?: 'personal' | 'workspace'; filters?: InsightFilters },
): Promise<TrackDashboardRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO track_dashboards (id, team_id, owner_id, user_id, name, description, visibility, filters, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      scope.teamId,
      scope.ownerId,
      userId,
      payload.name.trim(),
      payload.description?.trim() ?? '',
      payload.visibility ?? 'workspace',
      JSON.stringify(payload.filters ?? {}),
      now,
      now,
    );
  return (await getDashboard(id)) as TrackDashboardRow;
}

export async function updateDashboard(
  id: string,
  payload: { name?: string; description?: string; visibility?: 'personal' | 'workspace'; filters?: InsightFilters },
): Promise<void> {
  const fields: string[] = [];
  const args: string[] = [];
  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.description !== undefined) {
    fields.push('description = ?');
    args.push(payload.description.trim());
  }
  if (payload.visibility !== undefined) {
    fields.push('visibility = ?');
    args.push(payload.visibility);
  }
  if (payload.filters !== undefined) {
    fields.push('filters = ?');
    args.push(JSON.stringify(payload.filters));
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  args.push(nowIso());
  await getDb().prepare(`UPDATE track_dashboards SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
}

export async function deleteDashboard(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_dashboards WHERE id = ?').run(id);
  return res.changes > 0;
}

export async function listWidgets(dashboardId: string): Promise<DashboardWidget[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM track_dashboard_widgets WHERE dashboard_id = ? ORDER BY position ASC, created_at ASC')
    .all(dashboardId)) as Array<Omit<DashboardWidget, 'query'> & { config: string }>;
  return rows.map(({ config, ...w }) => ({ ...w, width: (Number(w.width) === 2 ? 2 : 1) as 1 | 2, query: parseQuery(config) }));
}

export async function getWidget(id: string): Promise<(DashboardWidget & { dashboard: TrackDashboardRow }) | undefined> {
  const row = (await getDb().prepare('SELECT * FROM track_dashboard_widgets WHERE id = ?').get(id)) as
    | (Omit<DashboardWidget, 'query'> & { config: string })
    | undefined;
  if (!row) return undefined;
  const dashboard = await getDashboard(row.dashboard_id);
  if (!dashboard) return undefined;
  const { config, ...w } = row;
  return { ...w, width: (Number(w.width) === 2 ? 2 : 1) as 1 | 2, query: parseQuery(config), dashboard };
}

export async function addWidget(
  dashboardId: string,
  payload: { title?: string; kind: 'chart' | 'table' | 'metric'; width?: 1 | 2; query: InsightQuery },
): Promise<string> {
  const db = getDb();
  const max = (await db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM track_dashboard_widgets WHERE dashboard_id = ?').get(dashboardId)) as {
    m: number;
  };
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO track_dashboard_widgets (id, dashboard_id, title, kind, config, width, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, dashboardId, payload.title?.trim() ?? '', payload.kind, JSON.stringify(payload.query), payload.width ?? 1, Number(max.m) + 1, nowIso());
  await db.prepare('UPDATE track_dashboards SET updated_at = ? WHERE id = ?').run(nowIso(), dashboardId);
  return id;
}

export async function updateWidget(
  widget: DashboardWidget,
  payload: { title?: string; kind?: 'chart' | 'table' | 'metric'; width?: 1 | 2; query?: InsightQuery; move?: 'up' | 'down' },
): Promise<void> {
  const db = getDb();
  const fields: string[] = [];
  const args: Array<string | number> = [];
  if (payload.title !== undefined) {
    fields.push('title = ?');
    args.push(payload.title.trim());
  }
  if (payload.kind !== undefined) {
    fields.push('kind = ?');
    args.push(payload.kind);
  }
  if (payload.width !== undefined) {
    fields.push('width = ?');
    args.push(payload.width);
  }
  if (payload.query !== undefined) {
    fields.push('config = ?');
    args.push(JSON.stringify(payload.query));
  }
  if (fields.length) await db.prepare(`UPDATE track_dashboard_widgets SET ${fields.join(', ')} WHERE id = ?`).run(...args, widget.id);
  if (payload.move) {
    const all = await listWidgets(widget.dashboard_id);
    const idx = all.findIndex((w) => w.id === widget.id);
    const swap = payload.move === 'up' ? idx - 1 : idx + 1;
    if (idx >= 0 && swap >= 0 && swap < all.length) {
      const order = all.map((w) => w.id);
      [order[idx], order[swap]] = [order[swap], order[idx]];
      for (let i = 0; i < order.length; i++) {
        await db.prepare('UPDATE track_dashboard_widgets SET position = ? WHERE id = ?').run(i, order[i]);
      }
    }
  }
  await db.prepare('UPDATE track_dashboards SET updated_at = ? WHERE id = ?').run(nowIso(), widget.dashboard_id);
}

export async function deleteWidget(id: string): Promise<void> {
  await getDb().prepare('DELETE FROM track_dashboard_widgets WHERE id = ?').run(id);
}
