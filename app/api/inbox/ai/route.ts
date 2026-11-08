import { draftReply, rewriteText } from '@/lib/inbox/ai';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { aiSchema } from '@/lib/inbox/schemas';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Borrador de respuesta o reescritura. Nunca manda: devuelve el texto para el campo. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-ai', 60, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const body = await parseBody(req, aiSchema);
    const text = body.action === 'draft' ? await draftReply(owner, body.threadId, body.instruction) : await rewriteText(owner, body.text, body.mode, body.instruction);
    return iJson({ text });
  });
}
