/**
 * CRM: los filtros rápidos de los listados (la fila de botones bajo la
 * búsqueda), como en HubSpot: cada vista elige cuáles muestra y en qué orden
 * (`qf` en la URL y en la vista guardada). Puro: lo usan el server, los
 * componentes y los unitarios.
 */

export type QuickFilterEntity = 'contacts' | 'companies' | 'deals';

/** Todos los que puede mostrar cada listado, en el orden del menú "Editar filtros rápidos". */
export const QUICK_FILTERS: Record<QuickFilterEntity, readonly string[]> = {
  contacts: ['owner', 'created', 'activity', 'leadStatus', 'lifecycle', 'source', 'tag'],
  companies: ['owner', 'created', 'activity', 'lifecycle', 'industry', 'tag'],
  deals: ['owner', 'created', 'close', 'activity', 'stage', 'priority', 'source', 'tag', 'stalled'],
};

/** Los de fábrica (sin `qf`). */
export const DEFAULT_QUICK_FILTERS: Record<QuickFilterEntity, readonly string[]> = {
  contacts: ['owner', 'created', 'activity', 'leadStatus', 'lifecycle'],
  companies: ['owner', 'created', 'activity', 'lifecycle', 'industry'],
  deals: ['owner', 'created', 'close', 'activity', 'stage'],
};

/** `qf=none`: la vista no muestra ninguno. */
export const NO_QUICK_FILTERS = 'none';

const ALL = new Set(Object.values(QUICK_FILTERS).flat());
const MAX = 12;

/** Normaliza el param: ids conocidos, sin repetir, con tope; `none` si es lo único. '' = inválido. */
export function serializeQuickFilters(raw: string | null | undefined): string {
  if (!raw) return '';
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id === NO_QUICK_FILTERS && !ids.length) return NO_QUICK_FILTERS;
    if (ALL.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX) break;
  }
  return ids.join(',');
}

/** Los filtros rápidos a mostrar en este listado, en orden. */
export function quickFiltersFor(entity: QuickFilterEntity, qf: string | null | undefined): string[] {
  const clean = serializeQuickFilters(qf);
  if (!clean) return [...DEFAULT_QUICK_FILTERS[entity]];
  if (clean === NO_QUICK_FILTERS) return [];
  const known = new Set(QUICK_FILTERS[entity]);
  return clean.split(',').filter((id) => known.has(id));
}

/** El valor de `qf` para una elección (sin param si es la de fábrica). */
export function quickFiltersParam(entity: QuickFilterEntity, ids: readonly string[]): string | undefined {
  const known = new Set(QUICK_FILTERS[entity]);
  const clean = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
  if (!clean.length) return NO_QUICK_FILTERS;
  const defaults = DEFAULT_QUICK_FILTERS[entity];
  if (clean.length === defaults.length && clean.every((id, i) => id === defaults[i])) return undefined;
  return clean.join(',');
}
