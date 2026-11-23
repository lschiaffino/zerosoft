/**
 * Datos de las pestañas de vistas para las páginas de listado (server). Arma
 * lo que ViewTabs necesita: pestañas con su nombre, la activa y su estado, y
 * los equipos con los que la persona puede compartir.
 */
import { listSalesTeams } from '@/lib/crm-visibility';
import { listViewContext, sessionViewViewer } from '@/lib/crm-views';
import {
  DEFAULT_VIEWS,
  MODIFIED_PARAM,
  SAVED_VIEW_PARAM,
  resolveViewState,
  type ViewEntity,
  type ViewQuery,
} from '@/lib/crm-views-shared';
import type { TeamRole } from '@/lib/teams';
import type { ViewTabItem } from './ViewTabs';

export interface ListViews {
  tabs: ViewTabItem[];
  /** La pestaña que se abre sin `sv` (la primera). */
  defaultKey: string;
  activeKey: string;
  activeExtra: ViewTabItem | null;
  /** Estado efectivo del listado (vista activa + URL). */
  state: ViewQuery;
  modified: boolean;
  teams: Array<{ id: string; name: string }>;
  /** Params a conservar en los links del listado (vista activa y "la URL manda"). */
  keep: Record<string, string>;
}

export async function loadListViews(
  user: { id: string; role: TeamRole; actingUser?: { id: string } | null },
  entity: ViewEntity,
  searchParams: Record<string, string | string[] | undefined>,
  hidden: ReadonlySet<string>,
  t: (key: string) => string,
): Promise<ListViews> {
  const viewer = await sessionViewViewer(user);
  const svRaw = searchParams[SAVED_VIEW_PARAM] ?? (entity === 'contacts' ? searchParams.view : undefined);
  const sv = typeof svRaw === 'string' ? svRaw : undefined;
  const [ctx, teams] = await Promise.all([listViewContext(viewer, entity, sv, hidden), listSalesTeams(viewer.workspaceId)]);
  const byId = new Map(ctx.views.map((v) => [v.id, v]));
  const item = (key: string, pinned: boolean): ViewTabItem | null => {
    const def = DEFAULT_VIEWS[entity].find((d) => d.key === key);
    if (def) return { key, label: t(`views.defaults.${def.labelKey}`), pinned, saved: false, canEdit: false };
    const v = byId.get(key);
    if (!v) return null;
    return { key, label: v.name, pinned, saved: true, canEdit: v.canEdit, visibility: v.visibility, teamId: v.teamId, partial: v.partial };
  };
  const tabs = ctx.tabs.map((p) => item(p.key, !!p.pinned)).filter((x): x is ViewTabItem => !!x);
  const activeExtra = tabs.some((x) => x.key === ctx.activeKey) ? null : item(ctx.activeKey, false);
  const { state, modified } = resolveViewState(entity, searchParams, ctx.activeQuery);
  const keep: Record<string, string> = {};
  // Con una vista con filtros activa (aunque sea la que se abre sin `sv`), la URL la nombra y manda.
  if (ctx.activeKey !== 'all' || typeof sv === 'string') {
    keep[SAVED_VIEW_PARAM] = ctx.activeKey;
    keep[MODIFIED_PARAM] = '1';
  }
  if (state.cols) keep.cols = state.cols;
  if (state.freeze) keep.freeze = state.freeze;
  if (state.widths) keep.widths = state.widths;
  return {
    tabs,
    defaultKey: ctx.defaultKey,
    activeKey: ctx.activeKey,
    activeExtra,
    state,
    modified,
    teams: teams.filter((x) => viewer.isAdmin || viewer.teamIds.has(x.id)).map((x) => ({ id: x.id, name: x.name })),
    keep,
  };
}
