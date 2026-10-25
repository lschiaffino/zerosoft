import { NextResponse } from 'next/server';
import { BULK_ACTIONS, bulkChats, type BulkAction } from '@/lib/groups-inbox';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { canSeeChat } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Acciones en masa sobre chats de la bandeja: { ids, action } con action
 * close, reopen, read, unread, pin, unpin o assign (con assignedTo, null para
 * quitar). Hasta 200 chats; cada uno queda en su historial.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const action = str(b.action, 20) as BulkAction | undefined;
  if (!action || !(BULK_ACTIONS as readonly string[]).includes(action)) return groupsError(400, 'invalid_action');
  // Solo los chats que esta persona puede ver (acceso por etiqueta); el resto cuenta como fallido.
  const all = strArr(b.ids, 200);
  const viewer = await sessionViewer(s);
  const ids: string[] = [];
  for (const id of all) if (await canSeeChat(viewer, id)) ids.push(id);
  if (all.length === 0) return groupsError(400, 'no_recipients');
  try {
    const res = await bulkChats(s.ws, s.me, ids, action, b.assignedTo === null ? null : str(b.assignedTo, 100));
    return NextResponse.json({ updated: res.updated, failed: res.failed + (all.length - ids.length) });
  } catch (err) {
    return handleGroupsError(err);
  }
}
