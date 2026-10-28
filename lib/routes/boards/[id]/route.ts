import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { getBoard, getBoardName, moveBoardToFolder, renameBoard, setBoardThumbnail, trashBoard } from '@/lib/boards';
import { logBoardAudit } from '@/lib/board-audit';
import { publishBoardAccessChanged } from '@/lib/board-live';
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
  const personId = user.actingUser?.id ?? user.id;
  // Mover a una carpeta (null = sin carpeta).
  if (body && body.name === undefined && body.folderId !== undefined) {
    const folderId = body.folderId === null ? null : typeof body.folderId === 'string' && body.folderId.length <= 64 ? body.folderId : undefined;
    if (folderId === undefined) return jsonError(400, 'invalid_input');
    const res = await moveBoardToFolder(user.id, id, folderId);
    if (res === 'not_found') return jsonError(404, 'not_found');
    if (res === 'no_folder') return jsonError(400, 'no_folder');
    await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'board.moved', boardId: id, boardName: await getBoardName(user.id, id), data: { folderId } });
    return NextResponse.json({ ok: true, folder_id: folderId });
  }
  // Solo la miniatura (pizarra creada desde una plantilla): no cuenta como edición.
  if (body && body.name === undefined && body.thumbnail !== undefined) {
    const thumb = boardThumbnailSchema.safeParse(body);
    if (!thumb.success) return invalidInput(thumb.error);
    if (!(await setBoardThumbnail(user.id, id, thumb.data.thumbnail))) return jsonError(404, 'not_found');
    return NextResponse.json({ ok: true });
  }
  const parsed = boardRenameSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);
  const before = await getBoardName(user.id, id);
  if (!(await renameBoard(user.id, id, parsed.data.name, personId))) {
    return jsonError(404, 'not_found');
  }
  if (before !== parsed.data.name.trim()) {
    await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'board.renamed', boardId: id, boardName: parsed.data.name.trim(), data: { from: before } });
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
  // A la papelera (30 días): se restaura desde la lista; los links dejan de andar mientras tanto.
  const personId = user.actingUser?.id ?? user.id;
  if (!(await trashBoard(user.id, id, personId))) return jsonError(404, 'not_found');
  // Quien la tenga abierta en vivo pierde la conexión.
  await publishBoardAccessChanged(user.id, id);
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'board.trashed', boardId: id, boardName: name });
  await emitEventSoon(user.id, 'board.deleted', { board: { id, name: name ?? '' } });
  return new NextResponse(null, { status: 204 });
}
