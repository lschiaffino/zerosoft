import { NextResponse } from 'next/server';
import { newChatDirectory } from '@/lib/groups-new-chat';
import { groupsError, groupsSession, handleGroupsError, lineGuard } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El panel "Chat nuevo" de una línea: ?number=<id de la línea>, ?q= (nombre o
 * teléfono), ?cursor= (página siguiente) y ?limit=. Devuelve los contactados
 * con frecuencia (sin ?q=, en la primera página) y una página de contactos y
 * chats en orden alfabético. Quien solo ve sus chats no recibe la libreta;
 * con los teléfonos ocultos salen enmascarados.
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
    const dir = await newChatDirectory(line.viewer, numberId, { q: sp.get('q') ?? '', cursor: sp.get('cursor'), limit: Number(sp.get('limit')) || undefined });
    return NextResponse.json(dir, { headers: { 'cache-control': 'private, no-store' } });
  } catch (err) {
    return handleGroupsError(err);
  }
}
