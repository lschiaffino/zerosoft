import { NextResponse } from 'next/server';
import { logChatToHubspot } from '@/lib/groups-hubspot';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * { chatId }: deja en HubSpot la conversación de los últimos 7 días de ese
 * chat, como una nota por día en los registros vinculados. Repetirlo
 * actualiza las mismas notas. Hay que poder ver el chat.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const chatId = str((await readJson(req)).chatId, 100) ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    return NextResponse.json(await logChatToHubspot(s.ws, chatId));
  } catch (err) {
    return handleGroupsError(err);
  }
}
