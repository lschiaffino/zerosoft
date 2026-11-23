import { NextResponse } from 'next/server';
import { joinGroup } from '@/lib/groups-org';
import { groupsError, groupsSession, lineGuard, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { maskChat, scopeChatCrmRef } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** { numberId, invite }: entra al grupo con el link o código de invitación y lo trae a Groups. */
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
    // Un grupo que la línea había dejado vuelve con sus datos: con la máscara y la visibilidad del CRM de quien pide.
    const viewer = await sessionViewer(s);
    return NextResponse.json(await scopeChatCrmRef(viewer, maskChat(viewer, chat)), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
