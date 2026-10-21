import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { deleteBoard, getBoard, getBoardName, renameBoard, setBoardThumbnail } from '@/lib/boards';
import { emitEventSoon } from '@/lib/events';
import { boardRenameSchema, boardThumbnailSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  const board = await getBoard(user.id, id);
  if (!board) return jsonError(404, 'not_found');
  return NextResponse.json({ ...board, my_access: access.level });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const limited = await limitWrites('boards:write', user.actingUser?.id ?? user.id, 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  // Solo la miniatura (pizarra creada desde una plantilla): no cuenta como edición.
  if (body && body.name === undefined && body.thumbnail !== undefined) {
    const thumb = boardThumbnailSchema.safeParse(body);
    if (!thumb.success) return invalidInput(thumb.error);
    if (!(await setBoardThumbnail(user.id, id, thumb.data.thumbnail))) return jsonError(404, 'not_found');
    return NextResponse.json({ ok: true });
  }
  const parsed = boardRenameSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!(await renameBoard(user.id, id, parsed.data.name, user.actingUser?.id ?? user.id))) {
    return jsonError(404, 'not_found');
  }
  return NextResponse.json({ ok: true, name: parsed.data.name.trim() || 'Untitled board' });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  // Una pizarra restringida solo la borra quien gestiona su acceso.
  if (access.level !== 'manage' && (await getBoard(user.id, id))?.access === 'restricted') return jsonError(403, 'forbidden');
  const limited = await limitWrites('boards:write', user.actingUser?.id ?? user.id, 60);
  if (limited) return limited;
  const name = await getBoardName(user.id, id);
  if (!(await deleteBoard(user.id, id))) return jsonError(404, 'not_found');
  await emitEventSoon(user.id, 'board.deleted', { board: { id, name: name ?? '' } });
  return new NextResponse(null, { status: 204 });
}
