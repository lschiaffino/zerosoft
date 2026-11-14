import { iJson, withOwner } from '@/lib/inbox/http';
import { inboxNewChatDirectory } from '@/lib/inbox/new-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El panel "Chat nuevo" de WhatsApp en Inbox: ?q= (nombre o teléfono),
 * ?cursor= (página siguiente) y ?limit=. Devuelve "Mandate un mensaje", los
 * contactados con frecuencia y una página de contactos en orden alfabético.
 */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    return iJson(await inboxNewChatDirectory(owner, { q: sp.get('q') ?? '', cursor: sp.get('cursor'), limit: Number(sp.get('limit')) || undefined }));
  });
}
