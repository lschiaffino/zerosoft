import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { addComment, listComments } from '@/lib/docs-platform';
import { docsApi, docsV1Error, v1Body } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/docs/pages/:id/comments — comentarios e hilos de la página. */
export async function GET(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  try {
    return NextResponse.json({ data: await listComments(ctx.actor, id) });
  } catch (err) {
    return docsV1Error(err);
  }
}

const schema = z.object({
  text: z.string().trim().min(1).max(5000),
  blockId: z.string().max(100).nullish(),
  /** Responde en el hilo de este comentario. */
  parentId: z.string().max(100).nullish(),
});

/** POST /api/v1/docs/pages/:id/comments — comenta la página, un bloque o responde un hilo (como la persona de la key). */
export async function POST(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await v1Body(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    return NextResponse.json({ data: await addComment(ctx.actor, id, parsed.data) }, { status: 201 });
  } catch (err) {
    return docsV1Error(err);
  }
}
