import { NextResponse } from 'next/server';
import { HubspotError } from '@/lib/groups-hubspot';
import { moveKanbanCard } from '@/lib/groups-kanban';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * { chatId, board, column }: mueve un chat a una columna del tablero kanban.
 * board 'team' guarda la etapa del equipo (la ve el equipo), 'me' la etapa
 * propia (solo quien pide), 'hs:<propiedad>' escribe esa propiedad en la
 * empresa de HubSpot vinculada al chat. column 'none' lo saca de toda etapa
 * (o vacía la propiedad). Un chat que no ve, o una etapa que no es de este
 * tablero para quien pide (la de otra persona), es 404.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const chatId = str(b.chatId, 100) ?? '';
  const board = str(b.board, 200) ?? '';
  const column = str(b.column, 200) ?? '';
  if (!chatId || !board || !column) return groupsError(400, 'invalid_input');
  try {
    return NextResponse.json(await moveKanbanCard(await sessionViewer(s), board, chatId, column));
  } catch (err) {
    if (err instanceof HubspotError && err.detail) return NextResponse.json({ error: err.code, detail: err.detail }, { status: err.status });
    return handleGroupsError(err);
  }
}
