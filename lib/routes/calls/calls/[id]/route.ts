import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteCall, getCallDetail, updateCall } from '@/lib/calls/core';
import { callsActor, cFail, cJson, parseBody } from '@/lib/calls/http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: la llamada con transcripción, hablantes, análisis, métricas, comentarios y clips. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    return cJson({ call: await getCallDetail(a.actor, id, await sessionScope(a.user)) });
  } catch (err) {
    return cFail(err);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dealId: z.string().max(80).nullable().optional(),
  speakers: z
    .array(z.object({ id: z.string().max(20), name: z.string().trim().max(120).optional(), side: z.enum(['internal', 'external']).optional() }))
    .max(50)
    .optional(),
});

/** PATCH: renombrar, vincular a un deal, o corregir nombre y lado de un hablante. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const scope = await sessionScope(a.user);
    await updateCall(a.actor, id, await parseBody(req, patchSchema), scope);
    return cJson({ call: await getCallDetail(a.actor, id, scope) });
  } catch (err) {
    return cFail(err);
  }
}

/** DELETE: borra la llamada y su grabación (si el bot está adentro, sale). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    await deleteCall(a.actor, id);
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
