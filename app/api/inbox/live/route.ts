import { iJson, inboxOwner } from '@/lib/inbox/http';
import { livePoll } from '@/lib/wa-live';
import { requestCursor } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aviso en vivo de la lista de Inbox: qué chats de la persona cambiaron desde
 * ?cursor= (solo ids), { events, cursor }. Por índice: sin cambios no lee filas.
 */
export async function GET(req: Request) {
  const a = await inboxOwner();
  if ('res' in a) return a.res;
  return iJson(await livePoll({ app: 'inbox', owner: a.owner }, requestCursor(req)));
}
