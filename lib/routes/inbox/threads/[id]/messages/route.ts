import { createScheduled, listMessages } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { limitByIp } from '@/lib/rate-limit';
import { sendSchema } from '@/lib/inbox/schemas';
import { sendToThread } from '@/lib/inbox/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Mensajes anteriores a ?before= (al subir en la conversación). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const before = new URL(req.url).searchParams.get('before') ?? undefined;
    return iJson(await listMessages(owner, id, { before }));
  });
}

/** Manda ya, o programa el envío con sendAt. */
export async function POST(req: Request, ctx: Ctx) {
  const limited = await limitByIp(req, 'inbox-send', 120, 60).catch(() => null);
  if (limited) return limited;
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const body = await parseBody(req, sendSchema);
    if (body.sendAt) return iJson({ scheduled: await createScheduled(owner, id, body.body, body.sendAt) }, 201);
    await sendToThread(owner, id, body.body);
    const page = await listMessages(owner, id);
    return iJson({ messages: page.messages, more: page.more }, 201);
  });
}
