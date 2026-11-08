import { NextResponse } from 'next/server';
import { canSeeChat } from '@/lib/groups-access';
import { chatLines, listLines, setLineAccess } from '@/lib/groups-lines';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Líneas de WhatsApp.
 * - ?chat=<id>: por cuáles se puede responder ese chat ("Responder desde"), { lines: ReplyLine[] }.
 * - Sin parámetros: las líneas que la persona ve, con estado y salud (último mensaje, chats abiertos,
 *   importación); los admins reciben también quién tiene acceso a cada una. { lines: LineDto[], canEdit }.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const viewer = await sessionViewer(s);
  const chatId = new URL(req.url).searchParams.get('chat');
  if (chatId) {
    if (!(await canSeeChat(viewer, chatId))) return groupsError(404, 'not_found');
    return NextResponse.json({ lines: await chatLines(s.ws, viewer, chatId) });
  }
  return NextResponse.json({ lines: await listLines(s.ws, viewer, { withAccess: s.isAdmin }), canEdit: s.isAdmin });
}

/** { numberId, personIds?, teamIds? }: quién ve esa línea con el acceso por línea prendido. Solo admins. */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const numberId = str(b.numberId, 100);
  if (!numberId) return groupsError(400, 'not_found');
  try {
    return NextResponse.json({ numberId, access: await setLineAccess(s.ws, s.me, numberId, { personIds: b.personIds, teamIds: b.teamIds }) });
  } catch (err) {
    return handleGroupsError(err);
  }
}
