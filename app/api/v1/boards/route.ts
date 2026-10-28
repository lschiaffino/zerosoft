import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-auth';
import { apiCreateBoard, apiListBoards } from '@/lib/board-platform';
import { boardCreateV1, boardsApi, boardsV1Error, v1Json } from '@/lib/board-v1';
import { emitEventSoon } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/boards?q=&folder=&limit= — pizarras que ve la persona de la key (q busca también adentro). */
export async function GET(req: Request) {
  const ctx = await boardsApi(req, 'boards:read');
  if ('res' in ctx) return ctx.res;
  const p = new URL(req.url).searchParams;
  try {
    const data = await apiListBoards(ctx.actor, { q: p.get('q') ?? '', folderId: p.get('folder'), limit: Number(p.get('limit') ?? 50) || 50 });
    return NextResponse.json({ data });
  } catch (err) {
    return boardsV1Error(err);
  }
}

/** POST /api/v1/boards — pizarra nueva, vacía o desde una plantilla, opcionalmente en una carpeta. */
export async function POST(req: Request) {
  const ctx = await boardsApi(req, 'boards:write');
  if ('res' in ctx) return ctx.res;
  const parsed = boardCreateV1.safeParse(await v1Json(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const board = await apiCreateBoard(ctx.actor, parsed.data);
    await emitEventSoon(ctx.actor.ws, 'board.created', { board: { id: board.id, name: board.name }, createdBy: ctx.actor.personId });
    return NextResponse.json({ data: board }, { status: 201 });
  } catch (err) {
    return boardsV1Error(err);
  }
}
