import { NextResponse } from 'next/server';
import { CHAT_FILTERS, listChats, type ChatFilter, type ChatQuery, type PropertyFilter } from '@/lib/groups';
import { getSavedList, listQuery } from '@/lib/groups-org';
import { groupsError, groupsSession, sessionViewer } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';
import { parseHubspotFilterParam } from '@/lib/groups-hubspot-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?props=[{"key":"plan","op":"is","value":"Pro"}] → filtros válidos. */
function parseProps(raw: string | null): PropertyFilter[] {
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
 * Bandeja: chats y grupos con filtros (sin leer, sin responder, míos,
 * etiqueta, asignado, equipo, propiedades, vinculados a HubSpot con
 * ?hubspot=linked|unlinked, por propiedades de la empresa de HubSpot con
 * ?hs=[{"name":"industry","op":"any_of","values":["RETAIL"]}]; operadores is,
 * is_not, contains, gt, lt, any_of, none_of, empty, not_empty) y búsqueda en mensajes. Los fijados
 * van primero. ?list=<id> aplica
 * una lista guardada (los demás parámetros se suman encima).
 * Paginado: con ?cursor= (vacío para la primera página) responde
 * { rows, next, pinned }: `next` es el cursor de la página que sigue (null si
 * no hay más) y `pinned`, cuántos fijados vienen adelante en la primera página
 * (no cuentan para ?limit=, hasta 1000); así se recorre toda la historia sin
 * saltear ni repetir chats. Sin
 * ?cursor=, ?limit= y ?offset= con { rows, total }. ?meta=0 deja afuera lo
 * que acompaña a la lista (importaciones, no leídos, archivados, líneas
 * caídas). Con If-None-Match y sin cambios responde 304.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  let base: ChatQuery = {};
  const listId = p.get('list');
  if (listId) {
    const list = await getSavedList(s.ws, s.me, listId);
    if (!list) return groupsError(404, 'not_found');
    base = listQuery(list.filters);
  }
  const filter = (CHAT_FILTERS as readonly string[]).includes(p.get('filter') ?? '') ? (p.get('filter') as ChatFilter) : undefined;
  const kind = p.get('kind') === 'group' || p.get('kind') === 'dm' ? (p.get('kind') as 'group' | 'dm') : undefined;
  const props = parseProps(p.get('props'));
  const labels = (p.get('labels') ?? '').split(',').filter(Boolean);
  const hubspot = p.get('hubspot') === 'linked' || p.get('hubspot') === 'unlinked' ? (p.get('hubspot') as 'linked' | 'unlinked') : undefined;
  const paged = p.has('cursor');
  const viewer = await sessionViewer(s);
  const withMeta = p.get('meta') !== '0';
  const { activeImports, kickImport } = await import('@/lib/groups-import');
  const { countUnreadChats, countArchivedChats, droppedNumbers } = await import('@/lib/groups');
  const { hubspotConnected } = await import('@/lib/groups-hubspot');
  // La lista y lo que la acompaña van juntos: ninguna consulta espera a la otra.
  const [res, imports, unreadChats, archived, dropped, hubspotOn] = await Promise.all([
    listChats(s.ws, s.me, {
      ...base,
      filter: filter && filter !== 'all' ? filter : (base.filter ?? 'all'),
      q: p.get('q') || base.q || '',
      labelId: p.get('label') || undefined,
      labelIds: labels.length ? labels : base.labelIds,
      assignee: p.get('assignee') || base.assignee,
      props: [...(base.props ?? []), ...props],
      teamId: p.get('team') || base.teamId,
      numberId: p.get('number') || base.numberId,
      folderId: p.get('folder') || base.folderId,
      ownerId: p.get('owner') || base.ownerId,
      kind: kind ?? base.kind,
      hubspot: hubspot ?? base.hubspot,
      hsProps: [...(base.hsProps ?? []), ...parseHubspotFilterParam(p.get('hs'))],
      limit: Number(p.get('limit')) || 50,
      offset: Number(p.get('offset')) || 0,
      viewer,
      archived: p.get('archived') === '1',
      ...(paged ? { cursor: p.get('cursor') ?? '', count: false } : {}),
    }),
    // Importación en curso al conectar un número: la bandeja muestra el progreso.
    withMeta ? activeImports(s.ws, viewer).catch(() => []) : Promise.resolve([]),
    withMeta ? countUnreadChats(s.ws, viewer).catch(() => 0) : Promise.resolve(0),
    withMeta ? countArchivedChats(s.ws, viewer).catch(() => ({ total: 0, unread: 0 })) : Promise.resolve({ total: 0, unread: 0 }),
    // Líneas que se cayeron (tenían chats y ya no están conectadas): aviso para reconectar.
    withMeta ? droppedNumbers(s.ws, viewer).catch(() => []) : Promise.resolve([]),
    // Con HubSpot conectado, la bandeja ofrece el filtro "Vinculados a HubSpot".
    withMeta ? hubspotConnected(s.ws).catch(() => false) : Promise.resolve(false),
  ]);
  // Mientras alguien mira la bandeja, la importación avanza sin esperar al cron (cada tanda reclama su fila).
  for (const im of imports) if (im.status === 'queued' || im.status === 'running') await kickImport(im.numberId);
  if (paged) {
    const page = { rows: res.rows, next: res.next ?? null, pinned: res.pinned ?? 0 };
    return conditionalJson(req, withMeta ? { ...page, imports, unreadChats, archived, dropped, hubspot: hubspotOn } : page);
  }
  return conditionalJson(req, withMeta ? { ...res, imports, unreadChats, archived, dropped, hubspot: hubspotOn } : res);
}
