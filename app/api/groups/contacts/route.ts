import { NextResponse } from 'next/server';
import { searchNewChat } from '@/lib/groups-new-chat';
import { groupsError, groupsSession, handleGroupsError, lineGuard } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A quién escribirle desde una línea ("Chat nuevo"): ?number=<id de la línea>
 * y ?q= (nombre o teléfono). Devuelve hasta 20 filas entre los chats 1:1 de
 * esa línea que la persona ve y los contactos de su libreta. Sin ?q=, los
 * chats más recientes. Quien solo ve sus chats no recibe la libreta; con los
 * teléfonos ocultos salen enmascarados.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const sp = new URL(req.url).searchParams;
  const numberId = (sp.get('number') ?? '').slice(0, 100);
  if (!numberId) return groupsError(400, 'invalid_number');
  const line = await lineGuard(s, numberId);
  if (line instanceof NextResponse) return line;
  try {
    return NextResponse.json({ rows: await searchNewChat(line.viewer, numberId, sp.get('q') ?? '') });
  } catch (err) {
    return handleGroupsError(err);
  }
}
