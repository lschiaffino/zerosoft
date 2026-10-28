import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-auth';
import { apiGetBoard, apiTrashBoard, apiUpdateBoard } from '@/lib/board-platform';
import { boardUpdateV1, boardsApi, boardsV1Error, v1Json } from '@/lib/board-v1';
import { emitEventSoon } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/boards/:id?scene=1 — datos, resumen (frames, stickies, textos) y, con scene=1, la escena de Excalidraw. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await boardsApi(req, 'boards:read');
  if ('res' in auth) return auth.res;
  try {
    return NextResponse.json({ data: await apiGetBoard(auth.actor, id, new URL(req.url).searchParams.get('scene') === '1') });
  } catch (err) {
    return boardsV1Error(err);
  }
}

/** PATCH /api/v1/boards/:id — { name?, folderId? } */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await boardsApi(req, 'boards:write');
  if ('res' in auth) return auth.res;
  const parsed = boardUpdateV1.safeParse(await v1Json(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    return NextResponse.json({ data: await apiUpdateBoard(auth.actor, id, parsed.data) });
  } catch (err) {
    return boardsV1Error(err);
  }
}

/** DELETE /api/v1/boards/:id — a la papelera (30 días, se restaura desde la app). */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await boardsApi(req, 'boards:write');
  if ('res' in auth) return auth.res;
  try {
    await apiTrashBoard(auth.actor, id);
    await emitEventSoon(auth.actor.ws, 'board.deleted', { board: { id, name: '' } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return boardsV1Error(err);
  }
}
