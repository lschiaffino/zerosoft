import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-auth';
import { apiAddElements } from '@/lib/board-platform';
import { boardElementsV1, boardsApi, boardsV1Error, v1Json } from '@/lib/board-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/boards/:id/elements — suma stickies ({ text, color?, tags? })
 * y formas o textos ({ kind, text?, x?, y?, … }), con flechas entre ellos
 * (connect: [{ from, to }] por índice). Lo que no trae posición va a un hueco libre.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await boardsApi(req, 'boards:write');
  if ('res' in auth) return auth.res;
  const parsed = boardElementsV1.safeParse(await v1Json(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    return NextResponse.json({ data: await apiAddElements(auth.actor, id, parsed.data) }, { status: 201 });
  } catch (err) {
    return boardsV1Error(err);
  }
}
