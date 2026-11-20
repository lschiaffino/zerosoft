import { NextResponse } from 'next/server';
import { chatQueryFromParams } from '@/lib/groups-chat-query';
import { getKanbanPrefs, kanbanBoard, setKanbanPrefs } from '@/lib/groups-kanban';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La bandeja de Lines como kanban: los chats que ve quien pide, con los mismos
 * parámetros que GET /api/groups/chats (?f=, ?q=, ?folder=, ?number=,
 * ?linegroup=, ?list=, ?archived=1, ?hidden=1, ?tz=), repartidos en columnas.
 * ?board=team (etapas del equipo), me (las etapas propias) o hs:<propiedad>
 * (una propiedad de selección de la empresa de HubSpot); sin ?board=, el último
 * que eligió la persona. Cada columna trae su conteo y hasta 100 tarjetas.
 * ?prefs=1 responde solo { on, board } (si la vista está prendida y el tablero).
 * Con If-None-Match y sin cambios responde 304.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const sp = new URL(req.url).searchParams;
  const viewer = await sessionViewer(s);
  try {
    if (sp.get('prefs') === '1') return NextResponse.json(await getKanbanPrefs(viewer));
    const query = await chatQueryFromParams(s.ws, s.me, viewer, sp);
    if (!query) return groupsError(404, 'not_found');
    return conditionalJson(req, await kanbanBoard(viewer, sp.get('board')?.slice(0, 200) || null, query));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * Preferencias de quien pide: { on } prende o apaga la vista kanban, { board }
 * recuerda el tablero elegido, { collapsed: { board, columns } } las columnas
 * plegadas de ese tablero. Son de cada persona.
 */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const collapsed = b.collapsed && typeof b.collapsed === 'object' && !Array.isArray(b.collapsed) ? (b.collapsed as Record<string, unknown>) : null;
  try {
    return NextResponse.json(
      await setKanbanPrefs(await sessionViewer(s), {
        ...(typeof b.on === 'boolean' ? { on: b.on } : {}),
        ...(typeof b.board === 'string' ? { board: str(b.board, 200) ?? '' } : {}),
        ...(collapsed ? { collapsed: { board: str(collapsed.board, 200) ?? '', columns: strArr(collapsed.columns, 100) } } : {}),
      }),
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}
