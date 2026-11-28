import { NextResponse } from 'next/server';
import { joinGroup } from '@/lib/groups-org';
import { groupsError, groupsSession, lineGuard, handleGroupsError, readJson, str } from '@/lib/groups-http';
import { canSeeChat, maskChat, scopeChatCrmRef } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * { numberId, invite }: entra al grupo con el link o código de invitación y lo trae a Groups.
 * Si quien pide no ve ese chat (solo ve sus chats y el grupo no es suyo), la
 * línea igual entra pero no se devuelve nada del chat: 403 join_no_access.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const numberId = str(b.numberId, 100) ?? '';
  if (!numberId) return groupsError(400, 'invalid_number');
  const line = await lineGuard(s, numberId);
  if (line instanceof NextResponse) return line;
  try {
    const chat = await joinGroup(s.ws, numberId, str(b.invite, 300) ?? '');
    // Un grupo que la línea había dejado vuelve con sus datos: solo si quien pide ve ese chat, con su máscara y la visibilidad del CRM.
    const viewer = line.viewer;
    if (!(await canSeeChat(viewer, chat.id))) return groupsError(403, 'join_no_access');
    return NextResponse.json(await scopeChatCrmRef(viewer, maskChat(viewer, chat)), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
