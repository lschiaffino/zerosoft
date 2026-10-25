import { NextResponse } from 'next/server';
import { CHAT_FILTERS, listChats, type ChatFilter, type ChatQuery, type PropertyFilter } from '@/lib/groups';
import { getSavedList, listQuery } from '@/lib/groups-org';
import { groupsError, groupsSession } from '@/lib/groups-http';

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
 * etiqueta, asignado, propiedades) y búsqueda en mensajes. ?list=<id> aplica
 * una lista guardada (los demás parámetros se suman encima).
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
  const res = await listChats(s.ws, s.me, {
    ...base,
    filter: filter && filter !== 'all' ? filter : (base.filter ?? 'all'),
    q: p.get('q') || base.q || '',
    labelId: p.get('label') || undefined,
    labelIds: labels.length ? labels : base.labelIds,
    assignee: p.get('assignee') || base.assignee,
    props: [...(base.props ?? []), ...props],
    numberId: p.get('number') || base.numberId,
    kind: kind ?? base.kind,
    limit: Number(p.get('limit')) || 50,
    offset: Number(p.get('offset')) || 0,
  });
  return NextResponse.json(res);
}
