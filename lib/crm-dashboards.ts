/**
 * CRM — dashboards como los de HubSpot. Usado por /app/crm/dashboards y
 * app/api/crm/dashboards.
 *
 * Acceso (crm_dashboards.owner_id / visibility / team_id / access):
 * - 'private': solo su dueño.
 * - 'team': su dueño, quienes están en el equipo de ventas `team_id` y los admins.
 * - 'everyone': todo el workspace.
 * El dueño y los admins (en uno que no es privado) editan y comparten. El
 * resto edita los tiles si `access` es 'edit'; si es 'view', solo mira.
 *
 * Los datos de cada tile se calculan con la persona que mira (su alcance y
 * sus campos ocultos), nunca con quien creó el dashboard.
 */
import { getDb, type CrmDashboardRow, type CrmDashboardWidgetRow, type Db } from './db';
import type { OwnerScope, Viewer } from './crm-visibility';
import type { FieldViewer } from './crm-field-perms';
import { listMembers, roleAtLeast } from './teams';
import { drillReport, getCustomReport, reportForViewer, runReport, ReportError } from './crm-custom-reports';
import type { ReportConfig } from './crm-report-builder';
import type { SessionUser } from './session';
import { workspaceTeamId } from './workspace';
import {
  SALES_TEMPLATE,
  SIZE_COLS,
  legacyReportKey,
  libraryReport,
  parseDashboardFilters,
  resolveRange,
  type DashboardFilters,
  type DrillResult,
  type DrillRow,
  type DrillSegment,
  type TileSize,
} from './crm-dashboard-library';
import { computeLibraryReport, drillLibraryReport, type ReportContext } from './crm-dashboard-reports';
import {
  WIDGET_DEFAULT_SIZE,
  type DashboardAccess,
  type DashboardVisibility,
  type DashboardWidgetConfig,
  type DashboardWidgetType,
  type TileData,
} from './crm-dashboards-schema';

export type { CrmDashboardRow, CrmDashboardWidgetRow };

export interface CrmDashboardWithWidgets extends CrmDashboardRow {
  widgets: CrmDashboardWidgetRow[];
}

/** Dashboard como lo ve una persona: con lo que puede hacer. */
export interface DashboardView extends CrmDashboardWithWidgets {
  canEdit: boolean;
  canManage: boolean;
  isOwner: boolean;
  isDefault: boolean;
  ownerName: string | null;
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

export class DashboardError extends Error {
  constructor(public readonly code: 'not_found' | 'forbidden' | 'invalid_input') {
    super(code);
  }
}

// ---------- Acceso ----------

export function isAdminViewer(viewer: Viewer): boolean {
  return roleAtLeast(viewer.role, 'admin') || viewer.personId === viewer.workspaceId;
}

/** Equipos de ventas de la persona. */
async function salesTeamsOf(viewer: Viewer, db: Db): Promise<Set<string>> {
  const rows = (await db
    .prepare('SELECT team_id FROM crm_sales_team_members WHERE user_id = ? AND person_id = ?')
    .all(viewer.workspaceId, viewer.personId)) as Array<{ team_id: string }>;
  return new Set(rows.map((r) => r.team_id));
}

/** Qué puede hacer la persona con un dashboard. Puro (recibe sus equipos de ventas). */
export function dashboardRights(
  row: Pick<CrmDashboardRow, 'owner_id' | 'visibility' | 'team_id' | 'access' | 'user_id'>,
  viewer: Viewer,
  teams: ReadonlySet<string>,
): { canView: boolean; canEdit: boolean; canManage: boolean; isOwner: boolean } {
  if (row.user_id !== viewer.workspaceId) return { canView: false, canEdit: false, canManage: false, isOwner: false };
  const owner = row.owner_id ?? row.user_id;
  const isOwner = owner === viewer.personId;
  const admin = isAdminViewer(viewer);
  const vis = row.visibility || 'everyone';
  let canView = isOwner;
  if (!canView && vis === 'everyone') canView = true;
  if (!canView && vis === 'team') canView = admin || (!!row.team_id && teams.has(row.team_id));
  const canManage = isOwner || (canView && admin);
  const canEdit = canManage || (canView && row.access === 'edit');
  return { canView, canEdit, canManage, isOwner };
}

async function personNames(workspaceId: string, db: Db): Promise<Map<string, string>> {
  const rows = (await db
    .prepare(
      `SELECT u.id, COALESCE(NULLIF(u.name, ''), u.email) AS n FROM users u
       WHERE u.id = ? OR u.id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ?)`,
    )
    .all(workspaceId, workspaceId)) as Array<{ id: string; n: string }>;
  return new Map(rows.map((r) => [r.id, r.n]));
}

async function widgetsFor(ids: string[], db: Db): Promise<Map<string, CrmDashboardWidgetRow[]>> {
  const out = new Map<string, CrmDashboardWidgetRow[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = (await db
    .prepare(
      `SELECT * FROM crm_dashboard_widgets WHERE dashboard_id IN (${ids.map(() => '?').join(',')})
       ORDER BY position ASC, created_at ASC`,
    )
    .all(...ids)) as CrmDashboardWidgetRow[];
  for (const r of rows) out.get(r.dashboard_id)?.push(r);
  return out;
}

async function defaultDashboardId(viewer: Viewer, db: Db): Promise<string | null> {
  const row = (await db
    .prepare('SELECT default_dashboard_id AS id FROM crm_dashboard_prefs WHERE user_id = ? AND person_id = ?')
    .get(viewer.workspaceId, viewer.personId)) as { id: string | null } | undefined;
  return row?.id ?? null;
}

/** Los dashboards que la persona ve, con sus tiles (una consulta para todos los tiles). */
export async function listVisibleDashboards(viewer: Viewer, db: Db = getDb()): Promise<DashboardView[]> {
  const rows = (await db
    .prepare('SELECT * FROM crm_dashboards WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(viewer.workspaceId)) as CrmDashboardRow[];
  const teams = await salesTeamsOf(viewer, db);
  const visible = rows.map((r) => ({ r, rights: dashboardRights(r, viewer, teams) })).filter((x) => x.rights.canView);
  const widgets = await widgetsFor(visible.map((x) => x.r.id), db);
  const def = await defaultDashboardId(viewer, db);
  const names = await personNames(viewer.workspaceId, db);
  return visible.map(({ r, rights }) => ({
    ...r,
    widgets: widgets.get(r.id) ?? [],
    canEdit: rights.canEdit,
    canManage: rights.canManage,
    isOwner: rights.isOwner,
    isDefault: r.id === def,
    ownerName: names.get(r.owner_id ?? r.user_id) ?? null,
  }));
}

/** Un dashboard si la persona lo ve (null si no existe o no lo ve: no confirma que existe). */
export async function getDashboardFor(viewer: Viewer, id: string, db: Db = getDb()): Promise<DashboardView | null> {
  const row = (await db.prepare('SELECT * FROM crm_dashboards WHERE id = ? AND user_id = ?').get(id, viewer.workspaceId)) as
    | CrmDashboardRow
    | undefined;
  if (!row) return null;
  const rights = dashboardRights(row, viewer, await salesTeamsOf(viewer, db));
  if (!rights.canView) return null;
  const widgets = await widgetsFor([row.id], db);
  const names = await personNames(viewer.workspaceId, db);
  return {
    ...row,
    widgets: widgets.get(row.id) ?? [],
    canEdit: rights.canEdit,
    canManage: rights.canManage,
    isOwner: rights.isOwner,
    isDefault: (await defaultDashboardId(viewer, db)) === row.id,
    ownerName: names.get(row.owner_id ?? row.user_id) ?? null,
  };
}

/** Dashboards que la persona ve cuyo nombre contiene `q` (⌘K). */
export async function searchDashboards(viewer: Viewer, q: string, limit = 5, db: Db = getDb()): Promise<Array<{ id: string; name: string }>> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return (await listVisibleDashboards(viewer, db))
    .filter((d) => d.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.name }));
}

/** Dashboards donde la persona puede agregar tiles (para "Agregar al dashboard" del constructor). */
export async function listEditableDashboards(viewer: Viewer, db: Db = getDb()): Promise<Array<{ id: string; name: string }>> {
  return (await listVisibleDashboards(viewer, db)).filter((d) => d.canEdit).map((d) => ({ id: d.id, name: d.name }));
}

async function requireRight(viewer: Viewer, id: string, right: 'canEdit' | 'canManage', db: Db): Promise<DashboardView> {
  const d = await getDashboardFor(viewer, id, db);
  if (!d) throw new DashboardError('not_found');
  if (!d[right]) throw new DashboardError('forbidden');
  return d;
}

// ---------- Dashboards ----------

async function insertWidgetRow(
  db: Db,
  dashboardId: string,
  data: { type: DashboardWidgetType; config: DashboardWidgetConfig; w: number; h: number; position: number },
): Promise<CrmDashboardWidgetRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_dashboard_widgets (id, dashboard_id, type, config, x, y, w, h, position, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(id, dashboardId, data.type, JSON.stringify(data.config), data.position, data.w, data.h, data.position);
  return (await db.prepare('SELECT * FROM crm_dashboard_widgets WHERE id = ?').get(id)) as CrmDashboardWidgetRow;
}

export async function createDashboard(
  viewer: Viewer,
  input: { name: string; template?: 'blank' | 'sales'; visibility?: DashboardVisibility; cloneFrom?: string },
  db: Db = getDb(),
): Promise<DashboardView> {
  let source: DashboardView | null = null;
  if (input.cloneFrom) {
    source = await getDashboardFor(viewer, input.cloneFrom, db);
    if (!source) throw new DashboardError('not_found');
  }
  const id = crypto.randomUUID();
  const maxPos = (
    (await db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM crm_dashboards WHERE user_id = ?').get(viewer.workspaceId)) as {
      p: number;
    }
  ).p;
  // Uno nuevo (y una copia) arranca privado salvo que se pida otra cosa.
  const visibility: DashboardVisibility = input.visibility ?? 'private';
  await db
    .prepare(
      `INSERT INTO crm_dashboards (id, user_id, name, position, owner_id, visibility, team_id, access, filters, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'edit', ?, datetime('now'), datetime('now'))`,
    )
    .run(id, viewer.workspaceId, input.name, maxPos + 1, viewer.personId, visibility, source ? source.filters : '{}');
  if (source) {
    for (const w of source.widgets) {
      await insertWidgetRow(db, id, { type: w.type as DashboardWidgetType, config: parseConfig(w.config), w: w.w, h: w.h, position: w.position });
    }
  } else if (input.template === 'sales') {
    for (let i = 0; i < SALES_TEMPLATE.length; i++) {
      const t = SALES_TEMPLATE[i];
      await insertWidgetRow(db, id, { type: 'library', config: { reportKey: t.reportKey }, w: SIZE_COLS[t.size], h: 1, position: i });
    }
  }
  return (await getDashboardFor(viewer, id, db))!;
}

/**
 * Un workspace sin ningún dashboard arranca con "Sales" (plantilla de
 * ventas, visible para todos). Si ya hay dashboards no crea nada.
 */
export async function ensureStarterDashboard(viewer: Viewer, name: string, db: Db = getDb()): Promise<void> {
  const any = await db.prepare('SELECT 1 AS x FROM crm_dashboards WHERE user_id = ? LIMIT 1').get(viewer.workspaceId);
  if (any) return;
  await createDashboard(viewer, { name, template: 'sales', visibility: 'everyone' }, db);
}

export interface DashboardPatch {
  name?: string;
  visibility?: DashboardVisibility;
  teamId?: string | null;
  access?: DashboardAccess;
  filters?: DashboardFilters;
  isDefault?: true;
  order?: Array<{ id: string; position: number; size?: TileSize }>;
  layout?: DashboardLayoutItem[];
}

/** El dashboard actualizado como lo ve la persona; null si ya no lo ve (un admin que lo hizo privado de otro). */
export async function updateDashboard(viewer: Viewer, id: string, patch: DashboardPatch, db: Db = getDb()): Promise<DashboardView | null> {
  const current = await getDashboardFor(viewer, id, db);
  if (!current) throw new DashboardError('not_found');
  const sharing = patch.visibility !== undefined || patch.teamId !== undefined || patch.access !== undefined;
  const editing = patch.name !== undefined || patch.order !== undefined || patch.layout !== undefined || patch.filters !== undefined;
  if (sharing && !current.canManage) throw new DashboardError('forbidden');
  if (editing && !current.canEdit) throw new DashboardError('forbidden');

  const sets: string[] = [];
  const args: Array<string | null> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name);
  }
  if (patch.visibility !== undefined) {
    sets.push('visibility = ?');
    args.push(patch.visibility);
  }
  if (patch.teamId !== undefined || patch.visibility !== undefined) {
    const vis = patch.visibility ?? current.visibility;
    let team = patch.teamId !== undefined ? patch.teamId : current.team_id;
    if (vis !== 'team') team = null;
    if (team) {
      const ok = await db.prepare('SELECT 1 AS x FROM crm_sales_teams WHERE id = ? AND user_id = ?').get(team, viewer.workspaceId);
      if (!ok) throw new DashboardError('invalid_input');
    } else if (vis === 'team') throw new DashboardError('invalid_input');
    sets.push('team_id = ?');
    args.push(team ?? null);
  }
  if (patch.access !== undefined) {
    sets.push('access = ?');
    args.push(patch.access);
  }
  if (patch.filters !== undefined) {
    sets.push('filters = ?');
    args.push(JSON.stringify(parseDashboardFilters(patch.filters)));
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_dashboards SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(...args, id, viewer.workspaceId);
  }
  for (const item of patch.order ?? []) {
    if (item.size) {
      await db
        .prepare('UPDATE crm_dashboard_widgets SET position = ?, w = ? WHERE id = ? AND dashboard_id = ?')
        .run(item.position, SIZE_COLS[item.size], item.id, id);
    } else {
      await db.prepare('UPDATE crm_dashboard_widgets SET position = ? WHERE id = ? AND dashboard_id = ?').run(item.position, item.id, id);
    }
  }
  for (const item of patch.layout ?? []) {
    await db
      .prepare('UPDATE crm_dashboard_widgets SET x = ?, y = ?, w = ?, h = ?, position = ? WHERE id = ? AND dashboard_id = ?')
      .run(item.x, item.y, item.w, item.h, item.position, item.id, id);
  }
  if (patch.isDefault) {
    await db
      .prepare(
        `INSERT INTO crm_dashboard_prefs (user_id, person_id, default_dashboard_id, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, person_id) DO UPDATE SET default_dashboard_id = excluded.default_dashboard_id, updated_at = excluded.updated_at`,
      )
      .run(viewer.workspaceId, viewer.personId, id);
  }
  return getDashboardFor(viewer, id, db);
}

export async function deleteDashboard(viewer: Viewer, id: string, db: Db = getDb()): Promise<void> {
  await requireRight(viewer, id, 'canManage', db);
  await db.prepare('DELETE FROM crm_dashboard_widgets WHERE dashboard_id = ?').run(id);
  await db.prepare('DELETE FROM crm_dashboards WHERE id = ? AND user_id = ?').run(id, viewer.workspaceId);
  // Quien lo tenía de default vuelve al primero que ve.
  await db
    .prepare('UPDATE crm_dashboard_prefs SET default_dashboard_id = NULL WHERE user_id = ? AND default_dashboard_id = ?')
    .run(viewer.workspaceId, id);
}

/** Orden de los dashboards en el selector: es de todo el workspace, así que solo mueve los que la persona administra. */
export async function reorderDashboards(viewer: Viewer, ids: string[], db: Db = getDb()): Promise<void> {
  const visible = new Set((await listVisibleDashboards(viewer, db)).filter((d) => d.canManage).map((d) => d.id));
  for (let i = 0; i < ids.length; i++) {
    if (!visible.has(ids[i])) continue;
    await db.prepare('UPDATE crm_dashboards SET position = ? WHERE id = ? AND user_id = ?').run(i, ids[i], viewer.workspaceId);
  }
}

// ---------- Widgets ----------

export function parseConfig(raw: string): DashboardWidgetConfig {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as DashboardWidgetConfig) : {};
  } catch {
    return {};
  }
}

async function editableWidget(viewer: Viewer, widgetId: string, db: Db): Promise<CrmDashboardWidgetRow> {
  const widget = (await db
    .prepare(
      `SELECT w.* FROM crm_dashboard_widgets w JOIN crm_dashboards d ON d.id = w.dashboard_id
       WHERE w.id = ? AND d.user_id = ?`,
    )
    .get(widgetId, viewer.workspaceId)) as CrmDashboardWidgetRow | undefined;
  if (!widget) throw new DashboardError('not_found');
  await requireRight(viewer, widget.dashboard_id, 'canEdit', db);
  return widget;
}

export async function addWidget(
  viewer: Viewer,
  dashboardId: string,
  input: { type: DashboardWidgetType; config?: DashboardWidgetConfig; size?: TileSize; duplicateOf?: string; w?: number; h?: number },
  db: Db = getDb(),
): Promise<CrmDashboardWidgetRow> {
  let data = input;
  const dashboard = await requireRight(viewer, dashboardId, 'canEdit', db);
  let type = data.type;
  let config = data.config ?? {};
  let w = data.size ? SIZE_COLS[data.size] : data.w;
  let position = dashboard.widgets.length ? Math.max(...dashboard.widgets.map((x) => x.position)) + 1 : 0;
  if (data.duplicateOf) {
    const src = dashboard.widgets.find((x) => x.id === data.duplicateOf);
    if (!src) throw new DashboardError('not_found');
    type = src.type as DashboardWidgetType;
    config = parseConfig(src.config);
    w = src.w;
    data = { ...data, h: src.h };
    // La copia queda al lado del original.
    position = src.position + 1;
    await db.prepare('UPDATE crm_dashboard_widgets SET position = position + 1 WHERE dashboard_id = ? AND position >= ?').run(dashboardId, position);
  }
  if (type === 'library') {
    const def = libraryReport(config.reportKey);
    if (!def) throw new DashboardError('invalid_input');
    w ??= SIZE_COLS[def.size];
    if (config.viz && !def.vizOptions.includes(config.viz)) config = { ...config, viz: undefined };
  }
  if (type === 'custom_report') {
    if (!config.reportId || !(await getCustomReport(viewer.workspaceId, config.reportId, db))) throw new DashboardError('invalid_input');
  }
  return insertWidgetRow(db, dashboardId, {
    type,
    config,
    w: w ?? WIDGET_DEFAULT_SIZE[type].w,
    h: data.h ?? WIDGET_DEFAULT_SIZE[type].h,
    position,
  });
}

export async function updateWidget(
  viewer: Viewer,
  widgetId: string,
  data: { config?: DashboardWidgetConfig; size?: TileSize; x?: number; y?: number; w?: number; h?: number; position?: number },
  db: Db = getDb(),
): Promise<CrmDashboardWidgetRow> {
  const widget = await editableWidget(viewer, widgetId, db);
  const sets: string[] = [];
  const args: Array<string | number> = [];
  for (const key of ['x', 'y', 'w', 'h', 'position'] as const) {
    const v = data[key];
    if (typeof v === 'number') {
      sets.push(`${key} = ?`);
      args.push(v);
    }
  }
  if (data.size) {
    sets.push('w = ?');
    args.push(SIZE_COLS[data.size]);
  }
  if (data.config !== undefined) {
    let config: DashboardWidgetConfig = { ...parseConfig(widget.config), ...data.config };
    const key = widget.type === 'library' ? config.reportKey : legacyReportKey(widget.type, config as { metric?: string });
    const def = libraryReport(key);
    if (config.viz && (!def || !def.vizOptions.includes(config.viz))) config = { ...config, viz: undefined };
    if (!config.title) delete config.title;
    sets.push('config = ?');
    args.push(JSON.stringify(config));
  }
  if (sets.length) await db.prepare(`UPDATE crm_dashboard_widgets SET ${sets.join(', ')} WHERE id = ?`).run(...args, widgetId);
  return (await db.prepare('SELECT * FROM crm_dashboard_widgets WHERE id = ?').get(widgetId)) as CrmDashboardWidgetRow;
}

export async function deleteWidget(viewer: Viewer, widgetId: string, db: Db = getDb()): Promise<void> {
  await editableWidget(viewer, widgetId, db);
  await db.prepare('DELETE FROM crm_dashboard_widgets WHERE id = ?').run(widgetId);
}

// ============================================================
// DATOS DE LOS TILES (página + /api/crm/dashboards/data y /drill)
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

/** Quién mira los tiles: su alcance, sus campos ocultos y las personas que puede nombrar. */
export interface TileViewer {
  viewer: Viewer;
  scope: OwnerScope | undefined;
  fieldViewer: FieldViewer;
  owners: DashboardOwner[];
  locale: string;
  now?: Date;
}

/** Contexto de los reportes: filtros del dashboard ya validados contra el workspace. */
export async function reportContext(tv: TileViewer, filters: DashboardFilters, db: Db = getDb()): Promise<ReportContext> {
  const ws = tv.viewer.workspaceId;
  const pipelines = (await db
    .prepare('SELECT id FROM crm_pipelines WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(ws)) as Array<{ id: string }>;
  // Un pipeline de otro workspace no existe acá: no se lee ni el nombre de sus etapas.
  const pipelineId = filters.pipelineId && pipelines.some((p) => p.id === filters.pipelineId) ? filters.pipelineId : null;
  let ownerIds: string[] | null = null;
  // Un owner guardado que la persona no puede nombrar (fuera de su alcance) no filtra: ve lo suyo, sin pantallas en cero sin explicación.
  if (filters.ownerId && (!tv.scope || tv.scope.includes(filters.ownerId))) ownerIds = [filters.ownerId];
  else if (filters.teamId && !filters.ownerId) {
    const rows = (await db
      .prepare(
        `SELECT m.person_id FROM crm_sales_team_members m JOIN crm_sales_teams t ON t.id = m.team_id
         WHERE t.id = ? AND t.user_id = ? AND m.user_id = ?`,
      )
      .all(filters.teamId, ws, ws)) as Array<{ person_id: string }>;
    ownerIds = rows.map((r) => r.person_id);
  }
  return {
    workspaceId: ws,
    scope: tv.scope,
    ownerIds,
    pipelineId,
    defaultPipelineId: pipelines[0]?.id ?? null,
    range: resolveRange(filters, tv.now ?? new Date()),
    people: new Map(tv.owners.map((o) => [o.id, o.name || o.email])),
    locale: tv.locale,
    now: tv.now,
    db,
  };
}

/** Clave de la biblioteca de un tile (los widgets de antes se traducen). */
export function widgetReportKey(w: Pick<CrmDashboardWidgetRow, 'type' | 'config'>): string | null {
  const cfg = parseConfig(w.config);
  if (w.type === 'library') return libraryReport(cfg.reportKey)?.key ?? null;
  if (w.type === 'custom_report') return null;
  return legacyReportKey(w.type, cfg as { metric?: string });
}

/** Alcance para un reporte propio: el de quien mira, recortado al filtro de owner/equipo. */
export function narrowScope(scope: OwnerScope | undefined, ownerIds: string[] | null): OwnerScope | undefined {
  if (!ownerIds) return scope;
  if (!scope) return ownerIds;
  return ownerIds.filter((id) => scope.includes(id));
}

async function tileData(w: CrmDashboardWidgetRow, ctx: ReportContext, tv: TileViewer, db: Db): Promise<TileData> {
  try {
    if (w.type === 'custom_report') {
      const cfg = parseConfig(w.config);
      const report = cfg.reportId ? await getCustomReport(tv.viewer.workspaceId, cfg.reportId, db) : null;
      if (!report) return { kind: 'error', code: 'report_missing' };
      let config: ReportConfig = report.config;
      if (ctx.pipelineId && config.source === 'deals' && config.filters.length < 20) {
        config = { ...config, filters: [...config.filters, { f: 'deal.pipeline', o: 'is', v: ctx.pipelineId }] };
      }
      const result = await runReport(
        tv.viewer.workspaceId,
        config,
        {
          scope: narrowScope(tv.scope, ctx.ownerIds),
          people: tv.owners.map((o) => ({ id: o.id, name: o.name || o.email })),
          viewer: tv.fieldViewer,
          // El rango del dashboard va al campo de fecha del reporte (si tiene uno).
          range: { from: ctx.range.from, to: ctx.range.to },
        },
        db,
      );
      // La config sale como la ve la persona (sin campos ocultos).
      const shown = await reportForViewer(tv.fieldViewer, report, db);
      return { kind: 'custom', report: { id: report.id, name: report.name, config: shown.config, result } };
    }
    const key = widgetReportKey(w);
    if (!key) return { kind: 'error', code: 'unknown_report' };
    return await computeLibraryReport(key, ctx);
  } catch (e) {
    return { kind: 'error', code: e instanceof ReportError ? e.code : 'report_failed' };
  }
}

/** Datos de los tiles de un dashboard que la persona ve, con los filtros dados (o los guardados). */
export async function computeDashboardTiles(
  tv: TileViewer,
  dashboardId: string,
  filters: DashboardFilters | undefined,
  widgetIds?: string[],
  db: Db = getDb(),
): Promise<Record<string, TileData>> {
  const d = await getDashboardFor(tv.viewer, dashboardId, db);
  if (!d) throw new DashboardError('not_found');
  return tilesOf(tv, d, filters ?? parseDashboardFilters(d.filters), widgetIds, db);
}

/** Igual que computeDashboardTiles con el dashboard ya cargado (la página lo tiene). */
export async function tilesOf(
  tv: TileViewer,
  d: Pick<DashboardView, 'widgets'>,
  filters: DashboardFilters,
  widgetIds?: string[],
  db: Db = getDb(),
): Promise<Record<string, TileData>> {
  const ctx = await reportContext(tv, filters, db);
  const widgets = widgetIds ? d.widgets.filter((w) => widgetIds.includes(w.id)) : d.widgets;
  const entries = await Promise.all(widgets.map(async (w) => [w.id, await tileData(w, ctx, tv, db)] as const));
  return Object.fromEntries(entries);
}

/** Registros detrás de un segmento de un tile (solo los que la persona ve). */
export async function drillTile(
  tv: TileViewer,
  dashboardId: string,
  widgetId: string,
  filters: DashboardFilters | undefined,
  segment: DrillSegment,
  db: Db = getDb(),
): Promise<DrillResult> {
  const d = await getDashboardFor(tv.viewer, dashboardId, db);
  const w = d?.widgets.find((x) => x.id === widgetId);
  if (!d || !w) throw new DashboardError('not_found');
  if (w.type === 'custom_report') return drillCustomTile(tv, w, filters ?? parseDashboardFilters(d.filters), segment, db);
  const key = widgetReportKey(w);
  if (!key) throw new DashboardError('invalid_input');
  const ctx = await reportContext(tv, filters ?? parseDashboardFilters(d.filters), db);
  return drillLibraryReport(key, ctx, segment);
}

/**
 * Drill-down de un tile de reporte propio: los registros del segmento con el
 * mismo alcance (el de quien mira, recortado al filtro de owner/equipo), los
 * mismos filtros y pipeline que el tile y el rango del dashboard. Un campo
 * oculto para quien mira hace fallar el drill igual que el tile (forbidden).
 */
async function drillCustomTile(
  tv: TileViewer,
  w: CrmDashboardWidgetRow,
  filters: DashboardFilters,
  segment: DrillSegment,
  db: Db,
): Promise<DrillResult> {
  const cfg = parseConfig(w.config);
  const report = cfg.reportId ? await getCustomReport(tv.viewer.workspaceId, cfg.reportId, db) : null;
  if (!report) throw new DashboardError('not_found');
  const ctx = await reportContext(tv, filters, db);
  let config: ReportConfig = report.config;
  if (ctx.pipelineId && config.source === 'deals' && config.filters.length < 20) {
    config = { ...config, filters: [...config.filters, { f: 'deal.pipeline', o: 'is', v: ctx.pipelineId }] };
  }
  let res: Awaited<ReturnType<typeof drillReport>>;
  try {
    res = await drillReport(
      tv.viewer.workspaceId,
      config,
      segment.keys ?? [],
      { scope: narrowScope(tv.scope, ctx.ownerIds), viewer: tv.fieldViewer, range: { from: ctx.range.from, to: ctx.range.to }, locale: tv.locale },
      db,
    );
  } catch (e) {
    if (e instanceof ReportError) throw new DashboardError(e.code === 'invalid_field' ? 'forbidden' : 'invalid_input');
    throw e;
  }
  const people = new Map(tv.owners.map((o) => [o.id, o.name || o.email]));
  const object: DrillResult['object'] = res.object;
  return {
    object,
    total: res.total,
    truncated: res.truncated,
    sum: null,
    rows: res.rows.map((r): DrillRow => {
      const preview = r.object === 'activity' ? null : r.object;
      return {
        id: r.id,
        previewType: preview,
        previewId: preview ? r.id : null,
        href: r.object === 'activity' ? (report.config.source === 'tasks' ? `/app/crm/tasks/${r.id}` : null) : `/app/crm/${r.object === 'company' ? 'companies' : `${r.object}s`}/${r.id}`,
        name: r.name,
        amount: r.object === 'deal' ? r.amount : null,
        status: r.status,
        statusKind: r.object === 'deal' ? 'stage' : r.object === 'activity' ? 'activityType' : 'lifecycle',
        owner: r.ownerId ? people.get(r.ownerId) ?? null : null,
        date: r.date,
      };
    }),
  };
}
