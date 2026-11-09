import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { limitByIp } from '@/lib/rate-limit';
import { messageActionSchema } from '@/lib/inbox/schemas';
import { deleteForEveryone, editOwnMessage, forwardMessage, hideMessage, messageTranscript, reactToMessage, starMessage } from '@/lib/inbox/wa-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** La transcripción guardada de un audio ({ transcript: null } si todavía no se hizo). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => iJson({ transcript: await messageTranscript(owner, id, false) }));
}

/** Transcribe el audio (una sola vez; los largos con resumen). */
export async function POST(req: Request, ctx: Ctx) {
  const limited = await limitByIp(req, 'inbox-transcribe', 60, 60).catch(() => null);
  if (limited) return limited;
  const { id } = await ctx.params;
  return withOwner(async (owner) => iJson({ transcript: await messageTranscript(owner, id, true) }));
}

/** Reaccionar, editar, destacar, borrar para mí o reenviar un mensaje de WhatsApp. */
export async function PATCH(req: Request, ctx: Ctx) {
  const limited = await limitByIp(req, 'inbox-message-action', 240, 60).catch(() => null);
  if (limited) return limited;
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const body = await parseBody(req, messageActionSchema);
    switch (body.action) {
      case 'react':
        await reactToMessage(owner, id, body.emoji);
        break;
      case 'edit':
        await editOwnMessage(owner, id, body.body);
        break;
      case 'star':
      case 'unstar':
        await starMessage(owner, id, body.action === 'star');
        break;
      case 'hide':
        await hideMessage(owner, id);
        break;
      case 'forward':
        return iJson({ ok: true, sent: await forwardMessage(owner, id, body.to) });
    }
    return iJson({ ok: true });
  });
}

/** Borrar para todos (solo lo propio). */
export async function DELETE(req: Request, ctx: Ctx) {
  const limited = await limitByIp(req, 'inbox-message-action', 240, 60).catch(() => null);
  if (limited) return limited;
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await deleteForEveryone(owner, id);
    return iJson({ ok: true });
  });
}
