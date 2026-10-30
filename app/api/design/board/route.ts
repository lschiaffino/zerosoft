import { NextRequest } from 'next/server';
import { z } from 'zod';
import { userCanUseApp } from '@/lib/workspace';
import { addImageToBoard, DesignBoardError, editableBoards } from '@/lib/design-board';
import { designActor, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pizarras donde la persona puede agregar la página (hace falta tener Board en el workspace). */
export async function GET() {
  const s = await designActor();
  if ('res' in s) return s.res;
  if (!userCanUseApp(s.user, 'board')) return designJson({ boards: [], available: false });
  return designJson({ boards: await editableBoards(s.user), available: true });
}

const schema = z.object({
  boardId: z.string().max(64),
  dataUrl: z.string().max(6_000_000),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
});

/** Agrega la página (PNG armado en el navegador) a la pizarra como imagen. */
export async function POST(req: NextRequest) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  if (!userCanUseApp(s.user, 'board')) return designJson({ error: 'forbidden' }, 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    const res = await addImageToBoard(s.user, parsed.data.boardId, parsed.data);
    return designJson({ ok: true, version: res.version, href: `/app/board/${parsed.data.boardId}` });
  } catch (err) {
    if (err instanceof DesignBoardError) return designJson({ error: err.code }, err.status);
    throw err;
  }
}
