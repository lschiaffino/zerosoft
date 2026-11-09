import { NextResponse } from 'next/server';
import { CHAT_FILTERS, listChats, type ChatFilter, type ChatQuery, type PropertyFilter } from '@/lib/groups';
import { getSavedList, listQuery } from '@/lib/groups-org';
import { groupsError, groupsSession, sessionViewer } from '@/lib/groups-http';

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
 * etiqueta, asignado, equipo, propiedades) y búsqueda en mensajes. Los fijados
 * van primero. ?list=<id> aplica
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
    teamId: p.get('team') || base.teamId,
    numberId: p.get('number') || base.numberId,
    folderId: p.get('folder') || base.folderId,
    ownerId: p.get('owner') || base.ownerId,
    kind: kind ?? base.kind,
    limit: Number(p.get('limit')) || 50,
    offset: Number(p.get('offset')) || 0,
    viewer: await sessionViewer(s),
    archived: p.get('archived') === '1',
  });
  // Importación en curso al conectar un número: la bandeja muestra el progreso.
  const { activeImports, kickImport } = await import('@/lib/groups-import');
  const imports = await activeImports(s.ws, await sessionViewer(s)).catch(() => []);
  const { countUnreadChats, countArchivedChats, droppedNumbers } = await import('@/lib/groups');
  const viewer = await sessionViewer(s);
  const unreadChats = await countUnreadChats(s.ws, viewer).catch(() => 0);
  const archived = await countArchivedChats(s.ws, viewer).catch(() => ({ total: 0, unread: 0 }));
  // Líneas que se cayeron (tenían chats y ya no están conectadas): aviso para reconectar.
  const dropped = await droppedNumbers(s.ws, viewer).catch(() => []);
  // Mientras alguien mira la bandeja, la importación avanza sin esperar al cron (cada tanda reclama su fila).
  for (const im of imports) if (im.status === 'queued' || im.status === 'running') await kickImport(im.numberId);
  return NextResponse.json({ ...res, imports, unreadChats, archived, dropped });
}
