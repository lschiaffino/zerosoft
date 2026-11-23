/**
 * CRM: el filtro avanzado de un pedido HTTP (query param `filters`), para las
 * rutas de sesión, la API v1 y el export. Valida contra las propiedades que
 * ve quien pide: las de fábrica del objeto más las propias que no tiene ocultas.
 */
import { CRM_FILTER_FIELDS } from './crm';
import { filterTypeFor } from './crm-custom-fields';
import { fieldAccessFor, scoreSqlRules, type FieldViewer, type VisibleScoreRules } from './crm-field-perms';
import { compileRule, FilterError, parseStrictFilter, type FilterEnv, type FilterFieldType, type FilterModel } from './crm-filters';
import { MAX_FILTER_GROUPS, MAX_GROUP_RULES, parseFilterModel, sanitizeFilterModel, type FilterFieldShape } from './crm-filter-model';
import { isValidTimeZone } from './user-tz';

export type FilterEntity = keyof typeof CRM_FILTER_FIELDS;

export interface RequestFilter {
  /** undefined = el pedido no trae filtro. */
  filters?: FilterModel;
  customTypes?: Record<string, FilterFieldType>;
  filterEnv?: FilterEnv & { strictCustom: true };
  /**
   * Contactos, para quien tiene campos ocultos: las reglas de score que ve. El
   * orden y los filtros por score usan su total (ContactFilter.scoreRules),
   * también sin `filters` en el pedido.
   */
  scoreRules?: VisibleScoreRules;
}

/** Largo máximo del JSON del filtro en la URL. */
const MAX_FILTER_PARAM = 16_000;

/**
 * Lee y valida `filters`. `{ error: true }` si el JSON está roto, pasa los
 * límites o nombra una propiedad u operador que no existe (o que quien pide no
 * ve): la ruta responde 400 en vez de devolver una lista sin filtrar.
 */
export async function requestFilter(
  sp: URLSearchParams,
  entity: FilterEntity,
  who: { viewer: FieldViewer; viewerId: string; timeZone?: string | null },
): Promise<RequestFilter | { error: true }> {
  const raw = sp.get('filters');
  if (raw && raw.length > MAX_FILTER_PARAM) return { error: true };
  const access = raw || entity === 'contacts' ? await fieldAccessFor(who.viewer, entity) : null;
  const scoreRules = entity === 'contacts' && access ? scoreSqlRules(access.hidden) : undefined;
  const score = scoreRules ? { scoreRules } : {};
  if (!raw || !access) return score;
  const tz = who.timeZone && who.timeZone.length <= 64 && isValidTimeZone(who.timeZone) ? who.timeZone : 'UTC';
  const visible = access.visible;
  const customTypes: Record<string, FilterFieldType> = Object.fromEntries(visible.map((d) => [d.name, filterTypeFor(d.type)]));
  const filterEnv = { viewerId: who.viewerId, timeZone: tz, strictCustom: true as const };
  const { alias, fields } = CRM_FILTER_FIELDS[entity];
  try {
    const filters = parseStrictFilter({ alias, fields, customTypes, ...filterEnv }, raw);
    return { filters, customTypes, filterEnv, ...score };
  } catch (err) {
    if (err instanceof FilterError) return { error: true };
    throw err;
  }
}

/**
 * El filtro avanzado de un listado (el de la URL o el de la vista guardada),
 * leído igual por la página y por "Seleccionar todos los que coinciden" y
 * "Exportar la vista" (lib/crm-list-matching.ts), así los tres aplican las
 * mismas reglas. A diferencia de `requestFilter` (la API, que responde 400),
 * acá una regla que no se puede aplicar (una propiedad borrada, un campo que
 * quien mira tiene oculto, un valor incompleto) se descarta en silencio, como
 * siempre hizo la página: un link viejo sigue abriendo.
 *
 * `shapes`: las propiedades que ofrece el panel de filtros de la página (los
 * chips muestran solo lo que se aplica). Sin `shapes`, cuenta lo que el
 * server sabe compilar para quien mira.
 */
export function listFilterModel(
  raw: string | null | undefined,
  entity: FilterEntity,
  opts: { customTypes: Record<string, FilterFieldType>; env: FilterEnv & { strictCustom?: boolean }; shapes?: Record<string, FilterFieldShape> },
): FilterModel {
  const parsed = parseFilterModel(raw);
  const model = opts.shapes ? sanitizeFilterModel(parsed, opts.shapes) : parsed;
  const { alias, fields } = CRM_FILTER_FIELDS[entity];
  const ctx = { alias, fields, customTypes: opts.customTypes, ...opts.env };
  const groups = model.groups
    .slice(0, MAX_FILTER_GROUPS)
    .map((g) => ({ rules: g.rules.slice(0, MAX_GROUP_RULES).filter((rule) => compileRule(ctx, rule) !== null) }))
    .filter((g) => g.rules.length > 0);
  return { v: 1, groups };
}
