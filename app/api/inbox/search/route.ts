import { iJson, withOwner } from '@/lib/inbox/http';
import { searchMessages } from '@/lib/inbox/message-search';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mensajes de la persona que coinciden con ?q= (texto y filtros from:, in:,
 * has:, before:, after:), del más nuevo al más viejo. ?before= pagina.
 * ?thread= (repetible) busca solo en esos chats: la lupa de una conversación.
 */
export async function GET(req: Request) {
  const limited = await limitByIp(req, 'inbox-search', 120, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    const r = await searchMessages(owner, sp.get('q') ?? '', { before: sp.get('before') ?? undefined, limit: Number(sp.get('limit')) || 30, threads: sp.getAll('thread') });
    return iJson({ messages: r.hits, more: r.more });
  });
}
