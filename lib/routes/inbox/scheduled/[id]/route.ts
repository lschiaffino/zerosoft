import { cancelScheduled, getScheduledOwned, listScheduled, updateScheduled } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { scheduledPatchSchema } from '@/lib/inbox/schemas';
import { sendScheduled } from '@/lib/inbox/send';
import { InboxError } from '@/lib/inbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Cambiar texto u hora (un fallido o no enviado vuelve a quedar pendiente). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await updateScheduled(owner, id, await parseBody(req, scheduledPatchSchema));
    return iJson({ scheduled: await listScheduled(owner) });
  });
}

/** Enviar ya. */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await getScheduledOwned(owner, id);
    const r = await sendScheduled(id, new Date(), true);
    if (r === 'failed') {
      const row = await getScheduledOwned(owner, id);
      throw new InboxError(row.error || 'send_failed', 502);
    }
    return iJson({ result: r, scheduled: await listScheduled(owner) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await cancelScheduled(owner, id);
    return iJson({ scheduled: await listScheduled(owner) });
  });
}
