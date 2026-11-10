import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authBot, handleBotEvent } from '@/lib/calls/bot';
import { callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  type: z.enum(['joining', 'waiting_room', 'in_call', 'recording', 'participants', 'left', 'failed']),
  at: z.string().max(40).optional(),
  detail: z.object({ reason: z.string().max(40).optional() }).passthrough().optional(),
  participants: z.array(z.object({ name: z.string().max(200) })).max(200).optional(),
});

/** POST: estado del bot en la reunión (lo manda services/calls-bot con el token del trabajo). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = await callsLimit(req, 'bot-event', 600, 60);
  if (limited) return limited;
  const { id } = await ctx.params;
  const row = await authBot(req, id);
  if (!row) return cJson({ error: 'unauthorized' }, 401);
  try {
    await handleBotEvent(row, await parseBody(req, schema));
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
