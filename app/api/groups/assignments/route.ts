import { NextResponse } from 'next/server';
import { assignmentHistory } from '@/lib/groups-lines';
import { chatGuard, groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?chat=<id>: historial de asignación del chat (manual, por regla, por equipo, reasignado al desconectarse). */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const chatId = p.get('chat');
  if (!chatId) return groupsError(400, 'not_found');
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ events: await assignmentHistory(s.ws, guard.viewer, chatId, Number(p.get('limit')) || 100) });
}
