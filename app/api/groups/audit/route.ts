import { NextResponse } from 'next/server';
import { listAudit } from '@/lib/groups-audit';
import { canSeeChat, maskPhoneText, visibleChatIds } from '@/lib/groups-access';
import { groupsError, groupsSession, sessionViewer } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Log de auditoría. ?chat=<id> el de un chat (quien ve el chat); sin chat, el
 * del workspace (solo admins). Filtros: action, actor.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const chatId = p.get('chat') || undefined;
  const viewer = await sessionViewer(s);
  if (chatId) {
    if (!(await canSeeChat(viewer, chatId))) return groupsError(404, 'not_found');
  } else if (!s.isAdmin) return groupsError(403, 'forbidden');
  const entries = await listAudit(s.ws, {
    chatId,
    action: p.get('action') || undefined,
    actorId: p.get('actor') || undefined,
    chatIds: chatId ? null : await visibleChatIds(viewer),
    limit: Number(p.get('limit')) || 100,
  });
  return NextResponse.json({ entries: viewer.mask ? entries.map((e) => ({ ...e, chatName: maskPhoneText(e.chatName) })) : entries });
}
