/**
 * CRM: "Seleccionar todos los que coinciden" y "Exportar la vista" de los
 * listados de contactos, empresas y deals, como en HubSpot. Server-only.
 *
 * El cliente nunca manda la lista de ids más allá de la página: manda el
 * estado del listado (la query de la URL, con la vista activa `sv`) y el
 * server lo vuelve a evaluar con la persona que pide: su alcance por owner
 * (lib/crm-visibility.ts), sus vistas (una que no ve no aporta filtros) y sus
 * permisos por campo (un campo oculto no filtra ni ordena: la regla que lo
 * nombra se descarta, igual que en la página). Siempre con tope.
 */
import { fieldAccessFor, scoreSqlRules, sessionFieldViewer } from './crm-field-perms';
import { filterTypeFor } from './crm-custom-fields';
import { listFilterModel } from './crm-filter-http';
import { sessionScope } from './crm-visibility';
import { listViewContext, sessionViewViewer } from './crm-views';
import { SAVED_VIEW_PARAM, resolveViewState, type ViewQuery } from './crm-views-shared';
import { isExtraSort } from './crm-list-sort';
import { getUserTimeZone } from './user-tz';
import {
  ACTIVITY_DATE_SORTS,
  PRIORITIES,
  SOURCES,
  listCompanyIds,
  listContactIds,
  listDealIds,
  listPipelinesWithStages,
  type CompanyFilter,
  type ContactFilter,
  type DealFilter,
} from './crm';
import type { TeamRole } from './teams';

export type MatchingEntity = 'contacts' | 'companies' | 'deals';

/** Tope de registros de una acción masiva sobre "todos los que coinciden". */
export const MATCHING_CAP = 1000;
/** Tope de filas de "Exportar la vista". */
export const EXPORT_VIEW_CAP = 10_000;
/** Largo máximo de la query que describe el listado. */
const MAX_QUERY = 20_000;

const CONTACT_SORTS = ['newest', 'oldest', 'name', 'name_desc', 'email', 'email_desc', 'score', 'score_asc', ...ACTIVITY_DATE_SORTS];
const COMPANY_SORTS = ['newest', 'oldest', 'name', 'name_desc', ...ACTIVITY_DATE_SORTS];
const DEAL_SORTS = ['newest', 'oldest', 'amount', 'amount_asc', 'close_date', 'close_date_desc', ...ACTIVITY_DATE_SORTS];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | undefined) => (v && DAY.test(v) ? v : undefined);
const str = (v: string | undefined) => (v ? v : undefined);

type MatchingUser = { id: string; role: TeamRole; actingUser?: { id: string } | null };

export type MatchingResult = { ids: string[]; total: number } | { error: 'invalid_input' | 'invalid_filter' };

/** La query del listado (`?a=1&b=2` o `a=1&b=2`) como params sueltos (el último gana). */
export function parseListQuery(raw: string): Record<string, string> | null {
  if (typeof raw !== 'string' || raw.length > MAX_QUERY) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)) out[k] = v;
  return out;
}

/** Filtros por propiedad propia (`custom_<name>`) que la persona ve. */
function customFrom(state: ViewQuery, visible: ReadonlySet<string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith('custom_') && value && visible.has(key.slice(7))) out[key.slice(7)] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Ids (hasta `cap`) y total de los registros que el listado muestra con esta
 * query, para la persona que pide. `{ error }` si la query es inválida o el
 * filtro avanzado nombra algo que no existe o que la persona no ve.
 */
export async function resolveMatching(user: MatchingUser, entity: MatchingEntity, rawQuery: string, cap: number): Promise<MatchingResult> {
  const params = parseListQuery(rawQuery);
  if (!params) return { error: 'invalid_input' };
  const viewer = sessionFieldViewer(user);
  const [fieldAccess, scope, viewViewer, timeZone] = await Promise.all([
    fieldAccessFor(viewer, entity),
    sessionScope(user),
    sessionViewViewer(user),
    getUserTimeZone(),
  ]);
  const hidden = fieldAccess.hidden;
  const visibleNames = new Set(fieldAccess.visible.map((d) => d.name));
  const customTypes = Object.fromEntries(fieldAccess.visible.map((d) => [d.name, filterTypeFor(d.type)]));

  // La vista activa aporta sus filtros (ya sin lo que toca campos ocultos), igual que en la página.
  const sv = params[SAVED_VIEW_PARAM] ?? (entity === 'contacts' ? params.view : undefined);
  const ctx = await listViewContext(viewViewer, entity, sv, hidden);
  const { state } = resolveViewState(entity, params, ctx.activeQuery);

  // El mismo filtro que aplica la página (lib/crm-filter-http.ts listFilterModel): lo que la página
  // descarta (una propiedad borrada o un campo oculto para quien pide) acá tampoco filtra ni da error.
  const filterEnv = { viewerId: user.actingUser?.id ?? user.id, timeZone, strictCustom: true as const };
  const advModel = listFilterModel(state.filters, entity, { customTypes, env: filterEnv });
  const common = {
    q: str(state.q?.trim()),
    owner: str(state.owner),
    tag: str(state.tag),
    createdFrom: day(state.createdFrom),
    createdTo: day(state.createdTo),
    activityFrom: day(state.activityFrom),
    activityTo: day(state.activityTo),
    activityNone: state.noActivity === '1' || undefined,
    custom: customFrom(state, visibleNames),
    filters: advModel.groups.length ? advModel : undefined,
    filterEnv,
    customTypes,
    ownerScope: scope,
  };
  const sortOf = (known: readonly string[]) => {
    const s = state.sort ?? 'newest';
    return known.includes(s) || isExtraSort(s, customTypes) ? s : 'newest';
  };

  if (entity === 'contacts') {
    const f: ContactFilter = {
      ...common,
      lifecycle: str(state.lifecycle),
      leadStatus: str(state.leadStatus),
      source: str(state.source),
      sort: sortOf(CONTACT_SORTS) as ContactFilter['sort'],
      // Orden y filtros por score con el total que la persona ve (sin reglas sobre sus campos ocultos).
      scoreRules: scoreSqlRules(hidden),
    };
    return listContactIds(user.id, f, cap);
  }
  if (entity === 'companies') {
    const f: CompanyFilter = {
      ...common,
      industry: str(state.industry),
      lifecycle: str(state.lifecycle),
      sort: sortOf(COMPANY_SORTS) as CompanyFilter['sort'],
    };
    return listCompanyIds(user.id, f, cap);
  }
  // Deals: la tabla de un pipeline (el del param, o el primero, como la página).
  const pipelines = await listPipelinesWithStages(user.id);
  const pipeline = pipelines.find((p) => p.id === params.pipeline) ?? pipelines[0];
  if (!pipeline) return { ids: [], total: 0 };
  const stageId = state.stageId && pipeline.stages.some((s) => s.id === state.stageId) ? state.stageId : undefined;
  const f: DealFilter = {
    ...common,
    pipelineId: pipeline.id,
    stageId,
    priority: (PRIORITIES as readonly string[]).includes(state.priority ?? '') ? state.priority : undefined,
    source: (SOURCES as readonly string[]).includes(state.source ?? '') ? state.source : undefined,
    closeFrom: day(state.closeFrom),
    closeTo: day(state.closeTo),
    stalled: state.stalled === '1' || undefined,
    sort: sortOf(DEAL_SORTS) as DealFilter['sort'],
  };
  return listDealIds(user.id, f, cap);
}
