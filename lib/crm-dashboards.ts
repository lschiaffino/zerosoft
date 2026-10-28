/**
 * CRM — dashboards custom con widgets en grid drag&drop.
 * Usado por /app/crm/dashboards y app/api/crm/dashboards.
 */
import { getDb, type CrmDashboardRow, type CrmDashboardWidgetRow } from './db';
import type { OwnerScope } from './crm-visibility';
import { listTasks, listTimeline, wonLostByMonth } from './crm';
import { defaultPipelineId } from './crm-http';
import {
  defaultBucket,
  reportActivityLeaderboard,
  reportByOwner,
  reportForecast,
  reportFunnel,
  reportKpis,
  reportSourcePerformance,
  reportTimeseries,
  reportRange,
  type ReportFilters,
} from './crm-reports';
import { listMembers } from './teams';
import { getCustomReport, runReport, ReportError } from './crm-custom-reports';
import type { SessionUser } from './session';
import { workspaceTeamId } from './workspace';
import {
  WIDGET_DEFAULT_SIZE,
  type DashboardDataRequest,
  type DashboardWidgetConfig,
  type DashboardWidgetType,
  type WidgetData,
} from './crm-dashboards-schema';

export type { CrmDashboardRow, CrmDashboardWidgetRow };

export interface CrmDashboardWithWidgets extends CrmDashboardRow {
  widgets: CrmDashboardWidgetRow[];
}

/** Item de layout bulk (tras drag/resize). Coincide con dashboardLayoutItemSchema. */
export interface DashboardLayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
}

// ---------- Dashboards ----------

export async function listDashboards(userId: string): Promise<CrmDashboardRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM crm_dashboards WHERE user_id = ? ORDER BY position ASC, created_at ASC',
    )
    .all(userId)) as CrmDashboardRow[];
}

export async function listDashboardWidgets(
  dashboardId: string,
): Promise<CrmDashboardWidgetRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM crm_dashboard_widgets WHERE dashboard_id = ? ORDER BY position ASC, created_at ASC',
    )
    .all(dashboardId)) as CrmDashboardWidgetRow[];
}

export async function getDashboard(
  userId: string,
  id: string,
): Promise<CrmDashboardWithWidgets | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM crm_dashboards WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmDashboardRow | undefined;
  if (!row) return null;
  return { ...row, widgets: await listDashboardWidgets(row.id) };
}

export async function listDashboardsWithWidgets(
  userId: string,
): Promise<CrmDashboardWithWidgets[]> {
  const rows = await listDashboards(userId);
  const out: CrmDashboardWithWidgets[] = [];
  for (const row of rows) {
    out.push({ ...row, widgets: await listDashboardWidgets(row.id) });
  }
  return out;
}

export async function createDashboard(
  userId: string,
  name: string,
): Promise<CrmDashboardWithWidgets> {
  const db = getDb();
  const id = crypto.randomUUID();
  const maxPos = (
    (await db
      .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM crm_dashboards WHERE user_id = ?')
      .get(userId)) as { p: number }
  ).p;
  await db
    .prepare(
      `INSERT INTO crm_dashboards (id, user_id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(id, userId, name, maxPos + 1);
  const row = (await db
    .prepare('SELECT * FROM crm_dashboards WHERE id = ?')
    .get(id)) as CrmDashboardRow;
  return { ...row, widgets: [] };
}

export async function renameDashboard(
  userId: string,
  id: string,
  name: string,
): Promise<CrmDashboardRow | null> {
  const db = getDb();
  const res = await db
    .prepare(
      `UPDATE crm_dashboards SET name = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(name, id, userId);
  if (res.changes === 0) return null;
  return (await db
    .prepare('SELECT * FROM crm_dashboards WHERE id = ?')
    .get(id)) as CrmDashboardRow;
}

export async function deleteDashboard(userId: string, id: string): Promise<boolean> {
  // Los widgets caen por ON DELETE CASCADE.
  return (
    (await getDb()
      .prepare('DELETE FROM crm_dashboards WHERE id = ? AND user_id = ?')
      .run(id, userId)).changes > 0
  );
}

export async function reorderDashboards(userId: string, ids: string[]): Promise<void> {
  const db = getDb();
  for (let i = 0; i < ids.length; i++) {
    await db
      .prepare('UPDATE crm_dashboards SET position = ? WHERE id = ? AND user_id = ?')
      .run(i, ids[i], userId);
  }
}

// ---------- Widgets ----------

async function ownsWidget(userId: string, widgetId: string): Promise<boolean> {
  const row = await getDb()
    .prepare(
      `SELECT w.id FROM crm_dashboard_widgets w
       JOIN crm_dashboards d ON d.id = w.dashboard_id
       WHERE w.id = ? AND d.user_id = ?`,
    )
    .get(widgetId, userId);
  return row !== undefined;
}

export async function addWidget(
  userId: string,
  dashboardId: string,
  data: {
    type: DashboardWidgetType;
    config?: DashboardWidgetConfig;
    w?: number;
    h?: number;
    x?: number;
    y?: number;
    position?: number;
  },
): Promise<CrmDashboardWidgetRow | null> {
  const db = getDb();
  const dashboard = (await db
    .prepare('SELECT id FROM crm_dashboards WHERE id = ? AND user_id = ?')
    .get(dashboardId, userId)) as { id: string } | undefined;
  if (!dashboard) return null;

  const agg = (await db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) AS p, COALESCE(MAX(y + h), 0) AS bottom
       FROM crm_dashboard_widgets WHERE dashboard_id = ?`,
    )
    .get(dashboardId)) as { p: number; bottom: number };

  const id = crypto.randomUUID();
  const size = WIDGET_DEFAULT_SIZE[data.type];
  await db
    .prepare(
      `INSERT INTO crm_dashboard_widgets (id, dashboard_id, type, config, x, y, w, h, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      id,
      dashboardId,
      data.type,
      JSON.stringify(data.config ?? {}),
      data.x ?? 0,
      data.y ?? agg.bottom,
      data.w ?? size.w,
      data.h ?? size.h,
      data.position ?? agg.p + 1,
    );
  return (await db
    .prepare('SELECT * FROM crm_dashboard_widgets WHERE id = ?')
    .get(id)) as CrmDashboardWidgetRow;
}

/** Layout bulk (tras drag/resize): x/y/w/h/position de cada widget del dashboard. */
export async function updateWidgetLayout(
  userId: string,
  dashboardId: string,
  items: DashboardLayoutItem[],
): Promise<boolean> {
  const db = getDb();
  const dashboard = (await db
    .prepare('SELECT id FROM crm_dashboards WHERE id = ? AND user_id = ?')
    .get(dashboardId, userId)) as { id: string } | undefined;
  if (!dashboard) return false;
  for (const item of items) {
    await db
      .prepare(
        `UPDATE crm_dashboard_widgets SET x = ?, y = ?, w = ?, h = ?, position = ?
         WHERE id = ? AND dashboard_id = ?`,
      )
      .run(item.x, item.y, item.w, item.h, item.position, item.id, dashboardId);
  }
  await db
    .prepare(`UPDATE crm_dashboards SET updated_at = datetime('now') WHERE id = ?`)
    .run(dashboardId);
  return true;
}

export async function updateWidgetConfig(
  userId: string,
  widgetId: string,
  config: DashboardWidgetConfig,
): Promise<CrmDashboardWidgetRow | null> {
  if (!(await ownsWidget(userId, widgetId))) return null;
  const db = getDb();
  await db
    .prepare('UPDATE crm_dashboard_widgets SET config = ? WHERE id = ?')
    .run(JSON.stringify(config), widgetId);
  return (await db
    .prepare('SELECT * FROM crm_dashboard_widgets WHERE id = ?')
    .get(widgetId)) as CrmDashboardWidgetRow;
}

export async function updateWidget(
  userId: string,
  widgetId: string,
  data: Partial<DashboardLayoutItem> & { config?: DashboardWidgetConfig },
): Promise<CrmDashboardWidgetRow | null> {
  if (!(await ownsWidget(userId, widgetId))) return null;
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number> = [];
  for (const key of ['x', 'y', 'w', 'h', 'position'] as const) {
    const v = data[key];
    if (typeof v === 'number') {
      sets.push(`${key} = ?`);
      args.push(v);
    }
  }
  if (data.config !== undefined) {
    sets.push('config = ?');
    args.push(JSON.stringify(data.config));
  }
  if (sets.length > 0) {
    args.push(widgetId);
    await db
      .prepare(`UPDATE crm_dashboard_widgets SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args);
  }
  return (await db
    .prepare('SELECT * FROM crm_dashboard_widgets WHERE id = ?')
    .get(widgetId)) as CrmDashboardWidgetRow;
}

export async function deleteWidget(userId: string, widgetId: string): Promise<boolean> {
  if (!(await ownsWidget(userId, widgetId))) return false;
  return (
    (await getDb()
      .prepare('DELETE FROM crm_dashboard_widgets WHERE id = ?')
      .run(widgetId)).changes > 0
  );
}

// ============================================================
// DATASETS POR WIDGET (página + /api/crm/dashboards/data)
// ============================================================

export interface DashboardOwner {
  id: string;
  email: string;
  name: string | null;
}

/** Owners del workspace (team members o el propio usuario) para reportes por owner. */
export async function listReportOwners(user: SessionUser, scope?: OwnerScope): Promise<DashboardOwner[]> {
  const members = workspaceTeamId(user)
    ? await listMembers(workspaceTeamId(user)!)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  return members
    .filter((m) => !scope || scope.includes(m.user_id))
    .map((m) => ({ id: m.user_id, email: m.email, name: m.name }));
}

/** Dataset de un widget. Reusa las funciones de lib/crm-reports (rango default 30d). */
export async function getWidgetData(
  userId: string,
  req: DashboardDataRequest,
  owners: DashboardOwner[],
  scope?: OwnerScope,
): Promise<WidgetData> {
  const rangeLabel = req.range ?? '30d';
  const range = reportRange(rangeLabel);
  const filters: ReportFilters = { pipelineId: req.pipelineId ?? undefined, ownerIds: scope ?? undefined };

  switch (req.type) {
    case 'kpi':
      return { kpis: await reportKpis(userId, range, filters) };
    case 'funnel': {
      const pipelineId = req.pipelineId ?? (await defaultPipelineId(userId));
      return { funnel: await reportFunnel(userId, pipelineId, scope ?? undefined) };
    }
    case 'forecast': {
      const pipelineId = req.pipelineId ?? (await defaultPipelineId(userId));
      return { forecast: await reportForecast(userId, pipelineId, scope ?? undefined) };
    }
    case 'timeseries':
      return {
        timeseries: await reportTimeseries(userId, range, defaultBucket(rangeLabel), filters),
      };
    case 'wonlost':
      return { wonLost: await wonLostByMonth(userId, scope) };
    case 'source':
      return { sourcePerformance: await reportSourcePerformance(userId, range, filters) };
    case 'owner':
      return { byOwner: await reportByOwner(userId, range, filters, owners) };
    case 'leaderboard':
      return { leaderboard: await reportActivityLeaderboard(userId, range, owners) };
    case 'tasks':
      return { tasks: (await listTasks(userId, { bucket: 'upcoming', ownerScope: scope })).slice(0, 8) };
    case 'recent_activity':
      return { activities: await listTimeline(userId, { limit: 8, ownerScope: scope }) };
    case 'custom_report': {
      const report = req.reportId ? await getCustomReport(userId, req.reportId) : null;
      if (!report) return { report: null };
      try {
        const result = await runReport(userId, report.config, {
          scope,
          people: owners.map((o) => ({ id: o.id, name: o.name || o.email })),
        });
        return { report: { id: report.id, name: report.name, config: report.config, result } };
      } catch (e) {
        return { report: null, error: e instanceof ReportError ? e.code : 'report_failed' };
      }
    }
  }
}
