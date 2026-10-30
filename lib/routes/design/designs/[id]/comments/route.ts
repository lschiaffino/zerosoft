import { NextRequest } from 'next/server';
import { z } from 'zod';
import { addComment, listComments } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';
import { notifyDesignComment } from '@/lib/design-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    return designJson({ comments: await listComments(s.actor, id) });
  } catch (err) {
    return designFail(err);
  }
}

const postSchema = z.object({
  pageId: z.string().max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  body: z.string().min(1).max(2000),
  parentId: z.string().max(64).nullable().optional(),
});

/** Comentario nuevo fijado en (x, y) de una página, o respuesta a un hilo. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    const { comment, notify, designName } = await addComment(s.actor, id, parsed.data);
    await notifyDesignComment(s.actor, id, designName, comment.parentId ?? comment.id, notify, comment.body);
    return designJson({ comment }, 201);
  } catch (err) {
    return designFail(err);
  }
}
