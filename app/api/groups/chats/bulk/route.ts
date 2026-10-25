import { NextResponse } from 'next/server';
import { BULK_ACTIONS, bulkChats, type BulkAction } from '@/lib/groups-inbox';
import { groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

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
  const ids = strArr(b.ids, 200);
  if (ids.length === 0) return groupsError(400, 'no_recipients');
  try {
    return NextResponse.json(await bulkChats(s.ws, s.me, ids, action, b.assignedTo === null ? null : str(b.assignedTo, 100)));
  } catch (err) {
    return handleGroupsError(err);
  }
}
