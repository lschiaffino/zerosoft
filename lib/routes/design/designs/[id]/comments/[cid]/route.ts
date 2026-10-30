import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteComment, updateComment } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; cid: string }> };

const patchSchema = z.object({ resolved: z.boolean().optional(), body: z.string().max(2000).optional() });

/** Resolver o reabrir un hilo, o editar el texto propio. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id, cid } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    await updateComment(s.actor, id, cid, parsed.data);
    return designJson({ ok: true });
  } catch (err) {
    return designFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id, cid } = await ctx.params;
  try {
    await deleteComment(s.actor, id, cid);
    return new Response(null, { status: 204 });
  } catch (err) {
    return designFail(err);
  }
}
