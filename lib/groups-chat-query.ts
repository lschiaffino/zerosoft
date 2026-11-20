/**
 * Lines: los parámetros de la bandeja (los de GET /api/groups/chats) como
 * ChatQuery, para la vista kanban (app/api/groups/kanban): filtra igual que la
 * lista. La lista los lee en su propia ruta (el catálogo del MCP saca de ahí
 * sus parámetros): un parámetro nuevo allá va también acá
 * (tests/unit/lines-inbox-kanban.test.ts compara las dos). Server-only.
 */
import { CHAT_FILTERS, type ChatFilter, type ChatQuery, type PropertyFilter } from './groups';
import { getSavedList, listQuery } from './groups-org';
import { parseHubspotFilterParam } from './groups-hubspot-shared';
import { linesFiltersFromParam, parseLinesFilters } from './groups-filters';
import type { GroupsViewer } from './groups-access';

/** ?props=[{"key":"plan","op":"is","value":"Pro"}] → filtros válidos. */
export function parseChatProps(raw: string | null): PropertyFilter[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .slice(0, 10)
      .map((p) => (p ?? {}) as Record<string, unknown>)
      .map((p) => ({
        key: String(p.key ?? ''),
        op: (['is', 'set', 'unset'].includes(String(p.op)) ? p.op : 'is') as PropertyFilter['op'],
        value: p.value == null ? undefined : String(p.value),
      }));
  } catch {
    return [];
  }
}

/**
 * La consulta de la bandeja para estos parámetros (sin paginado). null si
 * ?list= es una lista guardada que no existe o que quien mira no ve.
 */
export async function chatQueryFromParams(ws: string, me: string, viewer: GroupsViewer, p: URLSearchParams): Promise<ChatQuery | null> {
  let base: ChatQuery = {};
  const listId = p.get('list');
  if (listId) {
    const list = await getSavedList(ws, me, listId);
    if (!list) return null;
    base = listQuery(list.filters);
  }
  const filter = (CHAT_FILTERS as readonly string[]).includes(p.get('filter') ?? '') ? (p.get('filter') as ChatFilter) : undefined;
  const kind = p.get('kind') === 'group' || p.get('kind') === 'dm' ? (p.get('kind') as 'group' | 'dm') : undefined;
  const props = parseChatProps(p.get('props'));
  const labels = (p.get('labels') ?? '').split(',').filter(Boolean);
  const hubspot = p.get('hubspot') === 'linked' || p.get('hubspot') === 'unlinked' ? (p.get('hubspot') as 'linked' | 'unlinked') : undefined;
  // Los filtros del panel de la bandeja (?f=) se suman a los de la lista guardada; los parámetros sueltos de siempre siguen valiendo.
  const panel = p.get('f') ? linesFiltersFromParam(p.get('f')) : null;
  const filters = panel || base.filters ? parseLinesFilters({ ...base.filters, ...panel }) : undefined;
  const tz = Number(p.get('tz'));
  return {
    ...base,
    filter: filter && filter !== 'all' ? filter : (base.filter ?? 'all'),
    q: p.get('q') || panel?.q || base.q || '',
    filters,
    tzOffsetMin: Number.isFinite(tz) ? tz : 0,
    labelId: p.get('label') || undefined,
    labelIds: labels.length ? labels : base.labelIds,
    assignee: p.get('assignee') || base.assignee,
    props: [...(base.props ?? []), ...props],
    teamId: p.get('team') || base.teamId,
    numberId: p.get('number') || base.numberId,
    lineGroupId: p.get('linegroup')?.slice(0, 100) || undefined,
    folderId: p.get('folder') || base.folderId,
    ownerId: p.get('owner') || base.ownerId,
    kind: kind ?? base.kind,
    hubspot: hubspot ?? panel?.hubspot ?? base.hubspot,
    hsProps: [...(panel?.hsProps ?? base.hsProps ?? []), ...parseHubspotFilterParam(p.get('hs'))],
    viewer,
    archived: p.get('archived') === '1',
    hidden: p.get('hidden') === '1',
  };
}
