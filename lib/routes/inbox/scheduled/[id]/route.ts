import { cancelScheduled, getScheduledOwned, listScheduled, updateScheduled } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { cancelBatch, firstOpenPart, replaceBatch } from '@/lib/inbox/schedule';
import { scheduledPatchSchema, scheduledReplaceSchema } from '@/lib/inbox/schemas';
import { sendScheduledNow } from '@/lib/inbox/send';
import { InboxError } from '@/lib/inbox/types';
import { deleteUploads } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Cambiar texto u hora de un mensaje (un fallido o no enviado vuelve a quedar pendiente). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await updateScheduled(owner, id, await parseBody(req, scheduledPatchSchema));
    return iJson({ scheduled: await listScheduled(owner) });
  });
}

/** Reemplazar lo que falta mandar de la secuencia (editar). */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await replaceBatch(owner, id, await parseBody(req, scheduledReplaceSchema));
    return iJson({ scheduled: await listScheduled(owner) });
  });
}

/** Enviar ya: la primera parte que falta sale ahora y las siguientes con sus esperas. */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const first = await firstOpenPart(owner, id);
    const r = await sendScheduledNow(first.id);
    if (r.failed && !r.sent) {
      const row = await getScheduledOwned(owner, first.id);
      throw new InboxError(row.error || 'send_failed', 502);
    }
    return iJson({ result: r.sent ? 'sent' : 'skipped', scheduled: await listScheduled(owner) });
  });
}

/** Cancelar un mensaje, o con ?all=1 todo lo que falta de su secuencia. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    if (new URL(req.url).searchParams.get('all') === '1') await cancelBatch(owner, id);
    else {
      const row = await getScheduledOwned(owner, id);
      await cancelScheduled(owner, id);
      if (row.media_url) await deleteUploads([row.media_url]);
    }
    return iJson({ scheduled: await listScheduled(owner) });
  });
}
