import { iJson, withOwner } from '@/lib/inbox/http';
import { limitByIp } from '@/lib/rate-limit';
import { InboxError } from '@/lib/inbox/types';
import { sendMyPresence, setBlocked, sharedContent, type SharedKind } from '@/lib/inbox/wa-meta';
import { makeSummary, readSummary } from '@/lib/inbox/wa-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const KINDS: SharedKind[] = ['media', 'docs', 'links', 'starred'];

/**
 * Panel de info de un chat de WhatsApp: ?part=shared&kind=media|docs|links|starred
 * (lo compartido en el chat) o ?part=summary (el resumen guardado).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    if (sp.get('part') === 'summary') return iJson({ summary: await readSummary(owner, id) });
    const kind = sp.get('kind') as SharedKind;
    if (!KINDS.includes(kind)) throw new InboxError('invalid_input', 400);
    return iJson({ items: await sharedContent(owner, id, kind) });
  });
}

/**
 * { action: 'summary' } pide un resumen nuevo a la IA; { action: 'block' |
 * 'unblock' } bloquea en WhatsApp; { action: 'presence', state } manda
 * "escribiendo", "grabando" o se suscribe a la presencia del chat ("paused");
 * { action: 'fetchMissing', auto? } le pide al teléfono el historial del chat.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { action?: unknown; state?: unknown } | null;
  if (b?.action === 'presence') {
    const limitedP = await limitByIp(req, 'inbox-presence', 120, 60).catch(() => null);
    if (limitedP) return limitedP;
    const state = b.state === 'composing' || b.state === 'recording' ? b.state : 'paused';
    return withOwner(async (owner) => {
      await sendMyPresence(owner, id, state);
      return iJson({ ok: true });
    });
  }
  if (b?.action === 'fetchMissing') {
    // El historial del chat desde el teléfono (mensajes que WhatsApp no pudo entregar, lib/wa-history-gaps.ts).
    const auto = (b as { auto?: unknown }).auto === true;
    return withOwner(async (owner) => {
      const { requestChatHistory, historyResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestChatHistory('inbox', owner, id, { auto });
      if (!out) throw new InboxError('not_found', 404);
      const r = historyResponse(out, auto);
      return iJson(r.body, r.status);
    });
  }
  const limited = await limitByIp(req, 'inbox-ai', 60, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    if (b?.action === 'summary') return iJson({ summary: await makeSummary(owner, id) });
    if (b?.action === 'block' || b?.action === 'unblock') {
      await setBlocked(owner, id, b.action === 'block');
      return iJson({ ok: true });
    }
    throw new InboxError('invalid_input', 400);
  });
}
